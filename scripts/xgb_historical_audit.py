#!/usr/bin/env python3
"""Audit trained Dirt IQ XGBoost artifacts against completed historical races.

Default behavior is intentionally out-of-sample for the current artifacts:
score completed races from 2025 forward, because train_model.py trains on
2021-2024 and stores that window in feature_params_*.json.
"""

import argparse
import importlib.util
import json
import sqlite3
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
PREDICT_PATH = ROOT / "scripts" / "predict_model.py"


def load_predict_module():
    spec = importlib.util.spec_from_file_location("dirtiq_predict_model", PREDICT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def con():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def pct(num, den):
    return f"{(num / den * 100):.1f}%" if den else "0.0%"


def load_artifact_meta(model_slug):
    path = ROOT / "data" / f"feature_params_{model_slug}.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def completed_races(db, series_key, min_year, max_year):
    series_where = ""
    params = {"min_year": str(min_year)}
    if max_year:
        params["max_year"] = str(max_year)
        year_where = "AND substr(r.race_date, 1, 4) BETWEEN :min_year AND :max_year"
    else:
        year_where = "AND substr(r.race_date, 1, 4) >= :min_year"

    if series_key == "lucas":
        series_where = "AND (r.division = 'Lucas Oil LMDS' OR r.series_mode = 'Lucas Oil LMDS')"
    elif series_key == "woo":
        series_where = "AND (r.division = 'WoO Late Models' OR r.series_mode = 'WoO Late Models')"
    elif series_key == "crown":
        series_where = """
          AND (
            r.division = 'Crown Jewel / Combined'
            OR (
              r.division IN ('WoO Late Models', 'Lucas Oil LMDS')
              AND (
                lower(r.name) LIKE '%show-me%' OR lower(r.name) LIKE '%show me%' OR
                lower(r.name) LIKE '%prairie dirt%' OR lower(r.name) LIKE '%usa nationals%' OR
                lower(r.name) LIKE '%world finals%' OR lower(r.name) LIKE '%knoxville%' OR
                lower(r.name) LIKE '%north/south%' OR lower(r.name) LIKE '%north south%' OR
                lower(r.name) LIKE '%topless%' OR lower(r.name) LIKE '%dream%' OR
                lower(r.name) LIKE '%world 100%' OR lower(r.name) LIKE '%firecracker%' OR
                lower(r.name) LIKE '%pdc%' OR lower(r.name) LIKE '%gopher 50%' OR
                lower(r.name) LIKE '%hawkeye 100%' OR lower(r.name) LIKE '%ralph latham%' OR
                lower(r.name) LIKE '%dirt million%' OR lower(r.name) LIKE '%gateway%' OR
                lower(r.name) LIKE '%jackson 100%' OR lower(r.name) LIKE '%hillbilly%' OR
                lower(r.name) LIKE '%national 100%' OR lower(r.name) LIKE '%silver dollar%' OR
                lower(r.name) LIKE '%florence%' OR lower(r.name) LIKE '%eldora%'
              )
            )
          )
        """

    return db.execute(
        f"""SELECT r.id, r.name, r.race_date, r.division, r.series_mode, t.name AS track_name,
                   COUNT(re.id) AS entries
            FROM races r
            JOIN tracks t ON t.id = r.track_id
            JOIN race_entries re ON re.race_id = r.id
            WHERE r.status = 'complete'
              AND re.finishing_position IS NOT NULL
              {year_where}
              {series_where}
            GROUP BY r.id
            HAVING SUM(CASE WHEN re.finishing_position = 1 AND re.dnf = 0 THEN 1 ELSE 0 END) = 1
               AND COUNT(re.id) >= 2
            ORDER BY r.race_date ASC, r.id ASC""",
        params,
    ).fetchall()


def actual_rows(db, race_id):
    return db.execute(
        """SELECT re.driver_id, d.name AS driver_name, re.finishing_position
           FROM race_entries re
           JOIN drivers d ON d.id = re.driver_id
           WHERE re.race_id = ?
             AND re.finishing_position IS NOT NULL
             AND re.dnf = 0
           ORDER BY re.finishing_position ASC""",
        (race_id,),
    ).fetchall()


def audit(series_key, min_year, max_year, limit):
    predict = load_predict_module()
    db = con()
    races = completed_races(db, series_key, min_year, max_year)
    if limit:
        races = races[-limit:]

    rows = []
    by_model = defaultdict(lambda: {"races": 0, "top1": 0, "top3": 0, "rank_sum": 0.0, "top3_overlap": 0})

    for race in races:
        payload = predict.score_race(race["id"])
        preds = payload.get("predictions", [])
        if len(preds) < 2:
            continue

        ranked = sorted(preds, key=lambda item: item.get("probability", 0), reverse=True)
        actual = actual_rows(db, race["id"])
        winner = actual[0]
        winner_index = next(
            (index for index, item in enumerate(ranked) if item["driverId"] == winner["driver_id"]),
            None,
        )
        if winner_index is None:
            continue

        pred_top3 = {item["driverId"] for item in ranked[:3]}
        actual_top3 = {row["driver_id"] for row in actual[:3]}
        top3_overlap = len(pred_top3 & actual_top3)
        model_series = payload.get("modelSeries") or "Unknown"
        model_slug = payload.get("modelSlug") or "unknown"

        row = {
            "race_id": race["id"],
            "date": race["race_date"],
            "race": race["name"],
            "track": race["track_name"],
            "model": model_series,
            "model_slug": model_slug,
            "field": len(ranked),
            "favorite": ranked[0]["driverName"],
            "favorite_prob": ranked[0].get("probability", 0),
            "winner": winner["driver_name"],
            "winner_rank": winner_index + 1,
            "winner_prob": ranked[winner_index].get("probability", 0),
            "top3_overlap": top3_overlap,
        }
        rows.append(row)

        summary = by_model[model_series]
        summary["races"] += 1
        summary["top1"] += 1 if row["winner_rank"] == 1 else 0
        summary["top3"] += 1 if row["winner_rank"] <= 3 else 0
        summary["rank_sum"] += row["winner_rank"]
        summary["top3_overlap"] += top3_overlap

    db.close()
    return rows, by_model


def main():
    parser = argparse.ArgumentParser(description="Audit XGBoost historical prediction performance.")
    parser.add_argument("--series", choices=["all", "lucas", "woo", "crown"], default="all")
    parser.add_argument("--min-year", type=int, default=2025)
    parser.add_argument("--max-year", type=int)
    parser.add_argument("--limit", type=int, help="Keep only the most recent N races after filtering.")
    parser.add_argument("--show", type=int, default=20, help="Race rows to print.")
    args = parser.parse_args()

    rows, by_model = audit(args.series, args.min_year, args.max_year, args.limit)
    if not rows:
        print("No completed races with scoreable XGBoost predictions found.")
        return

    print("=== XGBoost Historical Audit ===")
    print(f"Window: {args.min_year}{f'-{args.max_year}' if args.max_year else '+'}")
    print(f"Races scored: {len(rows)}")
    print()

    for model_series, summary in by_model.items():
        races = summary["races"]
        model_slug = next((row["model_slug"] for row in rows if row["model"] == model_series), "")
        meta = load_artifact_meta(model_slug)
        print(model_series)
        print(f"  artifact: {meta.get('model_algorithm', 'Unknown')} via {meta.get('model_engine', 'unknown engine')}")
        print(f"  trained_on: {meta.get('trained_on', 'unknown')}")
        print(f"  artifact test_auc/top1: {meta.get('test_auc', 'n/a')} / {meta.get('top1_acc', 'n/a')}")
        print(f"  race audit top1:       {summary['top1']}/{races} = {pct(summary['top1'], races)}")
        print(f"  race audit top3:       {summary['top3']}/{races} = {pct(summary['top3'], races)}")
        print(f"  avg winner rank:       {summary['rank_sum'] / races:.2f}")
        print(f"  avg top3 overlap:      {summary['top3_overlap'] / races:.2f}/3.0")
        print()

    print(f"Recent race details (last {min(args.show, len(rows))}):")
    print("date | race_id | model | winner rank | favorite | actual winner | track")
    print("-" * 120)
    for row in rows[-args.show:]:
        print(
            f"{row['date']} | {row['race_id']} | {row['model']} | "
            f"#{row['winner_rank']} | {row['favorite']} ({row['favorite_prob']:.1%}) | "
            f"{row['winner']} ({row['winner_prob']:.1%}) | {row['track']}"
        )


if __name__ == "__main__":
    main()
