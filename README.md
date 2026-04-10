# MedGuard

Offline medication safety checker for elderly patients and caregivers. Photograph pill bottles or type drug names to check for dangerous interactions and age-inappropriate medications — all processed locally on your device.

Built for the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon) on Kaggle.

---

## What It Does

1. **Medication label OCR** — Point your camera at a pill bottle. Gemma 4's vision extracts the drug name and dosage.
2. **Drug-drug interaction check** — Cross-references all your medications against an offline database of 1.4M+ interactions sourced from DrugBank.
3. **Beers Criteria screening** — Flags medications that the American Geriatrics Society considers potentially inappropriate for adults over 65.
4. **Plain-language explanations** — Gemma 4 explains risks and alternatives in simple, caring language suitable for non-medical users.
5. **Doctor visit report** — Generates a summary to bring to your next appointment.

---

## Tech Stack

| Component | Tool |
|-----------|------|
| LLM | [Gemma 4](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/) (E4B or 26B MoE) via [Ollama](https://ollama.com) |
| Vision/OCR | Gemma 4 native multimodal (image → text) |
| Drug interactions | [DrugBank 6.0](https://go.drugbank.com) XML (CC BY-NC 4.0) |
| Beers Criteria | AGS 2023 Beers Criteria, manually curated |
| Drug name normalization | [RxNorm API](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html) (NLM) |
| Local database | SQLite |
| Language | Python 3.10+ |

---

## Usage

- **Upload a photo** of a medication bottle label, or
- **Type drug names** separated by commas (e.g. `warfarin, ibuprofen, aspirin`), or
- **Both** — upload a photo and add more drugs by text

The app extracts drug names, checks for interactions, screens against Beers Criteria, and generates a plain-language safety report.

---

## Data Sources

- **DrugBank 6.0** — 1.4M+ drug-drug interactions, CC BY-NC 4.0. Knox et al., *Nucleic Acids Res.* 2024;52(D1):D1265-D1275.
- **AGS Beers Criteria 2023** — Potentially inappropriate medications for older adults. *J Am Geriatr Soc.* 2023;71(7):2052-2081.
- **RxNorm** — Drug name normalization. U.S. National Library of Medicine.

---
