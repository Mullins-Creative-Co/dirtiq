"""Fit production artifacts on all eligible history per series and stage.

Writes ``data/dirtiq_model_pl_<slug>.pkl`` (``_race_night`` for the race-night
stage) and ``data/feature_params_pl_<slug>.json``. The variant per series and
stage comes from the backtest report unless overridden.
"""
from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd

from ..ledger_core import now_iso
from . import MODEL_ID, MODEL_VERSION
from .backtest import REPORT_PATH, SERIES_ORDER, STAGES, chosen_variants, trainable_pool
from .data import RacingData, SERIES_SLUGS, load_dataset, model_dir
from .features import FEATURES, build_features, features_for_stage
from .model import VARIANTS

RACE_NIGHT_MIN_RACES = 40


def artifact_slug(series: str, stage: str) -> str:
    base = SERIES_SLUGS[series]
    return f"{base}_race_night" if stage == "race-night" else base


def artifact_paths(series: str, stage: str, directory: Optional[Path] = None) -> Dict[str, Path]:
    directory = Path(directory) if directory is not None else model_dir()
    s = artifact_slug(series, stage)
    return {"model": directory / f"dirtiq_model_pl_{s}.pkl", "params": directory / f"feature_params_pl_{s}.json"}


def load_report(path: Path = REPORT_PATH) -> Dict[str, Any]:
    if Path(path).exists():
        try:
            return json.loads(Path(path).read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def train_one(feat: pd.DataFrame, data: RacingData, series: str, stage: str, variant: str,
              backtest_entry: Optional[Dict[str, Any]] = None, directory: Optional[Path] = None) -> Dict[str, Any]:
    pool = trainable_pool(feat, data.races, series, stage)
    features = features_for_stage(stage)
    n_races = int(pool["race_id"].nunique())
    if n_races < 5:
        raise ValueError(f"{series} [{stage}]: only {n_races} eligible races")
    model = VARIANTS[variant](features).fit(pool)
    paths = artifact_paths(series, stage, directory)
    paths["model"].parent.mkdir(parents=True, exist_ok=True)
    bt = backtest_entry or {}
    # Post-hoc temperature from the backtest: fitted on out-of-fold predictions of the
    # chosen variant, so it only applies when this artifact is that variant.
    cal = bt.get("calibrationTemperature") or {}
    temperature = cal.get("temperature") if bt.get("variant") == variant else None
    temperature = float(temperature) if temperature else 1.0
    params: Dict[str, Any] = {
        "features": features,
        "feature_meanings": {f.name: f.meaning for f in FEATURES if f.name in features},
        "version": MODEL_VERSION,
        "model_id": MODEL_ID,
        "series": series,
        "model_stage": stage,
        "variant": variant,
        "model_engine": model.engine,
        "model_algorithm": model.algorithm,
        "trained_at": now_iso(),
        "data_through": str(pool["race_date"].max().date()),
        "trained_on": f"{series} through {pool['race_date'].max().date()} ({n_races} races, {len(pool)} entries)",
        "n_production": int(len(pool)),
        "eligible_races": n_races,
        "test_auc": None,
        "backtest_logloss": bt.get("logLoss"),
        "backtest_top1": bt.get("top1"),
        "backtest_top3_overlap": bt.get("top3Overlap"),
        "backtest_ece": bt.get("ece"),
        "calibration_temperature": temperature,
        "calibration_temperature_source": ("backtest out-of-fold predictions" if temperature != 1.0 else
                                           "none (T = 1): no backtest temperature for this variant, or within the deadband"),
        "backtest_logloss_calibrated": cal.get("logLossAfter") if bt.get("variant") == variant else None,
        "backtest_ece_calibrated": cal.get("eceAfter") if bt.get("variant") == variant else None,
        "backtest_legacy_logloss": bt.get("legacyLogLoss"),
        "backtest_uniform_logloss": bt.get("uniformLogLoss"),
        "backtest_seasons": bt.get("seasons"),
        "backtest_variants": bt.get("variants"),
        "top1_acc": bt.get("top1"),
        "auto_select": stage != "race-night" or n_races >= RACE_NIGHT_MIN_RACES,
        "race_night_coverage": {"starting_position": 0.70, "heat_or_qualifying": 0.50} if stage == "race-night" else None,
    }
    if variant == "cl":
        params["feature_weights"] = model.feature_weights()
        params["l2"] = model.l2
        params["converged"] = model.converged
    elif variant == "boosted":
        params["temperature"] = model.temperature
        params["best_iteration"] = model.best_iteration
    with open(paths["model"], "wb") as handle:
        pickle.dump({"model": model, "params": params}, handle)
    paths["params"].write_text(json.dumps(params, indent=2))
    return params


def train_all(series_list: Optional[Sequence[str]] = None, stages: Sequence[str] = STAGES,
              variant: str = "auto", report_path: Path = REPORT_PATH, directory: Optional[Path] = None,
              data: Optional[RacingData] = None, verbose: bool = True) -> List[Dict[str, Any]]:
    if data is None:
        data = load_dataset()
    feat = build_features(data)
    chosen = chosen_variants(load_report(report_path))
    out = []
    for stage in stages:
        for series in series_list or SERIES_ORDER:
            entry = chosen.get((series, stage))
            use = variant if variant != "auto" else (entry or {}).get("variant", "cl")
            try:
                params = train_one(feat, data, series, stage, use, entry, directory)
            except ValueError as exc:
                if verbose:
                    print(f"skip {exc}")
                continue
            out.append(params)
            if verbose:
                print(f"trained {series} [{stage}] variant={use} races={params['eligible_races']} "
                      f"data_through={params['data_through']} backtest_logloss={params['backtest_logloss']} "
                      f"T={params['calibration_temperature']}")
    return out


def load_artifact(series: str, stage: str, directory: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    paths = artifact_paths(series, stage, directory)
    if not paths["model"].exists() or not paths["params"].exists():
        return None
    with open(paths["model"], "rb") as handle:
        payload = pickle.load(handle)
    payload["params"] = json.loads(paths["params"].read_text())
    return payload
