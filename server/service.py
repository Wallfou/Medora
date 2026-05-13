"""SQLite, Ollama vision + text."""

import base64
import html
import json
import logging
import os
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import ollama

DB_FILE = os.environ.get("MEDORA_DB", "medora.db")
TEXT_MODEL = os.environ.get("MEDORA_TEXT_MODEL", "medora-gemma4-text")
VISION_MODEL = os.environ.get("MEDORA_VISION_MODEL", "gemma4:e2b")
SUMMARY_MODEL = os.environ.get("MEDORA_SUMMARY_MODEL", "medora-gemma4-text")
SUMMARY_TIMEOUT_S = float(os.environ.get("MEDORA_SUMMARY_TIMEOUT", "30"))

_logger = logging.getLogger(__name__)
_summary_executor = ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="medora-summarize"
)


def get_db():
    return sqlite3.connect(DB_FILE)


def _ensure_schema():
    """migrations for DBs built before recent schema additions"""
    db = get_db()
    try:
        try:
            db.execute(
                "ALTER TABLE drug_profiles ADD COLUMN side_effects_summary TEXT"
            )
        except sqlite3.OperationalError:
            pass
        db.execute(
            """CREATE TABLE IF NOT EXISTS drug_aliases (
                   alias     TEXT PRIMARY KEY,
                   canonical TEXT NOT NULL
               )"""
        )
        db.commit()
    finally:
        db.close()


_ensure_schema()


def _resolve_to_profile_name(db, name_lower):
    """Map a drug name to its canonical drug_profiles name via the alias table

    If name_lower is already the canonical name, or has no alias entry,
    it is returned unchanged and the caller's profile lookup will succeed
    or miss
    """
    row = db.execute(
        "SELECT canonical FROM drug_aliases WHERE alias = ?",
        (name_lower,),
    ).fetchone()
    return row[0] if row else name_lower


_CITATION_RE = re.compile(r"\[[A-Za-z0-9 ,.\-]+\]")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_DOSE_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*"
    r"(?:mg|g|mcg|µg|ng|kg|ml|l|grams?|grains?|tablets?|capsules?)"
    r"(?:/(?:kg|day|hour|hr|min|m2|wk|week|d))*\b",
    re.IGNORECASE,
)


