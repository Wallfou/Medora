"""
Medora Drug Interaction Database Builder

Run from the project root:  python build_drug_db.py

Creates medora.db (RxNorm RxCUIs, curated interactions, Beers criteria).
If datasets/full database.xml is present, DrugBank drug–drug interactions
are merged in afterward (curated beers_and_clinical pairs are preserved).
"""

import sqlite3
import requests
import time
import json
import re
import os
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
DB_FILE = "medora.db"

# DrugBank full database XML (after unzip). See datasets/README or DrugBank download.
DRUGBANK_XML = os.path.join("datasets", "full database.xml")

DRUGBANK_NS = "{http://www.drugbank.ca}"

COMMON_ELDERLY_DRUGS = [
    "warfarin", "metformin", "lisinopril", "amlodipine", "atorvastatin",
    "omeprazole", "metoprolol", "levothyroxine", "hydrochlorothiazide",
    "simvastatin", "losartan", "furosemide", "gabapentin", "prednisone",
    "tramadol", "acetaminophen", "ibuprofen", "aspirin", "clopidogrel",
    "apixaban", "rivaroxaban", "carvedilol", "sertraline", "escitalopram",
    "alprazolam", "diazepam", "zolpidem", "oxycodone", "morphine",
    "amitriptyline", "duloxetine", "pregabalin", "allopurinol",
    "digoxin", "amiodarone", "diltiazem", "verapamil", "spironolactone",
    "potassium chloride", "insulin glargine", "glipizide", "pioglitazone",
    "donepezil", "memantine", "levodopa", "carbidopa", "tamsulosin",
    "finasteride", "ciprofloxacin", "nitrofurantoin",
]

