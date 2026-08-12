#!/usr/bin/env python3
"""
Dirt IQ model maintenance runner.

Use this after adding/importing data:
  python3 scripts/maintain_models.py --audit-routing
  python3 scripts/maintain_models.py --train all
  python3 scripts/maintain_models.py --score-upcoming --limit 20
  python3 scripts/maintain_models.py --refresh --limit 20
"""

import argparse
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
PREDICT_PATH = ROOT / "scripts" / "predict_model.py"
TRAIN_PATH = ROOT / "scripts" / "train_model.py"

SERIES = {
    "lucas": "Lucas Oil LMDS",
    "woo": "WoO Late Models",
    "crown": "Crown Jewel / Combined",
    "summer": "DIRTcar Summer Nationals",
}


def load_predict_module():
    spec = importlib.util.spec_from_file_location("dirtiq_predict_model", PREDICT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def con():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def upcoming_races(limit=None, include_empty=False):
    db = con()
    sql = """
        SELECT r.id, r.name, r.race_date, r.division, r.series_mode,
               COUNT(re.id) AS entries
        FROM races r
        LEFT JOIN race_entries re ON re.race_id = r.id
        WHERE r.status = 'upcoming'
        GROUP BY r.id
        HAVING (? = 1 OR COUNT(re.id) > 0)
        ORDER BY r.race_date ASC, r.id ASC
    """
    rows = db.execute(sql, (1 if include_empty else 0,)).fetchall()
    db.close()
    return rows[:limit] if limit else rows


def cache_paths(race_id, model_slug):
    base = ROOT / "data" / "ml-predictions"
    return [
        base / f"race_{race_id}_{model_slug}.json",
        base / f"race_{race_id}.json",
    ]


def audit_routing(limit=None, include_empty=True):
    predict = load_predict_module()
    rows = upcoming_races(limit=limit, include_empty=include_empty)
    if not rows:
        print("No upcoming races found.")
        return

    print("race_id | date | entries | model | reason | cache | race")
    print("-" * 110)
    for race in rows:
        model_series, reason = predict.resolve_race_model_series(race)
        model_slug = predict.slug(model_series)
        cached = "yes" if any(path.exists() for path in cache_paths(race["id"], model_slug)) else "no"
        print(
            f"{race['id']} | {race['race_date']} | {race['entries']} | "
            f"{model_series} | {reason} | {cached} | {race['name']}"
        )


def train(series_key, engine, stage="early"):
    series_names = SERIES.values() if series_key == "all" else [SERIES[series_key]]
    for series in series_names:
        env = os.environ.copy()
        env["DIRTIQ_SERIES"] = series
        env["DIRTIQ_MODEL_STAGE"] = stage
        env["DIRTIQ_SKIP_IMPORTANCE"] = env.get("DIRTIQ_SKIP_IMPORTANCE", "1")
        env["PYTHONIOENCODING"] = "utf-8"
        if engine:
            env["DIRTIQ_MODEL_ENGINE"] = engine
        print(f"\n=== Training {series} ({stage}) ===")
        subprocess.run([sys.executable, str(TRAIN_PATH)], cwd=ROOT, env=env, check=True)


def score_race(race_id, model=None):
    args = [sys.executable, str(PREDICT_PATH), str(race_id), "--cache"]
    if model:
        args.extend(["--model", model])
    raw = subprocess.check_output(args, cwd=ROOT, text=True)
    payload = json.loads(raw)
    print(
        f"{payload['raceId']} | {payload.get('modelSeries')} | "
        f"{payload.get('modelReason')} | {len(payload.get('predictions', []))} scored"
    )
    return payload


def score_upcoming(limit=None, include_empty=False):
    rows = upcoming_races(limit=limit, include_empty=include_empty)
    if not rows:
        print("No upcoming races with entries found.")
        return
    for race in rows:
        score_race(race["id"])


def main():
    parser = argparse.ArgumentParser(description="Maintain Dirt IQ model artifacts and race caches.")
    parser.add_argument("--audit-routing", action="store_true", help="Show which model each upcoming race will use.")
    parser.add_argument("--train", choices=["all", "lucas", "woo", "crown", "summer"], help="Retrain model artifacts.")
    parser.add_argument("--engine", choices=["auto", "xgboost", "sklearn"], default=None, help="Training engine preference.")
    parser.add_argument("--stage", choices=["early", "race-night"], default="early", help="Train the entries-only or post-prelim artifact.")
    parser.add_argument("--score-upcoming", action="store_true", help="Cache predictions for upcoming races with entries.")
    parser.add_argument("--score-race", type=int, help="Cache predictions for one race.")
    parser.add_argument("--model", choices=["auto", "crown", "lucas", "woo", "summer"], default="auto", help="Manual scoring override for --score-race.")
    parser.add_argument("--refresh", action="store_true", help="Train all models, then score upcoming races.")
    parser.add_argument("--limit", type=int, default=None, help="Limit upcoming race count.")
    parser.add_argument("--include-empty", action="store_true", help="Include races with no entries in audits/scoring.")
    args = parser.parse_args()

    if args.refresh:
        train("all", args.engine, args.stage)
        score_upcoming(limit=args.limit, include_empty=args.include_empty)
        audit_routing(limit=args.limit, include_empty=True)
        return

    did_work = False
    if args.train:
        train(args.train, args.engine, args.stage)
        did_work = True
    if args.score_race is not None:
        score_race(args.score_race, None if args.model == "auto" else args.model)
        did_work = True
    if args.score_upcoming:
        score_upcoming(limit=args.limit, include_empty=args.include_empty)
        did_work = True
    if args.audit_routing:
        audit_routing(limit=args.limit, include_empty=True)
        did_work = True

    if not did_work:
        parser.print_help()


if __name__ == "__main__":
    main()
