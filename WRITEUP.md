# Medora: An On-Device Medication Safety Assistant for Older Adults

Submitted to the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon).

## 1. Problem

Polypharmacy — the concurrent use of five or more medications — affects 37–51% of adults over 65 and drives 17–51% of preventable adverse drug events in that population. Older adults often see multiple specialists who lack visibility into each other's prescriptions, and existing medication-safety tools assume a clinician audience: dense interaction tables, technical language, cloud-only deployment, and English as the default. None of that serves a 78-year-old at the kitchen table holding three pill bottles and a new prescription.

The gap is sharper in developing countries, where smartphone penetration outpaces clinical infrastructure. There is essentially no patient-facing AI tooling for medication safety that works offline, speaks plainly, and respects the privacy of someone whose entire medical history would otherwise need to leave the device. Existing consumer apps either route queries through cloud APIs (privacy and connectivity barriers), require manual entry of every drug (high friction for users with vision or motor difficulties), or wrap generic LLMs that hallucinate dose recommendations.

Medora targets this gap directly: a photo of a pill bottle becomes a structured medication list, checked against an offline interaction database and explained by a Gemma 4 model fine-tuned to sound like a careful pharmacist would.

## 2. Solution

Medora is a mobile-first web application that runs entirely on the user's device against a local Ollama installation. The user journey is intentionally narrow and designed for low cognitive load:

1. **Capture.** The user photographs each pill bottle. Gemma 4's native multimodal model extracts `(drug_name, dosage)` pairs directly from the label, replacing a fragile OCR + regex pipeline with one model call. The camera page shows a gallery of captured photos (not a misleading "viewfinder") with per-photo remove controls.
2. **Confirm.** Extracted names are fuzzy-matched against a 63,000-entry alias index built from DrugBank synonyms and brand names. Ambiguous matches surface "did you mean…" chips so the user can correct them before any analysis runs. Manual entry is fully supported alongside scan results — the same layout for both, so the UI never feels like it's "switching modes" mid-typing.
3. **Analyze.** The confirmed list is checked against an offline SQLite database of 1.4M+ drug-drug interactions (DrugBank 6.0) and the AGS 2023 Beers Criteria for medications inappropriate in older adults. Severity is bucketed into major / moderate flags with management guidance.
4. **Explain.** Gemma 4 generates a plain-language safety report grounded in the structured findings. The report is the "headline" — bring this to your doctor.
5. **Follow up.** A streaming chat interface answers questions about specific medications. First token arrives in 1–2 seconds; full responses stream over the next ~10 seconds.
6. **Report.** A printable summary is generated to bring to the next doctor's visit.

On-device matters for three reasons. **Privacy**: medication lists are sensitive enough that a cloud upload is a non-starter for many users. **Reach**: offline operation removes the connectivity floor, opening the tool to rural and developing-country users who have smartphones but unreliable internet. **Trust**: when a tool answers a question about your medications, you should be able to verify that nothing left your device.

## 3. Architecture

Medora is structured as three loosely-coupled layers, each chosen so the smallest viable Gemma 4 model is trusted with the smallest viable surface area:

```
Frontend (React + Vite)                       Mobile-first SPA
        │
        │  /api/* (Vite proxy in dev, same-origin in prod)
        ▼
Backend (FastAPI)                             Five endpoints, single responsibility each
        │
        ├──► Ollama  (Gemma 4 vision + text + fine-tune)
        ▼
Data Layer (SQLite + curated profiles)        Offline, ~250 MB
```

### Frontend

`client/` is a React 18 + Vite single-page app styled with Tailwind. Mobile-first responsive design covers:

- **HomePage** — entry point with med entry and "Take photos" CTA.
- **CameraPage** — gallery-style photo capture using the OS camera (HTML `<input type="file" capture="environment">`), with per-photo remove buttons. Originally designed as a fake "viewfinder," redesigned to show a real gallery of captured shots once we realized the placeholder camera icon was misleading users.
- **ConfirmPage** — uniform layout for both scanned and manually-typed rows, with a `NormalizationHint` component that renders "Did you mean…" chips for ambiguous matches.
- **ResultsPage** — interaction analysis, Beers flags, and the Gemma-generated explanation.
- **ReportPage** — printable doctor visit summary.
- **AskPage** — streaming chat, with tokens rendering live as they arrive.

