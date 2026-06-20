#!/usr/bin/env python3
"""Audit repeatable Dirt IQ signals before adding manual/model weight.

Current focus:
- Feature-importance groups from trained model artifacts.
- Prelim/night-before winner repeat rates at same track + series.

The goal is to distinguish statistically useful signals from good stories.
"""

import argparse
import pickle
import sqlite3
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "dirtiq.db"

MODEL_SLUGS = {
    "lucas": "lucas_oil_lmds",
    "woo": "woo_late_models",
    "crown": "crown_jewel_combined",
}

FEATURE_GROUPS = {
    "lineup/prelim": [
        "start_pos_norm",
        "heat_pos_norm",
        "qt_rank_norm",
    ],
    "recent form": [
        "last5_avg_finish",
        "last10_avg_finish",
        "last5_win_rate",
        "recent_wins_3",
        "recent_wins_5",
        "streak_top3",
    ],
    "career strength": [
        "career_starts",
        "career_wins",
        "career_win_rate",
        "career_avg_finish",
        "career_top3_rate",
    ],
    "track-specific": [
        "track_starts",
        "track_wins",
        "track_win_rate",
        "track_avg_finish",
        "track_top3_rate",
    ],
    "similar track": [
        "similar_track_starts",
        "similar_track_win_rate",
        "similar_track_top3_rate",
        "similar_track_avg_finish",
        "log_aggregate_track_size_wins",
    ],
    "multi-night": [
        "prev_same_track_win_3d",
        "prev_same_track_top3_3d",
        "days_since_same_track_win",
    ],
    "aggregate dominance": [
        "log_feature_wins",
        "log_top5s",
        "log_top10s",
        "log_agg_laps_led",
        "laps_led_per_win",
        "log_hard_charger_count",
        "log_agg_heat_wins",
        "agg_last5_avg_finish",
        "agg_avg_finish",
        "agg_avg_start",
        "agg_avg_qual_position",
    ],
    "equipment": [
        "chassis_longhorn",
        "chassis_rocket",
        "engine_clements",
        "engine_cornett",
        "engine_durham",
        "engine_vic_hill",
        "shock_ohlins",
        "shock_bilstein",
        "shock_penske",
        "shock_integra",
    ],
    "race shape": [
        "field_size",
        "dist_bucket",
        "track_len_bucket",
        "years_since_2021",
    ],
}


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def model_feature_groups() -> None:
    print("=== XGBoost Feature Signal Groups ===")
    for label, slug in MODEL_SLUGS.items():
        model_path = ROOT / "data" / f"dirtiq_model_{slug}.pkl"
        params_path = ROOT / "data" / f"feature_params_{slug}.json"
        if not model_path.exists():
            continue

        model = pickle.load(open(model_path, "rb"))
        if not hasattr(model, "feature_importances_"):
            print(f"\n{label}: no feature importances available")
            continue

        import json

        params = json.load(open(params_path))
        features = params["features"]
        importances = dict(zip(features, model.feature_importances_))
        total = sum(importances.values()) or 1.0

        group_scores = []
        claimed = set()
        for group, names in FEATURE_GROUPS.items():
            score = sum(importances.get(name, 0.0) for name in names)
            claimed.update(names)
            group_scores.append((group, score))
        other = sum(value for name, value in importances.items() if name not in claimed)
        group_scores.append(("other", other))

        print(f"\n{label.upper()} ({type(model).__name__})")
        for group, score in sorted(group_scores, key=lambda item: item[1], reverse=True):
            if score <= 0:
                continue
            print(f"  {group:20s} {score / total:>6.1%}")

        top = sorted(importances.items(), key=lambda item: item[1], reverse=True)[:10]
        print("  top features:")
        for name, score in top:
            print(f"    {name:34s} {score / total:>6.1%}")


def parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def prelim_repeat_rows(series: Optional[str] = None, max_gap_days: int = 3):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    params = []
    where = "r.status = 'complete'"
    if series:
        where += " AND r.division = ?"
        params.append(series)

    races = con.execute(
        f"""SELECT r.id, r.name, r.race_date, r.division, r.track_id, t.name AS track_name
            FROM races r
            JOIN tracks t ON t.id = r.track_id
            WHERE {where}
            ORDER BY r.track_id, r.division, r.race_date, r.id""",
        params,
    ).fetchall()

    by_track_series: dict[tuple[int, str], list[sqlite3.Row]] = defaultdict(list)
    for race in races:
        by_track_series[(race["track_id"], race["division"])].append(race)

    outcomes = []
    for (_, _), group in by_track_series.items():
        by_date: dict[date, list[sqlite3.Row]] = defaultdict(list)
        for race in group:
            by_date[parse_date(race["race_date"])].append(race)
        dates = sorted(by_date)

        for idx, current_date in enumerate(dates):
            if idx == 0:
                continue
            prior_dates = [
                d for d in dates[:idx]
                if 0 < (current_date - d).days <= max_gap_days
            ]
            if not prior_dates:
                continue
            previous_date = prior_dates[-1]

            previous_winners = []
            for prev_race in by_date[previous_date]:
                previous_winners.extend(
                    con.execute(
                        """SELECT re.driver_id, d.name AS driver_name
                           FROM race_entries re
                           JOIN drivers d ON d.id = re.driver_id
                           WHERE re.race_id = ?
                             AND re.finishing_position = 1
                             AND COALESCE(re.dnf, 0) = 0""",
                        (prev_race["id"],),
                    ).fetchall()
                )

            if not previous_winners:
                continue

            for current_race in by_date[current_date]:
                field_size = con.execute(
                    "SELECT COUNT(*) AS n FROM race_entries WHERE race_id = ? AND finishing_position IS NOT NULL",
                    (current_race["id"],),
                ).fetchone()["n"]

                for winner in previous_winners:
                    current_entry = con.execute(
                        """SELECT finishing_position, dnf
                           FROM race_entries
                           WHERE race_id = ? AND driver_id = ?""",
                        (current_race["id"], winner["driver_id"]),
                    ).fetchone()
                    if not current_entry:
                        continue

                    finish = current_entry["finishing_position"]
                    dnf = bool(current_entry["dnf"])
                    outcomes.append({
                        "series": current_race["division"],
                        "track": current_race["track_name"],
                        "previous_date": previous_date.isoformat(),
                        "current_date": current_date.isoformat(),
                        "driver": winner["driver_name"],
                        "finish": finish,
                        "dnf": dnf,
                        "field_size": field_size,
                        "repeat_win": finish == 1 and not dnf,
                        "top3": finish is not None and finish <= 3 and not dnf,
                        "top5": finish is not None and finish <= 5 and not dnf,
                    })

    con.close()
    return outcomes


def summarize_prelim_repeat(series: Optional[str] = None) -> None:
    rows = prelim_repeat_rows(series)
    label = series or "All series"
    print(f"\n=== Prelim/Night-Before Winner Repeat Audit: {label} ===")
    if not rows:
        print("No same-track next-night opportunities found.")
        return

    n = len(rows)
    repeat_wins = sum(row["repeat_win"] for row in rows)
    top3 = sum(row["top3"] for row in rows)
    top5 = sum(row["top5"] for row in rows)
    avg_field = sum(row["field_size"] for row in rows) / n
    baseline_win = sum(1 / max(row["field_size"], 1) for row in rows) / n
    baseline_top3 = sum(min(3, row["field_size"]) / max(row["field_size"], 1) for row in rows) / n
    avg_finish = sum(row["finish"] for row in rows if row["finish"] is not None) / n

    print(f"Opportunities:       {n}")
    print(f"Repeat wins:         {repeat_wins}/{n} = {pct(repeat_wins / n)}")
    print(f"Top-3 next night:    {top3}/{n} = {pct(top3 / n)}")
    print(f"Top-5 next night:    {top5}/{n} = {pct(top5 / n)}")
    print(f"Avg finish:          {avg_finish:.1f}")
    print(f"Avg field size:      {avg_field:.1f}")
    print(f"Random win baseline: {pct(baseline_win)}")
    print(f"Random top-3 base:   {pct(baseline_top3)}")

    by_series: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_series[row["series"]].append(row)
    if len(by_series) > 1:
        print("\nBy series:")
        for series_name, series_rows in sorted(by_series.items()):
            count = len(series_rows)
            wins = sum(row["repeat_win"] for row in series_rows)
            podiums = sum(row["top3"] for row in series_rows)
            print(f"  {series_name:16s} repeat {wins}/{count} {pct(wins/count)} · top3 {podiums}/{count} {pct(podiums/count)}")

    print("\nRecent examples:")
    for row in rows[-12:]:
        print(
            f"  {row['current_date']} {row['track']} | {row['driver']} "
            f"after {row['previous_date']} win -> P{row['finish']}"
        )

    if n < 30:
        print("\nInterpretation: sample is small; treat as a watch/caveat, not a heavy model boost.")
    elif repeat_wins / n <= baseline_win * 1.5:
        print("\nInterpretation: repeat wins do not clear a strong edge threshold; avoid manual boost.")
    else:
        print("\nInterpretation: repeat wins beat baseline; consider a small feature or underwriting note, then backtest.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit model/underwriting signals.")
    parser.add_argument("--series", choices=["Lucas Oil LMDS", "WoO Late Models"], help="Restrict prelim-repeat audit to one series.")
    parser.add_argument("--skip-feature-groups", action="store_true")
    args = parser.parse_args()

    if not args.skip_feature_groups:
        model_feature_groups()
    summarize_prelim_repeat(args.series)


if __name__ == "__main__":
    main()
