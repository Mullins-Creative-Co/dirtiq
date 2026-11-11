"""Rolling-by-season backtest for one sport and the ``public/sports/<sport>.json`` report.

For each test season the hyperparameters are fit on every prior season from the
sport's warm-up year, the filter is run through those seasons, then continued
through the test season updating only from completed games strictly before each
game day. Residual distributions and the market-anchored ridge come from the
training seasons alone.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .adapters.common import ROOT, now_iso
from .model import (MODEL_VERSION, AnchorFit, Scorer, SportConfig, anchor_residuals_z, fit_anchor,
                    grade_selections, implied_market_margin, initial_hyper, market_metrics, round_or_none, variant_metrics)
from .ratings import EmpiricalMargin, Hyper, KalmanRatings, fit_hyper, run_filter
from . import stack

REPORT_DIR = ROOT / "public" / "sports"
PRED_DIR = ROOT / "data" / "sports"


def report_path(sport: str) -> Path:
    return REPORT_DIR / f"{sport}.json"


def load_report(sport: str) -> Dict[str, Any]:
    path = report_path(sport)
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def write_report(sport: str, payload: Dict[str, Any]) -> Path:
    path = report_path(sport)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1, allow_nan=False))
    tmp.replace(path)
    return path


def teams_in(games: pd.DataFrame) -> List[str]:
    return sorted(set(games["home"].astype(str)) | set(games["away"].astype(str)))


def data_through(games: pd.DataFrame) -> Optional[str]:
    done = games[games["completed"]]
    if done.empty:
        return None
    return str(done["start"].max().tz_convert("America/New_York").date())


def training_artifacts(kf: KalmanRatings, train: pd.DataFrame, burn_in_seasons: int = 1,
                       moneyline_market: bool = False) -> Tuple[pd.DataFrame, EmpiricalMargin, Optional[AnchorFit], Optional[EmpiricalMargin]]:
    """Run the filter through ``train`` and derive residual distributions and the anchor ridge."""
    pred = run_filter(kf, train)
    seasons = np.sort(train["season"].unique())
    keep = train["season"].to_numpy() >= (seasons[burn_in_seasons] if len(seasons) > burn_in_seasons else seasons[0])
    margin = (train["home_score"] - train["away_score"]).to_numpy(dtype=float)
    mu, var = pred["pred_mean"].to_numpy(), pred["pred_var"].to_numpy()
    z = ((margin - mu) / np.sqrt(var))[keep]
    emp = EmpiricalMargin(z)
    sds = np.sqrt(np.clip(var, 1e-9, None))
    mkt = np.array([implied_market_margin(row, s, moneyline_market) for (_, row), s in zip(train.iterrows(), sds)], dtype=float)
    anchor = fit_anchor(mu[keep], mkt[keep], margin[keep])
    anchor_emp = EmpiricalMargin(anchor_residuals_z(anchor, mu[keep], mkt[keep], margin[keep])) if anchor else None
    return pred, emp, anchor, anchor_emp


def fold_summary(scored: pd.DataFrame, cfg: SportConfig) -> Dict[str, Any]:
    ind = variant_metrics(scored, "ind")
    mk = market_metrics(scored)
    anc = variant_metrics(scored, "anc")
    sel = grade_selections(scored, "ind", cfg.rule)
    anc_sel = grade_selections(scored, "anc", cfg.rule) if anc.get("games") else None
    stk = variant_metrics(scored, "stk") if "stk_mean" in scored.columns else {"games": 0}
    stkm = variant_metrics(scored, "stkm") if "stkm_mean" in scored.columns else {"games": 0}
    stk_sel = grade_selections(scored, "stk", cfg.rule) if stk.get("games") else None
    stkm_sel = grade_selections(scored, "stkm", cfg.rule) if stkm.get("games") else None
    return {"independent": ind, "market": mk, "anchored": anc, "selections": sel, "anchoredSelections": anc_sel,
            "stacked": stk, "stackedSelections": stk_sel, "stackedMarket": stkm, "stackedMarketSelections": stkm_sel}


def choose_headline(ind: Dict[str, Any], stk: Dict[str, Any]) -> str:
    """The variant whose probabilities the forecast publishes: the stack when it beats the
    independent filter on out-of-fold moneyline log loss, else the independent filter."""
    a, b = ind.get("logLossMoneyline"), stk.get("logLossMoneyline")
    return "stacked" if (a is not None and b is not None and b < a) else "independent"


def run_backtest(cfg: SportConfig, games: pd.DataFrame, maxiter: int = 300, verbose: bool = True,
                 first_test: Optional[int] = None) -> Tuple[Dict[str, Any], pd.DataFrame]:
    completed = games[games["completed"] & (games["season"] >= cfg.warm_start)].sort_values(["start", "game_id"])
    seasons = [int(s) for s in np.sort(completed["season"].unique())]
    start_test = first_test or cfg.first_test
    counts = completed.groupby("season").size()
    test_seasons = [s for s in seasons if s >= start_test and int(counts.get(s, 0)) >= cfg.min_test_games]
    if not test_seasons:
        raise ValueError(f"no test seasons >= {start_test} with at least {cfg.min_test_games} completed games")
    teams = teams_in(games)
    prev: Optional[Hyper] = None
    folds: List[Dict[str, Any]] = []
    scored_parts: List[pd.DataFrame] = []
    budget = min(maxiter, cfg.maxiter) if cfg.maxiter else maxiter
    for season in test_seasons:
        train = completed[completed["season"] < season]
        hyper, info = fit_hyper(train, teams, init=prev or initial_hyper(cfg, train), maxiter=budget)
        prev = hyper
        kf = KalmanRatings(teams, hyper)
        train_pred, emp, anchor, anchor_emp = training_artifacts(kf, train, moneyline_market=cfg.moneyline_market)
        scorer = Scorer(cfg.threshold, emp, anchor, anchor_emp, ties=cfg.ties, moneyline_market=cfg.moneyline_market)
        test = completed[completed["season"] == season]
        pred = run_filter(kf, test)
        scored = scorer.score_frame(test, pred)
        fits, stack_cols = stack.fit_fold(cfg, train, train_pred, test, pred)
        scored = scored.join(stack_cols)
        scored_parts.append(scored)
        summary = fold_summary(scored, cfg)
        fold = {
            "season": season, "games": int(len(test)), "trainSeasons": info["trainSeasons"], "trainGames": int(len(train)),
            "hyper": hyper.to_dict(), "fit": {k: info[k] for k in ("nllPerGame", "iterations", "converged")},
            "empiricalResiduals": int(len(emp.z)), "anchor": anchor.to_dict() if anchor else None,
            "stack": {k: (f.to_dict() if f else None) for k, f in fits.items()},
            "summary": summary,
        }
        folds.append(fold)
        if verbose:
            ind, mk, sel = summary["independent"], summary["market"], summary["selections"]
            stk = summary["stacked"]
            print(f"{cfg.sport} {season}: games={len(test)} mae={ind.get('mae')} stk={stk.get('mae')} market={mk.get('marketMae')} "
                  f"brierML={ind.get('brierMoneyline')} stk={stk.get('brierMoneyline')} stkm={summary['stackedMarket'].get('brierMoneyline')} mkt={mk.get('marketBrierMoneyline')} "
                  f"picks={sel['wins']}-{sel['losses']}-{sel['pushes']} units={sel['units']} "
                  f"hfa={hyper.hfa:.2f} sigma={hyper.sigma:.2f} q/day={hyper.process_sd_day:.3f} rev={hyper.season_reversion:.2f} ssd={hyper.season_sd:.2f}")
    scored_all = pd.concat(scored_parts).sort_values(["start", "game_id"])
    report = assemble_backtest(cfg, games, scored_all, folds, test_seasons)
    return report, scored_all


def assemble_backtest(cfg: SportConfig, games: pd.DataFrame, scored: pd.DataFrame, folds: List[Dict[str, Any]], test_seasons: List[int]) -> Dict[str, Any]:
    pooled = fold_summary(scored, cfg)
    ind, mk, anc, sel = pooled["independent"], pooled["market"], pooled["anchored"], pooled["selections"]
    stk, stkm = pooled["stacked"], pooled["stackedMarket"]
    has_market = bool(mk.get("marketGames"))
    latest_season = int(max(test_seasons))
    all_games = games[games["season"] == latest_season]
    partial = bool((~all_games["completed"]).any())
    by_season = []
    for f in folds:
        s = f["summary"]
        by_season.append({
            "season": f["season"], "games": f["games"], "partial": bool(f["season"] == latest_season and partial),
            "mae": s["independent"].get("mae"), "marketMae": s["market"].get("marketMae"),
            "brierSpread": s["independent"].get("brierSpread"), "marketBrierSpread": s["market"].get("marketBrierSpread"),
            "brierMoneyline": s["independent"].get("brierMoneyline"), "marketBrierMoneyline": s["market"].get("marketBrierMoneyline"),
            "logLossMoneyline": s["independent"].get("logLossMoneyline"), "ece": s["independent"].get("ece"),
            "anchoredMae": s["anchored"].get("mae"), "anchoredBrierSpread": s["anchored"].get("brierSpread"),
            "stackedMae": s["stacked"].get("mae"), "stackedBrierMoneyline": s["stacked"].get("brierMoneyline"),
            "stackedLogLossMoneyline": s["stacked"].get("logLossMoneyline"), "stackedBrierSpread": s["stacked"].get("brierSpread"),
            "stackedMarketBrierMoneyline": s["stackedMarket"].get("brierMoneyline"), "stackedMarketMae": s["stackedMarket"].get("mae"),
            "selections": s["selections"], "anchoredSelections": s["anchoredSelections"], "stackedSelections": s["stackedSelections"],
            "hyper": f["hyper"], "anchor": f["anchor"], "fit": f["fit"], "trainGames": f["trainGames"],
        })
    variants = [
        {"id": "independent", "description": "Kalman rating difference + home field", **{k: v for k, v in ind.items() if k not in ("calibration", "calibrationSpread")},
         "selections": sel},
        {"id": "market-anchored", "description": "market margin + ridge(rating - market) fit on earlier games",
         "available": bool(anc.get("games")),
         **({k: v for k, v in anc.items() if k not in ("calibration", "calibrationSpread")} if anc.get("games") else {}),
         "selections": pooled["anchoredSelections"],
         "fitsBySeason": [{"season": f["season"], **(f["anchor"] or {})} for f in folds if f["anchor"]] or None},
        {"id": "stacked", "description": "ridge margin + logistic win on rating difference, rating uncertainty, rest, back-to-backs, starter adjustments and site (no market input)",
         "available": bool(stk.get("games")), "features": stack.BASE_FEATURES,
         **({k: v for k, v in stk.items() if k not in ("calibration", "calibrationSpread")} if stk.get("games") else {}),
         "selections": pooled["stackedSelections"],
         "fitsBySeason": [{"season": f["season"], **f["stack"]["stk"]} for f in folds if f.get("stack", {}).get("stk")] or None},
        {"id": "stacked-market", "description": "the stacked inputs plus the market margin and no-vig moneyline logit; the best calibrated probability where a line exists",
         "available": bool(stkm.get("games")), "features": stack.MARKET_FEATURES,
         **({k: v for k, v in stkm.items() if k not in ("calibration", "calibrationSpread")} if stkm.get("games") else {}),
         "selections": pooled["stackedMarketSelections"],
         "fitsBySeason": [{"season": f["season"], **f["stack"]["stkm"]} for f in folds if f.get("stack", {}).get("stkm")] or None},
    ]
    if not has_market:
        variants[1]["limitation"] = f"{cfg.label} source carries no betting lines; the anchored variant and selections cannot be evaluated"
    last = folds[-1]
    backtest = {
        "seasons": test_seasons, "games": int(len(scored)), "warmStartSeason": cfg.warm_start,
        "protocol": "rolling by season: hyperparameters fit on all prior seasons, filter updates only from completed games before each game day",
        "mae": ind.get("mae"), "marketMae": mk.get("marketMae"),
        "brierSpread": ind.get("brierSpread"), "marketBrierSpread": mk.get("marketBrierSpread"),
        "brierMoneyline": ind.get("brierMoneyline"), "marketBrierMoneyline": mk.get("marketBrierMoneyline"),
        "logLossMoneyline": ind.get("logLossMoneyline"), "marketLogLossMoneyline": mk.get("marketLogLossMoneyline"),
        "brierMoneylineOnPricedGames": ind.get("brierMoneylineOnPricedGames"),
        "brierSpreadOnPricedGames": ind.get("brierSpreadOnPricedGames"),
        "ece": ind.get("ece"), "calibration": ind.get("calibration", []),
        "eceSpread": ind.get("eceSpread"), "calibrationSpread": ind.get("calibrationSpread", []),
        "homeWinRate": ind.get("homeWinRate"),
        "stackedMae": stk.get("mae"), "stackedBrierMoneyline": stk.get("brierMoneyline"), "stackedLogLossMoneyline": stk.get("logLossMoneyline"),
        "stackedBrierSpread": stk.get("brierSpread"), "stackedEce": stk.get("ece"), "stackedCalibration": stk.get("calibration", []),
        "stackedMarketMae": stkm.get("mae"), "stackedMarketBrierMoneyline": stkm.get("brierMoneyline"),
        "stackedMarketLogLossMoneyline": stkm.get("logLossMoneyline"), "stackedMarketBrierSpread": stkm.get("brierSpread"),
        "headline": choose_headline(ind, stk),
        "selections": sel if has_market else {"rule": cfg.rule, "n": 0, "wins": 0, "losses": 0, "pushes": 0, "units": None, "roi": None,
                                              "limitation": "no market lines in source"},
        "selectionThreshold": cfg.threshold,
        "clv": None,
        "clvNote": "archive holds one line per game, so closing-line value is only measurable live through the ledger",
        "bySeason": by_season, "variants": variants,
        "hyperparameters": [{"season": f["season"], **f["hyper"]} for f in folds],
        "latestFit": {"season": last["season"], "hyper": last["hyper"], "anchor": last["anchor"], "fit": last["fit"], "trainSeasons": last["trainSeasons"]},
        "marketGames": mk.get("marketGames"), "marketMoneylineGames": mk.get("marketMoneylineGames"), "marketSpreadGames": mk.get("marketSpreadGames"),
    }
    return backtest


def base_report(cfg: SportConfig, games: pd.DataFrame) -> Dict[str, Any]:
    return {
        "sport": cfg.sport, "label": games.attrs.get("label", cfg.label), "generatedAt": now_iso(),
        "modelId": cfg.model_id, "modelVersion": MODEL_VERSION,
        "dataThrough": data_through(games), "sources": games.attrs.get("sources", []),
    }


def limitations(cfg: SportConfig, games: pd.DataFrame, backtest: Optional[Dict[str, Any]]) -> List[str]:
    out = [
        "Backtest numbers are not a claim of a live edge; only settled ledger rows can make that claim.",
        "Ratings use final margins only: no injuries, quarterbacks, travel or weather. The stacked layer adds rest, back-to-backs and (MLB) probable-pitcher adjustments on top.",
        "Home advantage is a single learned constant per fit; it does not vary by team or drift inside a season.",
    ]
    if not games.attrs.get("book"):
        out.append(f"The {cfg.label} source carries no betting lines, so market comparisons, selections and ledger rows are unavailable.")
    else:
        out.append("Archived lines are one consensus number per game (effectively closing), so backtest selections are graded at the close; closing-line value is measured live through the ledger.")
    if backtest and backtest.get("marketMae") is not None and backtest.get("mae") is not None and backtest["mae"] > backtest["marketMae"]:
        out.append(f"The independent model trails the market on margin MAE ({backtest['mae']} vs {backtest['marketMae']}); treat it as a sanity check on the market, not a replacement for it.")
    if cfg.sport == "ncaaf":
        out.append("NCAAF: FCS opponents are pooled into one rating; the cfbfastR betting archive is a multi-book median, carries spread prices only for 2010-2019 (selections after 2019 are graded but unpriced) and ends with the 2025 season; 2026 games and the upcoming list use ESPN's per-game odds and scoreboard.")
    if cfg.sport == "nba":
        out.append("NBA: lines are ESPN per-game multi-book medians from the 2015-16 season. Regular season, play-in and playoff games are included; the 2020 bubble games are not flagged neutral by ESPN.")
    if cfg.sport == "ncaab":
        out.append("NCAAB: lines are ESPN per-game multi-book medians from the 2018-19 season (earlier seasons are unpriced). Non-Division-I opponents (no ESPN conference) and teams with fewer than six games in a season are pooled into one NON_D1 rating; regular season and postseason (conference and national tournaments) are included; the optimizer budget per fold is reduced because of the ~365-team state.")
    if cfg.moneyline_market:
        out.append(f"{cfg.label}: the listed spread is a fixed {'run' if cfg.sport == 'mlb' else 'puck'} line, so the market margin, edge and lean come from the no-vig moneyline converted to a margin with the game's forecast SD; cover probabilities still use the listed line.")
    if cfg.sport == "mlb":
        out.append("MLB: lines are ESPN per-game multi-book medians from 2017 (earlier seasons are unpriced), matched to Stats API games by local date and team; probable pitchers from the Stats API feed the stacked layer's starter adjustment (the final listed probable, which is the actual starter for completed games). Margins are runs; regular season and postseason are included, spring training and exhibitions excluded; the feed has no neutral-site flag, so only known international venues and the 2020 bubble postseason are neutral; no starting-pitcher information.")
    if cfg.sport == "nhl":
        out.append("NHL: lines are ESPN per-game multi-book medians from the 2019-20 season (earlier seasons are unpriced), matched to stats-API games by local date and team. Margins are goals with every overtime or shootout decision recorded as a one-goal margin; regular season and playoffs are included, preseason and All-Star excluded; the feed has no neutral-site flag (Global Series games abroad count as home games).")
    return out


def save_predictions(sport: str, scored: pd.DataFrame) -> Path:
    PRED_DIR.mkdir(parents=True, exist_ok=True)
    path = PRED_DIR / f"{sport}-backtest-predictions.csv"
    scored.to_csv(path, index=False)
    return path


def backtest_command(cfg: SportConfig, games: pd.DataFrame, maxiter: int = 300, first_test: Optional[int] = None) -> Dict[str, Any]:
    backtest, scored = run_backtest(cfg, games, maxiter=maxiter, first_test=first_test)
    report = load_report(cfg.sport)
    report.update(base_report(cfg, games))
    report["backtest"] = backtest
    report.setdefault("ratings", [])
    report.setdefault("upcoming", [])
    report["limitations"] = limitations(cfg, games, backtest)
    path = write_report(cfg.sport, report)
    pred_path = save_predictions(cfg.sport, scored)
    print(f"wrote {path} and {pred_path}")
    return report
