#!/usr/bin/env python3
"""Train and audit a no-leak agent overlay against XGBoost predictions.

This is intentionally a *meta* model, not a replacement for XGBoost. It learns
when to trust or fade the current XGB probabilities using only fields available
before each completed race, then tests on a later holdout window.
"""

import argparse
import importlib.util
import sqlite3
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss, roc_auc_score


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


def completed_races(db, min_year=2025):
    return db.execute(
        """SELECT r.id, r.name, r.race_date, r.division, r.series_mode, t.name AS track_name
           FROM races r
           JOIN tracks t ON t.id = r.track_id
           JOIN race_entries re ON re.race_id = r.id
           WHERE r.status = 'complete'
             AND re.finishing_position IS NOT NULL
             AND substr(r.race_date, 1, 4) >= ?
           GROUP BY r.id
           HAVING SUM(CASE WHEN re.finishing_position = 1 AND re.dnf = 0 THEN 1 ELSE 0 END) = 1
              AND COUNT(re.id) >= 2
           ORDER BY r.race_date ASC, r.id ASC""",
        (str(min_year),),
    ).fetchall()


def entry_context(db, race_id):
    rows = db.execute(
        """SELECT driver_id, starting_position, heat_position, qualifying_time, entry_status
           FROM race_entries
           WHERE race_id = ?""",
        (race_id,),
    ).fetchall()
    field = max(len(rows), 1)
    heat_values = [row["heat_position"] for row in rows if row["heat_position"] is not None and row["heat_position"] > 0]
    start_values = [
        row["starting_position"]
        for row in rows
        if row["starting_position"] is not None and row["starting_position"] > 0
    ]
    qt_values = [
        row["qualifying_time"]
        for row in rows
        if row["qualifying_time"] is not None and row["qualifying_time"] > 0
    ]
    qt_sorted = sorted(qt_values)
    out = {}
    for row in rows:
        start = row["starting_position"]
        heat = row["heat_position"]
        qt = row["qualifying_time"]
        out[row["driver_id"]] = {
            "start_norm": (start - 1) / max(field - 1, 1) if start and start > 0 else np.nan,
            "heat_norm": (heat - 1) / max(len(heat_values) - 1, 1) if heat and heat > 0 else np.nan,
            "qt_norm": qt_sorted.index(qt) / max(len(qt_sorted) - 1, 1) if qt and qt > 0 and qt in qt_sorted else np.nan,
            "has_start": 1.0 if start and start > 0 else 0.0,
            "has_heat": 1.0 if heat and heat > 0 else 0.0,
            "has_qt": 1.0 if qt and qt > 0 else 0.0,
            "entry_unconfirmed": 1.0 if row["entry_status"] == "unconfirmed" else 0.0,
            "entry_scratched": 1.0 if row["entry_status"] == "scratched" else 0.0,
        }
    return out


def actual_winner_and_top3(db, race_id):
    rows = db.execute(
        """SELECT driver_id, finishing_position
           FROM race_entries
           WHERE race_id = ?
             AND finishing_position IS NOT NULL
             AND dnf = 0
           ORDER BY finishing_position ASC""",
        (race_id,),
    ).fetchall()
    if not rows:
        return None, set()
    return rows[0]["driver_id"], {row["driver_id"] for row in rows[:3]}


