"""
hypothesis_regression_audit.py
==============================
Tests hand-scouted race hypotheses against completed Dirt IQ history.

The goal is not to crown a new feature from a good story. It is to answer:
  - How often did this signal exist?
  - Did drivers with the signal win / podium more than baseline?
  - Does the signal still help on a time-based holdout?

Every feature is computed from races completed BEFORE the target row.
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import warnings
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

warnings.filterwarnings("ignore", category=RuntimeWarning)


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
]

FEATURES = [
    "won_last_7d",
    "won_last_14d",
    "podium_last_14d",
    "top5_last_14d",
    "recent_win_last_3",
    "recent_podium_last_3",
    "same_track_prior_start",
    "same_track_prior_win",
    "same_track_prior_top3",
    "similar_track_prior_start",
    "similar_track_prior_win",
    "similar_track_prior_top3",
    "crown_prior_top3_365d",
    "eldora_prior_top3_365d",
    "dream_prior_top3_365d",
    "last_start_was_win",
    "last_start_was_podium",
    "finished_top5_last_start",
    "last_start_finish",
    "days_since_last_win",
    "prior_starts",
]

LOGISTIC_FEATURES = [
    feature
    for feature in FEATURES
    if feature not in {"last_start_finish", "days_since_last_win", "prior_starts"}
]


@dataclass(frozen=True)
class PriorResult:
    race_date: pd.Timestamp
    race_id: int
    finish: int
    track_id: int
    track_name: str
    is_crown: bool
    is_eldora: bool
    is_dream: bool
    similar_to_next: bool = False


def is_crown_event(race_name: str, track_name: str) -> bool:
    text = f"{race_name} {track_name}".lower()
    return any(pattern in text for pattern in CROWN_PATTERNS)


def load_similar_tracks(con: sqlite3.Connection) -> dict[int, set[int]]:
    try:
        rows = con.execute(
            "SELECT track_id, similar_track_id FROM track_similars"
        ).fetchall()
    except sqlite3.OperationalError:
        return {}

    similar: dict[int, set[int]] = defaultdict(set)
    for track_id, similar_track_id in rows:
        similar[int(track_id)].add(int(similar_track_id))
        similar[int(similar_track_id)].add(int(track_id))
    return similar


def load_results(min_year: int) -> tuple[pd.DataFrame, dict[int, set[int]]]:
    con = sqlite3.connect(DB)
    similar_tracks = load_similar_tracks(con)
    df = pd.read_sql_query(
        """
        SELECT
          r.id AS race_id,
          r.name AS race_name,
          r.race_date,
          r.division,
          r.series_mode,
          r.track_id,
          t.name AS track_name,
          re.driver_id,
          d.name AS driver_name,
          re.finishing_position
        FROM race_entries re
        JOIN races r ON r.id = re.race_id
        JOIN tracks t ON t.id = r.track_id
        JOIN drivers d ON d.id = re.driver_id
        WHERE r.status = 'complete'
          AND re.finishing_position IS NOT NULL
          AND re.dnf = 0
          AND (
            r.division IN ('Lucas Oil LMDS', 'WoO Late Models')
            OR r.series_mode IN ('Lucas Oil LMDS', 'WoO Late Models')
            OR r.division = 'Crown Jewel / Combined'
            OR r.series_mode = 'Crown Jewel / Combined'
          )
          AND CAST(substr(r.race_date, 1, 4) AS INTEGER) >= ?
        ORDER BY r.race_date, r.id, re.finishing_position
        """,
        con,
        params=(min_year,),
    )
    con.close()

    df["race_date"] = pd.to_datetime(df["race_date"])
    df["year"] = df["race_date"].dt.year
    df["finish"] = df["finishing_position"].astype(int)
    df["win"] = (df["finish"] == 1).astype(int)
    df["top3"] = (df["finish"] <= 3).astype(int)
    df["top5"] = (df["finish"] <= 5).astype(int)
    df["is_crown_event"] = [
        is_crown_event(str(race), str(track))
        for race, track in zip(df["race_name"], df["track_name"])
    ]
    df["is_eldora_event"] = df["track_name"].str.lower().str.contains("eldora", na=False)
    df["is_dream_event"] = df["race_name"].str.lower().str.contains("dream", na=False)
    return df, similar_tracks


def compute_features(df: pd.DataFrame, similar_tracks: dict[int, set[int]]) -> pd.DataFrame:
    rows = []
    history_by_driver: dict[int, list[PriorResult]] = defaultdict(list)

    ordered = df.sort_values(["race_date", "race_id", "finish"]).reset_index(drop=True)
    for row in ordered.itertuples(index=False):
        history = history_by_driver[int(row.driver_id)]
        current_date = row.race_date
        current_track_id = int(row.track_id)
        similar_ids = similar_tracks.get(current_track_id, set())

        def days_ago(prior: PriorResult) -> int:
            return int((current_date - prior.race_date).days)

        recent_7 = [item for item in history if 0 < days_ago(item) <= 7]
        recent_14 = [item for item in history if 0 < days_ago(item) <= 14]
        last_3 = history[-3:]
        same_track = [item for item in history if item.track_id == current_track_id]
        similar_track = [item for item in history if item.track_id in similar_ids]
        crown_365 = [item for item in history if 0 < days_ago(item) <= 365 and item.is_crown]
        eldora_365 = [item for item in history if 0 < days_ago(item) <= 365 and item.is_eldora]
        dream_365 = [item for item in history if 0 < days_ago(item) <= 365 and item.is_dream]
        wins = [item for item in history if item.finish == 1]
        last_start = history[-1] if history else None

        feature_row = row._asdict()
        feature_row.update(
            {
                "won_last_7d": float(any(item.finish == 1 for item in recent_7)),
                "won_last_14d": float(any(item.finish == 1 for item in recent_14)),
                "podium_last_14d": float(any(item.finish <= 3 for item in recent_14)),
                "top5_last_14d": float(any(item.finish <= 5 for item in recent_14)),
                "recent_win_last_3": float(any(item.finish == 1 for item in last_3)),
                "recent_podium_last_3": float(any(item.finish <= 3 for item in last_3)),
                "same_track_prior_start": float(len(same_track) > 0),
                "same_track_prior_win": float(any(item.finish == 1 for item in same_track)),
                "same_track_prior_top3": float(any(item.finish <= 3 for item in same_track)),
                "similar_track_prior_start": float(len(similar_track) > 0),
                "similar_track_prior_win": float(any(item.finish == 1 for item in similar_track)),
                "similar_track_prior_top3": float(any(item.finish <= 3 for item in similar_track)),
                "crown_prior_top3_365d": float(any(item.finish <= 3 for item in crown_365)),
                "eldora_prior_top3_365d": float(any(item.finish <= 3 for item in eldora_365)),
                "dream_prior_top3_365d": float(any(item.finish <= 3 for item in dream_365)),
                "last_start_was_win": float(bool(last_start and last_start.finish == 1)),
                "last_start_was_podium": float(bool(last_start and last_start.finish <= 3)),
                "finished_top5_last_start": float(bool(last_start and last_start.finish <= 5)),
                "last_start_finish": float(last_start.finish) if last_start else np.nan,
                "days_since_last_win": float((current_date - wins[-1].race_date).days) if wins else np.nan,
                "prior_starts": float(len(history)),
            }
        )
        rows.append(feature_row)

        history.append(
            PriorResult(
                race_date=row.race_date,
                race_id=int(row.race_id),
                finish=int(row.finish),
                track_id=current_track_id,
                track_name=str(row.track_name),
                is_crown=bool(row.is_crown_event),
                is_eldora=bool(row.is_eldora_event),
                is_dream=bool(row.is_dream_event),
            )
        )

    out = pd.DataFrame(rows)
    return out[out["prior_starts"] >= 1].copy()


def apply_filters(df: pd.DataFrame, series: str, track: str | None) -> pd.DataFrame:
    filtered = df.copy()
    if series != "all":
        series_map = {
            "lucas": "Lucas Oil LMDS",
            "woo": "WoO Late Models",
        }
        if series == "crown":
            filtered = filtered[filtered["is_crown_event"]]
        else:
            filtered = filtered[filtered["division"] == series_map[series]]

    if track:
        filtered = filtered[
            filtered["track_name"].str.lower().str.contains(track.lower(), na=False)
        ]
    return filtered.copy()


def rate(value: float) -> str:
    if pd.isna(value):
        return "n/a"
    return f"{value * 100:5.1f}%"


def lift(feature_rate: float, baseline_rate: float) -> str:
    if pd.isna(feature_rate) or baseline_rate <= 0:
        return "n/a"
    return f"{feature_rate / baseline_rate:4.2f}x"


def print_univariate(df: pd.DataFrame, min_feature_rows: int) -> None:
    baseline_win = df["win"].mean()
    baseline_top3 = df["top3"].mean()
    print("\nUnivariate signal scan")
    print(
        f"Baseline: win {rate(baseline_win)} | top3 {rate(baseline_top3)} | rows {len(df):,}"
    )
    print(
        "feature                         n   win%  win_lift  top3% top3_lift  note"
    )

    for feature in FEATURES:
        feature_df = df[df[feature].fillna(0) > 0]
        n = len(feature_df)
        if n == 0:
            note = "no local coverage"
            print(f"{feature:<29} {n:4d}  {'n/a':>5}  {'n/a':>8}  {'n/a':>5}  {'n/a':>8}  {note}")
            continue

        win_rate = feature_df["win"].mean()
        top3_rate = feature_df["top3"].mean()
        note = "thin sample" if n < min_feature_rows else ""
        print(
            f"{feature:<29} {n:4d}  {rate(win_rate):>5}  {lift(win_rate, baseline_win):>8}  "
            f"{rate(top3_rate):>5}  {lift(top3_rate, baseline_top3):>8}  {note}"
        )


def run_logistic(df: pd.DataFrame, holdout_year: int, min_feature_rows: int, target: str) -> None:
    candidates = []
    for feature in LOGISTIC_FEATURES:
        positives = int((df[feature].fillna(0) > 0).sum())
        negatives = len(df) - positives
        if positives >= min_feature_rows and negatives >= min_feature_rows:
            candidates.append(feature)

    print(f"\nMultivariate logistic regression ({target}, holdout {holdout_year}+)")
    if len(candidates) < 2:
        print("Skipped: not enough features with usable sample size after filtering.")
        return

    train = df[df["year"] < holdout_year].copy()
    test = df[df["year"] >= holdout_year].copy()
    if train[target].nunique() < 2 or test[target].nunique() < 2:
        print("Skipped: train/test split does not contain both outcomes.")
        return

    X_train = train[candidates].replace([np.inf, -np.inf], np.nan).fillna(0).astype(float)
    X_test = test[candidates].replace([np.inf, -np.inf], np.nan).fillna(0).astype(float)
    y_train = train[target].astype(int)
    y_test = test[target].astype(int)

    model = LogisticRegression(max_iter=2000, class_weight="balanced", solver="liblinear")
    model.fit(X_train, y_train)
    train_pred = model.predict_proba(X_train)[:, 1]
    test_pred = model.predict_proba(X_test)[:, 1]

    def auc(y_true: pd.Series, pred: np.ndarray) -> float:
        if y_true.nunique() < 2:
            return float("nan")
        return float(roc_auc_score(y_true, pred))

    print(
        f"Train rows {len(train):,} | Test rows {len(test):,} | "
        f"train AUC {auc(y_train, train_pred):.3f} | test AUC {auc(y_test, test_pred):.3f} | "
        f"test logloss {log_loss(y_test, test_pred, labels=[0, 1]):.4f}"
    )
    print("feature                         coef  odds_ratio  positives")

    coefs = sorted(
        zip(candidates, model.coef_[0]),
        key=lambda item: abs(item[1]),
        reverse=True,
    )
    for feature, coef in coefs:
        odds_ratio = math.exp(float(coef))
        positives = int((df[feature].fillna(0) > 0).sum())
        print(f"{feature:<29} {coef:6.3f}  {odds_ratio:10.2f}  {positives:9d}")


def print_coverage_notes(df: pd.DataFrame, raw_df: pd.DataFrame) -> None:
    dream_events = raw_df[raw_df["is_dream_event"]]["race_id"].nunique()
    eldora_events = raw_df[raw_df["is_eldora_event"]]["race_id"].nunique()
    crown_events = raw_df[raw_df["is_crown_event"]]["race_id"].nunique()
    print("\nCoverage notes")
    print(f"- Crown-labeled completed events in DB: {crown_events}")
    print(f"- Eldora completed events in DB: {eldora_events}")
    print(f"- Dirt Late Model Dream-labeled events in DB: {dream_events}")
    if dream_events == 0:
        print(
            "- Dream podium is currently a missing-data problem, not a proven negative. "
            "Use eldora_prior_top3_365d or crown_prior_top3_365d as a proxy until Dream results are imported."
        )
    if len(df) < 300:
        print(
            "- This filter is small. Treat exact percentages as scouting evidence, then validate on broader series history."
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", choices=["all", "lucas", "woo", "crown"], default="all")
    parser.add_argument("--track", help="Optional track-name contains filter, e.g. Smoky Mountain")
    parser.add_argument("--min-year", type=int, default=2021)
    parser.add_argument("--holdout-year", type=int, default=2025)
    parser.add_argument("--min-feature-rows", type=int, default=30)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raw_df, similar_tracks = load_results(args.min_year)
    featured_df = compute_features(raw_df, similar_tracks)
    df = apply_filters(featured_df, args.series, args.track)

    print("Dirt IQ Hypothesis Regression Audit")
    print(f"DB: {DB}")
    print(
        f"Filter: series={args.series}, track={args.track or 'all'}, "
        f"min_year={args.min_year}, holdout_year={args.holdout_year}"
    )
    print(
        f"Rows: {len(df):,} entries | races {df['race_id'].nunique():,} | "
        f"drivers {df['driver_id'].nunique():,}"
    )

    if df.empty:
        print("No rows after filters.")
        return

    print_coverage_notes(df, raw_df)
    print_univariate(df, args.min_feature_rows)
    run_logistic(df, args.holdout_year, args.min_feature_rows, "win")
    run_logistic(df, args.holdout_year, args.min_feature_rows, "top3")


if __name__ == "__main__":
    main()
