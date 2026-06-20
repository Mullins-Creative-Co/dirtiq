"""
train_model.py
==============
Trains a boost-model win-probability layer on historical dirt late model results.

Feature engineering uses only data available BEFORE each race to prevent leakage:
  - Career track history (wins, avg finish) at this specific track
  - Career stats at all tracks (overall win rate, avg finish)
  - Rolling last-5 and last-10 form windows
  - Tonight's starting position, heat position, qual rank (when available)
  - Race distance bucket

Output:
  data/dirtiq_model_<series>.pkl    — trained model artifact
  data/feature_params_<series>.json — feature list + metadata for the predict script

Usage:
  python3 scripts/train_model.py
"""

import sqlite3
import json
import os
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, log_loss
import warnings
warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent
DB   = ROOT / "data" / "dirtiq.db"
SERIES = os.environ.get("DIRTIQ_SERIES", "WoO Late Models")
CROWN_JEWEL = SERIES == "Crown Jewel / Combined"
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

# ── 1. Load raw data ──────────────────────────────────────────────────────────
print("Loading data from DB…")
con = sqlite3.connect(DB)

race_filter = "r.division = ?"
race_params = [SERIES]
if CROWN_JEWEL:
    pattern_filter = " OR ".join(["lower(r.name) LIKE ?" for _ in CROWN_PATTERNS])
    race_filter = f"(r.division = 'Crown Jewel / Combined' OR (r.division IN ('WoO Late Models', 'Lucas Oil LMDS') AND ({pattern_filter})))"
    race_params = [f"%{pattern}%" for pattern in CROWN_PATTERNS]

df = pd.read_sql_query(f"""
  SELECT
    r.id            AS race_id,
    r.name          AS race_name,
    r.division      AS race_series,
    r.race_date,
    r.track_id,
    r.distance      AS race_laps,
    t.name          AS track_name,
    t.track_length,
    re.driver_id,
    d.name          AS driver_name,
    re.finishing_position,
    re.starting_position,
    re.qualifying_time,
    re.heat_position,
    re.bmain_position,
    re.laps_led,
    re.dnf,
    re.money
  FROM race_entries re
  JOIN races r  ON r.id  = re.race_id
  JOIN tracks t ON t.id  = r.track_id
  JOIN drivers d ON d.id = re.driver_id
  WHERE r.status = 'complete'
    AND {race_filter}
    AND re.finishing_position IS NOT NULL
    AND re.dnf = 0
  ORDER BY r.race_date, r.id, re.finishing_position
""", con, params=tuple(race_params))

print(f"  {len(df)} entries across {df['race_id'].nunique()} races, "
      f"{df['driver_id'].nunique()} drivers, {df['track_id'].nunique()} tracks for {SERIES}")

df["race_date"] = pd.to_datetime(df["race_date"])
df["year"]      = df["race_date"].dt.year

# Field size per race (used to normalise position)
field_sizes = df.groupby("race_id")["finishing_position"].max().rename("field_size")
df = df.join(field_sizes, on="race_id")

# Binary target
df["win"]  = (df["finishing_position"] == 1).astype(int)
df["top3"] = (df["finishing_position"] <= 3).astype(int)

# ── 2. Rolling feature engineering ───────────────────────────────────────────
print("Engineering features (rolling, no data leakage)…")

# Sort chronologically within each driver
df = df.sort_values(["driver_id", "race_date", "race_id"]).reset_index(drop=True)

def expanding_prior(series, func):
    """Apply func to all rows PRIOR to each row (shift-1 expanding window)."""
    return series.expanding().apply(func, raw=True).shift(1)

def safe_mean(x):   return np.mean(x) if len(x) > 0 else np.nan
def safe_win_r(x):  return np.mean(x == 1) if len(x) > 0 else np.nan
def safe_top3_r(x): return np.mean(x <= 3) if len(x) > 0 else np.nan

# --- Overall career stats (rolling, all tracks) ---
grp = df.groupby("driver_id")

