"""Overwrite drug_profiles.side_effects_summary with the curated patient-facing side-effect text used in v2 training data. 
Production's chat reference block will then match what the fine-tuned model was trained on.
"""

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_v2 import PROFILES

DB_PATH = Path(__file__).resolve().parent.parent / "medora.db"

DB_NAME = {
    "aspirin": "acetylsalicylic acid",
    "levodopa/carbidopa": ["levodopa", "carbidopa"],
    "calcium supplement": None,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    updated, missing = 0, []
    for name, (_dose, side_effects) in PROFILES.items():
        targets = DB_NAME.get(name, name)
        if targets is None:
            continue
        if isinstance(targets, str):
            targets = [targets]
        for target in targets:
            row = cur.execute(
                "SELECT side_effects_summary FROM drug_profiles WHERE name = ?",
                (target,),
            ).fetchone()
            if row is None:
                missing.append(target)
                continue
            if row[0] == side_effects:
                continue
            if args.dry_run:
                print(f"[dry-run] would update {target} (from {name})")
                print(f"  old: {(row[0] or '')[:120]}...")
                print(f"  new: {side_effects[:120]}...")
            else:
                cur.execute(
                    "UPDATE drug_profiles SET side_effects_summary = ? "
                    "WHERE name = ?",
                    (side_effects, target),
                )
            updated += 1

    if not args.dry_run:
        con.commit()
    con.close()

    print(f"\n{'Would update' if args.dry_run else 'Updated'} {updated} rows.")
    if missing:
        print(f"WARNING: no drug_profiles row for: {missing}")
        print("These drugs were in PROFILES but not in the DB. They will fall")
        print("through to the model's general training knowledge at runtime.")


if __name__ == "__main__":
    main()
