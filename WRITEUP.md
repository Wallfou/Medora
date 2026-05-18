# Medora: An On-Device Medication Safety Assistant for Older Adults

Submitted to the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon).

## 1. Problem

Polypharmacy, the concurrent use of five or more medications, affects 37–51% of adults over 65 [1][2] and drives 17–51% of preventable adverse drug events in that population [2][3]. Older adults often see multiple specialists who lack visibility into each other's prescriptions, and existing medication-safety tools assume a clinician audience: dense interaction tables, technical language, cloud-only deployment, and English as the default. None of that serves a 78-year-old at the kitchen table holding three pill bottles and a new prescription [4].

The gap is sharper in developing countries, where smartphone penetration outpaces clinical infrastructure. There is essentially no patient-facing AI tooling for medication safety that works offline and respects the privacy of someone whose entire medical history would otherwise need to to be shared.

Medora targets this gap directly by converting photos of pill bottles into a structured medication list. The list is then checked against an offline interaction database to raise any critical concerns. These could be explained and discussed further by a Gemma 4 model fine-tuned to sound like a careful pharmacist.

## 2. Solution

Medora is a mobile-first web application that runs entirely on the user's device against a local Ollama installation. The user journey is intentionally narrow and designed for low cognitive load:

1. **Capture.** The user photographs each pill bottle. Gemma 4's native multimodal model extracts `(drug_name, dosage)` pairs directly from the label. The camera page shows a gallery of captured photos with per-photo remove controls.
2. **Confirm.** Extracted names are fuzzy-matched against a 63,000 entry alias index built from DrugBank synonyms and brand names. Ambiguous matches surface a "did you mean…" section so the user can correct them before any analysis runs. Manual entry is fully supported alongside scan results, and the same layout is used for both.
3. **Analyze.** The confirmed list is checked against an offline SQLite database of more than 1.4 million unique drug-drug interactions and the AGS 2023 Beers Criteria for medications inappropriate for older adults. Severity is sorted into major and moderate flags with management guidance.
4. **Explain.** Gemma 4 generates an intuitive dashboard populated with the patient's medication list and any major/moderate interactions that were flagged by the system. The risks of drug interactions are explained individually. 
5. **Follow up.** A streaming chat interface answers questions about specific medications. Patients can ask about their medication side effects, safe alternatives, or any other issues they are concerned about.  Medora is tuned to be warm and empathetic. 
6. **Report.** A printable summary is generated for patients to bring to their next doctor's visit. 

On-device matters for two important reasons. **Privacy**: medical records are sensitive information that most people want to keep safe, especially in a period when data is extremely valuable. **Reach**: offline operation removes the connectivity floor, opening the tool to users who have smartphones but unreliable internet in developing countries 

## 3. Architecture

Medora is structured as three loosely coupled layers, each chosen so the smallest viable Gemma 4 model is trusted with the smallest viable surface area:

### Frontend

`client/` is a React 18 + Vite single-page app styled with Tailwind:

- **HomePage**: entry point with text medication entry and "Take photos" CTA.
- **CameraPage**: gallery style photo capture using the OS camera, with per-photo remove buttons. 
- **ConfirmPage**: uniform layout for both scanned and manual input rows, with a custom component that renders "Did you mean…" sections for ambiguous matches.
- **ResultsPage**: interaction analysis, Beers flags, and the Gemma generated explanation.
- **ReportPage**: printable doctor visit summary.
- **AskPage**: streaming chatbot, with tokens rendering live as they arrive.

### Backend

`server/` (FastAPI) exposes five endpoints, each with a single responsibility:

| Endpoint | Purpose |
|---|---|
| `/api/extract` | OCR a medication label photo via Gemma 4 multimodal. Returns `[{drug_name, dosage, normalized}]`. |
| `/api/normalize` | Fuzzy-match a list of inputted names against the alias index. Returns `{resolved, ambiguous, unresolved}` per input. |
| `/api/analyze` | Run interaction + Beers checks, generate the report. Pre-warms drug profile summaries in parallel. |
| `/api/ask` | Streaming chat. Returns chunked response with the model's tokens. |
| `/api/health` | health check |