df["career_starts"]      = grp.cumcount()          # races before this one
df["career_wins"]        = grp["win"].transform(lambda s: s.shift(1).expanding().sum())
df["career_win_rate"]    = df["career_wins"] / df["career_starts"].clip(lower=1)
df["career_avg_finish"]  = grp["finishing_position"].transform(
    lambda s: s.shift(1).expanding().mean())
df["career_top3_rate"]   = grp["top3"].transform(
    lambda s: s.shift(1).expanding().mean())

# --- Last-5 and last-10 rolling windows ---
df["last5_avg_finish"]   = grp["finishing_position"].transform(
    lambda s: s.shift(1).rolling(5,  min_periods=1).mean())
df["last10_avg_finish"]  = grp["finishing_position"].transform(
    lambda s: s.shift(1).rolling(10, min_periods=1).mean())
df["last5_win_rate"]     = grp["win"].transform(
    lambda s: s.shift(1).rolling(5,  min_periods=1).mean())
df["last10_dnf_rate"]    = grp["dnf"] .transform(
    lambda s: s.shift(1).rolling(10, min_periods=1).mean()) if "dnf" in df.columns else 0

# Consecutive top-3 streak
def streak_top3(series):
    out = []
    count = 0
    for v in series:
        out.append(count)
        count = count + 1 if v <= 3 else 0
    return out

df["streak_top3"] = df.groupby("driver_id")["finishing_position"].transform(streak_top3)

# Recent wins in last 3 and 5 races (non-consecutive hot-hand signal).
# Dream/crown-jewel analysis shows winners almost always have a win in last 3–5 starts.
df["recent_wins_3"] = df.groupby("driver_id")["win"].transform(
    lambda s: s.shift(1).rolling(3, min_periods=1).sum())
df["recent_wins_5"] = df.groupby("driver_id")["win"].transform(
    lambda s: s.shift(1).rolling(5, min_periods=1).sum())
df["recent_podiums_3"] = df.groupby("driver_id")["top3"].transform(
    lambda s: s.shift(1).rolling(3, min_periods=1).sum())
df["last_start_was_win"] = df.groupby("driver_id")["win"].transform(lambda s: s.shift(1)).fillna(0)
df["last_start_was_podium"] = df.groupby("driver_id")["top3"].transform(lambda s: s.shift(1)).fillna(0)
df["finished_top5_last_start"] = df.groupby("driver_id")["finishing_position"].transform(
    lambda s: (s.shift(1) <= 5).astype(float)).fillna(0)
df["feature_plus_minus"] = np.where(
    df["starting_position"].notna(),
    df["starting_position"] - df["finishing_position"],
    np.nan,
)
df["deep_start_top3"] = (
    df["starting_position"].notna()
    & (df["starting_position"] > 8)
    & (df["finishing_position"] <= 3)
).astype(float)
df["deep_start_win"] = (
    df["starting_position"].notna()
    & (df["starting_position"] > 8)
    & (df["finishing_position"] == 1)
).astype(float)
df["prior_deep_start_top3_count"] = grp["deep_start_top3"].transform(lambda s: s.shift(1).expanding().sum())
df["prior_deep_start_win_count"] = grp["deep_start_win"].transform(lambda s: s.shift(1).expanding().sum())
df["prior_plus_minus_avg"] = grp["feature_plus_minus"].transform(lambda s: s.shift(1).expanding().mean())
df["last5_plus_minus_avg"] = grp["feature_plus_minus"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())

# Calendar-window signals from the hypothesis audit. These avoid over-crediting
# one race by asking whether the driver had proven speed in the last 7/14 days.
df["won_last_7d"] = 0.0
df["won_last_14d"] = 0.0
df["podium_last_14d"] = 0.0
df["top5_last_14d"] = 0.0
for _, driver_rows in df.groupby("driver_id", sort=False):
    prior = []
    for idx, row in driver_rows.sort_values(["race_date", "race_id"]).iterrows():
        recent_7 = [item for item in prior if 0 < (row["race_date"] - item["race_date"]).days <= 7]
        recent_14 = [item for item in prior if 0 < (row["race_date"] - item["race_date"]).days <= 14]
        df.at[idx, "won_last_7d"] = float(any(item["finish"] == 1 for item in recent_7))
        df.at[idx, "won_last_14d"] = float(any(item["finish"] == 1 for item in recent_14))
        df.at[idx, "podium_last_14d"] = float(any(item["finish"] <= 3 for item in recent_14))
        df.at[idx, "top5_last_14d"] = float(any(item["finish"] <= 5 for item in recent_14))
        prior.append({"race_date": row["race_date"], "finish": int(row["finishing_position"])})