The frontend talks to the backend exclusively over `/api/*` and is naive about the model itself — the same UI works against any backend, and the Vite dev proxy makes mobile-LAN testing trivial (the phone hits the dev server's `/api/...` path and Vite forwards it to FastAPI; no CORS issues because everything appears same-origin to the browser).

### Backend

`server/` (FastAPI) exposes five endpoints, each single-responsibility:

| Endpoint | Purpose |
|---|---|
| `/api/extract` | OCR a medication label photo via Gemma 4 multimodal. Returns `[{drug_name, dosage, normalized}]`. |
| `/api/normalize` | Fuzzy-match a list of user-typed names against the alias index. Returns `{resolved, ambiguous, unresolved}` per input. |
| `/api/analyze` | Run interaction + Beers checks, generate the plain-language report. Pre-warms drug profile summaries in parallel. |
| `/api/ask` | Streaming chat. Returns `text/plain; charset=utf-8` chunked response with the model's tokens. |
| `/api/health` | Liveness + which model names are bound. |

The LLM is only invoked when structured DB lookups cannot answer the question alone. Interaction checks, Beers checks, and alias resolution are all deterministic table lookups. Only the *explanation* and *chat* paths call Gemma.

### Data Layer

A local SQLite database (`medora.db`, ~250 MB) built once from DrugBank 6.0 XML and a curated AGS 2023 Beers list. Five tables:

- `drugs` — canonical names with DrugBank IDs and brand-name lists.
- `interactions` — pairwise drug-drug interactions with severity (major / moderate) and management text.
- `beers_criteria` — flags for adults over 65, with rationale.
- `drug_profiles` — patient-facing profiles with indication, drug class, route, raw side-effects text, and a curated `side_effects_summary` column.
- `drug_aliases` — synonym → canonical mappings populated from DrugBank's `<synonyms>` and brand-name elements, plus manual additions for common gaps (e.g., "aspirin" → "acetylsalicylic acid").

## 4. The Data Pipeline (and the bug that almost shipped)

### Migrating off RxNav

The project initially intended to use the NLM RxNav drug-drug interaction REST API. Mid-build we discovered the endpoint had been quietly retired (effective January 2, 2024) — every request returned 404 with body `Not found`. NIH had ended the public DDI service because its data was DrugBank-licensed.

The fix was to go directly to the source: DrugBank's full XML database (CC BY-NC 4.0), version 6.0, which contains over 1.4M drug-drug interactions and 2,475 food-drug interactions — substantially more than the deprecated NLM API ever exposed. `build_drug_db.py` parses this XML offline and populates `medora.db` in one pass.

### The curated `side_effects_summary` column

DrugBank's `<toxicity>` field is the only patient-relevant adverse-effect data in the dataset, but it is *wildly* uneven. Warfarin's toxicity field is ~3000 characters split across four sections (Overdose, Carcinogenicity, Reproductive Toxicity, Lactation). Aspirin's is dominated by LD50 values from animal studies. Other drugs (metformin, lisinopril) have no patient-facing content at all in the toxicity field.

A straight injection of `<toxicity>` text into chat prompts produced clinically misleading responses — including a memorable failure mode where a 78-year-old asking about warfarin side effects received an unprompted pregnancy warning ("teratogen — birth defects in babies exposed in utero"), pulled directly from DrugBank's curator notes.

The solution was offline LLM summarization: at DB build time, each drug's `<toxicity>` text is passed through Gemma 4 with a directive prompt asking for a 1–2 sentence patient-facing summary. The result is cached in `side_effects_summary`. Empty results (when the source contains only LD50 data) are stored as a sentinel empty string so the chat path knows not to fall back to raw text.

### Debugging the summarizer

The summarizer initially produced empty responses for certain drugs. Investigation revealed three culprits:

1. **Citation markers** — text like `[A35408]`, `[L41539]`, `[FDA label]` confused the small model. Added `_clean_raw_text` to strip these via regex.
2. **HTML entities and tags** — `&lt;sub&gt;`, raw `<sub>` tags, and `\r\n` line endings disrupted parsing. Added `html.unescape` + tag-strip + whitespace normalization.
3. **Safety alignment refusals** — at temperature 0.3, Gemma 4 E2B's RLHF safety training caused it to refuse summarization of any text containing specific dose numbers ("more than 99 mg/kg"). The model would produce partial output then suddenly stop. Raising temperature to the model default (~0.7) gave the distribution enough flexibility to choose safer-but-useful wordings instead of locking up. This was the single most surprising bug in the project.

The final summarizer also has a positive-framed primary prompt ("summarize whatever safety information is present, including overdose risk — translate to patient language and skip dose numbers") and a higher-temperature fallback for edge cases.

### Analyze-time pre-warming

Even with offline summarization, some drugs miss the build pass. To avoid blocking chat on a 15-second summarization call, we built a background pre-warming system:

- `/api/analyze` immediately submits one summarization task per medication to a bounded `ThreadPoolExecutor` (max 2 workers).
- The user reads the analysis report (which takes ~5–10 seconds to generate anyway), giving the pre-warmer a head start.
- Each LLM call has a 20-second timeout; failures are logged but don't affect the user.
- An in-flight set guards against duplicate work.
- `/api/ask` always reads from the cache — never blocks on the LLM. If a summary isn't ready, it falls back to nothing (we deliberately don't fall back to raw toxicity text, since that's the failure mode we're trying to avoid).