# ---------------------------------------------------------------------------
# High-priority drug interactions for elderly patients
# Source: Beers Criteria 2023 Table 5 + clinical pharmacology references
# These are the interactions that MUST be in the database even if scraping
# fails
# ---------------------------------------------------------------------------
CRITICAL_INTERACTIONS = [
    {
        "drug1": "warfarin", "drug2": "aspirin",
        "description": "Combined use significantly increases the risk of major bleeding, including gastrointestinal and intracranial hemorrhage.",
        "severity": "major",
        "management": "Avoid combination unless specifically directed by a physician for a compelling indication. Monitor INR closely if co-prescribed."
    },
    {
        "drug1": "warfarin", "drug2": "ibuprofen",
        "description": "NSAIDs increase anticoagulant effect of warfarin and independently increase bleeding risk by inhibiting platelet function and damaging GI mucosa.",
        "severity": "major",
        "management": "Avoid NSAIDs in patients on warfarin. Use acetaminophen for pain relief instead. If unavoidable, monitor INR frequently."
    },
    {
        "drug1": "warfarin", "drug2": "amiodarone",
        "description": "Amiodarone inhibits CYP2C9 metabolism of warfarin, dramatically increasing warfarin levels and bleeding risk. Effect can persist for months after amiodarone is stopped.",
        "severity": "major",
        "management": "Reduce warfarin dose by 30-50% when starting amiodarone. Monitor INR weekly for several months."
    },
    {
        "drug1": "warfarin", "drug2": "ciprofloxacin",
        "description": "Ciprofloxacin inhibits CYP1A2 metabolism of warfarin, leading to elevated INR and increased bleeding risk.",
        "severity": "major",
        "management": "Monitor INR within 2-3 days of starting ciprofloxacin. Consider alternative antibiotic if possible."
    },
    {
        "drug1": "warfarin", "drug2": "omeprazole",
        "description": "Omeprazole may inhibit CYP2C19 metabolism of warfarin, potentially increasing anticoagulant effect.",
        "severity": "moderate",
        "management": "Monitor INR when starting or stopping omeprazole in patients on warfarin."
    },
    {
        "drug1": "metformin", "drug2": "ciprofloxacin",
        "description": "Fluoroquinolones can cause unpredictable blood sugar changes (both hypo- and hyperglycemia) in patients taking antidiabetic medications.",
        "severity": "moderate",
        "management": "Monitor blood glucose more frequently during antibiotic course."
    },
    {
        "drug1": "lisinopril", "drug2": "spironolactone",
        "description": "ACE inhibitors combined with potassium-sparing diuretics significantly increase the risk of life-threatening hyperkalemia.",
        "severity": "major",
        "management": "Monitor potassium levels within 1 week of starting combination and periodically thereafter. Avoid in patients with renal impairment."
    },
    {
        "drug1": "lisinopril", "drug2": "potassium chloride",
        "description": "ACE inhibitors reduce aldosterone secretion, decreasing potassium excretion. Adding potassium supplements can cause dangerous hyperkalemia.",
        "severity": "major",
        "management": "Monitor serum potassium closely. Reassess need for potassium supplementation when ACE inhibitor is started."
    },
    {
        "drug1": "digoxin", "drug2": "amiodarone",
        "description": "Amiodarone increases digoxin levels by 70-100%, risking digoxin toxicity (nausea, visual changes, fatal arrhythmias).",
        "severity": "major",
        "management": "Reduce digoxin dose by 50% when starting amiodarone. Monitor digoxin levels and watch for toxicity signs."
    },
    {
        "drug1": "digoxin", "drug2": "verapamil",
        "description": "Verapamil increases digoxin serum concentrations by reducing its renal and nonrenal clearance. Both drugs also slow heart rate.",
        "severity": "major",
        "management": "Reduce digoxin dose by 25-50%. Monitor digoxin levels and heart rate."
    },
    {
        "drug1": "digoxin", "drug2": "diltiazem",
        "description": "Diltiazem can increase digoxin levels and both drugs have additive effects on slowing heart rate and AV conduction.",
        "severity": "moderate",
        "management": "Monitor digoxin levels and heart rate when combining."
    },
    {
        "drug1": "simvastatin", "drug2": "amiodarone",
        "description": "Amiodarone inhibits CYP3A4, increasing simvastatin levels and risk of rhabdomyolysis (severe muscle breakdown).",
        "severity": "major",
        "management": "Do not exceed simvastatin 20mg/day with amiodarone. Consider switching to a statin not metabolized by CYP3A4 (pravastatin, rosuvastatin)."
    },
    {
        "drug1": "simvastatin", "drug2": "diltiazem",
        "description": "Diltiazem inhibits CYP3A4, increasing simvastatin levels and rhabdomyolysis risk.",
        "severity": "major",
        "management": "Do not exceed simvastatin 10mg/day with diltiazem. Consider alternative statin."
    },
    {
        "drug1": "simvastatin", "drug2": "amlodipine",
        "description": "Amlodipine moderately inhibits CYP3A4, increasing simvastatin exposure.",
        "severity": "moderate",
        "management": "Do not exceed simvastatin 20mg/day with amlodipine."
    },
    {
        "drug1": "oxycodone", "drug2": "diazepam",
        "description": "Concurrent opioids and benzodiazepines cause additive CNS and respiratory depression. This combination is a leading cause of overdose death.",
        "severity": "major",
        "management": "AVOID combination. If absolutely necessary, use lowest effective doses and shortest duration. FDA black box warning applies."
    },
    {
        "drug1": "oxycodone", "drug2": "gabapentin",
        "description": "Gabapentinoids combined with opioids increase risk of respiratory depression, sedation, and death.",
        "severity": "major",
        "management": "Avoid combination when possible. If used together, start gabapentin at low dose and monitor closely."
    },
    {
        "drug1": "tramadol", "drug2": "sertraline",
        "description": "Both drugs increase serotonin levels, risking serotonin syndrome (agitation, confusion, rapid heart rate, high blood pressure, muscle rigidity).",
        "severity": "major",
        "management": "Use with caution or avoid. Educate patient on serotonin syndrome symptoms. Consider non-serotonergic pain alternative."
    },
    {
        "drug1": "tramadol", "drug2": "escitalopram",
        "description": "Combined serotonergic activity increases risk of serotonin syndrome. Escitalopram also inhibits CYP2D6, potentially increasing tramadol levels.",
        "severity": "major",
        "management": "Avoid combination if possible. If used, start at low doses and watch for serotonin syndrome symptoms."
    },
    {
        "drug1": "metformin", "drug2": "furosemide",
        "description": "Furosemide can impair kidney function and cause dehydration, increasing risk of metformin-associated lactic acidosis.",
        "severity": "moderate",
        "management": "Monitor renal function. Ensure adequate hydration. Consider dose adjustment in elderly."
    },
    {
        "drug1": "aspirin", "drug2": "ibuprofen",
        "description": "Ibuprofen can interfere with the antiplatelet effect of low-dose aspirin by competing for the COX-1 binding site, reducing aspirin's cardioprotective benefit.",
        "severity": "moderate",
        "management": "If both needed, take aspirin at least 30 minutes before ibuprofen. Consider alternative pain reliever."
    },
    {
        "drug1": "aspirin", "drug2": "clopidogrel",
        "description": "Dual antiplatelet therapy increases bleeding risk significantly, though this combination is sometimes intentionally prescribed after cardiac events.",
        "severity": "moderate",
        "management": "Only use together if specifically prescribed by cardiologist. Watch for signs of bleeding."
    },
    {
        "drug1": "apixaban", "drug2": "aspirin",
        "description": "Combining a direct oral anticoagulant with aspirin substantially increases bleeding risk without clear benefit in most patients.",
        "severity": "major",
        "management": "Reassess need for aspirin in patients on apixaban. Often aspirin can be safely stopped."
    },
    {
        "drug1": "alprazolam", "drug2": "oxycodone",
        "description": "Concurrent benzodiazepines and opioids cause additive CNS depression, respiratory depression, coma, and death.",
        "severity": "major",
        "management": "AVOID. FDA black box warning. If absolutely necessary, limit doses and duration."
    },
    {
        "drug1": "sertraline", "drug2": "amitriptyline",
        "description": "SSRIs inhibit CYP2D6, increasing tricyclic antidepressant levels. Combined serotonergic effect also increases serotonin syndrome risk.",
        "severity": "major",
        "management": "Avoid combination. If switching between these drugs, allow adequate washout period."
    },
    {
        "drug1": "amlodipine", "drug2": "simvastatin",
        "description": "Amlodipine increases simvastatin exposure via CYP3A4 inhibition, raising rhabdomyolysis risk.",
        "severity": "moderate",
        "management": "Limit simvastatin to 20mg/day when used with amlodipine."
    },
    {
        "drug1": "metoprolol", "drug2": "verapamil",
        "description": "Both drugs depress cardiac conduction and contractility. Combined use can cause severe bradycardia, heart block, or heart failure.",
        "severity": "major",
        "management": "Avoid combination, especially IV verapamil with any beta-blocker. Monitor heart rate and blood pressure closely."
    },
    {
        "drug1": "metoprolol", "drug2": "diltiazem",
        "description": "Additive negative chronotropic and inotropic effects. Risk of severe bradycardia and hypotension.",
        "severity": "major",
        "management": "Use with extreme caution. Monitor heart rate and blood pressure. Avoid in patients with conduction abnormalities."
    },
    {
        "drug1": "levothyroxine", "drug2": "omeprazole",
        "description": "Proton pump inhibitors reduce stomach acid needed for levothyroxine absorption, potentially causing hypothyroidism.",
        "severity": "moderate",
        "management": "Monitor TSH when starting or stopping a PPI. May need levothyroxine dose increase."
    },
    {
        "drug1": "glipizide", "drug2": "ciprofloxacin",
        "description": "Fluoroquinolones can cause severe hypoglycemia when combined with sulfonylureas, especially in elderly patients.",
        "severity": "major",
        "management": "Monitor blood glucose closely during antibiotic course. Consider dose reduction of glipizide."
    },
    {
        "drug1": "morphine", "drug2": "diazepam",
        "description": "Concurrent opioids and benzodiazepines cause profound CNS and respiratory depression. Leading cause of overdose death.",
        "severity": "major",
        "management": "AVOID. FDA black box warning. If no alternative, use lowest doses and monitor respiratory status."
    },
    {
        "drug1": "morphine", "drug2": "gabapentin",
        "description": "Gabapentinoids potentiate opioid-induced respiratory depression. FDA warning issued in 2019.",
        "severity": "major",
        "management": "Avoid if possible. If combined, reduce opioid dose and monitor closely."
    },
]