def build_dataset(min_year=2025):
    predict = load_predict_module()
    db = con()
    races = completed_races(db, min_year=min_year)
    rows = []
    race_rows = []

    for race in races:
        payload = predict.score_race(race["id"])
        preds = payload.get("predictions", [])
        if len(preds) < 2:
            continue

        ranked = sorted(preds, key=lambda item: item.get("probability", 0), reverse=True)
        winner_id, actual_top3 = actual_winner_and_top3(db, race["id"])
        if winner_id is None:
            continue

        field_size = len(ranked)
        favorite_prob = ranked[0].get("probability", 0.0)
        second_prob = ranked[1].get("probability", 0.0) if len(ranked) > 1 else 0.0
        context = entry_context(db, race["id"])
        model_series = payload.get("modelSeries") or ""
        series_lucas = 1.0 if "Lucas" in model_series else 0.0
        series_woo = 1.0 if "WoO" in model_series else 0.0
        series_crown = 1.0 if "Crown" in model_series else 0.0

        for index, pred in enumerate(ranked):
            driver_id = pred["driverId"]
            xgb_prob = float(pred.get("probability") or 0)
            driver_context = context.get(driver_id, {})
            rows.append(
                {
                    "race_id": race["id"],
                    "race_date": race["race_date"],
                    "race": race["name"],
                    "track": race["track_name"],
                    "driver_id": driver_id,
                    "driver": pred["driverName"],
                    "model_series": model_series,
                    "xgb_prob": xgb_prob,
                    "xgb_rank": index + 1,
                    "xgb_rank_norm": index / max(field_size - 1, 1),
                    "field_size": field_size,
                    "favorite_prob": favorite_prob,
                    "favorite_gap": favorite_prob - second_prob,
                    "prob_vs_favorite": xgb_prob / favorite_prob if favorite_prob > 0 else 0.0,
                    "series_lucas": series_lucas,
                    "series_woo": series_woo,
                    "series_crown": series_crown,
                    "start_norm": driver_context.get("start_norm", np.nan),
                    "heat_norm": driver_context.get("heat_norm", np.nan),
                    "qt_norm": driver_context.get("qt_norm", np.nan),
                    "has_start": driver_context.get("has_start", 0.0),
                    "has_heat": driver_context.get("has_heat", 0.0),
                    "has_qt": driver_context.get("has_qt", 0.0),
                    "entry_unconfirmed": driver_context.get("entry_unconfirmed", 0.0),
                    "entry_scratched": driver_context.get("entry_scratched", 0.0),
                    "win": 1 if driver_id == winner_id else 0,
                    "actual_top3": 1 if driver_id in actual_top3 else 0,
                }
            )

    db.close()
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame, []
    race_rows = frame[["race_id", "race_date", "race", "track", "model_series"]].drop_duplicates().to_dict("records")
    return frame, race_rows


FEATURES = [
    "xgb_prob",
    "xgb_rank_norm",
    "field_size",
    "favorite_prob",
    "favorite_gap",
    "prob_vs_favorite",
    "series_lucas",
    "series_woo",
    "series_crown",
    "start_norm",
    "heat_norm",
    "qt_norm",
    "has_start",
    "has_heat",
    "has_qt",
    "entry_unconfirmed",
    "entry_scratched",
]


def normalize_within_race(frame, score_column):
    out = frame.copy()
    totals = out.groupby("race_id")[score_column].transform("sum")
    out[f"{score_column}_norm"] = np.where(totals > 0, out[score_column] / totals, 0)
    return out


def score_summary(frame, score_column):
    summary = defaultdict(lambda: {"races": 0, "top1": 0, "top3": 0, "rank_sum": 0.0, "top3_overlap": 0})
    rows = []
    for race_id, group in frame.groupby("race_id", sort=False):
        ranked = group.sort_values(score_column, ascending=False).reset_index(drop=True)
        winner = ranked[ranked["win"] == 1]
        if winner.empty:
            continue
        winner_index = int(winner.index[0])
        actual_top3_ids = set(group[group["actual_top3"] == 1]["driver_id"])
        pred_top3_ids = set(ranked.head(3)["driver_id"])
        model_series = ranked.loc[0, "model_series"]
        stat = summary[model_series]
        stat["races"] += 1
        stat["top1"] += 1 if winner_index == 0 else 0
        stat["top3"] += 1 if winner_index <= 2 else 0
        stat["rank_sum"] += winner_index + 1
        stat["top3_overlap"] += len(actual_top3_ids & pred_top3_ids)
        rows.append(
            {
                "race_id": race_id,
                "date": ranked.loc[0, "race_date"],
                "race": ranked.loc[0, "race"],
                "track": ranked.loc[0, "track"],
                "model_series": model_series,
                "favorite": ranked.loc[0, "driver"],
                "winner": winner.iloc[0]["driver"],
                "winner_rank": winner_index + 1,
                "favorite_score": float(ranked.loc[0, score_column]),
                "winner_score": float(winner.iloc[0][score_column]),
            }
        )
    return summary, rows


def print_summary(label, summary):
    print(label)
    for series, stat in summary.items():
        races = stat["races"]
        print(
            f"  {series:<24} top1 {stat['top1']}/{races} = {pct(stat['top1'], races)} · "
            f"top3 {stat['top3']}/{races} = {pct(stat['top3'], races)} · "
            f"avg winner rank {stat['rank_sum'] / races:.2f} · "
            f"top3 overlap {stat['top3_overlap'] / races:.2f}/3"
        )
    print()


