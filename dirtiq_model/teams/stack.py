"""The learned layer on top of the Kalman ratings.

Two small models per sport, refit for every backtest fold (and on all completed games
for a forecast) from one-step-ahead filter predictions on the training seasons:

* ``stacked`` (prefix ``stk``): rating difference, its uncertainty, rest, back-to-back
  flags, starter adjustments and the neutral flag -> ridge for the margin, logistic
  for the home win. Independent of the market, so its edge against the line is
  still a disagreement signal.
* ``stacked-market`` (prefix ``stkm``): the same inputs plus the market margin and the
  no-vig moneyline logit. The best calibrated probability where a line exists; its
  job is grading, not finding leans.

Margin distributions reuse ``EmpiricalMargin`` on the stacked residuals so cover and
push probabilities stay on the sport's integer key numbers. Win probabilities come
from the logistic model (what the ledger grades). Standardization, ridge and
logistic are closed-form / scikit-learn and serialize to plain dicts.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from .. import scoring
from .features import rest_features, starter_adjustments
from .model import SportConfig, implied_market_margin, pick_side
from .ratings import EmpiricalMargin, win_probability

BASE_FEATURES = ["ind_mean", "ind_sd", "rest_diff", "home_b2b", "away_b2b", "home_games7", "away_games7", "starter_diff", "neutral"]
MARKET_FEATURES = BASE_FEATURES + ["market_margin", "mkt_logit"]
MIN_ROWS = 300
RIDGE_ALPHA = 1.0
LOGIT_C = 1.0
LOGIT_CLIP = 4.0


@dataclass
class StackFit:
    features: List[str]
    mu: np.ndarray
    sd: np.ndarray
    ridge_coef: np.ndarray
    ridge_intercept: float
    logit_coef: np.ndarray
    logit_intercept: float
    resid_z: EmpiricalMargin
    n: int
    train_mae: float
    train_log_loss: float
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "features": self.features, "n": self.n,
            "ridge": {f: round(float(c), 4) for f, c in zip(self.features, self.ridge_coef / self.sd)},
            "ridgeIntercept": round(float(self.ridge_intercept - float(np.dot(self.ridge_coef / self.sd, self.mu))), 4),
            "logit": {f: round(float(c), 4) for f, c in zip(self.features, self.logit_coef / self.sd)},
            "logitIntercept": round(float(self.logit_intercept - float(np.dot(self.logit_coef / self.sd, self.mu))), 4),
            "trainMae": round(self.train_mae, 4), "trainLogLoss": round(self.train_log_loss, 4),
            "empiricalResiduals": int(len(self.resid_z.z)),
        }


def _logit(p: Optional[float]) -> Optional[float]:
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return None
    p = min(max(float(p), 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def feature_frame(games: pd.DataFrame, pred: pd.DataFrame, moneyline_market: bool = False) -> pd.DataFrame:
    """Inputs for the stack aligned to ``games.index``: filter prediction, market, rest,
    starters (if the adapter carries ``home_starter``/``away_starter``) and the target."""
    f = pd.DataFrame(index=games.index)
    f["ind_mean"] = pred["pred_mean"].reindex(games.index).astype(float)
    f["ind_sd"] = np.sqrt(np.clip(pred["pred_var"].reindex(games.index).astype(float), 1e-9, None))
    f["neutral"] = pd.to_numeric(games["neutral"], errors="coerce").fillna(0).astype(float)
    f["market_margin"] = pd.to_numeric(pd.Series(
        [implied_market_margin(row, s, moneyline_market) for (_, row), s in zip(games.iterrows(), f["ind_sd"])], index=games.index), errors="coerce")
    f["spread_line"] = pd.to_numeric(games["spread_line"], errors="coerce").astype(float)
    hw = [scoring.no_vig_two_way(h, a)[0] if not (pd.isna(h) or pd.isna(a)) else None for h, a in zip(games["home_ml"], games["away_ml"])]
    f["mkt_home_win"] = pd.to_numeric(pd.Series(hw, index=games.index), errors="coerce")
    f["mkt_logit"] = f["mkt_home_win"].map(_logit).astype(float)
    f = f.join(rest_features(games))
    starters = starter_adjustments(games.join(f[["ind_mean"]]))
    f = f.join(starters)
    f["margin"] = (pd.to_numeric(games["home_score"], errors="coerce") - pd.to_numeric(games["away_score"], errors="coerce")).astype(float)
    f["completed"] = games["completed"].astype(bool)
    f["season"] = games["season"].astype(int)
    f["start"] = pd.to_datetime(games["start"], utc=True)
    return f


def _ridge(X: np.ndarray, y: np.ndarray, alpha: float) -> Tuple[np.ndarray, float]:
    Xc = np.column_stack([X, np.ones(len(X))])
    pen = np.eye(Xc.shape[1]) * alpha
    pen[-1, -1] = 0.0
    beta = np.linalg.solve(Xc.T @ Xc + pen, Xc.T @ y)
    return beta[:-1], float(beta[-1])


def fit_stack(frame: pd.DataFrame, features: Sequence[str], ties: bool) -> Optional[StackFit]:
    """Fit ridge (margin) and logistic (home win) on completed rows with every feature present."""
    feats = list(features)
    d = frame[frame["completed"] & frame["margin"].notna()].dropna(subset=feats)
    if len(d) < MIN_ROWS:
        return None
    X = d[feats].to_numpy(dtype=float)
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Z = (X - mu) / sd
    y = d["margin"].to_numpy(dtype=float)
    coef, intercept = _ridge(Z, y, RIDGE_ALPHA)
    fitted = Z @ coef + intercept
    resid_z = (y - fitted) / d["ind_sd"].to_numpy(dtype=float)
    win_mask = y != 0
    yw = (y[win_mask] > 0).astype(int)
    if yw.min() == yw.max():
        return None
    lr = LogisticRegression(C=LOGIT_C, max_iter=500)
    lr.fit(Z[win_mask], yw)
    p = np.clip(lr.predict_proba(Z[win_mask])[:, 1], 1e-6, 1 - 1e-6)
    ll = float(-np.mean(yw * np.log(p) + (1 - yw) * np.log(1 - p)))
    return StackFit(features=feats, mu=mu, sd=sd, ridge_coef=coef, ridge_intercept=intercept,
                    logit_coef=lr.coef_[0].copy(), logit_intercept=float(lr.intercept_[0]),
                    resid_z=EmpiricalMargin(resid_z), n=int(len(d)),
                    train_mae=float(np.mean(np.abs(y - fitted))), train_log_loss=ll)


def _dist(emp: EmpiricalMargin, mean: float, sd: float, ties: bool) -> Dict[int, float]:
    dist = emp.distribution(mean, sd)
    if ties or not dist.get(0):
        return dist
    live = 1.0 - dist[0]
    return {m: p / live for m, p in dist.items() if m != 0}


def apply_stack(fit: Optional[StackFit], frame: pd.DataFrame, prefix: str, threshold: float, ties: bool) -> pd.DataFrame:
    """Columns ``{prefix}_mean, _sd, _home_win, _tie, _home_cover, _away_cover, _push, _edge, _pick``
    aligned to ``frame.index``; rows missing any feature (or with no fit) are null."""
    cols = ["mean", "sd", "home_win", "tie", "home_cover", "away_cover", "push", "edge", "pick"]
    out = pd.DataFrame(index=frame.index, columns=[f"{prefix}_{c}" for c in cols], dtype=object)
    if fit is None:
        return out
    ok = frame[fit.features].notna().all(axis=1)
    if not ok.any():
        return out
    d = frame[ok]
    Z = (d[fit.features].to_numpy(dtype=float) - fit.mu) / fit.sd
    mean = Z @ fit.ridge_coef + fit.ridge_intercept
    logit = np.clip(Z @ fit.logit_coef + fit.logit_intercept, -LOGIT_CLIP * 3, LOGIT_CLIP * 3)
    pwin = 1.0 / (1.0 + np.exp(-logit))
    sds = d["ind_sd"].to_numpy(dtype=float)
    mkts = d["market_margin"].to_numpy(dtype=float)
    spreads = d["spread_line"].to_numpy(dtype=float)
    rows = []
    for m, s, pw, mk, sp in zip(mean, sds, pwin, mkts, spreads):
        dist = _dist(fit.resid_z, float(m), float(s), ties)
        _, tie = win_probability(dist)
        rec: Dict[str, Any] = {f"{prefix}_mean": float(m), f"{prefix}_sd": float(s), f"{prefix}_home_win": float(pw), f"{prefix}_tie": float(tie),
                               f"{prefix}_home_cover": None, f"{prefix}_away_cover": None, f"{prefix}_push": None, f"{prefix}_edge": None, f"{prefix}_pick": None}
        if not math.isnan(sp):
            hc, ac, push = scoring.cover_probabilities(dist, float(sp))
            rec.update({f"{prefix}_home_cover": hc, f"{prefix}_away_cover": ac, f"{prefix}_push": push})
        if not math.isnan(mk):
            edge = float(m - mk)
            rec.update({f"{prefix}_edge": edge, f"{prefix}_pick": pick_side(edge, threshold)})
        rows.append(rec)
    res = pd.DataFrame(rows, index=d.index)
    out.loc[d.index, res.columns] = res
    return out


def fit_fold(cfg: SportConfig, train: pd.DataFrame, train_pred: pd.DataFrame, test: pd.DataFrame, test_pred: pd.DataFrame,
             burn_in_seasons: int = 1) -> Tuple[Dict[str, Optional[StackFit]], pd.DataFrame]:
    """Fit both stacks on ``train`` and apply them to ``test``; starter adjustments run
    through train and test in one as-of pass. Returns ``({"stk": fit, "stkm": fit}, columns for test)``."""
    both = pd.concat([train, test])
    pred = pd.concat([train_pred, test_pred])
    frame = feature_frame(both, pred, cfg.moneyline_market)
    seasons = np.sort(train["season"].unique())
    first_fit_season = seasons[burn_in_seasons] if len(seasons) > burn_in_seasons else seasons[0]
    tr = frame.loc[train.index]
    tr = tr[tr["season"] >= first_fit_season]
    te = frame.loc[test.index]
    fits = {"stk": fit_stack(tr, BASE_FEATURES, cfg.ties), "stkm": fit_stack(tr, MARKET_FEATURES, cfg.ties)}
    cols = apply_stack(fits["stk"], te, "stk", cfg.threshold, cfg.ties).join(apply_stack(fits["stkm"], te, "stkm", cfg.threshold, cfg.ties))
    return fits, cols
