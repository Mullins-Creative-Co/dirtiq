"""Reproducible historical comparisons; never changes production model artifacts."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd

from .model import HALF_LIFE, POOLED, VERSION, fit, probabilities, score_features

LIMITS = {"nba": (100, 400, 60), "ncaab": (60, 300, 70), "nfl": (10, 100, 70), "ncaaf": (10, 140, 90)}


def load(path: Path, sport: str, as_of: pd.Timestamp) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    raw = pd.read_csv(path, low_memory=False, dtype={"game_id": str})
    required = ["game_id", "season", "start", "home", "away", "neutral", "home_score", "away_score", "completed", "ind_mean", "spread_line", "total_line"]
    if any(c not in raw for c in required):
        raise ValueError("Missing required input columns")
    audit: Dict[str, Any] = {"inputRows": len(raw), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    d = raw.copy()
    d["start"] = pd.to_datetime(d.start, utc=True, errors="coerce")
    for c in ("season", "neutral", "home_score", "away_score", "ind_mean", "spread_line", "total_line", "spread_home_price", "spread_away_price"):
        d[c] = pd.to_numeric(d[c], errors="coerce") if c in d else np.nan
    d = d.replace([np.inf, -np.inf], np.nan)
    valid = d.game_id.notna() & d.home.notna() & d.away.notna() & (d.home != d.away) & d.start.notna() & (d.start < as_of)
    valid &= d.completed.astype(str).str.lower().isin(["true", "1"])
    valid &= d.season.notna() & (d.season % 1 == 0) & d.neutral.isin([0, 1])
    for c in ("home_score", "away_score"):
        valid &= d[c].notna() & (d[c] >= 0) & (d[c] % 1 == 0)
    audit["invalidOrNonfinal"] = int((~valid).sum())
    d = d[valid].copy()
    dup = d[d.duplicated("game_id", keep=False)]
    for _, group in dup.groupby("game_id"):
        if len(group[required].drop_duplicates()) > 1:
            raise ValueError("Conflicting duplicate game ID: " + str(group.game_id.iloc[0]))
    audit["duplicateRows"] = int(d.duplicated("game_id").sum())
    d = d.drop_duplicates("game_id")
    pooled = d.home.isin(POOLED) | d.away.isin(POOLED)
    audit["pooledOpponentGames"] = int(pooled.sum())
    d = d[~pooled].copy()
    # Schedule convention: basketball season is its ending year.
    current = as_of.year + int(as_of.month >= 7) if sport in ("nba", "ncaab") else as_of.year
    audit["incompleteSeasonGames"] = int((d.season >= current).sum())
    d = d[d.season < current].sort_values(["start", "game_id"]).reset_index(drop=True)
    low, high, spread_cap = LIMITS[sport]
    bad_spread = d.spread_line.notna() & ((d.spread_line.abs() > spread_cap) | (d.spread_line * 2 % 1 != 0))
    bad_total = d.total_line.notna() & ((d.total_line < low) | (d.total_line > high) | (d.total_line * 2 % 1 != 0))
    audit.update(invalidSpreadLines=int(bad_spread.sum()), invalidTotalLines=int(bad_total.sum()), eligibleHistoryGames=len(d))
    d.loc[bad_spread, "spread_line"] = np.nan
    d.loc[bad_total, "total_line"] = np.nan
    for c in ("spread_home_price", "spread_away_price"):
        d.loc[d[c].abs() < 100, c] = np.nan
    if d.empty:
        raise ValueError("No complete eligible historical seasons")
    audit.update(firstStart=d.start.min().isoformat(), lastStart=d.start.max().isoformat())
    d["completed"] = True
    return d, audit


def payout(price: np.ndarray) -> np.ndarray:
    return np.where(price >= 100, price / 100.0, 100.0 / np.maximum(np.abs(price), 1.0))


def interval(values: np.ndarray, dates: pd.Series) -> list:
    """Paired date-cluster bootstrap; resample sums and counts, not cluster means."""
    if len(values) == 0:
        return [None, None]
    groups = pd.DataFrame({"date": np.asarray(dates), "value": values}).groupby("date").value.agg(["sum", "count"])
    rng = np.random.default_rng(20261119)
    sums, counts = groups["sum"].to_numpy(), groups["count"].to_numpy()
    estimates = []
    for _ in range(499):
        ix = rng.integers(0, len(groups), len(groups))
        estimates.append(sums[ix].sum() / counts[ix].sum())
    return [round(float(v), 5) for v in np.quantile(estimates, [0.025, 0.975])]


def selections(d: pd.DataFrame, real_price: bool) -> Dict[str, Any]:
    chosen = d[d.select & (d.has_price == real_price)]
    wins = int(chosen.won.sum())
    pushes = int(chosen.push.sum())
    losses = int(len(chosen) - wins - pushes)
    profit = np.where(chosen.won, payout(chosen.price.to_numpy()), np.where(chosen.push, 0.0, -1.0))
    n = wins + losses
    p = wins / n if n else 0.0
    den = 1 + 1.96 ** 2 / n if n else 1.0
    lower = ((p + 1.96 ** 2 / (2 * n) - 1.96 * np.sqrt(p * (1-p)/n + 1.96 ** 2/(4*n*n))) / den) if n else None
    return {"bets": len(chosen), "wins": wins, "losses": losses, "pushes": pushes,
            "coverRate": wins / n if n else None, "lower95": lower,
            "units": float(profit.sum()), "roi": float(profit.mean()) if len(chosen) else None,
            "priceBasis": "archived side price" if real_price else "assumed -110 sensitivity; not executable ROI"}


def metrics(d: pd.DataFrame) -> Dict[str, Any]:
    ae = np.abs(d.actual - d.prediction)
    me = np.abs(d.actual - d.market_line)
    no_push = d[d.actual != d.market_line]
    y = (no_push.actual > no_push.market_line).to_numpy(dtype=float)
    p = np.clip(no_push.conditional.to_numpy(), 1e-6, 1-1e-6)
    pm = no_push.market_probability.to_numpy()
    return {"games": len(d), "mae": float(ae.mean()), "rmse": float(np.sqrt(np.mean((d.actual-d.prediction)**2))),
            "marketMae": float(me.mean()), "maeDelta": float((ae-me).mean()),
            "maeDelta95": interval((ae-me).to_numpy(), d.day),
            "nonPushGames": len(no_push), "brier": float(np.mean((p-y)**2)),
            "benchmarkBrier": float(np.mean((pm-y)**2)),
            "pairedPriceGames": int(no_push.paired_price.sum()),
            "logLoss": float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p))),
            "archivedPriceSelections": selections(d, True), "assumedPriceSelections": selections(d, False)}


def evaluate(games: pd.DataFrame, sport: str) -> Tuple[list, pd.DataFrame]:
    features = score_features(games, sport)
    d = games.join(features)
    d["day"] = d.start.dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
    outputs = []
    for market in ("spread", "total"):
        frame = d.copy()
        frame["actual"] = frame.home_score - frame.away_score if market == "spread" else frame.home_score + frame.away_score
        frame["market_line"] = -frame.spread_line if market == "spread" else frame.total_line
        required = ["market_line", "ind_mean"] if market == "spread" else ["market_line"]
        frame = frame.dropna(subset=required)
        seasons = sorted(frame.season.unique())
        for season in seasons[2:]:
            prior = [s for s in seasons if s < season]
            calibration_season = prior[-1]
            train = frame[frame.season < calibration_season]
            calibration = frame[frame.season == calibration_season]
            test = frame[frame.season == season]
            if test.start.min() <= calibration.start.max():
                raise ValueError("Calibration timestamps overlap test")
            for anchored in (False, True):
                model = fit(train, calibration, market, anchored)
                if model is None:
                    continue
                result = test.copy()
                result["prediction"] = model.mean(test)
                over, under, push = probabilities(result.prediction.to_numpy(), result.market_line.to_numpy(), model.residuals)
                conditional = np.divide(over, over+under, out=np.full(len(over), 0.5), where=(over+under)>0)
                result["conditional"] = conditional
                result["push_probability"] = push
                result["selected_high"] = conditional >= 0.5
                hp = result.spread_home_price.to_numpy() if market == "spread" else np.full(len(result), np.nan)
                ap = result.spread_away_price.to_numpy() if market == "spread" else np.full(len(result), np.nan)
                paired = np.isfinite(hp) & np.isfinite(ap)
                hi = 1 / (1 + payout(hp))
                lo = 1 / (1 + payout(ap))
                result["paired_price"] = paired
                result["market_probability"] = np.where(paired, hi/(hi+lo), 0.5)
                prices = np.where(conditional >= 0.5, hp, ap)
                result["has_price"] = np.isfinite(prices)
                result["price"] = np.where(np.isfinite(prices), prices, -110.0)
                result["selected_probability"] = np.maximum(conditional, 1-conditional)
                # Unconditional win EV includes push refunds; price from selected side only.
                winp = np.where(conditional >= 0.5, over, under)
                losep = np.where(conditional >= 0.5, under, over)
                ev = winp * payout(result.price.to_numpy()) - losep
                result["select"] = (result.selected_probability >= 0.55) & (ev > 0)
                result["push"] = result.actual == result.market_line
                result["won"] = ((result.actual > result.market_line) == result.selected_high) & ~result.push
                result["market"] = market
                result["variant"] = "market-residual" if anchored else "score-independent"
                result["fitThrough"] = model.trained_through
                result["calibratedThrough"] = model.calibrated_through
                result["trainingGames"] = model.training_games
                result["calibrationGames"] = len(model.residuals)
                outputs.append(result)
    if not outputs:
        raise ValueError("Insufficient temporally separated fit/calibration/test seasons")
    all_rows = pd.concat(outputs, ignore_index=True)
    reports = []
    for (market, variant), group in all_rows.groupby(["market", "variant"]):
        report = {"market": market, "variant": variant, **metrics(group),
                  "benchmark": "no-vig paired spread prices where available; 50% otherwise" if market == "spread" else "50% no-push benchmark; totals side prices unavailable",
                  "bySeason": [{"season": int(s), **metrics(g)} for s, g in group.groupby("season")]}
        reports.append(report)
    return reports, all_rows


def run(input_dir: Path, output: Path, detail_dir: Path, as_of: str) -> Dict[str, Any]:
    cutoff = pd.Timestamp(as_of)
    cutoff = cutoff.tz_localize("America/New_York").tz_convert("UTC") if cutoff.tz is None else cutoff.tz_convert("UTC")
    sports = []
    detail_dir.mkdir(parents=True, exist_ok=True)
    for sport in ("ncaaf", "ncaab", "nba", "nfl"):
        path = input_dir / (sport + "-backtest-predictions.csv")
        games, audit = load(path, sport, cutoff)
        comparisons, rows = evaluate(games, sport)
        rows.to_csv(detail_dir / (sport + "-fair-lines.csv"), index=False)
        sports.append({"sport": sport, "audit": audit, "comparisons": comparisons})
        print(sport, [(x["market"], x["variant"], round(x["maeDelta"], 3)) for x in comparisons], flush=True)
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "asOf": cutoff.isoformat(),
              "modelVersion": VERSION, "status": "historical research; not promoted", "promoted": False,
              "protocol": "docs/fair-line-protocol.md", "sports": sports,
              "limitations": ["Previously inspected historical seasons; not untouched external validation.",
                              "Closing consensus is not an executable FanDuel/DraftKings price or a timestamped opener.",
                              "Totals prices absent: -110 results are sensitivity only, not executable ROI.",
                              "Scoring states use final scores, not possessions, verified starters, weather or injury history.",
                              "Marginal date-cluster intervals do not adjust for multiple candidate comparisons.",
                              "No production forecasts, stakes, manual logging or betting records are changed."]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report