def _clean_raw_text(raw):
    """Normalize DrugBank text for small-model consumption.

    1. Strip citation markers, HTML tags/entities.
    2. Replace specific dose values like "1-2 mg/kg/day" with a neutral phrase
       -- Gemma's safety alignment refuses to finish summarizing if primed
       with a dose threshold.
    3. Collapse whitespace.
    """
    if not raw:
        return ""
    text = html.unescape(raw)
    text = _CITATION_RE.sub("", text)
    text = _TAG_RE.sub("", text)
    text = _DOSE_RE.sub("a large amount", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def _summarize_side_effects(drug_name, raw_text):
    """Extract patient-relevant side effects from DrugBank toxicity field

    Returns a comma-separated list of short phrases (with optional parenthetical
    context). List format so the chat-injection layer can compose
    its own natural language in Medora's tone instead of mirroring a fixed
    summary's voice or duplicating disclaimers

    Retries once with a simpler prompt before giving up.
    """
    cleaned = _clean_raw_text(raw_text)
    if not cleaned:
        return ""

    primary_prompt = (
        f"From the medical reference text below for {drug_name}, extract the side "
        f"effects and safety concerns a patient should be aware of.\n\n"
        f"Output ONLY a comma-separated list of short phrases. Each phrase should "
        f"be brief but may include a short parenthetical for context where useful. "
        f"No introduction, no disclaimers, no advice, no sentences -- just the items.\n\n"
        f"Example output: bleeding more easily (especially from gums or GI tract), "
        f"bruising, nosebleeds, stomach pain, harm during pregnancy\n\n"
        f"REFERENCE:\n{cleaned}\n\n"
        f"LIST:"
    )

    fallback_prompt = (
        f"List the side effects and safety concerns of {drug_name} from this text "
        f"as a comma-separated list of short phrases. No sentences, no advice.\n\n"
        f"{cleaned}\n\n"
        f"LIST:"
    )

    # Can't override temperature: Gemma 4 e2b safety alignment cuts
    # off summaries at low temperatures (0.3) when the input mentions doses,
    # because the sharpened distribution traps the model in refusal tokens.
    # The model's own defaults (~0.7-0.8) produce reliable patient summaries.
    client = ollama.Client(timeout=SUMMARY_TIMEOUT_S)
    for label, prompt in [("primary", primary_prompt), ("fallback", fallback_prompt)]:
        response = client.chat(
            model=SUMMARY_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        result = (response["message"]["content"] or "").strip()
        if result:
            return result
        _logger.info(
            "summarize: %s attempt empty for %s, trying next", label, drug_name
        )

    return ""


def _summarize_and_cache(name_lower):
    """Background worker: summarize one drug's side effects and write to the cache.

    Resolves aliases before lookup so e.g. "aspirin" finds "acetylsalicylic acid".
    No-ops if the cache is already populated or there is no raw text to summarize.
    All failures are logged so silent worker crashes show up in uvicorn stdout
    """
    try:
        db = get_db()
        try:
            canonical = _resolve_to_profile_name(db, name_lower)
            _logger.info(
                "summarize: %s -> canonical=%s", name_lower, canonical
            )

            row = db.execute(
                "SELECT side_effects, side_effects_summary "
                "FROM drug_profiles WHERE name = ?",
                (canonical,),
            ).fetchone()
            if not row:
                _logger.info("summarize: no profile row for %s", canonical)
                return

            raw_side, summary = row
            # `is not None` distinguishes "never tried" (NULL) from
            # "tried and got nothing useful"
            if summary is not None:
                _logger.info(
                    "summarize: already attempted for %s", canonical
                )
                return
            if not raw_side:
                _logger.info("summarize: no raw text for %s", canonical)
                return

            try:
                new_summary = _summarize_side_effects(canonical, raw_side)
            except Exception as e:
                _logger.warning(
                    "summarize: LLM failed for %s: %s", canonical, e
                )
                return

            if not new_summary:
                # Store empty sentinel so future warm passes don't retry
                # and so get_drug_profile knows not to fall back to raw LD50 text.
                _logger.warning(
                    "summarize: empty LLM response for %s; "
                    "marking attempted to prevent fallback to raw text",
                    canonical,
                )
                new_summary = ""

            db.execute(
                "UPDATE drug_profiles SET side_effects_summary = ? "
                "WHERE name = ?",
                (new_summary, canonical),
            )
            db.commit()
            if new_summary:
                _logger.info(
                    "summarize: wrote %d chars for %s",
                    len(new_summary),
                    canonical,
                )
        finally:
            db.close()
    except Exception as e:
        _logger.exception(
            "summarize: worker crashed for %s: %s", name_lower, e
        )


def warm_drug_profiles(names):
    """Schedule background side-effects summarization for any uncached drugs.

    This is called proactively at /api/analyze so summaries are likely ready by the time
    the patient navigates to chat. The thread pool is bounded by 2, so tasks queue if busy.
    """
    if not names:
        return
    seen = set()
    for n in names:
        n_lower = (n or "").lower().strip()
        if not n_lower or n_lower in seen:
            continue
        seen.add(n_lower)
        _summary_executor.submit(_summarize_and_cache, n_lower)


def get_drug_profile(name):
    """Fetch a cached drug profile. Returns raw side_effects if the summary is not
    yet processed. Use warm_drug_profiles() at /api/analyze
    to fill the cache ahead of chat.

    Returns a dict, or None if the drug has no profile row.
    """
    name_lower = (name or "").lower().strip()
    if not name_lower:
        return None

    db = get_db()
    canonical = _resolve_to_profile_name(db, name_lower)
    row = db.execute(
        """SELECT p.indication, p.description_short, p.drug_class,
                  p.side_effects, p.side_effects_summary, p.route,
                  d.brand_names
           FROM drug_profiles p
           LEFT JOIN drugs d ON d.name = p.name
           WHERE p.name = ?""",
        (canonical,),
    ).fetchone()
    db.close()

    if not row:
        return None

    (
        indication,
        description,
        drug_class,
        raw_side,
        summary,
        route,
        brand_names,
    ) = row

    # summary semantics:
    #   None  -> never attempted; raw_side is the best we have
    #   ""    -> attempted, no useful summary; do not fall back to raw LD50 text
    #   "..." -> use the cached summary
    if summary is not None:
        side_effects = summary
    else:
        side_effects = raw_side or ""

    return {
        "name": name_lower,
        "indication": indication or "",
        "description": description or "",
        "drug_class": drug_class or "",
        "side_effects": side_effects,
        "route": route or "",
        "brand_names": brand_names or "",
    }


def find_interactions(drug_names):
    """Query interactions table for all pairs"""
    db = get_db()
    results = []
    names = [d.lower().strip() for d in drug_names]

    for i, d1 in enumerate(names):
        for d2 in names[i + 1 :]:
            rows = db.execute(
                """SELECT drug1, drug2, description,
                          severity, management
                   FROM interactions
                   WHERE drug1 = ? AND drug2 = ?""",
                (d1, d2),
            ).fetchall()

            if not rows:
                rows = db.execute(
                    """SELECT drug1, drug2, description,
                              severity, management
                       FROM interactions
                       WHERE drug1 = ? AND drug2 = ?""",
                    (d2, d1),
                ).fetchall()

            for r in rows:
                results.append(
                    {
                        "drug1": r[0],
                        "drug2": r[1],
                        "description": r[2],
                        "severity": r[3],
                        "management": r[4],
                    }
                )
    db.close()
    return results


def find_beers_flags(drug_names):
    """Check Beers Criteria for each drug."""
    db = get_db()
    flags = []
    for name in drug_names:
        rows = db.execute(
            """SELECT drug_name, drug_class, recommendation,
                      rationale, severity, alternatives
               FROM beers_criteria
               WHERE drug_name = ?""",
            (name.lower().strip(),),
        ).fetchall()
        for r in rows:
            flags.append(
                {
                    "drug": r[0],
                    "drug_class": r[1],
                    "recommendation": r[2],
                    "rationale": r[3],
                    "severity": r[4],
                    "alternatives": r[5],
                }
            )
    db.close()
    return flags


def normalize_drug_name(raw_name):
    """Try to match OCR output to a known drug in our DB."""
    db = get_db()
    clean = raw_name.lower().strip()

    row = db.execute(
        "SELECT name FROM drugs WHERE name = ?", (clean,)
    ).fetchone()
    if row:
        db.close()
        return row[0]

    row = db.execute(
        "SELECT name FROM drugs WHERE ? LIKE '%' || name || '%'", (clean,)
    ).fetchone()
    if row:
        db.close()
        return row[0]

    row = db.execute(
        "SELECT name FROM drugs WHERE name LIKE ?", (f"%{clean}%",)
    ).fetchone()
    if row:
        db.close()
        return row[0]

    db.close()
    return clean


def extract_drugs_from_image(image_path):
    """Use Gemma 4 vision to read drug names from a photo."""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    response = ollama.chat(
        model=VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": (
                    "Look at this medication label photo. "
                    "Extract the drug name and dosage. "
                    "Return ONLY a JSON array, nothing else: "
                    '[{"drug_name": "...", "dosage": "..."}]'
                ),
                "images": [img_b64],
            }
        ],
    )

    text = response["message"]["content"]

    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)

    try:
        start = text.index("[")
        end = text.rindex("]") + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        try:
            start = text.index("{")
            end = text.rindex("}") + 1
            return [json.loads(text[start:end])]
        except (ValueError, json.JSONDecodeError):
            return [{"drug_name": text.strip(), "dosage": "unknown"}]