# ---------------------------------------------------------------------------
# Beers Criteria 2023 — potentially inappropriate medications for elderly
# Source: AGS 2023 Beers Criteria (J Am Geriatr Soc. 2023;71(7):2052-2081)
# ---------------------------------------------------------------------------
BEERS_CRITERIA = [
    {
        "drug_class": "Benzodiazepines",
        "drugs": ["alprazolam", "diazepam", "lorazepam", "clonazepam", "temazepam"],
        "recommendation": "Avoid",
        "rationale": "Increased sensitivity in older adults. Risk of cognitive impairment, delirium, falls, fractures, and motor vehicle crashes. Minimal improvement in sleep latency and duration.",
        "severity": "high",
        "alternatives": "For insomnia: sleep hygiene, CBT-I. For anxiety: SSRIs, SNRIs, buspirone."
    },
    {
        "drug_class": "Non-benzodiazepine hypnotics (Z-drugs)",
        "drugs": ["zolpidem", "zaleplon", "eszopiclone"],
        "recommendation": "Avoid",
        "rationale": "Similar adverse effects as benzodiazepines in older adults (delirium, falls, fractures). Minimal improvement in sleep.",
        "severity": "high",
        "alternatives": "Sleep hygiene, CBT-I, melatonin, trazodone (low dose)."
    },
    {
        "drug_class": "First-generation antihistamines",
        "drugs": ["diphenhydramine", "hydroxyzine", "chlorpheniramine", "promethazine"],
        "recommendation": "Avoid",
        "rationale": "Highly anticholinergic. Clearance reduced with age. Risk of confusion, dry mouth, constipation, urinary retention, blurred vision.",
        "severity": "high",
        "alternatives": "Second-generation antihistamines (cetirizine, loratadine) for allergies."
    },
    {
        "drug_class": "Tricyclic antidepressants",
        "drugs": ["amitriptyline", "nortriptyline", "imipramine", "doxepin"],
        "recommendation": "Avoid (especially amitriptyline and doxepin >6mg)",
        "rationale": "Highly anticholinergic, sedating, and cause orthostatic hypotension. Risk of falls, cardiac conduction abnormalities.",
        "severity": "high",
        "alternatives": "SSRIs (sertraline, escitalopram), SNRIs (duloxetine, venlafaxine)."
    },
    {
        "drug_class": "Long-acting sulfonylureas",
        "drugs": ["glyburide", "glimepiride"],
        "recommendation": "Avoid glyburide. Use glimepiride with caution.",
        "rationale": "Higher risk of prolonged hypoglycemia in older adults. Glyburide has the longest duration of action.",
        "severity": "high",
        "alternatives": "Glipizide (shorter acting), metformin, DPP-4 inhibitors."
    },
    {
        "drug_class": "Proton pump inhibitors (long-term use)",
        "drugs": ["omeprazole", "pantoprazole", "esomeprazole", "lansoprazole"],
        "recommendation": "Avoid use beyond 8 weeks without clear indication",
        "rationale": "Long-term use associated with C. difficile infection, bone loss and fractures, vitamin B12 deficiency, hypomagnesemia.",
        "severity": "moderate",
        "alternatives": "H2 blockers (famotidine) for maintenance, lifestyle modifications."
    },
    {
        "drug_class": "NSAIDs (oral, non-selective)",
        "drugs": ["ibuprofen", "naproxen", "diclofenac", "indomethacin", "meloxicam"],
        "recommendation": "Avoid chronic use",
        "rationale": "Increased risk of GI bleeding, peptic ulcer disease, acute kidney injury, fluid retention, and heart failure exacerbation. Risk increases with age.",
        "severity": "high",
        "alternatives": "Acetaminophen, topical NSAIDs, duloxetine for chronic pain, physical therapy."
    },
    {
        "drug_class": "Skeletal muscle relaxants",
        "drugs": ["cyclobenzaprine", "methocarbamol", "carisoprodol", "metaxalone"],
        "recommendation": "Avoid",
        "rationale": "Anticholinergic effects, sedation, increased risk of fractures. Poorly tolerated by older adults. Questionable effectiveness at tolerable doses.",
        "severity": "moderate",
        "alternatives": "Physical therapy, stretching, topical analgesics."
    },
    {
        "drug_class": "Antipsychotics (first and second generation)",
        "drugs": ["haloperidol", "quetiapine", "olanzapine", "risperidone"],
        "recommendation": "Avoid for behavioral symptoms of dementia unless non-pharmacological options failed and patient is a threat",
        "rationale": "Increased risk of stroke and mortality in persons with dementia. FDA black box warning.",
        "severity": "high",
        "alternatives": "Non-pharmacological behavioral interventions first."
    },
    {
        "drug_class": "Aspirin for primary prevention",
        "drugs": ["aspirin"],
        "recommendation": "Avoid initiating for primary prevention of cardiovascular disease",
        "rationale": "Risk of major bleeding increases with age and outweighs cardiovascular benefit in primary prevention. USPSTF 2022 recommendation.",
        "severity": "moderate",
        "alternatives": "Statin therapy, blood pressure control, lifestyle modifications for CV risk reduction."
    },
]