### Data Layer

A local SQLite database built once from DrugBank 6.0 XML and a curated AGS 2023 Beers list. Five tables:

- `drugs`: canonical names with DrugBank IDs and brand name lists.
- `interactions`: pairwise drug-drug interactions with severity and management text.
- `beers_criteria`: flags for adults over 65, with rationale.
- `drug_profiles`: patient-facing profiles with indication, drug class, route, raw side-effects text, and a curated `side_effects_summary` column.
- `drug_aliases`: synonym to canonical mappings

## 4. The Data Pipeline

### Migrating off RxNav

The project initially intended to use the NLM RxNav drug-drug interaction REST API. Mid-build, I discovered the endpoint had been retired, and every request returned 404 with body `Not found`. The fix was to go directly to the source: DrugBank's full XML database, version 6.0, which contains over 1.4M drug-drug interactions and 2,475 food-drug interactions, substantially more than the deprecated NLM API exposed. `build_drug_db.py` parses this XML offline and populates `medora.db` in one pass.

### The curated `side_effects_summary` column

The idea is to give Medora context about the side effects of each medication. DrugBank's `<toxicity>` field is the only patient-facing side effect data in the dataset, but it is very uneven. Warfarin's toxicity field is around 3000 characters split across four sections (Overdose, Carcinogenicity, Reproductive Toxicity, Lactation), while Aspirin's is dominated by LD50 values from animal studies. Other drugs have no content at all in the toxicity field. 

A straight injection of toxicity text into chat prompts produced clinically misleading responses, including an unprompted pregnancy warning for a 78-year-old patient, which was pulled directly from DrugBank's curator notes.

The solution that I went with was an offline LLM summarization. So, at DB build time, each drug's toxicity text is passed through Gemma 4 with a directive prompt asking for a 1–2 sentence patient-facing summary. The result is cached in `side_effects_summary`. Empty results are stored as a sentinel empty string so the chat path knows not to fall back to raw text.

### Debugging the summarizer

The summarizer initially produced empty responses for certain drugs, and after some debugging, I found that the issue was closely tied to the sampling temperature. At a low temperature of 0.3, Gemma 4 E2B handles safety-sensitive medication text very rigidly, especially when the input contains specific dosage numbers. The model would produce partial output, then suddenly halt. Raising the temperature to the model default, which was around 0.7, gave the distribution enough flexibility to choose safer phrasing, rather than getting stuck in a cautious refusal pattern. This bug gave me a lot of insight into how models can behave under strict safety constraints and how generation parameters can impact reliability significantly. 

### Pre-warming during analysis time, streaming chat, and other optimization features

Even with offline summarization, some drugs miss the build pass. To avoid increasing the chat latency with summarization calls, I built a background pre-warming system:

- `/api/analyze` immediately submits a summarization task per medication to a bounded `ThreadPoolExecutor`.
- The user reads the analysis report (which takes ~5–10 seconds to generate), giving the pre-warmer a head start.
- Each LLM call has a 20 seconds timeout, and failures are logged but don't affect the user.
- `/api/ask` always reads from the cache and never blocks on the LLM. If a summary isn't ready, it falls back to nothing instead of the raw toxicity field, since it contains a lot of irrelevant information that can invalidate the output. 

This was one of the several steps to optimizing the response time of the chat feature:

The original total response time was around 20 seconds, which was too long for a chat UX. The fix I decided to go with is *progressive rendering*. By streaming tokens to the browser as they're produced, the user sees the response start within around 5 seconds rather than staring at a spinner for the full duration.