# --- Track-specific career stats ---
df = df.sort_values(["driver_id", "track_id", "race_date", "race_id"]).reset_index(drop=True)
tgrp = df.groupby(["driver_id", "track_id"])

df["track_starts"]      = tgrp.cumcount()
df["track_wins"]        = tgrp["win"].transform(lambda s: s.shift(1).expanding().sum())
df["track_win_rate"]    = df["track_wins"] / df["track_starts"].clip(lower=1)
df["track_avg_finish"]  = tgrp["finishing_position"].transform(
    lambda s: s.shift(1).expanding().mean())
df["track_top3_rate"]   = tgrp["top3"].transform(
    lambda s: s.shift(1).expanding().mean())

# --- Similar-track career stats ---
# Uses only prior rows for the driver, then weights those starts by the current
# track's similarity matrix. This lets a future Smoky race learn from prior 411,
# Tazewell, Cherokee, etc. form without leaking the race being predicted.
sim_rows = con.execute("""
  SELECT track_id, similar_track_id, similarity_weight
  FROM track_similars
""").fetchall()
similar_tracks = {}
for track_id, similar_track_id, weight in sim_rows:
    similar_tracks.setdefault(int(track_id), []).append((int(similar_track_id), float(weight)))
    similar_tracks.setdefault(int(similar_track_id), []).append((int(track_id), float(weight)))

df = df.sort_values(["driver_id", "race_date", "race_id", "finishing_position"]).reset_index(drop=True)
similar_starts = np.zeros(len(df), dtype=float)
similar_wins = np.zeros(len(df), dtype=float)
similar_top3 = np.zeros(len(df), dtype=float)
similar_finish_points = np.zeros(len(df), dtype=float)

for _, driver_rows in df.groupby("driver_id", sort=False):
    history_by_track = {}
    for idx, row in driver_rows.iterrows():
        weighted_starts = 0.0
        weighted_wins = 0.0
        weighted_top3 = 0.0
        weighted_finish_points = 0.0

        for similar_track_id, weight in similar_tracks.get(int(row["track_id"]), []):
            history = history_by_track.get(similar_track_id)
            if not history:
                continue
            weighted_starts += history["starts"] * weight
            weighted_wins += history["wins"] * weight
            weighted_top3 += history["top3"] * weight
            weighted_finish_points += history["finish_sum"] * weight

        similar_starts[idx] = weighted_starts
        similar_wins[idx] = weighted_wins
        similar_top3[idx] = weighted_top3
        similar_finish_points[idx] = weighted_finish_points

        track_history = history_by_track.setdefault(
            int(row["track_id"]),
            {"starts": 0.0, "wins": 0.0, "top3": 0.0, "finish_sum": 0.0},
        )
        track_history["starts"] += 1.0
        track_history["wins"] += float(row["win"])
        track_history["top3"] += float(row["top3"])
        track_history["finish_sum"] += float(row["finishing_position"])

df["similar_track_starts"] = similar_starts
df["similar_track_win_rate"] = np.where(similar_starts > 0, similar_wins / similar_starts, np.nan)
df["similar_track_top3_rate"] = np.where(similar_starts > 0, similar_top3 / similar_starts, np.nan)
df["similar_track_avg_finish"] = np.where(similar_starts > 0, similar_finish_points / similar_starts, np.nan)
df["similar_track_prior_top3"] = (similar_top3 > 0).astype(float)
df["similar_track_prior_win"] = (similar_wins > 0).astype(float)

# Re-sort chronologically for the final dataset
df = df.sort_values(["race_date", "race_id", "finishing_position"]).reset_index(drop=True)

