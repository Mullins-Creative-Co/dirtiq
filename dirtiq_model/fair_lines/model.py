"""Daily as-of scoring states and temporally separated ridge/distribution fits."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

HALF_LIFE = {"nba": 15, "ncaab": 10, "nfl": 8, "ncaaf": 6}
PRIOR_SCORE = {"nba": 110.0, "ncaab": 70.0, "nfl": 22.0, "ncaaf": 28.0}
MIN_FIT = 200
MIN_CALIBRATION = 100
RIDGE = 100.0
VERSION = "fair-lines-1"
POOLED = {"NON_D1", "FCS", "NON_FBS"}


def score_features(games: pd.DataFrame, sport: str) -> pd.DataFrame:
    """No same-day final scores; schedule rest uses Eastern calendar dates.

    State is scoring points, not possessions/pace. No market input enters this pass.
    All games should be final history or unscored targets, uniquely identified.
    """
    alpha = 1.0 - 0.5 ** (1.0 / HALF_LIFE[sport])
    offense: Dict[str, float] = {}
    defense: Dict[str, float] = {}
    last_season: Dict[str, int] = {}
    previous: Dict[Tuple[str, int], pd.Timestamp] = {}
    league_sum, league_n = PRIOR_SCORE[sport] * 100.0, 100.0
    home_sum, home_n = 0.0, 100.0
    records = []
    d = games.copy()
    d["_day"] = pd.to_datetime(d["start"], utc=True).dt.tz_convert("America/New_York").dt.normalize()
    for day, batch in d.sort_values(["start", "game_id"]).groupby("_day", sort=True):
        updates = []
        for r in batch.itertuples():
            home, away, season = str(r.home), str(r.away), int(r.season)
            for team in (home, away):
                if team in last_season and last_season[team] != season:
                    offense[team] = offense.get(team, 0.0) * 0.5
                    defense[team] = defense.get(team, 0.0) * 0.5
                last_season[team] = season
            base = league_sum / league_n
            hfa = (home_sum / home_n) * (1.0 - float(r.neutral)) / 2.0
            hp = base + offense.get(home, 0.0) + defense.get(away, 0.0) + hfa
            ap = base + offense.get(away, 0.0) + defense.get(home, 0.0) - hfa
            rest = []
            for team in (home, away):
                prior = previous.get((team, season))
                rest.append(min(7.0, max(0.0, float((day - prior).days))) if prior is not None else 7.0)
            records.append({"index": r.Index, "score_margin": hp - ap, "score_total": hp + ap,
                            "rest_diff": rest[0] - rest[1], "rest_sum": sum(rest),
                            "home_b2b": float(rest[0] <= 1), "away_b2b": float(rest[1] <= 1)})
            previous[(home, season)] = previous[(away, season)] = day
            if bool(r.completed) and np.isfinite(r.home_score) and np.isfinite(r.away_score):
                updates.append((home, away, float(r.home_score), float(r.away_score), hp, ap, float(r.neutral)))
        # Accumulate from frozen pre-day predictions, then apply each team's update.
        for home, away, hs, aws, hp, ap, neutral in updates:
            offense[home] = offense.get(home, 0.0) + alpha * (hs - hp) / 2.0
            defense[away] = defense.get(away, 0.0) + alpha * (hs - hp) / 2.0
            offense[away] = offense.get(away, 0.0) + alpha * (aws - ap) / 2.0
            defense[home] = defense.get(home, 0.0) + alpha * (aws - ap) / 2.0
            league_sum += hs + aws
            league_n += 2
            if not neutral:
                home_sum += hs - aws
                home_n += 1
    return pd.DataFrame(records).set_index("index").reindex(games.index)


def design(frame: pd.DataFrame, market: str, anchored: bool) -> Tuple[np.ndarray, List[str]]:
    names = ["score_margin" if market == "spread" else "score_total", "rest_diff", "rest_sum", "home_b2b", "away_b2b", "neutral"]
    if market == "spread":
        names.append("ind_mean")
    x = frame[names].to_numpy(dtype=float).copy()
    if anchored:
        ref = frame["market_line"].to_numpy(dtype=float)
        x[:, 0] -= ref
        if market == "spread":
            x[:, -1] -= ref
        x = np.column_stack([x, ref])
        names = names + ["market_line"]
    return x, names


@dataclass
class Fit:
    mu: np.ndarray
    scale: np.ndarray
    coef: np.ndarray
    features: List[str]
    anchored: bool
    market: str
    residuals: np.ndarray
    trained_through: str
    calibrated_through: str
    training_games: int

    def mean(self, frame: pd.DataFrame) -> np.ndarray:
        x, _ = design(frame, self.market, self.anchored)
        out = np.einsum("ij,j->i", np.column_stack([(x - self.mu) / self.scale, np.ones(len(x))]), self.coef, optimize=False)
        return out + frame["market_line"].to_numpy(dtype=float) if self.anchored else out


def fit(train: pd.DataFrame, calibration: pd.DataFrame, market: str, anchored: bool) -> Optional[Fit]:
    """Calibration outcomes never enter ridge fit or feature scaling."""
    if len(train) < MIN_FIT or len(calibration) < MIN_CALIBRATION:
        return None
    if train["season"].max() >= calibration["season"].min():
        raise ValueError("Training must precede the calibration season")
    if pd.to_datetime(train.start, utc=True).max() >= pd.to_datetime(calibration.start, utc=True).min():
        raise ValueError("Training timestamps overlap calibration")
    x, names = design(train, market, anchored)
    if not np.isfinite(x).all():
        raise ValueError("Nonfinite training features")
    mu, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-9] = 1.0
    z = np.column_stack([(x - mu) / scale, np.ones(len(x))])
    y = train.actual.to_numpy(dtype=float)
    if anchored:
        y = y - train.market_line.to_numpy(dtype=float)
    penalty = np.eye(z.shape[1]) * RIDGE
    penalty[-1, -1] = 0.0
    coef = np.linalg.solve(np.einsum("ni,nj->ij", z, z, optimize=False) + penalty,
                           np.einsum("ni,n->i", z, y, optimize=False))
    result = Fit(mu, scale, coef, names, anchored, market, np.array([]),
                 str(train.start.max()), str(calibration.start.max()), len(train))
    result.residuals = np.sort(calibration.actual.to_numpy(dtype=float) - result.mean(calibration))
    if not np.isfinite(result.residuals).all():
        raise ValueError("Nonfinite calibration residuals")
    return result


def probabilities(mean: np.ndarray, line: np.ndarray, residuals: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unconditional P(outcome>line), P(<line), P(push), integer-valued scores.

    An integer outcome k corresponds to continuous outcomes in [k-.5,k+.5).
    Half-point lines have no pushes. Continuous residuals are kept at calibration.
    """
    if not len(residuals) or not np.isfinite(residuals).all():
        raise ValueError("Finite calibration residuals required")
    r = np.sort(residuals)
    lower = np.ceil(line) - 0.5
    upper = np.floor(line) + 0.5
    below = np.searchsorted(r, lower - mean, side="left") / len(r)
    above = 1.0 - np.searchsorted(r, upper - mean, side="left") / len(r)
    push = np.clip(1.0 - above - below, 0.0, 1.0)
    return above, below, push