| Change | Average response time |
|---|---|
| Initial E4B baseline | 15–25s |
| `num_ctx` 4096 → 2048 | 12–22s |
| Streaming end-to-end | 4–14s |
| `repeat_penalty` tuning, `num_predict` cap | 4–14s, no truncations |


Other steps I took to further optimize:

- **`OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KEEP_ALIVE=24h`.** This saves around 2 seconds on prefill and eliminates any cold start penalties after Ollama unloads the Gemma model on idle. 
- **Alias choices cache pre-warm** The 63 thousand-entry rapidfuzz cache used to be built on the first normalization call, costing around 100 to 300ms. Eagerly building it at module import time hides that cost in server startup instead of the first user-facing request.

### Medication name alias resolution and normalization

The problem is that the medication name that the public recognizes is different than the name that's stored in the DrugBank (aspirin vs Acetylsalicylic acid). This causes a direct profile lookup to miss, so the chat path silently goes without context. The fix was to populate a `drug_aliases` table during parsing. 

Another issue was name normalization. Patient inputs, especially among the elderly, are very messy. Inputs could be misspelled or contain unnecessary information: "baby aspirin 81mg", "Tylenol PM". The normalization pipeline uses **descriptor stripping** to perform a regex pass and remove descriptors/dose forms. The pipeline also performs a **fuzzy match** against the pool of drug names. A top score above 92 with more than an 8-point gap to the runner-up resolves directly. Otherwise, the top scores above 70 are flagged as ambiguous, and the list is returned to the UI for user confirmation.

## 5. Gemma 4 Usage

Medora uses Gemma 4 in three deliberately different modes:

### Vision

`/api/extract` sends label photos to Gemma 4 multimodal via Ollama with a structured prompt requesting a JSON array of `{drug_name, dosage}` objects. Output parsing accepts JSON objects, JSON arrays, or near-JSON formats, in case Gemma wraps responses in code fences. A normalization pass follows extraction, so it can be fed into the structured pipeline. 

### Offline summarization 

At DB build time, each drug's `<toxicity>` text is summarized into 1–2 sentences of patient-facing language. Details on this is in section 4. 

### Patient-facing chat

The chat-facing model is tested with both fine-tuned E2B and E4B models. The architectural choice between E2B and E4B is discussed in Section 7. The conclusion is that E2B cannot reliably hold a multi-step argument together for complex multi-drug questions, so the bigger model was a better fit for a medical platform, where reliability is a priority. 

Inference uses:
- `num_predict=1400`: generous cap so multi-drug responses don't truncate
- `repeat_penalty=1.08`, `repeat_last_n=64`: break loop patterns without over-suppressing legitimate drug-name repetition.
- `num_ctx=2048`: sized to actual prompt distribution, tuned down to decrease latency. 
- `keep_alive="24h"`: model stays resident between requests, eliminating cold-load reloads after idle.
- `stream=True`: tokens flow to the client as they are generated

## 6. The Fine-Tuning Journey

The fine-tuning effort went through several iterations. In my opinion, this was the most instructive part of the project.

### Iteration 1: Baseline LoRA

Trained Gemma 4 E2B with Unsloth (LoRA r=16, α=32, 3 epochs, lr 2e-4) on a 100-example dataset covering drug education, interactions, and basic boundary handling. Result: the model collapsed into repetitive output (`"If you're on warfarin, you should also be aware of signs of bleeding: * Blood in your urine ... If you're on warfarin, you should also be aware of signs of bleeding: * Blood in your urine ..."`). The same paragraph block was emitted multiple times. 

The dataset was too small and narrow, so the model learned brittle surface patterns instead of general behavior. With such a low rank, the adaptor didn't have enough capacity to represent all the desired behaviors that I wanted to tune, while the learning rate was too aggressive and pushed the model into unstable outputs. 

### Iteration 2: Bigger rank, more epochs, smaller LR

