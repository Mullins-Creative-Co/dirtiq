"""Descriptive audit of frozen rolling predictions; no fitting or threshold search.

python3 scripts/research/historical_model_audit.py --input-dir /path/to/data/sports --output /tmp/audit.json
Historical consensus prices are paper benchmarks, not executable named-book offers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd

SPORTS = {"nba": ("stk", 3.0, 2027), "nfl": ("ind", 2.0, 2026),
          "ncaab": ("stk", 3.0, 2027), "ncaaf": ("ind", 3.0, 2026)}


def wilson(wins: int, n: int) -> Any:
    if not n:
        return None
    p, z = wins / n, 1.959963984540054
    center = (p + z*z/(2*n))/(1+z*z/n)
    half = z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    return [float(center-half), float(center+half)]


def selection_stats(d: pd.DataFrame) -> Dict[str, Any]:
    pick = np.sign(d["edge"])
    result = pick * (d["margin"] + d["spread_line"])
    decided = result != 0
    wins, losses = int((result > 0).sum()), int((result < 0).sum())
    price = d["spread_home_price"].where(pick > 0, d["spread_away_price"])
    priced = price.notna() & (price.abs() >= 100)
    payout = pd.Series(np.where(price > 0, price/100, 100/price.abs()), index=d.index)
    units = payout.where(result > 0, -1).where(result != 0, 0)
    return {"games": len(d), "wins": wins, "losses": losses, "pushes": int((result == 0).sum()),
            "coverRate": wins / (wins+losses) if wins+losses else None,
            "coverInterval95": wilson(wins, wins+losses),
            "meanPredictedCoverOnDecided": float(d.loc[decided, "pick_prob"].mean()) if decided.any() else None,
            "priced": int(priced.sum()), "paperRoiAtArchivedPrices": float(units[priced].mean()) if priced.any() else None}


def audit(path: Path, sport: str) -> Dict[str, Any]:
    prefix, threshold, partial_season = SPORTS[sport]
    raw = pd.read_csv(path, dtype={"game_id": str}, low_memory=False)
    raw["start"] = pd.to_datetime(raw["start"], utc=True)
    d = raw[raw["season"] < partial_season].copy()
    pooled = d["home"].isin(["NON_D1", "FCS"]) | d["away"].isin(["NON_D1", "FCS"])
    valid = d["margin"].notna() & d["spread_line"].notna() & (d["spread_line"].abs() < 100) & ~pooled
    d = d[valid].copy()
    d["prediction"] = d[prefix+"_mean"].fillna(d["ind_mean"])
    d = d[d["prediction"].notna()].copy()
    d["model_error"] = (d["prediction"]-d["margin"]).abs()
    d["market_error"] = (-d["spread_line"]-d["margin"]).abs()
    d["edge"] = d["prediction"]+d["spread_line"]
    h, a = d[prefix+"_home_cover"], d[prefix+"_away_cover"]
    home_prob = h/(h+a)
    d["pick_prob"] = home_prob.where(d["edge"] > 0, 1-home_prob)
    selected = d[(d["edge"].abs() >= threshold) & (d["edge"].abs() < 4*threshold)].copy()
    # Paired date resampling describes uncertainty; it does not make these previously studied seasons untouched.
    daily = pd.DataFrame({"date": d["start"].dt.strftime("%Y-%m-%d"),
                          "difference": d["model_error"]-d["market_error"]}).groupby("date")["difference"].agg(["sum", "count"])
    rng = np.random.default_rng(20261123)
    draws = []
    for _ in range(2000):
        ix = rng.integers(0, len(daily), len(daily))
        draws.append(float(daily["sum"].to_numpy()[ix].sum()/daily["count"].to_numpy()[ix].sum()))
    gap, market_residual = d["edge"].to_numpy(), (d["margin"]+d["spread_line"]).to_numpy()
    centered = gap-gap.mean()
    slope = float(np.sum(centered*(market_residual-market_residual.mean()))/np.sum(centered**2))
    ml = d[d["home_ml"].abs().ge(100) & d["away_ml"].abs().ge(100) & d[prefix+"_home_win"].notna() & d["margin"].ne(0)].copy()
    def implied(prices: pd.Series) -> pd.Series:
        return pd.Series(np.where(prices < 0, -prices/(100-prices), 100/(100+prices)), index=prices.index)
    ih, ia = implied(ml["home_ml"]), implied(ml["away_ml"])
    outcome = (ml["margin"] > 0).astype(float)
    # First five rated games per team-season: descriptive, with same-day games not counted as prior.
    long = pd.concat([raw[["season", "start", "home"]].rename(columns={"home": "team"}),
                      raw[["season", "start", "away"]].rename(columns={"away": "team"})])
    counts = long.groupby(["season", "team", "start"]).size().rename("n").reset_index().sort_values("start")
    counts["prior"] = counts.groupby(["season", "team"])["n"].cumsum()-counts["n"]
    lookup = counts.set_index(["season", "team", "start"])["prior"]
    early = np.array([min(lookup.loc[(r.season,r.home,r.start)], lookup.loc[(r.season,r.away,r.start)]) < 5 for r in selected.itertuples()])
    selected["early"] = early
    worst = d.nlargest(8, "model_error")
    return {"sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "sourceRows": len(raw),
            "sourceThrough": raw["start"].max().isoformat(), "excludedPartialSeason": partial_season,
            "excludedInvalidOrPooled": int((~valid).sum()), "headline": prefix,
            "seasons": [int(d["season"].min()), int(d["season"].max())], "sameGameSpreadGames": len(d),
            "modelMae": float(d["model_error"].mean()), "marketMae": float(d["market_error"].mean()),
            "pairedExcessMaeInterval95": [float(x) for x in np.quantile(draws, [.025,.975])],
            "modelToMarketMarginSdRatio": float(d["prediction"].std()/d["spread_line"].std()),
            "disagreementResidualSlopeDescriptive": slope,
            "selectionRule": "%g <= absolute disagreement < %g" % (threshold, 4*threshold),
            "selections": selection_stats(selected),
            "underdogSelectionFraction": float(((np.sign(selected["edge"])*selected["spread_line"]) > 0).mean()),
            "earlySelections": selection_stats(selected[selected["early"]]),
            "laterSelections": selection_stats(selected[~selected["early"]]),
            "bySeason": [{"season": int(s), **selection_stats(g)} for s,g in selected.groupby("season")],
            "pairedMoneylineGames": len(ml),
            "modelMoneylineBrier": float(((ml[prefix+"_home_win"]-outcome)**2).mean()),
            "marketMoneylineBrier": float(((ih/(ih+ia)-outcome)**2).mean()),
            "worstMisses": [{"gameId": r.game_id, "home": r.home, "away": r.away,
                "date": r.start.isoformat(), "actualHomeMargin": r.margin, "modelHomeMargin": r.prediction,
                "marketHomeMargin": -r.spread_line} for r in worst.itertuples()]}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input-dir", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    report = {"asOf": "2026-11-23", "status": "diagnostic_only_no_promotion", "notes": [
        "Frozen rolling forecasts; complete seasons only; prior historical studies make these reused diagnostic data.",
        "Legacy team identity and exact quote timestamps are not verified; no executable-book ROI claim.",
        "Historical headline baseline only; current injury adjustments and separate NFL experimental projections are not evaluated.",
        "Intervals are descriptive and not corrected for all prior research. No weights or thresholds were selected here."],
        "sports": {s:audit(args.input_dir/(s+"-backtest-predictions.csv"),s) for s in SPORTS}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False)+"\n")
    for sport,r in report["sports"].items():
        print(sport, "games",r["sameGameSpreadGames"], "MAE",round(r["modelMae"],3),"vs",round(r["marketMae"],3),
              "cover",round(r["selections"]["coverRate"]*100,2),"predicted",round(r["selections"]["meanPredictedCoverOnDecided"]*100,2),
              "slope",round(r["disagreementResidualSlopeDescriptive"],3))

if __name__ == "__main__":
    main()