def create_db():
    """Create the SQLite database with all tables."""
    db = sqlite3.connect(DB_FILE)

    db.executescript("""
        DROP TABLE IF EXISTS drug_aliases;
        DROP TABLE IF EXISTS interactions;
        DROP TABLE IF EXISTS beers_criteria;
        DROP TABLE IF EXISTS drug_profiles;
        DROP TABLE IF EXISTS drugs;

        CREATE TABLE drugs (
            name TEXT PRIMARY KEY,
            rxcui TEXT,
            brand_names TEXT DEFAULT '',
            drugbank_id TEXT
        );

        CREATE TABLE interactions (
            drug1 TEXT NOT NULL,
            drug2 TEXT NOT NULL,
            description TEXT,
            severity TEXT,
            management TEXT,
            source TEXT DEFAULT 'curated',
            UNIQUE(drug1, drug2)
        );

        CREATE TABLE beers_criteria (
            drug_name TEXT NOT NULL,
            drug_class TEXT,
            recommendation TEXT,
            rationale TEXT,
            severity TEXT,
            alternatives TEXT,
            UNIQUE(drug_name, drug_class)
        );

        CREATE TABLE drug_profiles (
            name TEXT PRIMARY KEY,
            indication TEXT,
            description_short TEXT,
            drug_class TEXT,
            side_effects TEXT,
            side_effects_summary TEXT,
            route TEXT,
            FOREIGN KEY (name) REFERENCES drugs(name)
        );

        CREATE TABLE drug_aliases (
            alias TEXT PRIMARY KEY,
            canonical TEXT NOT NULL
        );
    """)
    return db