LoRA r=32, α=64, 5–6 epochs, lr 1e-4. This iteration, I also reduced the temperature from 0.7 to 0.3 so I can better evaluate what the model actually learned by eliminating sampling noise. This version improved in terms of tone, but it also exposed a critical problem, where the model began making confident medical errors. For instance, it claimed opioids increase bleeding risk by slowing clotting, which was not accurate. The model also claimed that both ibuprofen and opioids irritate the stomach lining, which was incorrect as well. 

Although the training loss dropped cleanly to 0.35, the model's behavior was worse from a safety perspective. It was producing polished, but medically inaccurate advice, which was a very dangerous failure. This demonstrated that a strong training loss alone cannot indicate success. 

### Iteration 3: Reference blocks + curated DB context (the surprising failure)

For the third iteration, I hypothesized that injecting a `MEDICATION REFERENCE` block would give the model more authoritative facts to ground its answers in. However, the result degraded performance on every axis. Instead of using reference material selectively, the model often treated it as text to summarize or paragraphze directly. The model often brought in completely irrelevant information, such as: 

- "Use must be stopped during pregnancy," surfaced to a 78-year-old patient asking about side effects.
- "Renal and hepatic bleeding" became "warfarin affects your kidneys and brain" in the model's paraphrase.
- "Class: 4-Hydroxycoumarins, Agrochemicals." *Agrochemicals.* DrugBank's chemical-class label surfaced unedited in a chat with an elderly patient.

The cause was a train/serve prompt mismatch. The model was trained on prompts without a reference block, but production was now injecting one. At inference, the model was in an out-of-distribution prompt shape, and its trained "warm pharmacist" pattern decayed back toward "summarize the source material I was just handed."

### Iteration 4: Re-fine-tune with the reference block present

The real fix was to regenerate the training data so every example's system prompt contains a realistic `MEDICATION REFERENCE` block matching the production format, with assistant turns that demonstrate selective fact integration. Each example paired a curated medication reference block with the user's question. The assistant's responses were written to demonstrate selective fact integration, which used the facts that directly answer the patient's question, but ignored irrelevant or inappropriate details. I also kept off-topic or adversarial examples, so the model learns that the presence of a medication context doesn't automatically mean every user request should be answered. For the system prompt, I replaced the strict "use this as your source of truth" framing with softer guidance: "Background facts about the patient’s medications. Weave in only what directly answers the patient’s question; do not list every field unless asked. Stay in your normal warm, conversational voice."

The resulting model was a clear improvement over the previous iteration. However, E2B still occasionally produced internal contradictions on complex questions regarding multiple drugs. For instance, it would recommend the patient to *"stop ibuprofen"* in one paragraph and say *"low-dose ibuprofen is still worth the risk"* in the next. 

### Iteration 5: E2B to E4B switch

These weren't fact problems since the reference blocks have the right facts. I believe the issue is more compositional. E2B could retrieve and phrase relevant facts, but it couldn't reliably hold a multi-step argument together across an entire response. When a question required comparing several medications and identifying the most dangerous interaction, the smaller models would drift between competing answers. 

Re-fine-tuning with the same data on Gemma 4 E4B eliminated the contradictions and restored coherence on multi-drug reasoning. The tradeoff is that latency went up modestly, which was addressed with several optimization steps discussed in Section 4. 

## 7. Evaluation

Five model variants were evaluated against a 30-prompt suite covering drug education, interactions, elderly safety, practical management, emotional support, off-topic handling, and adversarial prompts. Each response was scored 1–5 by a frontier LLM model on safety, correctness, readability, and empathy against a written rubric:

| Model | Safety | Correctness | Readability | Empathy | Avg |
|---|---|---|---|---|---|
| 1: Base Gemma 4 E2B | 4.5 | 3.5 | 4.0 | 3.0 | 3.75 |
| 2: Fine-tuned E2B | 4.2 | 4.0 | 4.4 | 4.1 | 4.18 |
| 3: + raw context | 3.6 | 3.4 | 4.3 | 4.0 | 3.83 |
| 4: + curated context | 4.0 | 3.7 | 4.1 | 4.2 | 4.00 |
| 5: E4B + curated | 4.5 | 4.0 | 4.3 | 4.1 | 4.23 |

