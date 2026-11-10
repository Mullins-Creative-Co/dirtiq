"""Rolling-origin backtest by season: train through year t-1, test year t.

For every fold the conditional logit, the boosted-softmax candidate, the
legacy-method baseline (legacy XGBoost hyperparameters + legacy normalizer on
the same leak-free features), a form-only baseline and the uniform baseline
are fitted on identical training races and scored on identical test races.
Writes ``public/data/racing-model-report.json``.
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

from .. import scoring
from ..ledger_core import now_iso
from . import MODEL_ID, MODEL_VERSION
from .data import ROOT, RacingData, SERIES_SLUGS, load_dataset, resolve_series, series_pool_mask
from .features import build_features, features_for_stage, race_night_coverage
from .model import VARIANTS, ConditionalLogit, apply_temperature

REPORT_PATH = ROOT / "public" / "data" / "racing-model-report.json"
SERIES_ORDER = ["Lucas Oil LMDS", "WoO Late Models", "DIRTcar Summer Nationals", "Crown Jewel / Combined"]
STAGES = ["early", "race-night"]
VARIANT_ORDER = ["cl", "boosted", "legacy-method", "form-only", "uniform"]
CANDIDATES = ["cl", "boosted"]
MIN_TEST_RACES = 15
MIN_TRAIN_RACES = 30
TEMPERATURE_BOUNDS = (0.5, 3.0)
TEMPERATURE_DEADBAND = 0.02   # |T - 1| below this keeps T = 1
FAVORITE_THRESHOLD = 0.5

LIMITATIONS = [
    "Backtest folds are rolling by season; seasons with fewer than 15 test races (and the first season of every series) are not scored.",
    "Source coverage is incomplete: audited race exclusions from public/data/data-quality.json are applied before training and scoring.",
    "Crown Jewel / Combined pools crown-named WoO and Lucas races, so those races are scored by two series models; the pooled rows use the router's choice only.",
    "The legacy-method baseline is the legacy algorithm refitted on leak-free features per fold, not the shipped legacy artifacts, which carried snapshot tables with no as-of date.",
    "B-main positions are nearly absent in history, so bmain features are effectively missing indicators.",
    "Early-stage favorites priced above 50% are overconfident in the raw backtest (pooled bins >= 0.5: predicted ~0.57, observed ~0.29 over ~50 races). A per-(series, stage) temperature fitted on the out-of-fold predictions (calibrationTemperature) is applied at scoring time; it rests on few favorite races, so treat heavy early-stage favorites with caution until the ledger confirms them.",
    "The first WoO fold (test 2022) trains on only 36 races and the conditional logit scores worse than uniform there; production artifacts train on 99-255 races per series.",
    "No backtest number is a claim of a live edge; the forecast ledger is the only place a live claim can come from.",
]


def season_folds(years: Sequence[int], min_test: int = MIN_TEST_RACES, min_train: int = MIN_TRAIN_RACES) -> List[Dict[str, Any]]:
    """Fold boundaries from one year per race: test year t, train strictly earlier years."""
    arr = np.asarray(list(years), dtype=int)
    folds = []
    for t in sorted(set(arr.tolist())):
        n_test = int((arr == t).sum())
        n_train = int((arr < t).sum())
        if n_test >= min_test and n_train >= min_train:
            folds.append({"season": int(t), "trainYears": sorted(set(arr[arr < t].tolist())),
                          "trainRaces": n_train, "testRaces": n_test})
    return folds


def trainable_pool(feat: pd.DataFrame, races: pd.DataFrame, series: str, stage: str) -> pd.DataFrame:
    """Completed races in the series pool with one winner; race-night stage applies the coverage rule."""
    pool_ids = set(races.loc[series_pool_mask(races, series) & (races["status"] == "complete"), "race_id"])
    rows = feat[feat["race_id"].isin(pool_ids) & (feat["status"] == "complete")]
    g = rows.groupby("race_id")["won"]
    ok = (g.transform("sum") == 1) & (g.transform("size") >= 3)
    rows = rows[ok.to_numpy()]
    if stage == "race-night":
        cov = race_night_coverage(rows)
        rows = rows[rows["race_id"].isin(cov.index[cov["race_night"]])]
    return rows.reset_index(drop=True)


def run_fold(pool: pd.DataFrame, season: int, features: List[str], variants: Sequence[str]) -> pd.DataFrame:
    train = pool[pool["year"] < season]
    test = pool[pool["year"] == season]
    out = test[["race_id", "driver_id", "race_date", "year", "finishing_position", "won"]].copy()
    out["season"] = season
    for name in variants:
        m = VARIANTS[name](features).fit(train)
        out[f"p_{name}"] = m.predict_win(test)
    return out


def summarize(results: pd.DataFrame, col: str) -> Dict[str, Any]:
    """Per-race multinomial log loss, top-1, top-3 overlap; per-entry Brier and ECE."""
    if results.empty:
        return {"races": 0, "entries": 0, "logLoss": None, "top1": None, "top3Overlap": None, "brier": None, "ece": None, "calibration": []}
    ll: List[float] = []
    top1: List[float] = []
    top3: List[float] = []
    for _, race in results.groupby("race_id", sort=False):
        p = race[col].to_numpy(dtype=float)
        fp = race["finishing_position"].to_numpy(dtype=float)
        won = race["won"].to_numpy(dtype=float)
        if won.sum() != 1:
            continue
        ll.append(scoring.multinomial_log_loss(p.tolist(), int(np.argmax(won))))
        top1.append(1.0 if np.argmax(p) == np.argmax(won) else 0.0)
        pred3 = set(np.argsort(-p, kind="stable")[:3].tolist())
        actual3 = set(np.argsort(fp, kind="stable")[:3].tolist())
        top3.append(float(len(pred3 & actual3)))
    pairs = list(zip(results[col].to_numpy(dtype=float).tolist(), results["won"].to_numpy(dtype=int).tolist()))
    bins = scoring.calibration_bins(pairs)
    ece = scoring.expected_calibration_error(bins)
    return {
        "races": len(ll),
        "entries": int(len(results)),
        "logLoss": round(float(np.mean(ll)), 4) if ll else None,
        "top1": round(float(np.mean(top1)), 4) if top1 else None,
        "top3Overlap": round(float(np.mean(top3)), 4) if top3 else None,
        "brier": round(float(np.mean([scoring.brier(p, y) for p, y in pairs])), 5) if pairs else None,
        "ece": round(float(ece), 4) if ece is not None else None,
        "calibration": bins,
    }


def _mean_race_log_loss(prob: np.ndarray, won: np.ndarray) -> float:
    """Mean per-race multinomial log loss; ``won`` marks exactly one winner per race."""
    p = np.clip(np.asarray(prob, dtype=float)[np.asarray(won).astype(bool)], scoring.EPS, None)
    return float(-np.mean(np.log(p))) if len(p) else float("nan")


def fit_temperature(prob: np.ndarray, race_ids: np.ndarray, won: np.ndarray,
                    bounds: Tuple[float, float] = TEMPERATURE_BOUNDS, deadband: float = TEMPERATURE_DEADBAND) -> float:
    """Temperature T minimizing the out-of-fold multinomial log loss of softmax(log p / T).

    Scores divided by T > 1 flatten the field (shrink favorites); T < 1 sharpens
    it. Bounded search; T within ``deadband`` of 1 is reported as exactly 1.
    """
    prob = np.asarray(prob, dtype=float)
    race_ids = np.asarray(race_ids)
    won = np.asarray(won, dtype=float)
    if won.sum() == 0:
        return 1.0
    res = minimize_scalar(lambda t: _mean_race_log_loss(apply_temperature(prob, race_ids, t), won),
                          bounds=bounds, method="bounded", options={"xatol": 1e-4})
    t = float(res.x)
    if abs(t - 1.0) < deadband:
        t = 1.0
    return round(t, 4)


def favorites_bin(prob: np.ndarray, won: np.ndarray, threshold: float = FAVORITE_THRESHOLD) -> Dict[str, Any]:
    """Predicted mean and observed win rate for entrants priced at or above ``threshold``."""
    prob = np.asarray(prob, dtype=float)
    won = np.asarray(won, dtype=float)
    m = prob >= threshold
    n = int(m.sum())
    return {"threshold": threshold, "n": n,
            "predicted": round(float(prob[m].mean()), 4) if n else None,
            "observed": round(float(won[m].mean()), 4) if n else None}


def temperature_block(results: pd.DataFrame, before_col: str, after_col: str,
                      temperature: Optional[float], source: str) -> Dict[str, Any]:
    """Before/after calibration diagnostics for the report (log loss, ECE, >= 0.5 bin, reliability bins)."""
    before = summarize(results, before_col)
    after = summarize(results, after_col)
    won = results["won"].to_numpy(dtype=float)
    return {
        "temperature": temperature,
        "bounds": list(TEMPERATURE_BOUNDS),
        "deadband": TEMPERATURE_DEADBAND,
        "fittedOn": source,
        "races": before["races"],
        "logLossBefore": before["logLoss"],
        "logLossAfter": after["logLoss"],
        "eceBefore": before["ece"],
        "eceAfter": after["ece"],
        "favoritesBefore": favorites_bin(results[before_col].to_numpy(dtype=float), won),
        "favoritesAfter": favorites_bin(results[after_col].to_numpy(dtype=float), won),
        "calibrationAfter": after["calibration"],
    }


def _variant_key(name: str) -> str:
    return {"cl": "cl", "boosted": "boosted", "legacy-method": "legacy", "form-only": "formOnly", "uniform": "uniform"}[name]


def series_entry(series: str, stage: str, results: pd.DataFrame, variants: Sequence[str],
                 folds: List[Dict[str, Any]], feature_weights: List[Dict[str, float]],
                 pooled: bool = False) -> Dict[str, Any]:
    """Report entry for one (series, stage). Adds ``p_chosen`` / ``p_calibrated`` columns to ``results`` in place."""
    per_variant = {v: summarize(results, f"p_{v}") for v in variants}
    candidates = [v for v in CANDIDATES if v in per_variant and per_variant[v]["logLoss"] is not None]
    chosen = min(candidates, key=lambda v: per_variant[v]["logLoss"]) if candidates else "cl"
    main = per_variant[chosen]
    race_ids = results["race_id"].to_numpy()
    won = results["won"].to_numpy(dtype=float)
    if pooled:
        # routed rows already carry each series' own calibrated probability
        temperature: Optional[float] = None
        source = "per-series temperatures applied to each routed race (fit on out-of-fold predictions only)"
    else:
        results["p_chosen"] = results[f"p_{chosen}"].to_numpy(dtype=float)
        temperature = fit_temperature(results["p_chosen"].to_numpy(), race_ids, won)
        results["p_calibrated"] = apply_temperature(results["p_chosen"].to_numpy(), race_ids, temperature)
        source = "out-of-fold backtest predictions of the chosen variant only (never the training fold)"
    calibration = temperature_block(results, "p_chosen", "p_calibrated", temperature, source)
    by_season = []
    for season, rows in results.groupby("season", sort=True):
        row = {"season": int(season), "races": int(rows["race_id"].nunique())}
        for v in variants:
            s = summarize(rows, f"p_{v}")
            key = _variant_key(v)
            row[f"{key}LogLoss"] = s["logLoss"]
            row[f"{key}Top1"] = s["top1"]
        row["logLoss"] = row[f"{_variant_key(chosen)}LogLoss"]
        row["top1"] = row[f"{_variant_key(chosen)}Top1"]
        by_season.append(row)
    entry: Dict[str, Any] = {
        "series": series,
        "slug": SERIES_SLUGS.get(series, series.lower().replace(" ", "_")),
        "stage": stage,
        "variant": chosen,
        "selectionRule": "min held-out multinomial log loss over cl and boosted",
        "races": main["races"],
        "entries": main["entries"],
        "seasons": [f["season"] for f in folds],
        "folds": folds,
        "logLoss": main["logLoss"],
        "top1": main["top1"],
        "top3Overlap": main["top3Overlap"],
        "brier": main["brier"],
        "ece": main["ece"],
        "calibration": main["calibration"],
        "calibrationTemperature": calibration,
        "bySeason": by_season,
        "features": feature_weights,
        "variants": {v: {k: per_variant[v][k] for k in ("logLoss", "top1", "top3Overlap", "brier", "ece")} for v in variants},
    }
    for v in variants:
        key = _variant_key(v)
        entry[f"{key}LogLoss"] = per_variant[v]["logLoss"]
        entry[f"{key}Top1"] = per_variant[v]["top1"]
        entry[f"{key}Top3Overlap"] = per_variant[v]["top3Overlap"]
    return entry


def run_backtest(data: Optional[RacingData] = None, feat: Optional[pd.DataFrame] = None,
                 series_list: Optional[Sequence[str]] = None, stages: Sequence[str] = STAGES,
                 variants: Sequence[str] = VARIANT_ORDER, out_path: Optional[Path] = REPORT_PATH,
                 verbose: bool = True) -> Dict[str, Any]:
    t0 = time.time()
    if data is None:
        data = load_dataset()
    if feat is None:
        feat = build_features(data)
    series_list = list(series_list or SERIES_ORDER)
    entries: List[Dict[str, Any]] = []
    results_by: Dict[Tuple[str, str], pd.DataFrame] = {}
    notes: List[str] = []

    for stage in stages:
        features = features_for_stage(stage)
        for series in series_list:
            pool = trainable_pool(feat, data.races, series, stage)
            years_per_race = pool.drop_duplicates("race_id")["year"].tolist()
            folds = season_folds(years_per_race)
            if not folds:
                notes.append(f"{series} [{stage}]: no season with >= {MIN_TEST_RACES} test races and >= {MIN_TRAIN_RACES} train races ({len(years_per_race)} races)")
                continue
            parts = []
            for fold in folds:
                t1 = time.time()
                parts.append(run_fold(pool, fold["season"], features, variants))
                if verbose:
                    print(f"  {series} [{stage}] season {fold['season']}: train {fold['trainRaces']} / test {fold['testRaces']} races ({time.time() - t1:.1f}s)")
            results = pd.concat(parts, ignore_index=True)
            results_by[(series, stage)] = results
            cl_full = ConditionalLogit(features).fit(pool)
            weights = sorted(cl_full.feature_weights(), key=lambda r: -abs(r["weight"]))
            entry = series_entry(series, stage, results, variants, folds, weights)
            entries.append(entry)
            if verbose:
                print(f"{series} [{stage}] -> {entry['variant']}  " + "  ".join(
                    f"{v}={entry['variants'][v]['logLoss']}" for v in variants))

        # pooled rows use the router's series for every race
        routed = {int(r["race_id"]): resolve_series(r)[0] for _, r in data.races.iterrows()}
        pooled_parts = []
        for (series, st), res in results_by.items():
            if st != stage:
                continue
            keep = res["race_id"].map(lambda rid: routed.get(int(rid)) == series)
            pooled_parts.append(res[keep.to_numpy()])
        if pooled_parts:
            pooled = pd.concat(pooled_parts, ignore_index=True)
            if len(pooled):
                folds = season_folds(pooled.drop_duplicates("race_id")["year"].tolist(), min_test=1, min_train=0)
                entries.append(series_entry("Pooled (routed)", stage, pooled, variants, folds, [], pooled=True))
                entries[-1]["slug"] = "pooled"

    report = {
        "generatedAt": now_iso(),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "method": ("rolling-origin by season: train through year t-1, test year t; every variant fitted per fold on identical races. "
                   "calibrationTemperature: one temperature per (series, stage) chosen by minimizing the multinomial log loss of "
                   "softmax(score / T) on the out-of-fold backtest predictions only (bounded [0.5, 3]; T within 0.02 of 1 is kept at 1); "
                   "it is applied at scoring time and never fitted on the training fold"),
        "raceNightRule": {"starting_position": 0.70, "heat_or_qualifying": 0.50},
        "variants": {
            "cl": "conditional logit (Plackett-Luce winner), L2, standardized as-of features with missing indicators",
            "boosted": "XGBoost binary score (depth 3, 300 trees, eta 0.03, min_child_weight 10, early stopping) -> per-race temperature softmax",
            "legacy-method": "legacy XGBoost hyperparameters (700 trees, depth 4) + power 0.65 / cap 0.45 normalizer on the same leak-free features",
            "form-only": "softmax of -scale * last-10 average finish, scale fitted on the training fold",
            "uniform": "1 / field size",
        },
        "series": entries,
        "notes": notes,
        "limitations": LIMITATIONS,
        "runtimeSeconds": round(time.time() - t0, 1),
    }
    if out_path is not None:
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(report, indent=1))
        tmp.replace(out_path)
        if verbose:
            print(f"wrote {out_path} ({report['runtimeSeconds']}s)")
    return report


def chosen_variants(report: Dict[str, Any]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """(series, stage) -> report entry, for train.py and score.py metadata."""
    return {(e["series"], e["stage"]): e for e in report.get("series", []) if e.get("slug") != "pooled"}


def format_table(report: Dict[str, Any]) -> str:
    cols = ["series", "stage", "races", "variant", "cl", "boosted", "legacy", "formOnly", "uniform", "top1", "legacyTop1", "top3", "ece",
            "T", "llAfter", "eceAfter", "fav>=.5 before", "fav>=.5 after"]
    lines = [" | ".join(cols)]
    for e in report.get("series", []):
        c = e.get("calibrationTemperature") or {}
        fb, fa = c.get("favoritesBefore") or {}, c.get("favoritesAfter") or {}
        lines.append(" | ".join(str(x) for x in [
            e["series"], e["stage"], e["races"], e["variant"], e.get("clLogLoss"), e.get("boostedLogLoss"),
            e.get("legacyLogLoss"), e.get("formOnlyLogLoss"), e.get("uniformLogLoss"), e.get("top1"),
            e.get("legacyTop1"), e.get("top3Overlap"), e.get("ece"),
            c.get("temperature"), c.get("logLossAfter"), c.get("eceAfter"),
            f"n={fb.get('n')} {fb.get('predicted')}/{fb.get('observed')}",
            f"n={fa.get('n')} {fa.get('predicted')}/{fa.get('observed')}"]))
    return "\n".join(lines)