# --- Multi-night same-track signal ---
# Prelim/night-before winners repeat far above random baseline, but most still
# do not win again. Keep this as a small no-leak signal rather than a manual
# boost: only completed races at the same track/series from the prior 1-3 days
# can influence the current row.
df["prev_same_track_win_3d"] = 0.0
df["prev_same_track_top3_3d"] = 0.0
df["days_since_same_track_win"] = np.nan
df["same_track_prior_top3"] = (df["track_top3_rate"].fillna(0) > 0).astype(float)
df["same_track_prior_win"] = (df["track_win_rate"].fillna(0) > 0).astype(float)

prior_same_track_results = {}
for idx, row in df.iterrows():
    current_date = row["race_date"]
    key = (int(row["track_id"]), int(row["driver_id"]))
    history = prior_same_track_results.get(key, [])
    recent = [
        item for item in history
        if 0 < (current_date - item["race_date"]).days <= 3
    ]
    if recent:
        df.at[idx, "prev_same_track_win_3d"] = float(any(item["finish"] == 1 for item in recent))
        df.at[idx, "prev_same_track_top3_3d"] = float(any(item["finish"] <= 3 for item in recent))
        win_days = [
            (current_date - item["race_date"]).days
            for item in recent
            if item["finish"] == 1
        ]
        if win_days:
            df.at[idx, "days_since_same_track_win"] = float(min(win_days))

    history.append({
        "race_date": current_date,
        "finish": int(row["finishing_position"]),
    })
    prior_same_track_results[key] = history

# ── 3. Tonight's pre-race context features ───────────────────────────────────
# Normalise qualifying time rank within each race (1=fastest → 0.0, last → 1.0)
df["qt_rank_norm"] = np.nan
has_qt = df["qualifying_time"].notna()
for race_id, grp in df[has_qt].groupby("race_id"):
    ranked = grp["qualifying_time"].rank(method="min")
    n = len(grp)
    df.loc[grp.index, "qt_rank_norm"] = (ranked - 1) / max(n - 1, 1)

# Normalise starting position within race (1=P1=0.0, last=1.0)
df["start_pos_norm"] = np.nan
has_sp = df["starting_position"].notna() & (df["starting_position"] > 0)
for race_id, grp in df[has_sp].groupby("race_id"):
    n = len(grp)
    df.loc[grp.index, "start_pos_norm"] = (grp["starting_position"] - 1) / max(n - 1, 1)

# Heat position normalised
df["heat_pos_norm"] = np.nan
has_hp = df["heat_position"].notna() & (df["heat_position"] > 0)
for race_id, grp in df[has_hp].groupby("race_id"):
    n = len(grp)
    df.loc[grp.index, "heat_pos_norm"] = (grp["heat_position"] - 1) / max(n - 1, 1)

# B-main path normalised. This stays separate from heat results; a B-main win is
# a transfer-path signal, not equivalent to winning a heat from the main program.
df["bmain_pos_norm"] = np.nan
df["used_bmain_path"] = 0.0
if "bmain_position" in df.columns:
    has_bmain = df["bmain_position"].notna() & (df["bmain_position"] > 0)
    df.loc[has_bmain, "used_bmain_path"] = 1.0
    for race_id, grp in df[has_bmain].groupby("race_id"):
        n = len(grp)
        df.loc[grp.index, "bmain_pos_norm"] = (grp["bmain_position"] - 1) / max(n - 1, 1)

# Distance bucket (0=sprint ≤40, 1=standard 41-70, 2=long 71-100, 3=marathon 100+)
df["dist_bucket"] = pd.cut(
    df["race_laps"].fillna(40),
    bins=[0, 40, 70, 100, 9999],
    labels=[0, 1, 2, 3]
).astype(float)

# Track length bucket (0=unknown, 1=1/4mi, 2=3/8mi, 3=1/2mi, 4=larger)
df["track_len_bucket"] = pd.cut(
    df["track_length"].fillna(0),
    bins=[-0.01, 0.01, 0.3, 0.45, 0.6, 99],
    labels=[0, 1, 2, 3, 4]
).astype(float)

