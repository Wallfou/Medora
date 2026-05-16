"""SQLite, Ollama vision + text."""

import base64
import html
import json
import logging
import os
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import ollama
from rapidfuzz import fuzz, process

DB_FILE = os.environ.get("MEDORA_DB", "medora.db")
TEXT_MODEL = os.environ.get("MEDORA_TEXT_MODEL", "gemma4")
VISION_MODEL = os.environ.get("MEDORA_VISION_MODEL", "gemma4")
SUMMARY_MODEL = os.environ.get("MEDORA_SUMMARY_MODEL", "gemma4")
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


# Medication name normalization
# Resolution layers, in order of confidence:
# 1. Strip descriptors / strengths / dose forms
# 2. Exact match against drugs.name or drug_aliases.alias
# 3. Fuzzy match (rapidfuzz WRatio) against the same pool, deduped per canonical drug
# Result statuses: "resolved", "ambiguous", "unresolved"

# Longest phrases first so "regular strength" matches before "regular".
_DESCRIPTOR_WORDS = sorted(
    [
        "baby", "babies",
        "children's", "childrens", "children", "child's", "child",
        "kids'", "kids", "kid's",
        "pediatric", "infant", "infants'", "infant's", "infants",
        "adult", "adults", "adults'",
        "low-dose", "low dose", "lo-dose", "lodose",
        "regular strength", "regular", "extra strength", "extra-strength",
        "maximum strength", "max strength", "max-strength",
        "mini", "junior", "jr",
        "chewable", "chewables", "chew",
        "fast-acting", "fast acting",
        "rapid release", "rapid-release",
        "coated", "uncoated", "enteric coated", "enteric-coated",
    ],
    key=len,
    reverse=True,
)
_DESCRIPTOR_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in _DESCRIPTOR_WORDS) + r")\b",
    re.IGNORECASE,
)

# Pharmacokinetic release form suffixes -> same active ingredient, safe to strip for identification
# "ER" / "XR" / etc
_RELEASE_FORM_RE = re.compile(
    r"\b(?:ER|XR|SR|CR|IR|XL|MR|DR|ODT|HCL)\b",
    re.IGNORECASE,
)

# Dosage forms
_DOSE_FORM_RE = re.compile(
    r"\b(?:tablets?|capsules?|caplets?|pills?|gelcaps?|softgels?|gel|"
    r"drops?|syrup|suspension|suppositor(?:y|ies)|patch(?:es)?|"
    r"cream|ointment|spray|inhaler|lozenges?|powder|liquid)\b",
    re.IGNORECASE,
)

# Strength values: "81mg", "500 mg", "5/325", "10%"
_STRENGTH_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*/\s*\d+(?:[.,]\d+)?\s*"
    r"(?:mg|mcg|µg|g|ml|iu|units?|%)?\b"
    r"|\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|iu|units?|%)\b",
    re.IGNORECASE,
)

# Punctuation we want to strip out (commas between strengths, trailing parentheticals
# Hyphens are kept since some drug names include them
_PUNCT_RE = re.compile(r"[(),;:]")


def _strip_descriptors(text):
    """Remove descriptors, strengths, dose forms, and release-form suffixes.
    Returns the cleaned candidate string. Whitespace collapsed.
    """
    if not text:
        return ""
    s = text.lower()
    s = _STRENGTH_RE.sub(" ", s)
    s = _DESCRIPTOR_RE.sub(" ", s)
    s = _DOSE_FORM_RE.sub(" ", s)
    s = _RELEASE_FORM_RE.sub(" ", s)
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


_choices_cache = None
# Set to Trueto skip eager build at import time
_WARM_NORMALIZE_AT_IMPORT = os.environ.get("MEDORA_WARM_NORMALIZE", "1") != "0"


def _get_normalize_choices():
    """Lazy build the alias to canonical lookup table for fuzzy search

    Drugs.name values map to themselves; drug_aliases entries map to their
    canonical drug. Drug-name keys take precedence over conflicting alias keys.
    Result is cached for the process lifetime.
    """
    global _choices_cache
    if _choices_cache is not None:
        return _choices_cache

    db = get_db()
    try:
        choices = {}
        for (name,) in db.execute("SELECT name FROM drugs"):
            if name:
                choices[name.lower()] = name.lower()
        for alias, canonical in db.execute(
            "SELECT alias, canonical FROM drug_aliases"
        ):
            if not alias or not canonical:
                continue
            a = alias.lower()
            if a not in choices:
                choices[a] = canonical.lower()
    finally:
        db.close()

    _choices_cache = choices
    return choices


