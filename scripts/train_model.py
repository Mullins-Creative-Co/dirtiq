"""
train_model.py
==============
Trains an XGBoost win-probability model on historical WoO Late Model results.

Feature engineering uses only data available BEFORE each race to prevent leakage:
  - Career track history (wins, avg finish) at this specific track
  - Career stats at all tracks (overall win rate, avg finish)
  - Rolling last-5 and last-10 form windows
  - Tonight's starting position, heat position, qual rank (when available)
  - Race distance bucket

Output:
  data/dirtiq_model.json    — XGBoost model (JSON format, loadable by Node.js)
  data/feature_params.json  — feature list + metadata for the predict script

Usage:
  python3 scripts/train_model.py
"""

import sqlite3
import json
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, log_loss
import warnings
warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent
DB   = ROOT / "data" / "dirtiq.db"

# ── 1. Load raw data ──────────────────────────────────────────────────────────
print("Loading data from DB…")
con = sqlite3.connect(DB)

df = pd.read_sql_query("""
  SELECT
    r.id            AS race_id,
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
    re.laps_led,
    re.dnf,
    re.money
  FROM race_entries re
  JOIN races r  ON r.id  = re.race_id
  JOIN tracks t ON t.id  = r.track_id
  JOIN drivers d ON d.id = re.driver_id
  WHERE r.status = 'complete'
    AND re.finishing_position IS NOT NULL
    AND re.dnf = 0
  ORDER BY r.race_date, r.id, re.finishing_position
""", con)
con.close()

print(f"  {len(df)} entries across {df['race_id'].nunique()} races, "
      f"{df['driver_id'].nunique()} drivers, {df['track_id'].nunique()} tracks")

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

# Re-sort chronologically for the final dataset
df = df.sort_values(["race_date", "race_id", "finishing_position"]).reset_index(drop=True)

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

# ── 4. Feature matrix ─────────────────────────────────────────────────────────
FEATURES = [
    # Career overall
    "career_starts", "career_win_rate", "career_avg_finish", "career_top3_rate",
    # Rolling form
    "last5_avg_finish", "last10_avg_finish", "last5_win_rate", "streak_top3",
    # Track-specific
    "track_starts", "track_win_rate", "track_avg_finish", "track_top3_rate",
    # Tonight's context (may be NaN if not yet entered)
    "start_pos_norm", "heat_pos_norm", "qt_rank_norm",
    # Race context
    "dist_bucket", "track_len_bucket", "years_since_2021",
]

# Drop rows where we have NO history at all (first race in dataset is untrainable)
df_model = df[df["career_starts"] >= 1].copy()
print(f"  Training rows after filtering first-race entries: {len(df_model)}")

X = df_model[FEATURES].astype(float)
y = df_model["win"]

print(f"  Win rate in dataset: {y.mean():.3f}  (field avg {1/df_model['field_size'].mean():.3f})")

# ── 5. Train / evaluate ───────────────────────────────────────────────────────
print("\nTraining XGBoost model…")

# Time-based split: train on 2021-2024, test on 2025+
train_mask = df_model["year"] <= 2024
test_mask  = df_model["year"] >= 2025

X_train, y_train = X[train_mask], y[train_mask]
X_test,  y_test  = X[test_mask],  y[test_mask]

print(f"  Train: {train_mask.sum()} rows ({y_train.mean():.3f} win rate)")
print(f"  Test:  {test_mask.sum()} rows  ({y_test.mean():.3f} win rate)")

# Class imbalance: ~1 winner per ~25 finishers → scale_pos_weight
spw = (y_train == 0).sum() / (y_train == 1).sum()

# HistGradientBoostingClassifier handles NaN natively (no imputation needed),
# trains fast on this dataset size, and is pure Python (no OpenMP dep).
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
print("\nFeature importance (permutation on test set):")
from sklearn.inspection import permutation_importance
perm = permutation_importance(model, X_test, y_test, n_repeats=5, random_state=42, scoring="roc_auc")
for feat, imp in sorted(zip(FEATURES, perm.importances_mean), key=lambda x: -x[1]):
    if imp < 0.0001: continue
    bar = "█" * int(imp * 500)
    print(f"  {feat:<28} {imp:.4f}  {bar}")

# ── 8. Export model ───────────────────────────────────────────────────────────
import pickle

model_path  = ROOT / "data" / "dirtiq_model.pkl"
params_path = ROOT / "data" / "feature_params.json"

with open(model_path, "wb") as f:
    pickle.dump(model, f)

with open(params_path, "w") as f:
    json.dump({
        "features": FEATURES,
        "version":  "1.0",
        "trained_on": "WoO Late Models 2021-2024",
        "test_auc":   round(roc_auc_score(y_test, y_pred_test), 4),
        "top1_acc":   round(top1_correct / total_races, 4),
        "n_train":    int(train_mask.sum()),
        "n_test":     int(test_mask.sum()),
    }, f, indent=2)

print(f"\nModel saved → {model_path}")
print(f"Params saved → {params_path}")
