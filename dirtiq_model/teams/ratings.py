"""Kalman-filter team ratings on game margin.

State: one strength per team (points). Observation for a game:

    home_margin = r_home - r_away + hfa * (1 - neutral) + e,   e ~ N(0, sigma^2)

Between game days every team's variance grows by ``process_sd_day^2`` per
calendar day; at a season boundary each rating is pulled ``season_reversion``
of the way toward the league mean and ``season_sd^2`` is added to the variance.
Home advantage is a learned constant per sport. All hyperparameters are fit by
maximizing the one-step-ahead Gaussian predictive log likelihood on training
games; nothing here looks at a game before predicting it.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from .. import scoring

GAME_DAY_TZ = "America/New_York"
MARGIN_LIMIT = 80
MIN_EMPIRICAL_RESIDUALS = 300


@dataclass
class Hyper:
    process_sd_day: float
    season_reversion: float
    season_sd: float
    hfa: float
    sigma: float
    init_sd: float

    def to_vector(self) -> np.ndarray:
        rev = min(max(self.season_reversion, 1e-4), 1 - 1e-4)
        return np.array([
            math.log(self.process_sd_day), math.log(rev / (1 - rev)), math.log(self.season_sd), self.hfa, math.log(self.sigma),
        ])

    @classmethod
    def from_vector(cls, v: Sequence[float], init_sd: float) -> "Hyper":
        return cls(
            process_sd_day=float(math.exp(v[0])),
            season_reversion=float(1.0 / (1.0 + math.exp(-v[1]))),
            season_sd=float(math.exp(v[2])),
            hfa=float(v[3]),
            sigma=float(math.exp(v[4])),
            init_sd=float(init_sd),
        )

    def to_dict(self) -> Dict[str, float]:
        return {k: round(float(x), 5) for k, x in asdict(self).items()}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Hyper":
        return cls(**{k: float(d[k]) for k in ("process_sd_day", "season_reversion", "season_sd", "hfa", "sigma", "init_sd")})


def game_days(start: pd.Series) -> pd.Series:
    """Calendar day (US Eastern) used to batch simultaneous games."""
    return pd.to_datetime(start, utc=True).dt.tz_convert(GAME_DAY_TZ).dt.normalize().dt.tz_localize(None)


class KalmanRatings:
    def __init__(self, teams: Sequence[str], hyper: Hyper):
        self.teams = list(teams)
        self.index = {t: i for i, t in enumerate(self.teams)}
        n = len(self.teams)
        self.hyper = hyper
        self.mean = np.zeros(n)
        self.cov = np.eye(n) * float(hyper.init_sd) ** 2
        self.last_day: Optional[pd.Timestamp] = None
        self.season: Optional[int] = None
        self.games_played = np.zeros(n, dtype=int)
        self.updated_at: Optional[pd.Timestamp] = None

    # ── time evolution ──────────────────────────────────────────────────
    def start_day(self, day: pd.Timestamp, season: int) -> None:
        """Advance the clock to ``day`` (a new season triggers reversion instead of drift)."""
        if self.season is None:
            self.season, self.last_day = int(season), day
            return
        if int(season) != self.season:
            self.new_season()
            self.season, self.last_day = int(season), day
            return
        gap = int((day - self.last_day).days) if self.last_day is not None else 0
        if gap > 0:
            self.cov[np.diag_indices_from(self.cov)] += gap * self.hyper.process_sd_day ** 2
        self.last_day = day

    def new_season(self) -> None:
        rev = self.hyper.season_reversion
        league_mean = float(self.mean.mean())
        self.mean = league_mean + (1.0 - rev) * (self.mean - league_mean)
        self.cov = (1.0 - rev) ** 2 * self.cov + np.eye(len(self.teams)) * self.hyper.season_sd ** 2
        self.games_played[:] = 0

    # ── predict / update ────────────────────────────────────────────────
    def predict(self, home: str, away: str, neutral: int = 0) -> Tuple[float, float]:
        """One-step-ahead (mean, variance) of the home margin."""
        h, a = self.index[home], self.index[away]
        mean = self.mean[h] - self.mean[a] + (0.0 if neutral else self.hyper.hfa)
        var = self.cov[h, h] + self.cov[a, a] - 2.0 * self.cov[h, a] + self.hyper.sigma ** 2
        return float(mean), float(var)

    def update(self, games: Sequence[Tuple[str, str, int, float]]) -> None:
        """Joint Kalman update for simultaneous games ``(home, away, neutral, margin)``."""
        if not games:
            return
        n, m = len(self.teams), len(games)
        H = np.zeros((m, n))
        y = np.zeros(m)
        for i, (home, away, neutral, margin) in enumerate(games):
            h, a = self.index[home], self.index[away]
            H[i, h] += 1.0
            H[i, a] -= 1.0
            y[i] = float(margin) - (0.0 if neutral else self.hyper.hfa)
            self.games_played[h] += 1
            self.games_played[a] += 1
        PHt = self.cov @ H.T
        S = H @ PHt + np.eye(m) * self.hyper.sigma ** 2
        K = np.linalg.solve(S, PHt.T).T
        self.mean = self.mean + K @ (y - H @ self.mean)
        cov = self.cov - K @ PHt.T
        self.cov = 0.5 * (cov + cov.T)

    def snapshot(self) -> pd.DataFrame:
        sd = np.sqrt(np.clip(np.diag(self.cov), 0.0, None))
        out = pd.DataFrame({"team": self.teams, "rating": self.mean, "sd": sd, "games": self.games_played})
        out["rank"] = out["rating"].rank(ascending=False, method="min").astype(int)
        return out.sort_values("rank").reset_index(drop=True)


def run_filter(kf: KalmanRatings, games: pd.DataFrame, update: bool = True) -> pd.DataFrame:
    """Run ``kf`` through ``games`` in start order, batching games on one calendar day.

    Returns a frame aligned to ``games.index`` with ``pred_mean`` and ``pred_var``
    computed before any game of that day is absorbed. With ``update`` the
    completed games of each day are then absorbed; incomplete rows never update.
    """
    if games.empty:
        return pd.DataFrame({"pred_mean": [], "pred_var": []}, index=games.index)
    days = game_days(games["start"])
    order = np.lexsort((games["start"].values, days.values))
    idx = games.index[order]
    g = games.loc[idx]
    d = days.loc[idx]
    mean = np.zeros(len(g))
    var = np.zeros(len(g))
    homes, aways = g["home"].to_numpy(), g["away"].to_numpy()
    neutrals = g["neutral"].to_numpy().astype(int)
    seasons = g["season"].to_numpy().astype(int)
    margins = (g["home_score"] - g["away_score"]).to_numpy(dtype=float)
    done = g["completed"].to_numpy().astype(bool) if "completed" in g.columns else np.ones(len(g), dtype=bool)
    day_values = d.to_numpy()
    pos = 0
    n = len(g)
    while pos < n:
        end = pos
        while end < n and day_values[end] == day_values[pos] and seasons[end] == seasons[pos]:
            end += 1
        kf.start_day(pd.Timestamp(day_values[pos]), int(seasons[pos]))
        batch = []
        for i in range(pos, end):
            mean[i], var[i] = kf.predict(homes[i], aways[i], neutrals[i])
            if update and done[i] and not math.isnan(margins[i]):
                batch.append((homes[i], aways[i], int(neutrals[i]), float(margins[i])))
        if batch:
            kf.update(batch)
            kf.updated_at = g["start"].iloc[end - 1]
        pos = end
    out = pd.DataFrame({"pred_mean": mean, "pred_var": var}, index=idx)
    return out.loc[games.index]


def negative_log_likelihood(hyper: Hyper, games: pd.DataFrame, teams: Sequence[str], score_mask: Optional[np.ndarray] = None) -> float:
    kf = KalmanRatings(teams, hyper)
    pred = run_filter(kf, games)
    margin = (games["home_score"] - games["away_score"]).to_numpy(dtype=float)
    mu, v = pred["pred_mean"].to_numpy(), pred["pred_var"].to_numpy()
    nll = 0.5 * (np.log(2 * math.pi * v) + (margin - mu) ** 2 / v)
    if score_mask is not None:
        nll = nll[score_mask]
    return float(nll.sum())


def default_hyper(games: pd.DataFrame) -> Hyper:
    margin = (games["home_score"] - games["away_score"]).astype(float)
    s = float(margin.std()) if len(margin) > 1 else 10.0
    home = margin[games["neutral"].astype(int) == 0]
    return Hyper(
        process_sd_day=0.02 * s, season_reversion=0.4, season_sd=0.25 * s,
        hfa=float(home.mean()) if len(home) else 0.0, sigma=0.9 * s, init_sd=0.3 * s,
    )


def fit_hyper(games: pd.DataFrame, teams: Sequence[str], init: Optional[Hyper] = None,
              maxiter: int = 250, burn_in_seasons: int = 1) -> Tuple[Hyper, Dict[str, Any]]:
    """Maximize one-step-ahead predictive log likelihood over ``games`` (training only).

    Games in the first ``burn_in_seasons`` seasons are run through the filter but
    excluded from the objective so the flat prior does not drive the fit.
    """
    games = games[games["completed"]].sort_values("start")
    init = init or default_hyper(games)
    seasons = np.sort(games["season"].unique())
    if len(seasons) > burn_in_seasons:
        mask = games["season"].to_numpy() >= seasons[burn_in_seasons]
    else:
        mask = np.ones(len(games), dtype=bool)
    scored = int(mask.sum())

    scale = float(init.sigma)

    def objective(v: np.ndarray) -> float:
        if not np.all(np.isfinite(v)) or np.any(np.abs(v[[0, 2, 4]]) > 12) or abs(v[3]) > 30:
            return 1e12
        h = Hyper.from_vector(v, init.init_sd)
        # keep the search inside a sane region: noise terms bounded by the margin scale
        if not (0.05 * scale <= h.sigma <= 5.0 * scale) or h.process_sd_day > scale or h.season_sd > 5.0 * scale:
            return 1e12
        try:
            with np.errstate(all="ignore"):
                value = negative_log_likelihood(h, games, teams, mask)
        except (np.linalg.LinAlgError, ValueError, FloatingPointError):
            return 1e12
        return value if math.isfinite(value) else 1e12

    res = minimize(objective, init.to_vector(), method="Nelder-Mead",
                   options={"maxiter": maxiter, "xatol": 1e-3, "fatol": 1e-3, "adaptive": True})
    best = Hyper.from_vector(res.x, init.init_sd)
    info = {"nll": float(res.fun), "nllPerGame": float(res.fun / max(scored, 1)), "scoredGames": scored,
            "iterations": int(res.nit), "converged": bool(res.success), "trainSeasons": [int(s) for s in seasons]}
    return best, info


class EmpiricalMargin:
    """Margin distribution from standardized training residuals, shifted to a forecast.

    Each residual ``z_i = (actual - predicted) / predicted_sd`` from training becomes
    one integer margin ``round(mean + z_i * sd)``; the histogram of those is the
    forecast distribution. Because the integer structure of real margins survives
    the shift, NFL key numbers (3, 7) get their natural mass without a lookup table.
    Falls back to the discretized normal when fewer than 300 residuals exist.
    """

    def __init__(self, z: Sequence[float], limit: int = MARGIN_LIMIT):
        self.z = np.asarray([float(x) for x in z if x is not None and not math.isnan(float(x))])
        self.limit = int(limit)

    @property
    def empirical(self) -> bool:
        return len(self.z) >= MIN_EMPIRICAL_RESIDUALS

    def distribution(self, mean: float, sd: float) -> Dict[int, float]:
        if not self.empirical:
            return scoring.margin_distribution(mean, sd, limit=self.limit)
        margins = np.clip(np.rint(mean + self.z * sd), -self.limit, self.limit).astype(int)
        counts = np.bincount(margins + self.limit, minlength=2 * self.limit + 1).astype(float)
        counts /= counts.sum()
        return {m - self.limit: float(c) for m, c in enumerate(counts) if c > 0}

    def to_list(self) -> List[float]:
        return [round(float(x), 4) for x in self.z]


def win_probability(dist: Dict[int, float]) -> Tuple[float, float]:
    """(home win prob excluding ties, tie prob) from an integer margin distribution."""
    home = sum(p for m, p in dist.items() if m > 0)
    away = sum(p for m, p in dist.items() if m < 0)
    tie = sum(p for m, p in dist.items() if m == 0)
    if home + away <= 0:
        return 0.5, tie
    return home / (home + away), tie
