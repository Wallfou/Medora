"""SQLite, Ollama vision + text."""

import base64
import json
import os
import re
import sqlite3

import ollama

DB_FILE = os.environ.get("MEDORA_DB", "medora.db")
MODEL = os.environ.get("MEDORA_MODEL", "gemma4")


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


def generate_explanation(drug_names, interactions, beers_flags):
    """Ask Gemma 4 for a plain-language report."""

    interaction_text = ""
    if interactions:
        for ix in interactions:
            icon = "🔴" if ix["severity"] == "major" else "🟡"
            interaction_text += (
                f"- {icon} {ix['drug1']} + {ix['drug2']} "
                f"({ix['severity']}): {ix['description']} "
                f"Management: {ix['management']}\n"
            )
    else:
        interaction_text = "No drug-drug interactions found in database."

    beers_text = ""
    if beers_flags:
        for b in beers_flags:
            beers_text += (
                f"- {b['drug']} ({b['drug_class']}): "
                f"{b['recommendation']}. {b['rationale']} "
                f"Alternatives: {b['alternatives']}\n"
            )

    prompt = f"""You are Medora, a friendly medication safety assistant.
A patient is taking these medications: {', '.join(drug_names)}.

DRUG INTERACTIONS FOUND:
{interaction_text}

BEERS CRITERIA FLAGS (potentially inappropriate for elderly):
{beers_text if beers_text else "None flagged."}

Please provide a clear, caring summary for the patient:
1. Explain each interaction in simple language (as if talking to
   a grandmother who is not a medical professional)
2. For each Beers flag, explain why it may be risky for someone
   over 65 and what alternatives exist
3. List what to discuss with their doctor at the next visit
4. End with a reminder that you are NOT replacing medical advice

Keep it warm, clear, and actionable. Use emoji sparingly for
severity: 🔴 Major  🟡 Moderate  🟢 Safe"""

    response = ollama.chat(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response["message"]["content"]