# Recency: years since first race in dataset (helps model weight recent form)
df["years_since_2021"] = (df["year"] - 2021).clip(lower=0)

# Crown/Eldora recent top-3 profiles. These are most useful for crown-jewel
# style events but can also identify national big-race form without hand bumps.
def is_crown_name(name, track_name):
    text = f"{name or ''} {track_name or ''}".lower()
    return any(pattern in text for pattern in CROWN_PATTERNS)

df["is_crown_event"] = [
    is_crown_name(name, track)
    for name, track in zip(df.get("race_name", ""), df["track_name"])
] if "race_name" in df.columns else [
    is_crown_name("", track)
    for track in df["track_name"]
]
df["is_eldora_event"] = df["track_name"].astype(str).str.lower().str.contains("eldora", na=False)
df["crown_prior_top3_365d"] = 0.0
df["crown_prior_win_365d"] = 0.0
df["crown_prior_deep_top3_365d"] = 0.0
df["eldora_prior_top3_365d"] = 0.0
for _, driver_rows in df.groupby("driver_id", sort=False):
    prior = []
    for idx, row in driver_rows.sort_values(["race_date", "race_id"]).iterrows():
        recent_365 = [item for item in prior if 0 < (row["race_date"] - item["race_date"]).days <= 365]
        df.at[idx, "crown_prior_top3_365d"] = float(any(item["finish"] <= 3 and item["is_crown"] for item in recent_365))
        df.at[idx, "crown_prior_win_365d"] = float(any(item["finish"] == 1 and item["is_crown"] for item in recent_365))
        df.at[idx, "crown_prior_deep_top3_365d"] = float(any(
            item["finish"] <= 3 and item["is_crown"] and item["start"] is not None and item["start"] > 8
            for item in recent_365
        ))
        df.at[idx, "eldora_prior_top3_365d"] = float(any(item["finish"] <= 3 and item["is_eldora"] for item in recent_365))
        prior.append({
            "race_date": row["race_date"],
            "finish": int(row["finishing_position"]),
            "start": None if pd.isna(row["starting_position"]) else int(row["starting_position"]),
            "is_crown": bool(row["is_crown_event"]),
            "is_eldora": bool(row["is_eldora_event"]),
        })

# ── 4. Aggregate driver intelligence snapshot ─────────────────────────────────
# These inputs come from imported driver_model_metrics. They are intentionally
# compressed with log1p because career count totals are strong priors, not direct
# race-night evidence.
metric_params = [SERIES]
metric_where = "series = ?"
if CROWN_JEWEL:
    metric_params = ["WoO Late Models", "Lucas Oil LMDS"]
    metric_where = "series IN (?, ?)"

metric_df = pd.read_sql_query(f"""
  SELECT
    driver_id,
    series AS metric_series,
    last5_avg_finish AS agg_last5_avg_finish,
    avg_finish AS agg_avg_finish,
    avg_start AS agg_avg_start,
    avg_qual_position AS agg_avg_qual_position,
    quick_times AS agg_quick_times,
    qual_attempts AS agg_qual_attempts,
    feature_wins,
    laps_led_per_win,
    top5s,
    top10s,
    laps_led AS agg_laps_led,
    hard_charger_count,
    heat_wins AS agg_heat_wins
  FROM driver_model_metrics
  WHERE {metric_where}
""", con, params=tuple(metric_params))

if len(metric_df) > 0:
    if CROWN_JEWEL:
        metric_df["metric_strength"] = (
            metric_df["feature_wins"].fillna(0)
            + metric_df["top5s"].fillna(0) * 0.25
            + metric_df["agg_laps_led"].fillna(0) * 0.01
        )
        metric_df = (
            metric_df.sort_values(["driver_id", "metric_strength"], ascending=[True, False])
            .drop_duplicates("driver_id")
            .drop(columns=["metric_strength"])
        )
    df = df.merge(metric_df.drop(columns=["metric_series"], errors="ignore"), on="driver_id", how="left")
else:
    for c in [
        "agg_last5_avg_finish", "agg_avg_finish", "agg_avg_start",
        "agg_avg_qual_position", "agg_quick_times", "agg_qual_attempts",
        "feature_wins", "laps_led_per_win", "top5s", "top10s",
        "agg_laps_led", "hard_charger_count", "agg_heat_wins"
    ]:
        df[c] = np.nan

