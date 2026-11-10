"""Per-sport configuration, the two model variants, per-game scoring and grading.

Variants (always scored on identical games):
  * ``independent``      projected margin = Kalman rating difference + home field.
  * ``market-anchored``  projected margin = market margin + ridge(rating - market),
                         with the ridge fit on earlier games only.

Selection rule, fixed before any result is examined:
  pick the side the model favours when ``abs(projected - marketMargin) >= threshold``.
Selections are settled at the archived spread price of that side when present;
there is no -110 assumption (a separate ``roiAt110Illustrative`` is labelled as such).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from .. import scoring
from .ratings import EmpiricalMargin, Hyper, default_hyper, win_probability

MODEL_VERSION = "1.0"
RIDGE_ALPHA = 1.0


@dataclass(frozen=True)
class SportConfig:
    sport: str
    label: str
    threshold: float          # selection rule: abs(model - market) >= threshold, in the sport's margin unit
    warm_start: int
    first_test: int
    min_test_games: int = 40
    ties: bool = False        # can a game end level? (NFL yes; NBA/college/NHL no; MLB only when called early)
    unit: str = "points"      # margin unit (points, runs, goals)
    sigma_prior: Optional[float] = None   # starting observation-noise SD for the hyperparameter fit (None: 0.9 x margin SD)
    hfa_prior: Optional[float] = None     # starting home advantage for the fit (None: mean home margin)
    season_convention: str = "calendar year of the season"  # how the adapter labels ``season``
    maxiter: Optional[int] = None         # optimizer budget per fold when the default is too slow (many teams)

    @property
    def model_id(self) -> str:
        return f"{self.sport}-kalman"

    @property
    def rule(self) -> str:
        return f"abs(model - market) >= {self.threshold:.1f}"


ENDING_YEAR = "ESPN/league ending year (2026-27 is 2027)"

SPORT_CONFIG: Dict[str, SportConfig] = {
    "nfl": SportConfig("nfl", "NFL", threshold=2.0, warm_start=2009, first_test=2015, ties=True,
                       season_convention="calendar year the season starts (nflverse)"),
    "nba": SportConfig("nba", "NBA", threshold=3.0, warm_start=2016, first_test=2019, season_convention=ENDING_YEAR),
    "ncaaf": SportConfig("ncaaf", "NCAAF", threshold=3.0, warm_start=2010, first_test=2015,
                         season_convention="calendar year the season starts (ESPN)"),
    # ~365 Division I teams plus a pooled NON_D1 rating and ~6,000 games a season: a smaller
    # Nelder-Mead budget keeps the rolling backtest near ten minutes (warm starts carry the fit across folds).
    "ncaab": SportConfig("ncaab", "NCAAB", threshold=3.0, warm_start=2016, first_test=2019, sigma_prior=11.0,
                         season_convention=ENDING_YEAR, maxiter=80),
    "mlb": SportConfig("mlb", "MLB", threshold=1.0, warm_start=2015, first_test=2018, unit="runs", sigma_prior=4.3,
                       hfa_prior=0.2, season_convention="calendar year (MLB Stats API season)"),
    "nhl": SportConfig("nhl", "NHL", threshold=0.5, warm_start=2016, first_test=2019, unit="goals", sigma_prior=2.3,
                       hfa_prior=0.2, season_convention=ENDING_YEAR),
}


def config_for(sport: str) -> SportConfig:
    if sport not in SPORT_CONFIG:
        raise ValueError(f"unknown sport {sport!r}")
    return SPORT_CONFIG[sport]


def initial_hyper(cfg: SportConfig, games: pd.DataFrame) -> Hyper:
    """Starting point for the hyperparameter fit: the data-driven default with the
    sport's observation-noise and home-advantage priors substituted when configured."""
    base = default_hyper(games[games["completed"]] if "completed" in games.columns else games)
    sigma = float(cfg.sigma_prior) if cfg.sigma_prior else base.sigma
    hfa = float(cfg.hfa_prior) if cfg.hfa_prior is not None else base.hfa
    return Hyper(process_sd_day=base.process_sd_day, season_reversion=base.season_reversion, season_sd=base.season_sd,
                 hfa=hfa, sigma=sigma, init_sd=base.init_sd)


# ── market helpers ──────────────────────────────────────────────────────


def market_margin(spread_line: Any) -> Optional[float]:
    """Market-implied home margin from the home handicap (negative = home favorite)."""
    if spread_line is None or (isinstance(spread_line, float) and math.isnan(spread_line)):
        return None
    return -float(spread_line)


def _opt_int(x: Any) -> Optional[int]:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return int(round(f))


def _opt_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    f = float(x)
    return None if math.isnan(f) else f