def load_rxcui(db):
    """1. Use RxNorm API to get RxCUI for each drug."""

    print("\n=== 1. Loading RxCUI ===")
    for drug in COMMON_ELDERLY_DRUGS:
        try:
            resp = requests.get(
                f"https://rxnav.nlm.nih.gov/REST/rxcui.json?name={drug}",
                timeout=10,
            ).json()
            rxcui_list = resp.get("idGroup", {}).get("rxnormId", [])
            rxcui = rxcui_list[0] if rxcui_list else None
            db.execute(
                "INSERT OR REPLACE INTO drugs (name, rxcui) VALUES (?, ?)",
                (drug.lower(), rxcui),
            )
            status = f"RxCUI {rxcui}" if rxcui else "NOT FOUND"
            print(f"  {drug} → {status}")
        except Exception as e:
            print(f"  {drug} → ERROR: {e}")
            db.execute(
                "INSERT OR IGNORE INTO drugs (name) VALUES (?)", (drug.lower(),)
            )
        time.sleep(0.1)  # respect rate limit

    db.commit()
    count = db.execute("SELECT COUNT(*) FROM drugs").fetchone()[0]
    print(f"{count} drugs loaded\n")


def load_curated_interactions(db):
    """2. Load the critical interactions"""
    print("=== 2. Loading critical interactions ===")
    for ix in CRITICAL_INTERACTIONS:
        db.execute(
            """INSERT OR REPLACE INTO interactions
               (drug1, drug2, description, severity, management, source)
               VALUES (?, ?, ?, ?, ?, 'beers_and_clinical')""",
            (
                ix["drug1"].lower(),
                ix["drug2"].lower(),
                ix["description"],
                ix["severity"],
                ix.get("management", ""),
            ),
        )
        db.execute(
            """INSERT OR IGNORE INTO interactions
               (drug1, drug2, description, severity, management, source)
               VALUES (?, ?, ?, ?, ?, 'beers_and_clinical')""",
            (
                ix["drug2"].lower(),
                ix["drug1"].lower(),
                ix["description"],
                ix["severity"],
                ix.get("management", ""),
            ),
        )
    db.commit()
    count = db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
    print(f"{count} interaction records loaded (including reverse pairs)\n")