for c in ["feature_wins", "top5s", "top10s", "agg_laps_led", "hard_charger_count", "agg_heat_wins"]:
    df[f"log_{c}"] = np.log1p(df[c].fillna(0))
df["agg_qual_rate"] = np.where(
    df["agg_qual_attempts"].fillna(0) > 0,
    df["agg_quick_times"].fillna(0) / df["agg_qual_attempts"].replace(0, np.nan),
    np.nan,
)

def track_size_label(length):
    if pd.isna(length) or length <= 0:
        return None
    known = {
        0.25: "1/4",
        0.30: "3/10",
        1 / 3: "1/3",
        0.375: "3/8",
        0.40: "4/10",
        0.4375: "7/16",
        0.50: "1/2",
        0.625: "5/8",
    }
    return min(known.items(), key=lambda item: abs(item[0] - length))[1]

track_size_params = [SERIES]
track_size_where = "series = ?"
if CROWN_JEWEL:
    track_size_params = ["WoO Late Models", "Lucas Oil LMDS"]
    track_size_where = "series IN (?, ?)"

track_size_df = pd.read_sql_query(f"""
  SELECT driver_id, track_size, wins
  FROM driver_track_size_wins
  WHERE {track_size_where}
""", con, params=tuple(track_size_params))

if len(track_size_df) > 0:
    track_size_lookup = {
        (int(r.driver_id), str(r.track_size)): float(r.wins)
        for r in track_size_df.itertuples(index=False)
    }
    df["track_size_label"] = df["track_length"].apply(track_size_label)
    df["aggregate_track_size_wins"] = [
        track_size_lookup.get((int(driver_id), label), 0.0) if label else 0.0
        for driver_id, label in zip(df["driver_id"], df["track_size_label"])
    ]
else:
    df["aggregate_track_size_wins"] = 0.0

df["log_aggregate_track_size_wins"] = np.log1p(df["aggregate_track_size_wins"])

# ── 5. Equipment profile features ─────────────────────────────────────────────
equipment_df = pd.read_sql_query("""
  SELECT
    driver_id,
    chassis_family,
    engine_family,
    shock_family
  FROM driver_equipment_profiles
""", con)
con.close()

if len(equipment_df) > 0:
    df = df.merge(equipment_df, on="driver_id", how="left")
else:
    df["chassis_family"] = np.nan
    df["engine_family"] = np.nan
    df["shock_family"] = np.nan

for value in ["Longhorn", "Rocket"]:
    df[f"chassis_{value.lower().replace(' ', '_')}"] = (df["chassis_family"] == value).astype(float)

for value in ["Clements", "Cornett", "Durham", "Vic Hill"]:
    df[f"engine_{value.lower().replace(' ', '_')}"] = (df["engine_family"] == value).astype(float)

for value in ["Ohlins", "Bilstein", "Penske", "Integra"]:
    df[f"shock_{value.lower().replace(' ', '_')}"] = (df["shock_family"] == value).astype(float)