def _build_medication_reference(drug_names):
    """Format drug profile facts as source of truth for system prompt injection

    Returns an empty string if no usable profiles exist, callers can skip the block
    """
    if not drug_names:
        return ""

    sections = []
    for name in drug_names:
        profile = get_drug_profile(name)
        if not profile:
            continue

        brand_suffix = ""
        brands_raw = profile.get("brand_names") or ""
        if brands_raw:
            try:
                brands = json.loads(brands_raw)
                if brands:
                    brand_suffix = f" (also sold as {', '.join(brands[:3])})"
            except (json.JSONDecodeError, TypeError):
                pass

        lines = [f"{name.upper()}{brand_suffix}"]
        if profile.get("drug_class"):
            lines.append(f"  Class: {profile['drug_class']}")
        if profile.get("indication"):
            lines.append(f"  Used for: {profile['indication']}")
        if profile.get("side_effects"):
            lines.append(f"  Common side effects: {profile['side_effects']}")

        if len(lines) > 1:
            sections.append("\n".join(lines))

    if not sections:
        return ""

    return (
        "MEDICATION REFERENCE\n"
        "Use the facts below as your source of truth when answering about these "
        "specific medications. Paraphrase naturally — do not quote verbatim or list "
        "every field unless the patient asks for it. For drugs not listed here, use "
        "your general training knowledge.\n\n"
        + "\n\n".join(sections)
    )