def load_beers_criteria(db):
    """3. Load Beers Criteria flags"""
    print("=== 3. Loading Beers Criteria ===")
    for entry in BEERS_CRITERIA:
        for drug in entry["drugs"]:
            db.execute(
                """INSERT OR REPLACE INTO beers_criteria
                   (drug_name, drug_class, recommendation, rationale, severity, alternatives)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    drug.lower(),
                    entry["drug_class"],
                    entry["recommendation"],
                    entry["rationale"],
                    entry["severity"],
                    entry.get("alternatives", ""),
                ),
            )
    db.commit()
    count = db.execute("SELECT COUNT(*) FROM beers_criteria").fetchone()[0]
    print(f"{count} Beers Criteria entries loaded\n")


def _truncate_text(text, max_chars):
    """Cut to a sentence boundary near max_chars; otherwise hard-truncate"""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    last_period = cut.rfind(". ")
    if last_period > max_chars * 0.6:
        return cut[: last_period + 1]
    return cut.rstrip() + "..."


def _extract_profile(elem, ns):
    """Pull patient relevant fields from a drug XML element"""

    def text_of(tag):
        el = elem.find(f"{ns}{tag}")
        return el.text.strip() if (el is not None and el.text) else ""

    indication = _truncate_text(text_of("indication"), 400)
    description_short = _truncate_text(text_of("description"), 400)
    side_effects = _truncate_text(text_of("toxicity"), 500)

    cats_el = elem.find(f"{ns}categories")
    cat_names = []
    if cats_el is not None:
        for cat in cats_el.findall(f"{ns}category"):
            inner = cat.find(f"{ns}category")
            if inner is not None and inner.text:
                cat_names.append(inner.text.strip())
            if len(cat_names) >= 2:
                break
    drug_class = ", ".join(cat_names)

    products_el = elem.find(f"{ns}products")
    brand_names = []
    seen_brands = set()
    routes = set()
    if products_el is not None:
        for prod in products_el.findall(f"{ns}product"):
            name_el = prod.find(f"{ns}name")
            if name_el is not None and name_el.text:
                bn = name_el.text.strip()
                key = bn.lower()
                if bn and key not in seen_brands and len(brand_names) < 5:
                    seen_brands.add(key)
                    brand_names.append(bn)
            r_el = prod.find(f"{ns}route")
            if r_el is not None and r_el.text:
                routes.add(r_el.text.strip().lower())

    return {
        "indication": indication,
        "description_short": description_short,
        "drug_class": drug_class,
        "side_effects": side_effects,
        "route": ", ".join(sorted(routes)[:3]),
        "brand_names": json.dumps(brand_names),
    }


def load_drugbank_data(db, xml_path=None):
    """Parse DrugBank XML in one pass, drug-drug interactions and patient relevant profiles

    Curated interaction rows are preserved
    Profiles populate the drug_profiles table and the drugs.brand_names column
    """
    path = xml_path or DRUGBANK_XML
    if not os.path.isfile(path):
        print(
            f"=== 4. DrugBank XML skipped (not found: {path})\n"
        )
        return

    ns = DRUGBANK_NS
    try:
        db.execute("ALTER TABLE drugs ADD COLUMN drugbank_id TEXT")
    except sqlite3.OperationalError:
        pass

    before = db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
    print(f"=== 4. Loading DrugBank data from {path}")
    print(f"    Interactions before import: {before}\n")

    drug_count = 0
    interaction_count = 0
    profile_count = 0
    alias_count = 0
    skipped = 0

    context = ET.iterparse(path, events=("end",))
    for _event, elem in context:
        if elem.tag != f"{ns}drug":
            continue

        if elem.attrib.get("type") not in ("small molecule", "biotech"):
            elem.clear()
            continue

        dbid = None
        name = None

        for child_id in elem.findall(f"{ns}drugbank-id"):
            if child_id.attrib.get("primary") == "true":
                dbid = child_id.text
                break

        name_el = elem.find(f"{ns}name")
        if name_el is not None:
            name = name_el.text

        if not dbid or not name:
            elem.clear()
            continue

        name_lower = name.lower()
        existing = db.execute(
            "SELECT name FROM drugs WHERE name = ?",
            (name_lower,),
        ).fetchone()

        profile = _extract_profile(elem, ns)

        if existing:
            db.execute(
                "UPDATE drugs SET drugbank_id = ?, brand_names = ? WHERE name = ?",
                (dbid, profile["brand_names"], name_lower),
            )
        else:
            db.execute(
                "INSERT OR IGNORE INTO drugs (name, drugbank_id, brand_names) "
                "VALUES (?, ?, ?)",
                (name_lower, dbid, profile["brand_names"]),
            )

        if any(
            profile[k]
            for k in ("indication", "description_short", "drug_class", "side_effects", "route")
        ):
            db.execute(
                """INSERT OR REPLACE INTO drug_profiles
                   (name, indication, description_short, drug_class, side_effects, route)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    name_lower,
                    profile["indication"],
                    profile["description_short"],
                    profile["drug_class"],
                    profile["side_effects"],
                    profile["route"],
                ),
            )
            profile_count += 1

        # Synonyms → aliases
        synonyms_el = elem.find(f"{ns}synonyms")
        if synonyms_el is not None:
            for syn in synonyms_el.findall(f"{ns}synonym"):
                if not syn.text:
                    continue
                alias = syn.text.strip().lower()
                # Skip self, empty, very short (abbreviations), or very long (IUPAC names)
                if alias and alias != name_lower and 4 <= len(alias) <= 100:
                    cur = db.execute(
                        "INSERT OR IGNORE INTO drug_aliases (alias, canonical) "
                        "VALUES (?, ?)",
                        (alias, name_lower),
                    )
                    alias_count += cur.rowcount

        # Brand names → aliases (unified lookup path alongside drugs.brand_names)
        brands_raw = profile.get("brand_names") or ""
        if brands_raw:
            try:
                for brand in json.loads(brands_raw):
                    if not brand:
                        continue
                    alias = brand.strip().lower()
                    if alias and alias != name_lower and len(alias) >= 3:
                        cur = db.execute(
                            "INSERT OR IGNORE INTO drug_aliases (alias, canonical) "
                            "VALUES (?, ?)",
                            (alias, name_lower),
                        )
                        alias_count += cur.rowcount
            except (json.JSONDecodeError, TypeError):
                pass

        ddi_el = elem.find(f"{ns}drug-interactions")
        if ddi_el is not None:
            for ddi in ddi_el.findall(f"{ns}drug-interaction"):
                other_name_el = ddi.find(f"{ns}name")
                desc_el = ddi.find(f"{ns}description")

                if other_name_el is None:
                    continue

                other_name = (
                    other_name_el.text.lower() if other_name_el.text else ""
                )
                desc = (
                    desc_el.text
                    if desc_el is not None and desc_el.text
                    else ""
                )

                existing_ix = db.execute(
                    "SELECT source FROM interactions "
                    "WHERE drug1 = ? AND drug2 = ?",
                    (name_lower, other_name),
                ).fetchone()

                if existing_ix and existing_ix[0] == "beers_and_clinical":
                    skipped += 1
                    continue

                desc_check = desc.lower()
                severity = "moderate"
                if any(
                    w in desc_check
                    for w in (
                        "contraindicated",
                        "serious",
                        "fatal",
                        "black box",
                        "avoid",
                        "life-threatening",
                        "significantly increase",
                        "major",
                    )
                ):
                    severity = "major"
                elif any(
                    w in desc_check for w in ("minor", "slight", "minimal")
                ):
                    severity = "minor"

                try:
                    cur = db.execute(
                        "INSERT OR IGNORE INTO interactions "
                        "(drug1, drug2, description, severity, "
                        "management, source) "
                        "VALUES (?, ?, ?, ?, ?, 'drugbank')",
                        (name_lower, other_name, desc, severity, ""),
                    )
                    if cur.rowcount:
                        interaction_count += 1
                except sqlite3.IntegrityError:
                    pass

        drug_count += 1
        if drug_count % 1000 == 0:
            db.commit()
            print(
                f"    Processed {drug_count} drugs, "
                f"{interaction_count} new interactions, "
                f"{profile_count} profiles, "
                f"{alias_count} aliases..."
            )

        elem.clear()

    db.commit()
    after = db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
    drugbank_rows = db.execute(
        "SELECT COUNT(*) FROM interactions WHERE source = 'drugbank'"
    ).fetchone()[0]
    profile_total = db.execute("SELECT COUNT(*) FROM drug_profiles").fetchone()[0]
    alias_total = db.execute("SELECT COUNT(*) FROM drug_aliases").fetchone()[0]
    print(
        f"\n    Drugs processed: {drug_count}\n"
        f"    New DrugBank interaction rows attempted: {interaction_count}\n"
        f"    Curated pairs skipped: {skipped}\n"
        f"    Total interactions now: {after} "
        f"({drugbank_rows} from DrugBank)\n"
        f"    Drug profiles loaded: {profile_total}\n"
        f"    Drug aliases loaded: {alias_total}\n"
    )