# ── 4. Feature matrix ─────────────────────────────────────────────────────────
FEATURES = [
    # Career overall
    "career_starts", "career_win_rate", "career_avg_finish", "career_top3_rate",
    # Rolling form
    "last5_avg_finish", "last10_avg_finish", "last5_win_rate", "streak_top3",
    "recent_wins_3", "recent_wins_5", "recent_podiums_3",
    "won_last_7d", "won_last_14d", "podium_last_14d", "top5_last_14d",
    "last_start_was_win", "last_start_was_podium", "finished_top5_last_start",
    "prior_deep_start_top3_count", "prior_deep_start_win_count",
    "prior_plus_minus_avg", "last5_plus_minus_avg",
    # Track-specific
    "track_starts", "track_win_rate", "track_avg_finish", "track_top3_rate",
    "same_track_prior_win", "same_track_prior_top3",
    # Similar-track profile, using the track similarity matrix
    "similar_track_starts", "similar_track_win_rate", "similar_track_top3_rate",
    "similar_track_avg_finish", "similar_track_prior_win", "similar_track_prior_top3",
    # Big-race recent profile
    "crown_prior_top3_365d", "crown_prior_win_365d",
    "crown_prior_deep_top3_365d", "eldora_prior_top3_365d",
    # Multi-night same-track signal
    "prev_same_track_win_3d", "prev_same_track_top3_3d", "days_since_same_track_win",
    # Tonight's context (may be NaN if not yet entered)
    "start_pos_norm", "heat_pos_norm", "bmain_pos_norm", "used_bmain_path", "qt_rank_norm",
    # Race context
    "dist_bucket", "track_len_bucket", "years_since_2021",
    # Imported aggregate driver-intelligence snapshot
    "agg_last5_avg_finish", "agg_avg_finish", "agg_avg_start",
    "agg_avg_qual_position", "agg_qual_rate", "laps_led_per_win",
    "log_feature_wins", "log_top5s", "log_top10s", "log_agg_laps_led",
    "log_hard_charger_count", "log_agg_heat_wins", "log_aggregate_track_size_wins",
    # Imported driver equipment profile
    "chassis_longhorn", "chassis_rocket",
    "engine_clements", "engine_cornett", "engine_durham", "engine_vic_hill",
    "shock_ohlins", "shock_bilstein", "shock_penske", "shock_integra",
]

# Drop rows where we have NO history at all (first race in dataset is untrainable)
df_model = df[df["career_starts"] >= 1].copy()
print(f"  Training rows after filtering first-race entries: {len(df_model)}")

X = df_model[FEATURES].astype(float)
y = df_model["win"]

print(f"  Win rate in dataset: {y.mean():.3f}  (field avg {1/df_model['field_size'].mean():.3f})")

# ── 5. Train / evaluate ───────────────────────────────────────────────────────
requested_engine = os.environ.get("DIRTIQ_MODEL_ENGINE", "auto").lower()
model_engine = "sklearn_hist_gradient_boosting"
model_algorithm = "HistGradientBoostingClassifier"

print("\nTraining boost model…")

# Time-based split: train on 2021-2024, test on 2025+
train_mask = df_model["year"] <= 2024
test_mask  = df_model["year"] >= 2025

X_train, y_train = X[train_mask], y[train_mask]
X_test,  y_test  = X[test_mask],  y[test_mask]

print(f"  Train: {train_mask.sum()} rows ({y_train.mean():.3f} win rate)")
print(f"  Test:  {test_mask.sum()} rows  ({y_test.mean():.3f} win rate)")

# Class imbalance: ~1 winner per ~25 finishers → scale_pos_weight
spw = (y_train == 0).sum() / (y_train == 1).sum()

if requested_engine in ("auto", "xgboost", "xgb"):
    try:
        from xgboost import XGBClassifier

        model = XGBClassifier(
            n_estimators=700,
            max_depth=4,
            learning_rate=0.035,
            subsample=0.85,
            colsample_bytree=0.85,
            min_child_weight=2,
            reg_lambda=2.0,
            objective="binary:logistic",
            eval_metric="logloss",
            scale_pos_weight=spw,
            random_state=42,
            n_jobs=4,
            tree_method="hist",
            missing=np.nan,
        )
        model_engine = "xgboost"
        model_algorithm = "XGBClassifier"
    except Exception as exc:
        if requested_engine in ("xgboost", "xgb"):
            raise
        print(f"  XGBoost unavailable, using sklearn fallback: {exc}")
        model = None
else:
    model = None

if model is None:
    # HistGradientBoostingClassifier handles NaN natively (no imputation needed),
    # trains fast on this dataset size, and has no external OpenMP runtime dependency.
    model = HistGradientBoostingClassifier(
        max_iter          = 400,
        max_depth         = 4,
        learning_rate     = 0.05,
        min_samples_leaf  = 5,
        early_stopping    = True,
        validation_fraction = 0.1,
        n_iter_no_change  = 30,
        random_state      = 42,
    )

print(f"  Engine: {model_engine} ({model_algorithm})")