def answer_question(question, drug_names, history):
    """follow up question chatbot, answer a patient's question with medication context"""
    meds_str = ", ".join(drug_names) if drug_names else "none listed"

    system_prompt = (
        "You are Medora, a warm and knowledgeable medication safety assistant. "
        f"The patient takes these medications: {meds_str}. "
        "Use short, simple sentences. Explain medical terms in plain language. "
        "Share standard patient education information freely. "
        "Defer diagnosis and dosage decisions to doctors. "
        "Never repeat the same disclaimer twice in a row."
    )

    reference = _build_medication_reference(drug_names)
    if reference:
        system_prompt = f"{system_prompt}\n\n{reference}"

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history or []:
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    response = ollama.chat(
        model=TEXT_MODEL,
        messages=messages,
        options={"num_predict": 1024},
    )
    return response["message"]["content"]


def generate_explanation(drug_names, interactions, beers_flags):
    """Ask Gemma 4 for a plain-language report."""

    interaction_text = ""
    if interactions:
        for ix in interactions:
            sev = "major" if ix["severity"] == "major" else "moderate"
            interaction_text += (
                f"{ix['drug1']} and {ix['drug2']} together ({sev}): "
                f"{ix['description'].strip()} If this happens, guidance is: {ix['management'].strip()}\n"
            )
    else:
        interaction_text = "No drug-drug interactions in our database for this list."

    beers_text = ""
    if beers_flags:
        for b in beers_flags:
            beers_text += (
                f"Drug {b['drug']} ({b.get('drug_class') or 'unknown class'}): "
                f"{b['recommendation'].strip()} "
                f"Reason: {b['rationale'].strip()} "
                f"Possible alternatives to ask about: {b['alternatives'].strip()}\n"
            )

    prompt = f"""You are Medora, a medication safety assistant speaking to an elderly
patient or their caregiver.

They are taking: {", ".join(drug_names)}

DATA FROM OUR CHECKS (for your eyes only; do not dump this back verbatim):
DRUG-DRUG:
{interaction_text}
BEERS (older adult safety flags):
{beers_text if beers_text else "None flagged."}

RULES:
- Use short sentences. Maximum 15 words per sentence.
- Use simple words. Say "bleeding" not "hemorrhage." Say "dangerous"
  not "contraindicated."
- NO medical jargon unless you immediately explain it in plain language.
- NO bullet points, NO numbered lists, NO headings. Write as natural speech, like you are talking.
- For each drug-drug interaction, use exactly three short sentences: what might happen, how serious it is, what to do. If there are many, say the most serious one or two in full, then one short sentence for the rest.
- If there are Beers flags, add one or two short sentences in plain language. Skip if there were none.
- Do not add a long introduction or closing essay. No "In conclusion." Say once that you are not a doctor if there is room.
- End with exactly ONE clear next step for the patient.
- Your ENTIRE reply must be under 150 words. Stop when you reach the next step. Do not continue after that."""

    response = ollama.chat(
        model=TEXT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        options={"num_predict": 380},
    )
    return response["message"]["content"]