def print_summary(db):
    drugs = db.execute("SELECT COUNT(*) FROM drugs").fetchone()[0]
    interactions = db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
    major = db.execute(
        "SELECT COUNT(*) FROM interactions WHERE severity='major'"
    ).fetchone()[0]
    beers = db.execute("SELECT COUNT(*) FROM beers_criteria").fetchone()[0]
    drugbank_ix = db.execute(
        "SELECT COUNT(*) FROM interactions WHERE source = 'drugbank'"
    ).fetchone()[0]
    profiles = db.execute("SELECT COUNT(*) FROM drug_profiles").fetchone()[0]
    aliases = db.execute("SELECT COUNT(*) FROM drug_aliases").fetchone()[0]

    print("=" * 25)
    print("  Medora Database Summary")
    print("=" * 25)
    print(f"  Drugs:              {drugs}")
    print(f"  Drug profiles:      {profiles}")
    print(f"  Drug aliases:       {aliases}")
    print(f"  Interactions:       {interactions} ({major} major)")
    print(f"    DrugBank-sourced: {drugbank_ix}")
    print(f"  Beers Criteria:     {beers} entries")
    print(f"  Database file:      {DB_FILE}")
    print("=" * 25)
    print()

    print("Samples:")
    for row in db.execute(
        "SELECT drug1, drug2, severity FROM interactions WHERE severity='major' LIMIT 5"
    ).fetchall():
        print(f" {row[0]} + {row[1]} → {row[2]}")
    print()


def main():
    print("Building...\n")
    db = create_db()
    load_rxcui(db)
    load_curated_interactions(db)
    load_beers_criteria(db)
    load_drugbank_data(db)
    print_summary(db)
    db.close()
    print("Done!")


if __name__ == "__main__":
    main()