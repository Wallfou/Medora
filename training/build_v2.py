"""Rebuild medora_train.jsonl with a realistic MEDICATION REFERENCE block
injected into each example's system prompt, matching the production prompt
shape produced by service._build_medication_reference (after the v2 update).

Side-effect text here is hand-authored for a warm, patient-facing voice. We
deliberately do NOT pull from drug_profiles.side_effects_summary because that
column contains DrugBank-flavored clinical text (LD50 references,
teratogenicity warnings, etc.) that is the source of Model 3's drift.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "medora_train.jsonl"
OUT = HERE / "medora_train_v2.jsonl"

# (typical-adult dose, plain-language side-effect line)
PROFILES = {
    "acetaminophen": (
        "500mg every 6 hours as needed",
        "Generally well-tolerated. Doses over about 3g a day, or use with regular alcohol, can stress the liver.",
    ),
    "allopurinol": (
        "300mg daily",
        "Usually well-tolerated. Watch for any rash — rarely it can be a serious skin reaction.",
    ),
    "alprazolam": (
        "0.5mg twice daily",
        "Drowsiness, unsteadiness, memory or balance problems. Dependence risk; stopping suddenly can cause withdrawal.",
    ),
    "amiodarone": (
        "200mg daily",
        "Thyroid changes, sun sensitivity, tremor, visual halos. Long-term use can affect the lungs or liver.",
    ),
    "amitriptyline": (
        "25mg at bedtime",
        "Dry mouth, drowsiness, constipation, dizziness on standing, weight gain, urinary trouble — often harder on older adults.",
    ),
    "amlodipine": (
        "5mg daily",
        "Ankle swelling, flushing, occasional headache.",
    ),
    "apixaban": (
        "5mg twice daily",
        "Easier bruising and bleeding. Watch for blood in urine or stool, a severe headache, or bleeding that won't stop.",
    ),
    "aspirin": (
        "81mg daily",
        "Stomach upset, easier bruising and bleeding. Long-term daily use raises the risk of GI bleeding.",
    ),
    "atorvastatin": (
        "20mg daily",
        "Muscle aches or weakness. Rare but important: severe muscle pain with dark urine, or signs of liver trouble.",
    ),
    "calcium supplement": (
        "500mg twice daily with meals",
        "Generally well-tolerated. Higher doses can cause constipation or gas, and rarely kidney stones.",
    ),
    "carvedilol": (
        "12.5mg twice daily",
        "Tiredness, slow heart rate, dizziness on standing, occasional shortness of breath.",
    ),
    "ciprofloxacin": (
        "500mg twice daily",
        "Nausea, diarrhea, tendon pain or rupture (especially in older adults), occasional confusion or dizziness.",
    ),
    "clopidogrel": (
        "75mg daily",
        "Easier bruising and bleeding, occasional rash or stomach upset.",
    ),
    "diazepam": (
        "5mg at bedtime",
        "Drowsiness, unsteadiness, memory and balance problems. Higher fall risk in older adults. Dependence risk.",
    ),
    "digoxin": (
        "0.125mg daily",
        "Nausea, loss of appetite, blurry or yellow-tinged vision, slow or irregular heartbeat — a sign the level may be too high.",
    ),
    "diltiazem": (
        "120mg daily",
        "Ankle swelling, slow heart rate, mild dizziness, occasional headache or flushing.",
    ),
    "donepezil": (
        "5mg daily",
        "Nausea, diarrhea, vivid dreams, slow heart rate, occasional muscle cramps.",
    ),
    "duloxetine": (
        "30mg daily",
        "Nausea, dry mouth, drowsiness or insomnia, sweating. Most ease after the first 2–4 weeks.",
    ),
    "escitalopram": (
        "10mg daily",
        "Nausea, headache, trouble sleeping, sexual side effects. Most ease after the first 2–4 weeks.",
    ),
    "finasteride": (
        "5mg daily",
        "Decreased libido, erectile changes, occasional breast tenderness.",
    ),
    "furosemide": (
        "20mg daily",
        "Frequent urination, dehydration, low potassium, dizziness on standing.",
    ),
    "gabapentin": (
        "300mg three times daily",
        "Drowsiness, dizziness, mild swelling in the feet or ankles, sometimes blurry vision.",
    ),
    "glipizide": (
        "5mg daily before breakfast",
        "Low blood sugar (shakiness, sweating, confusion) — especially if a meal is delayed. Mild weight gain.",
    ),
    "hydrochlorothiazide": (
        "25mg daily",
        "Frequent urination, low potassium or sodium, raised uric acid or blood sugar, sun sensitivity.",
    ),
    "hydrocodone": (
        "5mg every 6 hours as needed",
        "Drowsiness, constipation, nausea, slowed breathing at higher doses. Dependence risk with regular use.",
    ),
    "ibuprofen": (
        "400mg three times daily",
        "Stomach pain, heartburn, raised blood pressure, kidney strain with long-term use, easier bleeding.",
    ),
    "insulin glargine": (
        "20 units at bedtime",
        "Low blood sugar (shakiness, sweating, confusion), weight gain, redness at the injection site.",
    ),
    "levodopa/carbidopa": (
        "25/100 mg three times daily",
        "Nausea, dizziness on standing, involuntary movements (dyskinesias) with long-term use, occasional sleepiness.",
    ),
    "levothyroxine": (
        "75mcg daily on an empty stomach",
        "Usually well-tolerated. Too much can cause racing heart, tremor, weight loss, or trouble sleeping.",
    ),
    "lisinopril": (
        "10mg daily",
        "Dry persistent cough, dizziness on standing, mild rise in potassium. Rare but urgent: lip or tongue swelling.",
    ),
    "losartan": (
        "50mg daily",
        "Dizziness, mild rise in potassium, occasional headache or back pain.",
    ),
    "memantine": (
        "10mg twice daily",
        "Dizziness, headache, mild constipation, occasional confusion.",
    ),
    "metformin": (
        "500mg twice daily with meals",
        "Stomach upset, nausea, diarrhea, metallic taste — usually settles in 2–4 weeks if taken with food.",
    ),
    "metoprolol": (
        "50mg twice daily",
        "Tiredness, slow heart rate, cold hands and feet, mild dizziness.",
    ),
    "morphine": (
        "15mg every 4 hours as needed",
        "Drowsiness, constipation, nausea, slowed breathing at higher doses. Dependence risk with regular use.",
    ),
    "nitrofurantoin": (
        "100mg twice daily",
        "Nausea, headache, harmless brown-yellow urine. Long courses can affect the lungs or liver — watch for cough or breathing trouble.",
    ),
    "omeprazole": (
        "20mg daily before breakfast",
        "Generally mild — headache, gas, diarrhea. Long-term use may affect magnesium, calcium, or B12 levels.",
    ),
    "oxycodone": (
        "5mg every 6 hours as needed",
        "Drowsiness, constipation, nausea, slowed breathing at higher doses. Dependence risk with regular use.",
    ),
    "pioglitazone": (
        "15mg daily",
        "Weight gain, ankle swelling, mild anemia, small increase in fracture risk with long-term use.",
    ),
    "prednisone": (
        "10mg daily",
        "Increased appetite, mood swings, trouble sleeping, raised blood sugar, bone thinning and raised blood pressure with long-term use.",
    ),
    "pregabalin": (
        "75mg twice daily",
        "Drowsiness, dizziness, mild swelling in the feet or ankles, occasional weight gain.",
    ),
    "rivaroxaban": (
        "20mg daily with the evening meal",
        "Easier bruising and bleeding. Watch for blood in urine or stool, severe headache, or bleeding that won't stop.",
    ),
    "semaglutide": (
        "1mg weekly",
        "Nausea, decreased appetite, occasional vomiting or diarrhea. Usually improves over a few weeks.",
    ),
    "sertraline": (
        "50mg daily",
        "Nausea, headache, trouble sleeping, sexual side effects. Most ease after the first 2–4 weeks.",
    ),
    "simvastatin": (
        "20mg at bedtime",
        "Muscle aches or weakness. Rare but important: severe muscle pain with dark urine, or signs of liver trouble.",
    ),
    "spironolactone": (
        "25mg daily",
        "Raised potassium, dizziness, breast tenderness, occasional menstrual changes.",
    ),
    "tamsulosin": (
        "0.4mg daily after the same meal",
        "Dizziness when standing, stuffy nose, reduced ejaculation volume.",
    ),
    "tramadol": (
        "50mg every 6 hours as needed",
        "Drowsiness, nausea, constipation, dizziness. Can interact with antidepressants to raise serotonin levels.",
    ),
    "valsartan": (
        "80mg daily",
        "Dizziness, mild rise in potassium, occasional headache.",
    ),
    "verapamil": (
        "120mg daily",
        "Constipation, ankle swelling, slow heart rate, mild dizziness.",
    ),
    "warfarin": (
        "5mg daily",
        "Easier bruising and bleeding (gums, nose, cuts). Serious signs: blood in urine or stool, severe headache, or heavy persistent bleeding.",
    ),
    "zolpidem": (
        "5mg at bedtime",
        "Next-morning drowsiness, dizziness, higher fall risk in older adults, occasional sleepwalking or memory blanks.",
    ),
}

PREAMBLE = (
    "Background facts about the patient's medications. Weave in only what "
    "directly answers the patient's question; do not list every field unless "
    "asked. Stay in your normal warm, conversational voice. For drugs not "
    "listed here, use your general training knowledge."
)


def build_reference(meds_list):
    sections = []
    for name in meds_list:
        key = name.lower().strip()
        if key not in PROFILES:
            # Unknown drug -- emit minimal entry with no fabricated facts.
            sections.append(f"{name.upper()}")
            continue
        dose, side_effects = PROFILES[key]
        sections.append(
            f"{name.upper()}\n"
            f"  Patient's dose: {dose}\n"
            f"  Common side effects: {side_effects}"
        )
    return PREAMBLE + "\n\n" + "\n\n".join(sections)


def parse_meds(system_prompt):
    m = re.search(
        r"The patient takes these medications: ([^.]+)\.", system_prompt
    )
    if not m:
        return []
    return [d.strip() for d in m.group(1).split(",") if d.strip()]


def rebuild_row(row):
    sys_prompt = row["messages"][0]["content"]
    meds = parse_meds(sys_prompt)
    if not meds:
        return row
    ref = build_reference(meds)
    new_sys = f"{sys_prompt}\n\n{ref}"
    new_row = {"messages": list(row["messages"])}
    new_row["messages"][0] = {"role": "system", "content": new_sys}
    return new_row


def main():
    rows_in = []
    with open(SRC) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows_in.append(json.loads(line))

    rows_out = [rebuild_row(r) for r in rows_in]

    with open(OUT, "w") as f:
        for r in rows_out:
            f.write(json.dumps(r) + "\n")

    print(f"Wrote {len(rows_out)} rows to {OUT}")

    # Sanity: report any drugs in training data that aren't in PROFILES
    seen = set()
    for r in rows_in:
        for d in parse_meds(r["messages"][0]["content"]):
            seen.add(d.lower())
    missing = sorted(seen - set(PROFILES.keys()))
    if missing:
        print(f"WARNING: no profile entry for: {missing}")
    else:
        print("All drugs in training data have profile entries.")


if __name__ == "__main__":
    main()
