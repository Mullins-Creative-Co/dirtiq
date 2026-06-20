#!/usr/bin/env python3
"""Build a crown-jewel replay table for Race Lab.

The replay intentionally compares two views:
  - XGBoost: the trained crown model rank for the actual winner.
  - Agent: a transparent underwriting score from prior crown/recent/deep-start signals.

It also records start, heat, QT, and data gaps so the admin page shows when a
race is missing the inputs needed for stronger race-night modeling.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"
OUT = ROOT / "data" / "crown-replay.json"
PREDICT_PATH = ROOT / "scripts" / "predict_model.py"

CROWN_SERIES = "Crown Jewel / Combined"
CROWN_PATTERNS = [
    "show-me",
    "show me",
    "prairie dirt",
    "usa nationals",
    "world finals",
    "knoxville",
    "north/south",
    "north south",
    "topless",
    "dream",
    "world 100",
    "firecracker",
    "pdc",
    "gopher 50",
    "hawkeye 100",
    "ralph latham",
    "dirt million",
    "gateway",
    "jackson 100",
    "hillbilly",
    "national 100",
    "silver dollar",
    "florence",
    "eldora",
]


def load_predict_module():
    spec = importlib.util.spec_from_file_location("dirtiq_predict_model", PREDICT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def is_crown_name(name: str, track_name: str = "") -> bool:
    text = f"{name or ''} {track_name or ''}".lower()
    return any(pattern in text for pattern in CROWN_PATTERNS)


def crown_sql_clause() -> str:
    name_parts = " OR ".join([f"lower(r.name) LIKE '%{pattern}%'" for pattern in CROWN_PATTERNS])
    return f"""
      (
        r.division = '{CROWN_SERIES}'
        OR r.series_mode = '{CROWN_SERIES}'
        OR (
          COALESCE(r.series_mode, r.division) IN ('WoO Late Models', 'Lucas Oil LMDS')
          AND ({name_parts})
        )
      )
    """


def completed_crown_races(db, min_year: int, max_year: int | None):
    params = {"min_year": str(min_year)}
    if max_year:
        params["max_year"] = str(max_year)
        year_filter = "AND substr(r.race_date, 1, 4) BETWEEN :min_year AND :max_year"
    else:
        year_filter = "AND substr(r.race_date, 1, 4) >= :min_year"

    return db.execute(
        f"""
        SELECT r.id,
               r.name,
               r.race_date,
               r.division,
               COALESCE(r.series_mode, r.division) AS series_mode,
               t.name AS track_name,
               COUNT(re.id) AS field_size,
               SUM(CASE WHEN re.starting_position IS NOT NULL THEN 1 ELSE 0 END) AS starts,
               SUM(CASE WHEN re.heat_position IS NOT NULL THEN 1 ELSE 0 END) AS heats,
               SUM(CASE WHEN re.qualifying_time IS NOT NULL THEN 1 ELSE 0 END) AS qualifying
        FROM races r
        JOIN tracks t ON t.id = r.track_id
        JOIN race_entries re ON re.race_id = r.id
        WHERE r.status = 'complete'
          AND re.finishing_position IS NOT NULL
          {year_filter}
          AND {crown_sql_clause()}
        GROUP BY r.id
        HAVING SUM(CASE WHEN re.finishing_position = 1 AND re.dnf = 0 THEN 1 ELSE 0 END) = 1
           AND COUNT(re.id) >= 2
        ORDER BY r.race_date ASC, r.id ASC
        """,
        params,
    ).fetchall()


def race_entries(db, race_id: int):
    return db.execute(
        """
        SELECT re.driver_id,
               d.name AS driver_name,
               re.finishing_position,
               re.starting_position,
               re.heat_position,
               re.qualifying_time,
               re.dnf
        FROM race_entries re
        JOIN drivers d ON d.id = re.driver_id
        WHERE re.race_id = ?
          AND re.finishing_position IS NOT NULL
          AND re.dnf = 0
        ORDER BY re.finishing_position ASC
        """,
        (race_id,),
    ).fetchall()


def qualifying_ranks(entries):
    valid = sorted(
        [row for row in entries if row["qualifying_time"] is not None],
        key=lambda row: row["qualifying_time"],
    )
    return {int(row["driver_id"]): index + 1 for index, row in enumerate(valid)}


def prior_rows(db, driver_id: int, race_date: str):
    return db.execute(
        """
        SELECT r.id AS race_id,
               r.name AS race_name,
               r.race_date,
               r.division,
               r.series_mode,
               t.name AS track_name,
               re.finishing_position,
               re.starting_position
        FROM race_entries re
        JOIN races r ON r.id = re.race_id
        JOIN tracks t ON t.id = r.track_id
        WHERE re.driver_id = ?
          AND r.status = 'complete'
          AND re.finishing_position IS NOT NULL
          AND re.dnf = 0
          AND r.race_date < ?
        ORDER BY r.race_date ASC, r.id ASC
        """,
        (driver_id, race_date),
    ).fetchall()


def days_between(newer: str, older: str) -> int:
    newer_dt = datetime.fromisoformat(newer[:10])
    older_dt = datetime.fromisoformat(older[:10])
    return (newer_dt - older_dt).days


def driver_signals(db, driver_id: int, race_date: str):
    history = prior_rows(db, driver_id, race_date)
    crown_365 = []
    recent_14 = []
    deep_top3 = 0
    deep_wins = 0
    plus_minus_values: list[int] = []

    for row in history:
        days = days_between(race_date, row["race_date"])
        finish = int(row["finishing_position"])
        start = row["starting_position"]
        if start is not None:
            plus_minus = int(start) - finish
            plus_minus_values.append(plus_minus)
            if int(start) > 8 and finish <= 3:
                deep_top3 += 1
            if int(start) > 8 and finish == 1:
                deep_wins += 1

        is_crown = row["division"] == CROWN_SERIES or row["series_mode"] == CROWN_SERIES or is_crown_name(row["race_name"], row["track_name"])
        if 0 < days <= 365 and is_crown:
            crown_365.append(row)
        if 0 < days <= 14:
            recent_14.append(row)

    crown_top3 = any(int(row["finishing_position"]) <= 3 for row in crown_365)
    crown_win = any(int(row["finishing_position"]) == 1 for row in crown_365)
    recent_win = any(int(row["finishing_position"]) == 1 for row in recent_14)
    recent_top5 = any(int(row["finishing_position"]) <= 5 for row in recent_14)
    last5_plus_minus = plus_minus_values[-5:]

    return {
        "crownPriorTop3": crown_top3,
        "crownPriorWin": crown_win,
        "recentWin14d": recent_win,
        "recentTop514d": recent_top5,
        "priorDeepStartTop3Count": deep_top3,
        "priorDeepStartWinCount": deep_wins,
        "priorPlusMinusAvg": round(sum(plus_minus_values) / len(plus_minus_values), 2) if plus_minus_values else None,
        "last5PlusMinusAvg": round(sum(last5_plus_minus) / len(last5_plus_minus), 2) if last5_plus_minus else None,
    }


def agent_score(entry, signals):
    score = 0.0
    if signals["crownPriorWin"]:
        score += 0.25
    if signals["crownPriorTop3"]:
        score += 0.18
    if signals["recentWin14d"]:
        score += 0.16
    if signals["recentTop514d"]:
        score += 0.08
    score += min(0.12, signals["priorDeepStartTop3Count"] * 0.03)
    score += min(0.08, signals["priorDeepStartWinCount"] * 0.04)

    start = entry["starting_position"]
    heat = entry["heat_position"]
    if start is not None:
        if int(start) <= 4:
            score += 0.08
        elif int(start) <= 8:
            score += 0.04
    if heat is not None:
        if int(heat) == 1:
            score += 0.07
        elif int(heat) <= 3:
            score += 0.04

    last5_pm = signals["last5PlusMinusAvg"]
    if last5_pm is not None and last5_pm >= 3:
        score += 0.04
    return score


def rank_from_scores(scored_entries):
    ordered = sorted(scored_entries, key=lambda item: item["agentScore"], reverse=True)
    return {item["driverId"]: index + 1 for index, item in enumerate(ordered)}, ordered


def build_table(min_year: int, max_year: int | None, limit: int | None):
    predict = load_predict_module()
    db = connect()
    races = completed_crown_races(db, min_year, max_year)
    if limit:
        races = races[-limit:]

    rows = []
    top1 = 0
    top3 = 0
    agent_top1 = 0
    agent_top3 = 0
    rank_sum = 0
    agent_rank_sum = 0
    missing_qt = 0
    missing_heat = 0
    missing_start = 0

    for race in races:
        payload = predict.score_race(int(race["id"]), CROWN_SERIES)
        predictions = sorted(payload.get("predictions", []), key=lambda row: row.get("probability", 0), reverse=True)
        if len(predictions) < 2:
            continue

        entries = race_entries(db, int(race["id"]))
        if not entries:
            continue

        winner = entries[0]
        qt_ranks = qualifying_ranks(entries)
        xgb_rank = next(
            (index + 1 for index, item in enumerate(predictions) if int(item["driverId"]) == int(winner["driver_id"])),
            None,
        )
        if xgb_rank is None:
            continue

        signals_by_driver = {
            int(entry["driver_id"]): driver_signals(db, int(entry["driver_id"]), race["race_date"])
            for entry in entries
        }
        scored = [
            {
                "driverId": int(entry["driver_id"]),
                "driverName": entry["driver_name"],
                "agentScore": agent_score(entry, signals_by_driver[int(entry["driver_id"])]),
            }
            for entry in entries
        ]
        agent_ranks, agent_ordered = rank_from_scores(scored)
        winner_id = int(winner["driver_id"])
        agent_rank = agent_ranks.get(winner_id)
        winner_signals = signals_by_driver[winner_id]
        winner_prediction = predictions[xgb_rank - 1]

        gaps = []
        if int(race["qualifying"] or 0) == 0:
            gaps.append("QT")
            missing_qt += 1
        if int(race["heats"] or 0) == 0:
            gaps.append("Heat")
            missing_heat += 1
        if int(race["starts"] or 0) == 0:
            gaps.append("Start")
            missing_start += 1

        top1 += 1 if xgb_rank == 1 else 0
        top3 += 1 if xgb_rank <= 3 else 0
        agent_top1 += 1 if agent_rank == 1 else 0
        agent_top3 += 1 if agent_rank and agent_rank <= 3 else 0
        rank_sum += xgb_rank
        agent_rank_sum += agent_rank or len(entries)

        rows.append(
            {
                "raceId": int(race["id"]),
                "raceName": race["name"],
                "raceDate": race["race_date"],
                "division": race["division"],
                "trackName": race["track_name"],
                "fieldSize": len(entries),
                "actualWinner": winner["driver_name"],
                "actualFinish": int(winner["finishing_position"]),
                "winnerStart": int(winner["starting_position"]) if winner["starting_position"] is not None else None,
                "winnerHeat": int(winner["heat_position"]) if winner["heat_position"] is not None else None,
                "winnerQtRank": qt_ranks.get(winner_id),
                "xgbRank": xgb_rank,
                "xgbProbability": round(float(winner_prediction.get("probability", 0)), 6),
                "xgbFavorite": predictions[0]["driverName"],
                "xgbFavoriteProbability": round(float(predictions[0].get("probability", 0)), 6),
                "agentRank": agent_rank,
                "agentFavorite": agent_ordered[0]["driverName"] if agent_ordered else None,
                "agentScore": round(agent_ordered[agent_rank - 1]["agentScore"], 4) if agent_rank else None,
                "crownPriorTop3": winner_signals["crownPriorTop3"],
                "crownPriorWin": winner_signals["crownPriorWin"],
                "recentWin14d": winner_signals["recentWin14d"],
                "recentTop514d": winner_signals["recentTop514d"],
                "priorDeepStartTop3Count": winner_signals["priorDeepStartTop3Count"],
                "priorDeepStartWinCount": winner_signals["priorDeepStartWinCount"],
                "priorPlusMinusAvg": winner_signals["priorPlusMinusAvg"],
                "last5PlusMinusAvg": winner_signals["last5PlusMinusAvg"],
                "hasQualifying": int(race["qualifying"] or 0) > 0,
                "hasHeatData": int(race["heats"] or 0) > 0,
                "hasStartingLineup": int(race["starts"] or 0) > 0,
                "gaps": gaps,
            }
        )

    db.close()
    races_count = len(rows)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "races": races_count,
            "xgbTop1": top1,
            "xgbTop3": top3,
            "agentTop1": agent_top1,
            "agentTop3": agent_top3,
            "avgXgbWinnerRank": round(rank_sum / races_count, 2) if races_count else None,
            "avgAgentWinnerRank": round(agent_rank_sum / races_count, 2) if races_count else None,
            "missingQualifyingRaces": missing_qt,
            "missingHeatRaces": missing_heat,
            "missingStartRaces": missing_start,
        },
        "rows": list(reversed(rows)),
    }


def main():
    parser = argparse.ArgumentParser(description="Generate Race Lab crown replay JSON.")
    parser.add_argument("--min-year", type=int, default=2025)
    parser.add_argument("--max-year", type=int)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    payload = build_table(args.min_year, args.max_year, args.limit)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(
        "Crown replay: "
        f"{payload['summary']['races']} races, "
        f"XGB top3 {payload['summary']['xgbTop3']}, "
        f"agent top3 {payload['summary']['agentTop3']}"
    )


if __name__ == "__main__":
    main()
