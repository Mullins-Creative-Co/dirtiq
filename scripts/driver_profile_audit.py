#!/usr/bin/env python3
"""
Audit one driver's repeatable win/top-3 signals without leaking future results.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"

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
    "dirt track world championship",
    "dtwc",
]

PIERCE_TRACK_FAMILY = [
    "eldora",
    "fairbury",
    "farmer city",
    "cedar lake",
    "deer creek",
    "mississippi thunder",
    "volusia",
    "smoky mountain",
    "west virginia",
    "lucas oil speedway",
]


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def is_crown_event(race_name: str, track_name: str) -> bool:
    text = f"{race_name} {track_name}".lower()
    return any(pattern in text for pattern in CROWN_PATTERNS)


def is_profile_track(track_name: str) -> bool:
    text = track_name.lower()
    return any(pattern in text for pattern in PIERCE_TRACK_FAMILY)


def load_driver_results(driver_name: str) -> pd.DataFrame:
    con = sqlite3.connect(DB)
    df = pd.read_sql_query(
        """
        SELECT
          r.id AS race_id,
          r.name AS race_name,
          r.race_date,
          r.division,
          r.track_id,
          t.name AS track_name,
          t.track_length,
          re.driver_id,
          d.name AS driver_name,
          re.finishing_position,
          re.starting_position,
          re.qualifying_time,
          re.heat_position,
          re.dnf,
          field.field_size
        FROM race_entries re
        JOIN races r ON r.id = re.race_id
        JOIN tracks t ON t.id = r.track_id
        JOIN drivers d ON d.id = re.driver_id
        JOIN (
          SELECT race_id, COUNT(*) AS field_size
          FROM race_entries
          GROUP BY race_id
        ) field ON field.race_id = re.race_id
        WHERE lower(d.name) = lower(?)
          AND r.status = 'complete'
          AND re.finishing_position IS NOT NULL
        ORDER BY r.race_date, r.id
        """,
        con,
        params=(driver_name,),
    )
    con.close()
    if df.empty:
        return df

    df["race_date"] = pd.to_datetime(df["race_date"])
    df["finish"] = df["finishing_position"].astype(int)
    df["win"] = (df["finish"] == 1).astype(int)
    df["top3"] = (df["finish"] <= 3).astype(int)
    df["top5"] = (df["finish"] <= 5).astype(int)
    df["front_half_start"] = (
        df["starting_position"].notna()
        & (df["starting_position"] <= df["field_size"] / 2)
    ).astype(int)
    df["front_two_rows"] = (df["starting_position"].notna() & (df["starting_position"] <= 4)).astype(int)
    df["heat_win"] = (df["heat_position"].notna() & (df["heat_position"] == 1)).astype(int)
    df["is_crown_event"] = [
        is_crown_event(str(race_name), str(track_name))
        for race_name, track_name in zip(df["race_name"], df["track_name"])
    ]
    df["is_profile_track"] = [is_profile_track(str(track)) for track in df["track_name"]]
    df["track_size_3_8ish"] = (
        df["track_length"].notna() & (df["track_length"] >= 0.35) & (df["track_length"] <= 0.4)
    ).astype(int)
    return add_no_leak_history(df)


def add_no_leak_history(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    history: list[dict] = []
    track_history: dict[int, list[dict]] = defaultdict(list)

    for row in df.sort_values(["race_date", "race_id"]).to_dict("records"):
        current_date = row["race_date"]
        last_3 = history[-3:]
        last_5 = history[-5:]
        recent_14 = [
            item for item in history
            if 0 < (current_date - item["race_date"]).days <= 14
        ]
        same_track = track_history[int(row["track_id"])]
        crown_365 = [
            item for item in history
            if item["is_crown_event"] and 0 < (current_date - item["race_date"]).days <= 365
        ]

        row["won_last_3"] = int(any(item["finish"] == 1 for item in last_3))
        row["won_last_5"] = int(any(item["finish"] == 1 for item in last_5))
        row["podium_last_3"] = int(any(item["finish"] <= 3 for item in last_3))
        row["won_last_14d"] = int(any(item["finish"] == 1 for item in recent_14))
        row["prior_track_win"] = int(any(item["finish"] == 1 for item in same_track))
        row["prior_track_top3"] = int(any(item["finish"] <= 3 for item in same_track))
        row["prior_crown_top3_365d"] = int(any(item["finish"] <= 3 for item in crown_365))
        row["prior_starts"] = len(history)
        rows.append(row)

        history.append(row)
        track_history[int(row["track_id"])].append(row)

    return pd.DataFrame(rows)


def summarize_signal(df: pd.DataFrame, signal: str) -> dict:
    subset = df[df[signal].astype(bool)]
    return {
        "signal": signal,
        "starts": int(len(subset)),
        "winRate": float(subset["win"].mean()) if len(subset) else None,
        "top3Rate": float(subset["top3"].mean()) if len(subset) else None,
        "baselineWinRate": float(df["win"].mean()) if len(df) else None,
        "baselineTop3Rate": float(df["top3"].mean()) if len(df) else None,
    }


def audit(driver_name: str) -> dict:
    df = load_driver_results(driver_name)
    if df.empty:
        raise SystemExit(f"No completed results found for {driver_name}")

    signals = [
        "won_last_3",
        "won_last_5",
        "podium_last_3",
        "won_last_14d",
        "prior_track_win",
        "prior_track_top3",
        "prior_crown_top3_365d",
        "front_half_start",
        "front_two_rows",
        "heat_win",
        "is_crown_event",
        "is_profile_track",
        "track_size_3_8ish",
    ]
    signal_rows = [summarize_signal(df, signal) for signal in signals]
    signal_rows.sort(
        key=lambda row: (
            -1 if row["winRate"] is None else -row["winRate"],
            -row["starts"],
        )
    )

    recent = df.sort_values(["race_date", "race_id"], ascending=False).head(10)

    return {
        "driver": driver_name,
        "starts": int(len(df)),
        "wins": int(df["win"].sum()),
        "top3s": int(df["top3"].sum()),
        "winRate": float(df["win"].mean()),
        "top3Rate": float(df["top3"].mean()),
        "signals": signal_rows,
        "recent": [
            {
                "date": row.race_date.strftime("%Y-%m-%d"),
                "race": row.race_name,
                "track": row.track_name,
                "finish": int(row.finish),
                "start": None if pd.isna(row.starting_position) else int(row.starting_position),
            }
            for row in recent.itertuples(index=False)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit one driver's Dirt IQ profile signals.")
    parser.add_argument("--driver", default="Bobby Pierce")
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    payload = audit(args.driver)
    text = json.dumps(payload, indent=2)
    if args.json_out:
      path = Path(args.json_out)
      path.parent.mkdir(parents=True, exist_ok=True)
      path.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