def main():
    parser = argparse.ArgumentParser(description="Train/test an agent overlay against XGBoost.")
    parser.add_argument("--min-year", type=int, default=2025)
    parser.add_argument("--train-year", type=int, default=2025, help="Train overlay on this year.")
    parser.add_argument("--test-year", type=int, default=2026, help="Holdout overlay test year.")
    parser.add_argument("--show", type=int, default=12)
    args = parser.parse_args()

    df, _ = build_dataset(args.min_year)
    if df.empty:
        print("No scoreable completed races found.")
        return

    train = df[df["race_date"].str.startswith(str(args.train_year))].copy()
    test = df[df["race_date"].str.startswith(str(args.test_year))].copy()
    if train.empty or test.empty:
        print(f"Need both train year {args.train_year} and test year {args.test_year} completed races.")
        return

    model = HistGradientBoostingClassifier(
        max_iter=250,
        learning_rate=0.04,
        max_leaf_nodes=15,
        l2_regularization=1.0,
        early_stopping=True,
        random_state=42,
    )
    model.fit(train[FEATURES].astype(float), train["win"])

    train["agent_raw"] = model.predict_proba(train[FEATURES].astype(float))[:, 1]
    test["agent_raw"] = model.predict_proba(test[FEATURES].astype(float))[:, 1]
    train = normalize_within_race(train, "agent_raw")
    test = normalize_within_race(test, "agent_raw")

    print("=== Agent Overlay Audit ===")
    print(f"Overlay trained on {args.train_year}, tested on {args.test_year}.")
    print("This is the honest holdout check before the agent can influence live lines.")
    print()

    try:
        print(f"Holdout AUC:     XGB {roc_auc_score(test['win'], test['xgb_prob']):.4f} · Agent {roc_auc_score(test['win'], test['agent_raw_norm']):.4f}")
        print(f"Holdout logloss: XGB {log_loss(test['win'], test['xgb_prob'].clip(1e-6, 1 - 1e-6)):.4f} · Agent {log_loss(test['win'], test['agent_raw_norm'].clip(1e-6, 1 - 1e-6)):.4f}")
        print()
    except ValueError:
        pass

    xgb_summary, xgb_rows = score_summary(test, "xgb_prob")
    agent_summary, agent_rows = score_summary(test, "agent_raw_norm")
    print_summary("XGBoost holdout race ranking", xgb_summary)
    print_summary("Agent overlay holdout race ranking", agent_summary)

    agent_by_race = {row["race_id"]: row for row in agent_rows}
    improved = []
    worsened = []
    for row in xgb_rows:
        agent = agent_by_race.get(row["race_id"])
        if not agent:
            continue
        delta = row["winner_rank"] - agent["winner_rank"]
        item = {**row, "agent_rank": agent["winner_rank"], "rank_delta": delta}
        if delta > 0:
            improved.append(item)
        elif delta < 0:
            worsened.append(item)

    print(f"Recent holdout races (last {min(args.show, len(xgb_rows))}):")
    print("date | race_id | xgb→agent winner rank | xgb favorite | winner | track")
    print("-" * 118)
    for row in xgb_rows[-args.show:]:
        agent = agent_by_race.get(row["race_id"])
        agent_rank = agent["winner_rank"] if agent else None
        print(
            f"{row['date']} | {row['race_id']} | #{row['winner_rank']}→#{agent_rank} | "
            f"{row['favorite']} | {row['winner']} | {row['track']}"
        )

    print()
    print(f"Improved winner rank on {len(improved)} races; worsened on {len(worsened)} races.")
    if improved:
        print("Best improvements:")
        for row in sorted(improved, key=lambda item: item["rank_delta"], reverse=True)[:5]:
            print(f"  {row['date']} {row['race_id']} {row['winner']}: XGB #{row['winner_rank']} → Agent #{row['agent_rank']}")
    if worsened:
        print("Worst regressions:")
        for row in sorted(worsened, key=lambda item: item["rank_delta"])[:5]:
            print(f"  {row['date']} {row['race_id']} {row['winner']}: XGB #{row['winner_rank']} → Agent #{row['agent_rank']}")


if __name__ == "__main__":
    main()
