"""Score one race or every upcoming race; write the prediction JSON; record forecasts.

Output shape matches the legacy ``data/ml-predictions/race_<id>.json`` that
``src/lib/ml-predictions.ts`` reads, plus ``top3Probability``,
``top5Probability``, ``expectedFinish``, ``backtestLogLoss``, ``backtestTop1``.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from ..ledger_core import Forecast, Ledger
from . import MODEL_ID, MODEL_VERSION
from .data import RacingData, connect, data_dir, load_dataset, market_prices, resolve_series, slug
from .features import build_features, race_night_coverage
from .model import plackett_luce_stats
from .train import load_artifact

CALIBRATION = "softmax_field"


def upcoming_race_ids(data: RacingData, limit: Optional[int] = None) -> List[int]:
    live = data.entries[data.entries["entry_status"] != "scratched"]
    counts = live.groupby("race_id").size()
    races = data.races[(data.races["status"] == "upcoming") & data.races["race_id"].isin(counts.index)]
    ids = races.sort_values(["race_date", "race_id"])["race_id"].astype(int).tolist()
    return ids[:limit] if limit else ids


def race_payload(race_id: int, data: RacingData, feat: pd.DataFrame, directory: Optional[Path] = None,
                 override: Optional[str] = None, n_samples: int = 2000) -> Dict[str, Any]:
    race = data.race(race_id)
    rows = feat[feat["race_id"] == int(race_id)].reset_index(drop=True)
    series, reason = resolve_series(race, override)
    series_slug = slug(series)
    if rows.empty:
        cov = {"start": 0.0, "heat": 0.0, "qualifying": 0.0}
        return {"raceId": int(race_id), "modelSeries": series, "modelSlug": series_slug, "modelReason": reason,
                "modelStage": "early", "raceNightCoverage": cov, "predictions": []}
    cov_row = race_night_coverage(rows).iloc[0]
    coverage = {"start": float(cov_row["start"]), "heat": float(cov_row["heat"]), "qualifying": float(cov_row["qualifying"])}
    night = load_artifact(series, "race-night", directory) if bool(cov_row["race_night"]) else None
    use_night = night is not None and night["params"].get("auto_select", True)
    artifact = night if use_night else load_artifact(series, "early", directory)
    stage = "race-night" if use_night else "early"
    base = {"raceId": int(race_id), "modelSeries": series, "modelSlug": series_slug, "modelReason": reason,
            "modelStage": stage, "raceNightCoverage": coverage}
    if artifact is None:
        return dict(base, predictions=[])
    model = artifact["model"]
    params = artifact["params"]
    prob = model.predict_win(rows)
    scores = model.scores(rows) if hasattr(model, "scores") else np.log(np.clip(prob, 1e-12, None))
    raw = model.raw(rows) if hasattr(model, "raw") else prob
    pl = plackett_luce_stats(scores, n_samples=n_samples, seed=int(race_id))
    predictions = []
    for i, row in rows.iterrows():
        predictions.append({
            "driverId": int(row["driver_id"]),
            "driverName": row["driver_name"],
            "metricSeries": series,
            "modelSlug": series_slug,
            "modelSeries": series,
            "modelReason": reason,
            "modelStage": stage,
            "rawProbability": float(raw[i]),
            "probability": float(prob[i]),
            "calibration": CALIBRATION,
            "trainedOn": params.get("trained_on"),
            "testAuc": params.get("test_auc"),
            "top1Accuracy": params.get("backtest_top1"),
            "modelEngine": params.get("model_engine"),
            "modelAlgorithm": params.get("model_algorithm"),
            "featureCount": len(params.get("features", [])),
            "top3Probability": float(pl["top3"][i]),
            "top5Probability": float(pl["top5"][i]),
            "expectedFinish": round(float(pl["expected_finish"][i]), 3),
            "backtestLogLoss": params.get("backtest_logloss"),
            "backtestTop1": params.get("backtest_top1"),
        })
    predictions.sort(key=lambda p: -p["probability"])
    return dict(base, predictions=predictions, modelVariant=params.get("variant"), modelId=MODEL_ID,
                modelVersion=MODEL_VERSION, trainedAt=params.get("trained_at"), dataThrough=params.get("data_through"))


def write_payload(payload: Dict[str, Any], out_dir: Optional[Path] = None) -> Path:
    out_dir = Path(out_dir) if out_dir is not None else data_dir() / "ml-predictions"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"race_{payload['raceId']}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)
    return path


def forecasts_for(payload: Dict[str, Any], race: pd.Series, prices: Dict[int, Any]) -> List[Forecast]:
    out: List[Forecast] = []
    label = str(race["name"])
    start = str(pd.Timestamp(race["race_date"]).date())
    meta = {"series": payload["modelSeries"], "stage": payload["modelStage"], "engine": None}
    for p in payload.get("predictions", []):
        meta["engine"] = p.get("modelEngine")
        price = prices.get(int(p["driverId"]))
        common = dict(sport="racing", event_id=f"race:{payload['raceId']}", event_label=label, event_start=start,
                      selection=f"driver:{p['driverId']}", selection_label=str(p["driverName"]),
                      model_id=MODEL_ID, model_version=MODEL_VERSION, meta=dict(meta))
        out.append(Forecast(market="win", prob=float(p["probability"]), value=float(p["expectedFinish"]),
                            price=int(price[0]) if price else None, book="house" if price else None,
                            line_observed_at=str(price[1]) if price else None, **common))
        out.append(Forecast(market="top3", prob=float(p["top3Probability"]), value=float(p["expectedFinish"]), **common))
    return out


def score_races(race_ids: Sequence[int], data: Optional[RacingData] = None, feat: Optional[pd.DataFrame] = None,
                directory: Optional[Path] = None, out_dir: Optional[Path] = None, ledger: Optional[Ledger] = None,
                con: Optional[sqlite3.Connection] = None, record: bool = True, override: Optional[str] = None,
                verbose: bool = True) -> List[Dict[str, Any]]:
    own_con = con is None
    if data is None:
        con = con or connect()
        data = load_dataset(con)
    if feat is None:
        feat = build_features(data, race_ids=list(race_ids))
    own_ledger = ledger is None and record
    if own_ledger:
        ledger = Ledger()
    payloads = []
    try:
        for rid in race_ids:
            payload = race_payload(int(rid), data, feat, directory, override)
            path = write_payload(payload, out_dir)
            n_rec = 0
            if record and ledger is not None and payload["predictions"]:
                race = data.race(rid)
                prices = market_prices(con, int(rid)) if con is not None else {}
                n_rec = ledger.record(forecasts_for(payload, race, prices), replace_open=True)
            payloads.append(payload)
            if verbose:
                print(f"{payload['raceId']} | {payload['modelSeries']} | {payload['modelStage']} | "
                      f"{payload['modelReason']} | {len(payload['predictions'])} scored | {n_rec} ledger rows | {path}")
    finally:
        if own_ledger and ledger is not None:
            ledger.close()
        if own_con and con is not None:
            con.close()
    return payloads


def score_upcoming(limit: Optional[int] = None, **kwargs: Any) -> List[Dict[str, Any]]:
    con = connect()
    try:
        data = load_dataset(con)
        ids = upcoming_race_ids(data, limit)
        if not ids:
            print("No upcoming races with entries found.")
            return []
        return score_races(ids, data=data, con=con, **kwargs)
    finally:
        con.close()
