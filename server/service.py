"""SQLite, Ollama vision + text."""

import base64
import json
import os
import re
import sqlite3

import ollama

DB_FILE = os.environ.get("MEDORA_DB", "medora.db")
MODEL = os.environ.get("MEDORA_MODEL", "medora-gemma4")


def get_db():
    return sqlite3.connect(DB_FILE)


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
        model=MODEL,
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

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history or []:
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    response = ollama.chat(
        model=MODEL,
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
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        options={"num_predict": 380},
    )
    return response["message"]["content"]