model.fit(X_train, y_train)

# ── 6. Evaluate ───────────────────────────────────────────────────────────────
print("\n=== Evaluation ===")

y_pred_train = model.predict_proba(X_train)[:, 1]
y_pred_test  = model.predict_proba(X_test)[:, 1]

print(f"  Train AUC:     {roc_auc_score(y_train, y_pred_train):.4f}")
print(f"  Test  AUC:     {roc_auc_score(y_test,  y_pred_test):.4f}")
print(f"  Train logloss: {log_loss(y_train, y_pred_train):.4f}")
print(f"  Test  logloss: {log_loss(y_test,  y_pred_test):.4f}")

# Per-race top-1 accuracy: did the driver with highest predicted P(win) actually win?
test_df = df_model[test_mask].copy()
test_df["pred_prob"] = y_pred_test

top1_correct = 0
total_races  = 0
top3_in_actual_top3 = 0

for race_id, grp in test_df.groupby("race_id"):
    if grp["win"].sum() != 1:
        continue  # skip races without exactly 1 winner recorded
    total_races += 1
    predicted_winner = grp.loc[grp["pred_prob"].idxmax(), "driver_id"]
    actual_winner    = grp.loc[grp["win"].idxmax(),       "driver_id"]
    if predicted_winner == actual_winner:
        top1_correct += 1
    # Top-3 overlap
    pred_top3   = set(grp.nlargest(3, "pred_prob")["driver_id"])
    actual_top3 = set(grp.nsmallest(3, "finishing_position")["driver_id"])
    top3_in_actual_top3 += len(pred_top3 & actual_top3)

print(f"\n  Per-race top-1 accuracy: {top1_correct}/{total_races} = {top1_correct/total_races:.1%}")
print(f"  Avg top-3 overlap:       {top3_in_actual_top3/total_races:.2f}/3.0")
baseline = 1 / df_model[test_mask]["field_size"].mean()
print(f"  Baseline (random):       {baseline:.1%} win / {3*baseline:.1%} top-3")

# ── 7. Feature importance ─────────────────────────────────────────────────────
if os.environ.get("DIRTIQ_SKIP_IMPORTANCE") == "1":
    print("\nFeature importance skipped (DIRTIQ_SKIP_IMPORTANCE=1).")
else:
    print("\nFeature importance (permutation on test set):")
    from sklearn.inspection import permutation_importance
    repeats = int(os.environ.get("DIRTIQ_IMPORTANCE_REPEATS", "5"))
    perm = permutation_importance(model, X_test, y_test, n_repeats=repeats, random_state=42, scoring="roc_auc")
    for feat, imp in sorted(zip(FEATURES, perm.importances_mean), key=lambda x: -x[1]):
        if imp < 0.0001: continue
        bar = "█" * int(imp * 500)
        print(f"  {feat:<28} {imp:.4f}  {bar}")

# ── 8. Export model ───────────────────────────────────────────────────────────
import pickle
import re

series_slug = re.sub(r"[^a-z0-9]+", "_", SERIES.lower()).strip("_")
model_path  = ROOT / "data" / f"dirtiq_model_{series_slug}.pkl"
params_path = ROOT / "data" / f"feature_params_{series_slug}.json"

with open(model_path, "wb") as f:
    pickle.dump(model, f)

with open(params_path, "w") as f:
    json.dump({
        "features": FEATURES,
        "version":  "1.0",
        "model_engine": model_engine,
        "model_algorithm": model_algorithm,
        "requested_engine": requested_engine,
        "trained_on": f"{SERIES} 2021-2024",
        "test_auc":   round(roc_auc_score(y_test, y_pred_test), 4),
        "train_auc":  round(roc_auc_score(y_train, y_pred_train), 4),
        "test_logloss": round(log_loss(y_test, y_pred_test), 4),
        "top1_acc":   round(top1_correct / total_races, 4),
        "n_train":    int(train_mask.sum()),
        "n_test":     int(test_mask.sum()),
        "series": SERIES,
    }, f, indent=2)

print(f"\nModel saved → {model_path}")
print(f"Params saved → {params_path}")