# ── market-anchored residual fit ─────────────────────────────────────────


@dataclass
class AnchorFit:
    beta: float
    intercept: float
    sd: float
    n: int
    alpha: float = RIDGE_ALPHA

    def predict(self, ind_mean: float, mkt: float) -> float:
        return mkt + self.intercept + self.beta * (ind_mean - mkt)

    def to_dict(self) -> Dict[str, float]:
        return {k: (int(v) if k == "n" else round(float(v), 5)) for k, v in asdict(self).items()}


def ridge_1d(x: np.ndarray, y: np.ndarray, alpha: float = RIDGE_ALPHA) -> Tuple[float, float]:
    xm, ym = float(x.mean()), float(y.mean())
    xc, yc = x - xm, y - ym
    beta = float((xc * yc).sum() / ((xc * xc).sum() + alpha))
    return beta, ym - beta * xm


def fit_anchor(ind_mean: Sequence[float], mkt: Sequence[float], margin: Sequence[float], alpha: float = RIDGE_ALPHA) -> Optional[AnchorFit]:
    """Ridge of (actual - market) on (independent - market); returns None without a market."""
    df = pd.DataFrame({"ind": ind_mean, "mkt": mkt, "margin": margin}).dropna()
    if len(df) < 30:
        return None
    x = (df["ind"] - df["mkt"]).to_numpy(dtype=float)
    y = (df["margin"] - df["mkt"]).to_numpy(dtype=float)
    beta, intercept = ridge_1d(x, y, alpha)
    resid = y - (intercept + beta * x)
    return AnchorFit(beta=beta, intercept=intercept, sd=float(resid.std(ddof=1)), n=int(len(df)), alpha=alpha)


def anchor_residuals_z(fit: AnchorFit, ind_mean: Sequence[float], mkt: Sequence[float], margin: Sequence[float]) -> List[float]:
    df = pd.DataFrame({"ind": ind_mean, "mkt": mkt, "margin": margin}).dropna()
    pred = df["mkt"] + fit.intercept + fit.beta * (df["ind"] - df["mkt"])
    return ((df["margin"] - pred) / fit.sd).tolist()


# ── per-game scoring ────────────────────────────────────────────────────


@dataclass
class Scorer:
    """Everything needed to turn filter predictions into probabilities for one fold."""
    threshold: float
    independent: EmpiricalMargin
    anchor: Optional[AnchorFit] = None
    anchor_margin: Optional[EmpiricalMargin] = None
    ties: bool = True

    def _dist(self, emp: EmpiricalMargin, mean: float, sd: float) -> Dict[int, float]:
        dist = emp.distribution(mean, sd)
        if self.ties or not dist.get(0):
            return dist
        # sports that cannot end level: the shifted residual histogram still lands on 0, so drop it
        live = 1.0 - dist[0]
        return {m: p / live for m, p in dist.items() if m != 0}

    def score_one(self, mean: float, var: float, row: pd.Series) -> Dict[str, Any]:
        sd = math.sqrt(max(var, 1e-9))
        spread = _opt_float(row.get("spread_line"))
        mkt = market_margin(spread)
        out: Dict[str, Any] = {"ind_mean": mean, "ind_sd": sd, "market_margin": mkt}
        dist = self._dist(self.independent, mean, sd)
        out["ind_home_win"], out["ind_tie"] = win_probability(dist)
        if spread is not None:
            out["ind_home_cover"], out["ind_away_cover"], out["ind_push"] = scoring.cover_probabilities(dist, spread)
            out["ind_edge"] = mean - mkt
            out["ind_pick"] = pick_side(out["ind_edge"], self.threshold)
        else:
            out["ind_home_cover"] = out["ind_away_cover"] = out["ind_push"] = out["ind_edge"] = None
            out["ind_pick"] = None
        if self.anchor is not None and mkt is not None:
            amean = self.anchor.predict(mean, mkt)
            asd = self.anchor.sd
            adist = self._dist(self.anchor_margin or self.independent, amean, asd)
            out["anc_mean"], out["anc_sd"] = amean, asd
            out["anc_home_win"], out["anc_tie"] = win_probability(adist)
            out["anc_home_cover"], out["anc_away_cover"], out["anc_push"] = scoring.cover_probabilities(adist, spread)
            out["anc_edge"] = amean - mkt
            out["anc_pick"] = pick_side(out["anc_edge"], self.threshold)
        else:
            for k in ("anc_mean", "anc_sd", "anc_home_win", "anc_tie", "anc_home_cover", "anc_away_cover", "anc_push", "anc_edge", "anc_pick"):
                out[k] = None
        hw, _ = scoring.no_vig_two_way(_opt_float(row.get("home_ml")), _opt_float(row.get("away_ml")))
        hc, _ = scoring.no_vig_two_way(_opt_float(row.get("spread_home_price")), _opt_float(row.get("spread_away_price")))
        out["mkt_home_win"], out["mkt_home_cover"] = hw, hc
        return out

    def score_frame(self, games: pd.DataFrame, pred: pd.DataFrame) -> pd.DataFrame:
        rows = []
        for idx, row in games.iterrows():
            scored = self.score_one(float(pred.at[idx, "pred_mean"]), float(pred.at[idx, "pred_var"]), row)
            scored["_idx"] = idx
            rows.append(scored)
        extra = pd.DataFrame(rows).set_index("_idx")
        base = games[["game_id", "season", "week", "start", "home", "away", "neutral", "home_score", "away_score", "completed",
                      "spread_line", "spread_home_price", "spread_away_price", "home_ml", "away_ml", "total_line"]].copy()
        base["margin"] = base["home_score"] - base["away_score"]
        return base.join(extra)