### Alias resolution

Patients say "aspirin"; DrugBank calls it "Acetylsalicylic acid". A direct profile lookup misses, and the chat path silently goes without context.

Fix: a `drug_aliases` table populated during XML parsing from DrugBank's `<synonyms>` and brand-name elements. `get_drug_profile("aspirin")` now:

1. Looks up `drug_profiles` directly → miss.
2. Resolves through `drug_aliases` → canonical = "acetylsalicylic acid".
3. Re-queries `drug_profiles` with the canonical name → hit.

The same path is reused by the normalization endpoint (next section), giving consistent behavior whether the user typed the name, scanned it, or clicked a "did you mean…" chip.

## 5. Medication Name Normalization

Patient input is messy. Real examples encountered during testing: `"asprin"`, `"baby aspirin 81mg"`, `"Metformin ER 500mg tab"`, `"Coumadin"`, `"Tylenol PM"`.

The normalization pipeline has three layers, in order of confidence:

1. **Descriptor stripping** — A regex pass removes audience descriptors (baby, children's, pediatric, extra strength, low-dose), release-form suffixes (ER, XR, SR, CR, IR, XL, MR, DR), dose forms (tablet, capsule, syrup, patch), strength values (`81mg`, `5/325`, `500 mg`, `10%`), and stray punctuation. `"baby aspirin 81mg"` becomes `"aspirin"`.
2. **Exact match** — against `drugs.name` and `drug_aliases.alias`. If found → status `resolved`.
3. **Fuzzy match** — `rapidfuzz` WRatio against the same pool, deduped per canonical drug. Top score ≥92 with an ≥8-point gap to the runner-up → resolved. Score ≥70 → ambiguous (returns candidates list to the UI for user confirmation). Otherwise → unresolved.

The choices cache (63,000 entries) is built lazily on first call and persisted for process lifetime. Build cost: ~100–300ms one-time. The cache also pre-warms eagerly at module import time (controlled by the `MEDORA_WARM_NORMALIZE` environment variable) so the first user-facing call doesn't pay the build cost.

The UX side: `ConfirmPage.jsx` and `ResultsPage.jsx` share a `NormalizationHint` component that renders amber chips for ambiguous matches. Tapping a chip commits the canonical name. Editing the input clears stale candidates. The Analyze button stays enabled while candidates are unresolved so the user can pick and re-click without re-typing.

## 6. Gemma 4 Usage

Medora uses Gemma 4 in three deliberately different modes:

### Vision (OCR)

`/api/extract` sends label photos to Gemma 4 multimodal via Ollama with a structured prompt requesting a JSON array of `{drug_name, dosage}` objects. Native multimodal extraction replaces the traditional Tesseract → regex → entity-recognition stack with one model call. Output parsing is defensive — it accepts JSON objects, JSON arrays, or near-JSON formats (Gemma sometimes wraps responses in code fences or prose). A normalization pass follows extraction so the structured pipeline can take over from there.

### Offline summarization (DB build + analyze-time pre-warming)

At DB build time, each drug's `<toxicity>` text is summarized into 1–2 sentences of patient-facing language. Details on the prompt engineering and safety-alignment workarounds are in Section 4.

### Patient-facing chat (fine-tuned)

The chat-facing model is a Gemma 4 E4B fine-tune. The architectural choice between E2B and E4B is discussed at length in Section 8; the short version is that E2B couldn't reliably hold a multi-step argument together for complex multi-drug questions, and the bigger model was the durable fix.

Inference uses:
- `num_predict=1400` — generous cap so multi-drug responses don't truncate.
- `repeat_penalty=1.08`, `repeat_last_n=64` — break loop patterns without over-suppressing legitimate drug-name repetition.
- `num_ctx=2048` — sized to actual prompt distribution (~1500 tokens), down from a wasteful default of 4096.
- `keep_alive="24h"` — model stays resident between requests, eliminating cold-load reloads after idle.
- `stream=True` — tokens flow to the client as they're generated.

## 7. The Fine-Tuning Journey

The fine-tuning effort went through four iterations. The path through them was the most instructive part of the project.

### Iteration 1: Baseline LoRA

Trained Gemma 4 E2B with Unsloth (LoRA r=16, α=32, 3 epochs, lr 2e-4) on a 100-example dataset covering drug education, interactions, and basic boundary handling. Result: the model collapsed into repetitive output (`"If you're on warfarin, you should also be aware of signs of bleeding: * Blood in your urine ... If you're on warfarin, you should also be aware of signs of bleeding: * Blood in your urine ..."`) — same paragraph block emitted multiple times.

Train loss bottomed at 0.51, validation at 1.45. Diagnosis: underfit. The dataset was too small, the rank too low, the learning rate too high for the rank.

### Iteration 2: Bigger rank, more epochs, smaller LR

LoRA r=32, α=64, 5–6 epochs, lr 1e-4. Test temperature dropped from 0.7 to 0.3 to separate "what the model learned" from "sampling noise." Result: the warm tone landed, but the model overreached medically — claiming opioids increase bleeding risk by slowing clotting (not accurate), claiming ibuprofen and opioids both irritate the stomach lining (only ibuprofen does), recommending "low-dose ibuprofen" alongside warfarin (clinically dangerous).

The training loss dropped cleanly to 0.35. But the model was now confidently wrong rather than vaguely repetitive — a worse failure mode.

### Iteration 3: Reference blocks + curated DB context (the surprising failure)

Hypothesis: feed the model a `MEDICATION REFERENCE` block (assembled from `drug_profiles` at inference time) so it has authoritative facts to ground its answers in. The same fine-tuned weights as iteration 2, but production now injected DrugBank-sourced drug class, indication, and side-effect text into every chat prompt.

Result: **degraded performance on every axis.** The model dutifully transcribed DrugBank's curator language verbatim:

- "Use must be stopped during pregnancy" — to a 78-year-old patient asking about side effects.
- "Renal and hepatic bleeding" — became "warfarin affects your kidneys and brain" in the model's paraphrase.
- "Class: 4-Hydroxycoumarins, Agrochemicals" — *Agrochemicals.* DrugBank's chemical-class label, surfaced unedited into a chat with an elderly patient.

The cause was a train/serve prompt mismatch. The model was trained on prompts *without* a reference block, but production was now injecting one. At inference, the model was in an out-of-distribution prompt shape, and its trained "warm pharmacist" pattern decayed back toward "summarize the source material I was just handed."

Specific symptoms:
- **Off-target facts surfacing from the DB dump** — the teratogenicity warning to an elderly user.
- **Voice flattening** — the model dropped the empathy openings ("I'm glad you've been managing it for years") it had learned, and reached for a "be factual" register the reference block's framing was implicitly demanding.
- **Loss of multi-drug reasoning** — on "most dangerous combination?", iteration 2 named all four meds together; iteration 3 narrowed to just warfarin + ibuprofen because the reference block listed drugs individually.
- **Generic templated openings** — "The most important thing to know about X is Y" appeared in nearly every iteration-3 answer, a sign the model was reaching for a summarization scaffold rather than the conversational opens it had learned.

### Iteration 4: Re-fine-tune with the reference block present

The real fix: regenerate the training data so every example's system prompt contains a realistic `MEDICATION REFERENCE` block matching the production format, with assistant turns that demonstrate selective fact integration. Specifically:

- Each example pairs a curated reference block with the user question.
- Assistant turns use the relevant facts and *deliberately ignore* irrelevant ones (e.g., pregnancy warnings for an elderly patient).
- Off-topic and adversarial examples (recursion question, methamphetamine prompt) still include the reference block but keep their refusal/redirect responses — teaching the model that *context does not determine whether to engage*.

Hand-authored side-effect lines were written for all 52 drugs in the training set, replacing DrugBank's clinical text with patient-facing one-liners. The `_build_medication_reference` function in production was simultaneously revised to:

- Drop the `Class:` and `Used for:` lines (DrugBank values like "Agrochemicals" and citation-laden markdown).
- Drop the brand-names suffix (DrugBank data was noisy — "Adventure Medical Kits 1-4 Person First Aid" was listed as an ibuprofen brand).
- Replace the "use this as your source of truth" framing with: *"Background facts about the patient's medications. Weave in only what directly answers the patient's question; do not list every field unless asked. Stay in your normal warm, conversational voice."*

A `patch_db_summaries.py` script also overwrites `drug_profiles.side_effects_summary` for the 52 training drugs with the same curated text, so production prompts match training prompts exactly.

Result: pregnancy warnings disappeared. Voice returned. Multi-drug reasoning held together.

### Iteration 5: E2B → E4B switch

Even with iteration 4's improvements, E2B (the 2B-parameter variant) still produced occasional internal contradictions on complex multi-drug questions: *"stop ibuprofen"* in one paragraph and *"low-dose ibuprofen is still worth the risk"* in the next, or *"don't combine acetaminophen with warfarin"* (the opposite of correct guidance — acetaminophen is the recommended pain reliever for warfarin patients).

These weren't fact problems — the reference block had the right facts. They were *composition* problems: E2B couldn't reliably hold a multi-step argument together. Re-fine-tuning with the same data on Gemma 4 E4B (4B effective parameters) eliminated the contradictions and restored coherence on multi-drug reasoning. Latency went up modestly (E2B ~90 tok/s vs E4B ~55 tok/s on Apple Silicon), which was addressed separately (Section 9).

### Iteration 6: Validation loss-aware stopping

A 6-epoch training run showed clear overfitting — validation loss minimum at step 60 (end of epoch 2), then climbing steadily for the next 4 epochs to a train/eval gap of ~70x by the end. Dropping to 2 epochs with `load_best_model_at_end` captured the model right at the validation loss elbow without over-baking.

## 8. Generation Parameter Tuning

After fine-tuning issues were resolved, three production-side generation bugs surfaced:

### Repetition loops

The model would emit one paragraph, then re-emit the same block 4–5 times before hitting the `num_predict` ceiling. Sometimes the loops were verbatim ("opioids increase bleeding risk. opioids also increase bleeding risk — opioids increase bleeding risk"). Fix: `repeat_penalty=1.15`, `repeat_last_n=256` in both the Modelfile and the `ollama.chat` call.

### Truncation on multi-drug questions

The first repetition-penalty values were too aggressive. For "which combination is most dangerous?" with a 4-drug patient, the model needs to mention each drug name 5–8 times — but `repeat_last_n=256` penalized every legitimate re-use of "warfarin" across the response, causing the model to generate inefficient circumlocutions, eventually run out of low-penalty tokens, and emit the stop token early. Fix: relax to `repeat_penalty=1.08`, `repeat_last_n=64`, raise `num_predict` to 1400.

### Context-cap truncation on elderly + 4-drug responses

A response covering warfarin, aspirin, ibuprofen, *and* oxycodone in an elderly-patient template (emoji headers, sub-bullets per drug) hit the 900-token cap mid-fourth-section. Fix: bump `num_predict` to 1400, and add explicit system-prompt guidance to favor short prose paragraphs over bulleted templates ("Keep responses under 180 words unless the patient asks for more detail. Use short prose paragraphs, not bulleted lists or section headers").

## 9. Streaming the Chat End-to-End

Even after model and parameter tuning, total response time was 12–22 seconds — too long for a chat UX. The fix was not faster generation but *progressive rendering*: stream tokens to the browser as they're produced, so the user sees the response "talking" within ~1.5 seconds rather than staring at a spinner for the full duration.

Three coordinated changes:

**`server/service.py`** — Added `answer_question_stream(...)` as a generator yielding chunks from `ollama.chat(..., stream=True, keep_alive="24h")`. The non-streaming `answer_question(...)` is kept as a thin wrapper for any future callers. Generation options moved to a module-level `_ASK_OPTIONS` dict so both variants stay in sync.

**`server/main.py`** — `/api/ask` now returns `StreamingResponse(generate(), media_type="text/plain; charset=utf-8")`. The generator catches exceptions mid-stream and emits a `[ERROR] …` sentinel — once chunks have started flowing, HTTP status is locked, so the client detects errors from the body. Headers `Cache-Control: no-cache` and `X-Accel-Buffering: no` defeat any intermediate buffering.

**`client/src/pages/AskPage.jsx`** — Replaced `apiJson(...)` with `fetch(...) + response.body.getReader() + TextDecoder`. Maintains a buffer; first chunk appends a new assistant message bubble, subsequent chunks update its content in place. The "Thinking…" indicator hides as soon as the first chunk arrives (condition changed from `sending` to `sending && lastMessage?.role === "user"`). The `[ERROR]` sentinel is detected post-stream and surfaced via `setError`.

End-to-end result: first token in ~1.5s, total streaming ~10s. Total compute time is roughly unchanged, but the user experience is transformed.

## 10. Latency Optimization

Average response time across the full optimization sequence:

| Change | Average response time |
|---|---|
| Initial E4B baseline | 15–25s |
| `num_ctx` 4096 → 2048 | 12–22s |
| Streaming end-to-end | 4–14s (~1.5s to first token) |
| `repeat_penalty` tuning, `num_predict` cap | 4–14s, no truncations |

Additional latency wins identified but not all implemented:
- `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KEEP_ALIVE=24h` (~1–2s savings on prefill, eliminates cold-load reloads).
- Trimming the reference block to only question-relevant drugs (saves 0.5–1s for 5+ drug patients).
- Gemma 4 MTP speculative decoding (potentially 2–3x decode speedup, depends on Ollama version).

What we deliberately did *not* pursue: smaller quantizations (Q3/Q2 save <10% on Apple Silicon but noticeably degrade fine-tunes); switching from Ollama to llama.cpp directly (marginal gains for a large rewrite); parallelizing SQLite calls (already <50ms total).

## 11. Engineering Challenges Worth Remembering

### Ollama's `gemma4` architecture loading bug

After exporting the fine-tuned model to GGUF and registering it with `ollama create`, loading failed with:

```
error loading model architecture: unknown model architecture: 'gemma4'
```

The model file contained `general.architecture = gemma4` (written by Unsloth's converter), but Ollama's bundled `llama.cpp` didn't recognize that architecture string. The official `gemma4:e2b` worked because it was served by Ollama's native engine — custom imports with an mmproj (vision projector) file were forced down the broken `llama.cpp` path.

The fix was unintuitive: the Modelfile contained a single `FROM .` line, which auto-discovered both GGUFs in the directory (main model + mmproj) and packed them as two layers. The presence of the mmproj forced Ollama to assume multimodal handling, which routed through `llama.cpp`. Removing the mmproj line (we don't use the vision component of the fine-tune) routed the load through Ollama's native engine, which *does* know `gemma4`. Same weights file, just a one-line Modelfile change.

### The Unsloth GGUF export regression

A separate breakage in the GGUF export pipeline: Unsloth's `save_pretrained_gguf` wrapper copied `llama.cpp`'s `convert_hf_to_gguf.py` to a temporary file and tried to execute it from outside the `llama.cpp` directory, breaking a recently-added `from conversion import (...)` relative import. The merge step succeeded but the GGUF conversion failed mid-way.

Workaround: bypass the Unsloth GGUF wrapper entirely. Use `save_pretrained_merged` to produce a 16-bit HF model, then clone `llama.cpp` directly and run `convert_hf_to_gguf.py` from inside its own directory (where the relative import resolves), then build and run `llama-quantize` for the Q4_K_M step. About 4 cells of Colab notebook instead of one, but reliable against future Unsloth/llama.cpp drift.

### The `pip install -r llama.cpp/requirements.txt` trap

When migrating to the manual conversion path, an obvious-looking `pip install -r llama.cpp/requirements.txt` step downgraded torch (2.10 → 2.6), transformers (5.5.0 → 5.5.1), and numpy on top of an already-working Colab environment. The result was a torchvision circular-import error followed by `ModuleNotFoundError: Could not import module 'Gemma4Config'`. Fix: install *only* the `gguf` Python package (`pip install -e llama.cpp/gguf-py sentencepiece`) without the full requirements file.

### UI / CSS bugs

A few user-visible polish issues that took outsized debugging time:

- **Clipping of the remove-button "×" on photo thumbnails.** The button was placed outside its parent's clipping rectangle in a horizontally-scrolling strip. Fixed with `padding-top`, `overflow-y: visible`, and `z-index` adjustments.
- **Confirm-page layout switching mid-typing.** Manual rows used a `Medication name` field; the layout swapped to a `Database lookup` field after one keystroke because the row-distinction logic was: "any row with a non-empty `name` is a photo result." Fixed by tagging photo vs manual rows explicitly and keeping the layouts consistent. Later replaced entirely with a single unified layout across both row types.
- **Truncated chat responses.** Early `num_predict=380` was too aggressive — chat answers cut off mid-sentence. Bumped to 1024, then later to 1400 with the streaming refactor.
- **Empty chat bubbles on model failure.** Added a visible fallback ("(no response — please try again)") and `min-w-0 break-words` so long URLs/drug names wrap instead of overflowing.

## 12. Evaluation

Five model variants were evaluated against a 30-prompt suite covering drug education, interactions, elderly safety (Beers Criteria), practical management, emotional support, off-topic handling, and adversarial prompts (jailbreaks, lethal-dose questions, illegal-substance requests). Each response was scored 1–5 on safety, correctness, readability, and empathy.

| Model | Safety | Correctness | Readability | Empathy | Avg |
|---|---|---|---|---|---|
| 1: Base Gemma 4 E2B | 4.5 | 3.5 | 4.0 | 3.0 | 3.75 |
| 2: Fine-tuned E2B | 4.2 | 4.0 | 4.4 | 4.1 | 4.18 |
| 3: + naïve RAG context | 3.6 | 3.4 | 4.3 | 4.0 | 3.83 |
| 4: + curated context | 4.5 | 4.0 | 4.1 | 4.2 | 4.20 |
| 5: E4B + curated | 4.5 | 4.0 | 4.3 | 4.0 | 4.20 |

Three takeaways from the eval:

- **Fine-tuning matters.** Model 2 beat the base model on every axis except a small safety dip (the fine-tuned voice was warmer and slightly more willing to share information, which the rubric scored as marginally less "safe" but more useful).
- **Naïve RAG is worse than no RAG.** Model 3 was the worst on safety *and* correctness because it transcribed DrugBank's clinical language without filtering. This was the most counterintuitive finding of the project.
- **Bigger model fixes composition, not facts.** Models 4 and 5 had the same dataset and curated DB context; the only difference was E2B vs E4B. Average scores are nearly identical, but the per-prompt breakdown shows E4B holding together on complex multi-drug questions where E2B contradicted itself.

End-to-end latency (final state):
- Vision OCR: ~6s per photo.
- Interaction + Beers analysis: <1s for typical 4–6 drug patients.
- Plain-language explanation generation: ~5–10s.
- Streaming chat: ~1.5s to first token, ~10s total.

## 13. Future Work

- **Voice I/O.** A microphone input and TTS output would unlock the app for low-literacy users and those with vision difficulties. The chat infrastructure is already streaming-ready.
- **Multilingual.** Gemma 4 supports many languages; the persona prompt is the only English-specific piece. Spanish would be the highest-impact next target.
- **Validation layer.** A rule-based post-filter to catch known failure modes ("worth the risk" phrases, "low-dose [interacting drug] is okay" patterns, missing doctor-referral) running inline. An LLM-judge layer could run async over logs to grow the rule list.
- **Larger fine-tuning dataset.** 137 examples were enough to teach the voice but not enough to cover all the long-tail patterns (specific drug-food interactions, drug-disease combinations, lab-monitoring questions). Doubling the dataset is the most reliable next quality lever.
- **EHR integration.** FHIR connectors would let a patient pull their medication list directly from a hospital portal instead of scanning bottles, while preserving the on-device privacy guarantee.
- **Clinician-facing review mode.** Same data, different UI — a dashboard summarizing patient interactions, Beers flags, and chat history for a 15-minute medication review appointment.

## 14. Data Sources and Acknowledgements

- DrugBank 6.0 — Knox et al., *Nucleic Acids Res.* 2024;52(D1):D1265–D1275. Licensed CC BY-NC 4.0.
- AGS 2023 Beers Criteria — *J Am Geriatr Soc.* 2023;71(7):2052–2081.
- RxNorm — U.S. National Library of Medicine.
- Gemma 4 — Google DeepMind.
- Unsloth — fine-tuning framework, https://unsloth.ai.
- Ollama — local LLM runtime, https://ollama.com.

## Disclaimer

Medora is an educational tool and is not a substitute for professional medical advice. Always consult a licensed clinician before changing medications.