if _WARM_NORMALIZE_AT_IMPORT:
    try:
        _t0 = time.perf_counter()
        _get_normalize_choices()
        _logger.info(
            "normalize: warmed choices cache (%d entries) in %.0f ms",
            len(_choices_cache or {}),
            (time.perf_counter() - _t0) * 1000,
        )
    except Exception as _e:
        # fall back to lazy build if db not ready yet
        _logger.warning("normalize: eager warm failed (%s); will lazy-build", _e)


def _fuzzy_candidates(query, limit=10):
    """Return top fuzzy matches against drug names + aliases, deduped per canonical drug.

    Each candidate: {"name": canonical, "matched_as": alias-or-name, "score": int}.
    Sorted by score descending.
    """
    if not query:
        return []
    choices = _get_normalize_choices()
    if not choices:
        return []

    raw = process.extract(
        query, list(choices.keys()), scorer=fuzz.WRatio, limit=limit * 3
    )
    best_per_canonical = {}
    for matched, score, _ in raw:
        canonical = choices[matched]
        existing = best_per_canonical.get(canonical)
        if existing is None or score > existing["score"]:
            best_per_canonical[canonical] = {
                "name": canonical,
                "matched_as": matched,
                "score": int(score),
            }

    ranked = sorted(best_per_canonical.values(), key=lambda c: -c["score"])
    return ranked[:limit]


def normalize_medication(raw_input):
    """Map a patient's input string to a canonical drug name. 

    Returns a dict with:
        raw -- the original input
        cleaned -- after descriptor/strength/form stripping
        status -- "resolved" | "ambiguous" | "unresolved"
        resolved -- canonical drug name (only when resolved)
        candidates -- list of {name, matched_as, score} (for ambiguous/unresolved)

    Resolution rules:
        - Exact hit on drugs.name or drug_aliases.alias after stripping  -> resolved
        - Top fuzzy match >= 92 AND beats #2 by >= 8 points -> resolved
        - Otherwise, if top fuzzy >= 70 -> ambiguous
        - Otherwise -> unresolved
    """
    raw = (raw_input or "").strip()
    cleaned = _strip_descriptors(raw)

    if not cleaned:
        return {
            "raw": raw,
            "cleaned": "",
            "status": "unresolved",
            "resolved": "",
            "candidates": [],
        }

    db = get_db()
    try:
        row = db.execute(
            "SELECT name FROM drugs WHERE name = ?", (cleaned,)
        ).fetchone()
        if row:
            return {
                "raw": raw,
                "cleaned": cleaned,
                "status": "resolved",
                "resolved": row[0],
                "candidates": [],
            }
        row = db.execute(
            "SELECT canonical FROM drug_aliases WHERE alias = ?", (cleaned,)
        ).fetchone()
        if row:
            return {
                "raw": raw,
                "cleaned": cleaned,
                "status": "resolved",
                "resolved": row[0],
                "candidates": [],
            }
    finally:
        db.close()

    candidates = _fuzzy_candidates(cleaned, limit=5)
    if not candidates:
        return {
            "raw": raw,
            "cleaned": cleaned,
            "status": "unresolved",
            "resolved": "",
            "candidates": [],
        }

    top = candidates[0]
    runner_up_score = candidates[1]["score"] if len(candidates) > 1 else 0
    if top["score"] >= 92 and (top["score"] - runner_up_score) >= 8:
        return {
            "raw": raw,
            "cleaned": cleaned,
            "status": "resolved",
            "resolved": top["name"],
            "candidates": [],
        }

    if top["score"] < 70:
        return {
            "raw": raw,
            "cleaned": cleaned,
            "status": "unresolved",
            "resolved": "",
            "candidates": candidates[:3],
        }

    return {
        "raw": raw,
        "cleaned": cleaned,
        "status": "ambiguous",
        "resolved": "",
        "candidates": candidates,
    }


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


