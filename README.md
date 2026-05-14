# Medora

Medora is an offline medication safety assistant for older adults and caregivers. Photograph a pill bottle or type drug names, and Medora checks for dangerous interactions and age-inappropriate medications, then explains the findings in plain language. Everything runs locally — no network calls with patient data.

Built for the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon).

## How it works

Medora has three parts:

- **Frontend** (`client/`) — React + Vite single-page app. Mobile-first UI for capturing labels, confirming the extracted medications, and reading the safety report.
- **Backend** (`server/`, `app.py`) — FastAPI server exposing `/api/extract`, `/api/normalize`, `/api/analyze`, and `/api/ask`. Orchestrates OCR, drug-name resolution, interaction lookup, and LLM-generated explanations.
- **Database** (`medora.db`, built by `build_drug_db.py`) — SQLite containing RxNorm identifiers, DrugBank interaction data, and the AGS Beers Criteria.

A typical request flows: photo → Gemma 4 vision extracts `(drug_name, dosage)` → name normalized against RxNorm → SQLite lookup for interactions and Beers flags → Gemma 4 writes a plain-language summary.

## Features

- Camera and gallery upload, with manual entry as a fallback
- OCR of medication labels via Gemma 4's native multimodal model
- 1.4M+ drug-drug interactions sourced from DrugBank 6.0
- AGS 2023 Beers Criteria screening for adults over 65
- RxNorm-backed name normalization with "did you mean…" confirmations
- Plain-language explanations and a printable visit summary

## Fine-tuning

The off-the-shelf Gemma 4 model produces clinically accurate but cold, jargon-heavy answers — the wrong register for an older patient reading an interaction warning. We fine-tuned it to sound like a careful, warm pharmacist who explains things plainly.

- **Base model:** `unsloth/gemma-4-E2B-it`, loaded in 4-bit.
- **Method:** LoRA (rank 32, alpha 64) on all attention and MLP projections, via [Unsloth](https://unsloth.ai) and TRL's `SFTTrainer`. Response-only loss masking so the model learns to *produce* Medora's voice, not parrot the prompt.
- **Dataset:** ~140 curated `(system, user, assistant)` examples in `training/medora_train.jsonl`. Each system prompt establishes Medora's persona — short sentences, plain language, no repeated disclaimers, defer diagnosis and dosing to a doctor. Assistant turns model the desired tone: acknowledge concerns, name warning signs clearly, give practical guidance, avoid hedging.
- **Training:** 6 epochs, learning rate 1e-4, bf16, ~10 minutes on a Kaggle T4 x2 instance. The full notebook is in `training/medora-fine-tune.ipynb`.
- **Deployment:** the trained adapter is merged and exported to GGUF (`training/medora_gguf_export.ipynb`) and loaded via Ollama as `medora-gemma4-text`, which is what the backend calls at runtime.

## Tech stack

| Component | Tool |
|---|---|
| LLM and OCR | Gemma 4 (E4B or 26B MoE) via Ollama |
| Backend | Python 3.10+, FastAPI, SQLite |
| Frontend | React 18, Vite, Tailwind CSS |
| Drug data | DrugBank 6.0 (CC BY-NC 4.0), AGS Beers Criteria 2023, RxNorm (NLM) |

## Running locally

Prerequisites: Python 3.10+, Node 18+, [Ollama](https://ollama.com) with the Gemma 4 model pulled, and a built `medora.db`.

```bash
# Backend (from repo root)
pip install -r requirements.txt
python app.py                       # serves http://127.0.0.1:8000

# Frontend (in another terminal)
cd client
npm install
npm run dev                         # serves http://localhost:5173
```

The Vite dev server proxies `/api/*` to the FastAPI backend, so the client only needs the one URL.

## Data sources

- DrugBank 6.0 — Knox et al., *Nucleic Acids Res.* 2024;52(D1):D1265–D1275.
- AGS 2023 Beers Criteria — *J Am Geriatr Soc.* 2023;71(7):2052–2081.
- RxNorm — U.S. National Library of Medicine.

## Disclaimer

Medora is an educational tool and is not a substitute for professional medical advice. Always consult a licensed clinician before changing medications.