The main takeaways: 

- **Fine-tuning matters.** Model 2 beat the base model on correctness, readability, and empathy, with only a small safety dip. The fine-tuned model was warmer and more helpful, but that increased willingness to answer made the rubric score it as slightly less conservative than the base model.
- **Naive RAG is worse than no RAG.** Model 3 was the worst on safety and correctness because it transcribed DrugBank's clinical language without filtering. This was the most counterintuitive finding of the project. When the model was not trained to use that context selectively, the extra information became a liability
- **Curated context recovers, but not all the way on E2B.** Model 4 fixed the most obvious failures from Model 3. However, its overall score still landed below Model 2. The curated context improved relevance and safety behavior, but E2B still struggled with coherence on complex multi-drug questions, and the added reference structure made some responses less fluid.
- **The bigger model closes the gap.** E4B with curated context recovered the base model’s safety score while preserving most of the correctness, readability, and empathy gains from fine-tuning. The per-prompt breakdown showed that E4B handled complex multi-drug questions more coherently than E2B, avoiding the internal contradictions that appeared in Model 4. That is where the safety and correctness points came back.

## 8. Potential Future Work

- **Native iOS and Android apps.** Today Medora is a web app. A native rewrite using MLX (iOS) and llama.cpp's mobile bindings (Android) would let the model run directly on the phone instead of through a desktop Ollama install. This is the form factor that best matches the offline, on-device pitch: the user's caregiver puts the app on their phone and it works at the kitchen table without any other setup.
- **Voice I/O.** A microphone input and TTS output would unlock the app for low-literacy users and those with vision difficulties. The chat infrastructure is already ready.
- **Multilingual.** Gemma 4 supports many languages. The persona prompt is the only English-specific piece. Spanish would be the highest-impact next target.
- **Larger fine-tuning dataset.** 137 examples were enough to teach the voice but not enough to cover all the long-tail patterns (specific drug-food interactions, drug-disease combinations, lab-monitoring questions). Doubling the dataset is the most reliable next quality lever.
- **EHR integration.** FHIR connectors would let a patient pull their medication list directly from a hospital portal instead of scanning bottles, while preserving the on-device privacy guarantee.

## 9. Data Sources and Acknowledgements

- DrugBank 6.0. Knox et al., *Nucleic Acids Res.* 2024;52(D1):D1265–D1275. Licensed CC BY-NC 4.0.
- AGS 2023 Beers Criteria. *J Am Geriatr Soc.* 2023;71(7):2052–2081.
- RxNorm. U.S. National Library of Medicine.
- Gemma 4. Google DeepMind.
- Unsloth. Fine-tuning framework, https://unsloth.ai.
- Ollama. Local LLM runtime, https://ollama.com.

### Cited

[1] Kim, S., et al. "Global and regional prevalence of polypharmacy and related factors, 1997–2022: An umbrella review." *Geriatric Nursing* (2024). https://www.sciencedirect.com/science/article/abs/pii/S0167494324001419

[2] PharmD Live. "From Healing to Harm: The Unintended Consequences of Polypharmacy in Seniors." Citing AHRQ (2021), National Institute on Aging (2021), and Shehab et al. https://www.pharmdlive.com/blog/from-healing-to-harm-the-unintended-consequences-of-polypharmacy-in-seniors/

[3] "Addressing the Polypharmacy Conundrum." *U.S. Pharmacist.* https://www.uspharmacist.com/article/addressing-the-polypharmacy-conundrum

[4] "Associations Between Chronic Disease, Polypharmacy, and Medication-Related Problems Among Medicare Beneficiaries." https://pmc.ncbi.nlm.nih.gov/articles/PMC10398061/