def _coerce_meds(meds):
    """Accept either a list of names or a list of {name, dosage} dicts.

    Returns a list of (name, dosage) tuples with non-empty names, names
    lowercased. Lets callers pass legacy string lists during migration.
    """
    out = []
    for m in meds or []:
        if isinstance(m, str):
            name, dosage = m, ""
        elif isinstance(m, dict):
            name = m.get("name") or ""
            dosage = m.get("dosage") or ""
        else:
            continue
        name = name.strip().lower()
        if name:
            out.append((name, (dosage or "").strip()))
    return out


def _format_meds_inline(meds):
    """Render a meds list as 'metformin (500 mg), aspirin (81 mg daily)'."""
    parts = []
    for name, dosage in meds:
        parts.append(f"{name} ({dosage})" if dosage else name)
    return ", ".join(parts)


def _build_medication_reference(meds):
    """Format drug profile facts as source of truth for system prompt injection

    meds: list of (name, dosage) tuples. Dosage is injected verbatim as the
    patient typed it -- chatbot uses it to answer "am I taking too much?" style
    questions without us trying to parse free-form dosage strings.

    Returns an empty string if no usable profiles exist, callers can skip the block
    """
    if not meds:
        return ""

    sections = []
    for name, dosage in meds:
        profile = get_drug_profile(name)
        if not profile:
            if dosage:
                sections.append(f"{name.upper()}\n  Patient's dose: {dosage}")
            continue

        lines = [name.upper()]
        if dosage:
            lines.append(f"  Patient's dose: {dosage}")
        if profile.get("side_effects"):
            lines.append(f"  Common side effects: {profile['side_effects']}")

        if len(lines) > 1:
            sections.append("\n".join(lines))

    if not sections:
        return ""

    return (
        "Background facts about the patient's medications. Weave in only what "
        "directly answers the patient's question; do not list every field unless "
        "asked. Stay in your normal warm, conversational voice. For drugs not "
        "listed here, use your general training knowledge.\n\n"
        + "\n\n".join(sections)
    )


def _build_ask_messages(question, medications, history):
    meds = _coerce_meds(medications)
    meds_str = _format_meds_inline(meds) if meds else "none listed"

    system_prompt = (
        "You are Medora, a warm and knowledgeable medication safety assistant. "
        f"The patient takes these medications: {meds_str}. "
        "Use short, simple sentences. Explain medical terms in plain language. "
        "Share standard patient education information freely. "
        "Defer diagnosis and dosage decisions to doctors. "
        "Open with the direct answer; do not preamble. "
        "Keep responses under 180 words unless the patient asks for more detail. "
        "Use short prose paragraphs, not bulleted lists or section headers. "
        "State each important point once. Do not restate the same advice in different words, "
        "and never repeat the same disclaimer twice in a row."
    )

    reference = _build_medication_reference(meds)
    if reference:
        system_prompt = f"{system_prompt}\n\n{reference}"

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history or []:
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})
    return messages


_ASK_OPTIONS = {
    "num_predict": 1400,
    "repeat_penalty": 1.08,
    "repeat_last_n": 64,
    "num_ctx": 2048,
}


def answer_question_stream(question, medications, history):
    """
    Streaming follow-up chatbot 
    
    Yields response text chunks as they arrive from Ollama. 
    Prefer this over answer_question for chat endpoints so the
    client can render tokens progressively
    """
    messages = _build_ask_messages(question, medications, history)
    stream = ollama.chat(
        model=TEXT_MODEL,
        messages=messages,
        stream=True,
        keep_alive="24h",
        options=_ASK_OPTIONS,
    )
    for chunk in stream:
        piece = chunk.get("message", {}).get("content", "")
        if piece:
            yield piece


def answer_question(question, medications, history):
    """
    Non-streaming chat. 
    Collects the streamed response into a single string."""
    messages = _build_ask_messages(question, medications, history)

    response = ollama.chat(
        model=TEXT_MODEL,
        messages=messages,
        keep_alive="24h",
        options=_ASK_OPTIONS,
    )
    return response["message"]["content"]


def generate_explanation(medications, interactions, beers_flags):
    """Ask Gemma 4 for a plain-language report.

    medications: list of name strings OR {name, dosage} dicts.
    """
    meds = _coerce_meds(medications)

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

They are taking: {_format_meds_inline(meds)}

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