def pick_side(edge: Optional[float], threshold: float) -> Optional[str]:
    if edge is None or math.isnan(edge):
        return None
    if abs(edge) < threshold:
        return None
    return "home" if edge > 0 else "away"


# ── settlement ──────────────────────────────────────────────────────────


def settle_spread(home_margin: float, selection_line: float) -> str:
    """Grade a spread selection: ``selection_line`` is that side's handicap, ``home_margin``
    is the home margin for a home selection or the away margin for an away one."""
    s = float(home_margin) + float(selection_line)
    if abs(s) < 1e-9:
        return "push"
    return "win" if s > 0 else "loss"


def settle_moneyline(selection_margin: float) -> str:
    if abs(float(selection_margin)) < 1e-9:
        return "push"
    return "win" if selection_margin > 0 else "loss"


def grade_pick(row: pd.Series, pick: Optional[str]) -> Tuple[Optional[str], Optional[int]]:
    """(outcome, archived price) for a home/away spread pick on a completed row."""
    if pick is None or not bool(row.get("completed")) or pd.isna(row.get("margin")) or pd.isna(row.get("spread_line")):
        return None, None
    if pick == "home":
        return settle_spread(float(row["margin"]), float(row["spread_line"])), _opt_int(row.get("spread_home_price"))
    return settle_spread(-float(row["margin"]), -float(row["spread_line"])), _opt_int(row.get("spread_away_price"))


def grade_selections(scored: pd.DataFrame, prefix: str, rule: str) -> Dict[str, Any]:
    """Record, units and ROI for a variant's picks at archived prices."""
    wins = losses = pushes = 0
    units: List[float] = []
    unpriced = 0
    cover_pairs: List[Tuple[float, int]] = []
    for _, row in scored.iterrows():
        pick = row.get(f"{prefix}_pick")
        outcome, price = grade_pick(row, pick if isinstance(pick, str) else None)
        if outcome is None:
            continue
        wins += outcome == "win"
        losses += outcome == "loss"
        pushes += outcome == "push"
        u = scoring.settle_units(outcome, price)
        if u is None:
            unpriced += 1
        else:
            units.append(u)
        if outcome != "push":
            p = row[f"{prefix}_home_cover"] if pick == "home" else row[f"{prefix}_away_cover"]
            cover_pairs.append((float(p), 1 if outcome == "win" else 0))
    n = wins + losses + pushes
    decided = wins + losses
    out: Dict[str, Any] = {
        "rule": rule, "n": int(n), "wins": int(wins), "losses": int(losses), "pushes": int(pushes),
        "priced": int(len(units)), "unpriced": int(unpriced),
        "units": round(sum(units), 3) if units else None,
        "roi": round(sum(units) / len(units), 4) if units else None,
        "winRate": round(wins / decided, 4) if decided else None,
        "roiAt110Illustrative": round((wins * 100.0 / 110.0 - losses) / n, 4) if n else None,
        "avgPickProb": round(float(np.mean([p for p, _ in cover_pairs])), 4) if cover_pairs else None,
        "brierPicks": round(float(np.mean([scoring.brier(p, y) for p, y in cover_pairs])), 4) if cover_pairs else None,
    }
    return out


# ── metrics ─────────────────────────────────────────────────────────────


def _mean(xs: Sequence[float]) -> Optional[float]:
    xs = [float(x) for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return float(np.mean(xs)) if xs else None


def variant_metrics(scored: pd.DataFrame, prefix: str) -> Dict[str, Any]:
    done = scored[scored["completed"] & scored["margin"].notna()]
    mean_col = f"{prefix}_mean"
    done = done[done[mean_col].notna()]
    out: Dict[str, Any] = {"games": int(len(done))}
    if done.empty:
        return out
    out["mae"] = round(float((done["margin"] - done[mean_col]).abs().mean()), 4)
    out["bias"] = round(float((done["margin"] - done[mean_col]).mean()), 4)
    out["rmse"] = round(float(math.sqrt(((done["margin"] - done[mean_col]) ** 2).mean())), 4)
    priced = done[done["market_margin"].notna()]
    if not priced.empty:
        out["maeOnMarketGames"] = round(float((priced["margin"] - priced[mean_col]).abs().mean()), 4)
    # moneyline (ties excluded)
    ml = done[done["margin"] != 0]
    pairs = [(float(p), int(m > 0)) for p, m in zip(ml[f"{prefix}_home_win"], ml["margin"])]
    if pairs:
        out["brierMoneyline"] = round(float(np.mean([scoring.brier(p, y) for p, y in pairs])), 4)
        out["logLossMoneyline"] = round(float(np.mean([scoring.log_loss(p, y) for p, y in pairs])), 4)
        bins = scoring.calibration_bins(pairs)
        out["ece"] = round(float(scoring.expected_calibration_error(bins) or 0.0), 4)
        out["calibration"] = bins
        out["homeWinRate"] = round(float(np.mean([y for _, y in pairs])), 4)
    mlp = ml[ml["mkt_home_win"].notna()]
    if not mlp.empty:
        mp = [(float(p), int(m > 0)) for p, m in zip(mlp[f"{prefix}_home_win"], mlp["margin"])]
        out["brierMoneylineOnPricedGames"] = round(float(np.mean([scoring.brier(p, y) for p, y in mp])), 4)
        out["logLossMoneylineOnPricedGames"] = round(float(np.mean([scoring.log_loss(p, y) for p, y in mp])), 4)
    # spread cover (pushes excluded)
    sp = done[done["spread_line"].notna() & done[f"{prefix}_home_cover"].notna()]
    sp = sp[(sp["margin"] + sp["spread_line"]).abs() > 1e-9]
    cpairs = [(float(p), int(m + s > 0)) for p, m, s in zip(sp[f"{prefix}_home_cover"], sp["margin"], sp["spread_line"])]
    if cpairs:
        out["brierSpread"] = round(float(np.mean([scoring.brier(p, y) for p, y in cpairs])), 4)
        out["logLossSpread"] = round(float(np.mean([scoring.log_loss(p, y) for p, y in cpairs])), 4)
        sbins = scoring.calibration_bins(cpairs)
        out["eceSpread"] = round(float(scoring.expected_calibration_error(sbins) or 0.0), 4)
        out["calibrationSpread"] = sbins
    spp = sp[sp["mkt_home_cover"].notna()]
    if not spp.empty:
        cp = [(float(p), int(m + s > 0)) for p, m, s in zip(spp[f"{prefix}_home_cover"], spp["margin"], spp["spread_line"])]
        out["brierSpreadOnPricedGames"] = round(float(np.mean([scoring.brier(p, y) for p, y in cp])), 4)
    return out


def market_metrics(scored: pd.DataFrame) -> Dict[str, Any]:
    done = scored[scored["completed"] & scored["margin"].notna()]
    out: Dict[str, Any] = {}
    priced = done[done["market_margin"].notna()]
    out["marketGames"] = int(len(priced))
    out["marketMae"] = round(float((priced["margin"] - priced["market_margin"]).abs().mean()), 4) if not priced.empty else None
    ml = done[(done["margin"] != 0) & done["mkt_home_win"].notna()]
    pairs = [(float(p), int(m > 0)) for p, m in zip(ml["mkt_home_win"], ml["margin"])]
    out["marketMoneylineGames"] = int(len(pairs))
    out["marketBrierMoneyline"] = round(float(np.mean([scoring.brier(p, y) for p, y in pairs])), 4) if pairs else None
    out["marketLogLossMoneyline"] = round(float(np.mean([scoring.log_loss(p, y) for p, y in pairs])), 4) if pairs else None
    sp = done[done["spread_line"].notna() & done["mkt_home_cover"].notna()]
    sp = sp[(sp["margin"] + sp["spread_line"]).abs() > 1e-9]
    cpairs = [(float(p), int(m + s > 0)) for p, m, s in zip(sp["mkt_home_cover"], sp["margin"], sp["spread_line"])]
    out["marketSpreadGames"] = int(len(cpairs))
    out["marketBrierSpread"] = round(float(np.mean([scoring.brier(p, y) for p, y in cpairs])), 4) if cpairs else None
    return out


def round_or_none(x: Any, nd: int = 4) -> Optional[float]:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, nd)


def opt_int(x: Any) -> Optional[int]:
    return _opt_int(x)
