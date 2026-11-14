"""Game totals (over/under): a deliberately simple walk-forward projection.

Each team carries one number, how far its games run above or below the league's
season average total, updated after every game with an exponential half-life and
halved between seasons. A game's projected total is the league average plus both
teams' numbers. Against closing totals (2016-2026 backtest predictions) this is
worse than the market in every sport (MAE 14.9 v 14.3 NBA, 13.4 v 13.0 NCAAB,
10.8 v 10.5 NFL, 13.2 v 12.8 NCAAF) and its leans hit 46-51%, below the 52.4%
break-even. It exists so the site can show where the model sits against the
posted total, not because it finds value."""
from __future__ import annotations

from typing import Any, Dict, Optional

import pandas as pd

HALF_LIFE = {"nba": 15.0, "ncaab": 10.0, "nfl": 8.0, "ncaaf": 6.0}     # games
THRESHOLD = {"nba": 6.0, "ncaab": 6.0, "nfl": 4.0, "ncaaf": 4.0}       # points off the posted total before a lean
MIN_LEAGUE_GAMES = 30      # league average switches to the current season after this many games
MIN_TEAM_GAMES = 4         # both teams need this many games this season before a lean
SEASON_CARRY = 0.5


class TotalsState:
    def __init__(self, sport: str) -> None:
        self.alpha = 1.0 - 0.5 ** (1.0 / HALF_LIFE[sport])
        self.dev: Dict[str, float] = {}
        self.games: Dict[Any, int] = {}
        self.league: Dict[int, list] = {}
        self.last_season: Dict[str, int] = {}

    def base(self, season: int) -> Optional[float]:
        cur = self.league.get(season)
        if cur and cur[1] >= MIN_LEAGUE_GAMES:
            return cur[0] / cur[1]
        prev = self.league.get(season - 1)
        if prev and prev[1]:
            return prev[0] / prev[1]
        return cur[0] / cur[1] if cur and cur[1] else None

    def _roll(self, team: str, season: int) -> None:
        if self.last_season.get(team, season) != season:
            self.dev[team] = self.dev.get(team, 0.0) * SEASON_CARRY
        self.last_season[team] = season

    def predict(self, home: str, away: str, season: int) -> Optional[float]:
        base = self.base(season)
        if base is None:
            return None
        carry = lambda t: self.dev.get(t, 0.0) * (SEASON_CARRY if self.last_season.get(t, season) != season else 1.0)
        return base + carry(home) + carry(away)

    def update(self, home: str, away: str, season: int, total: float) -> None:
        pred = self.predict(home, away, season)
        for team in (home, away):
            self._roll(team, season)
            if pred is not None:
                self.dev[team] = self.dev.get(team, 0.0) + self.alpha * (total - pred) / 2.0
            self.games[(team, season)] = self.games.get((team, season), 0) + 1
        cur = self.league.setdefault(season, [0.0, 0])
        cur[0] += total
        cur[1] += 1


def fit(sport: str, completed: pd.DataFrame) -> Optional[TotalsState]:
    if sport not in HALF_LIFE or completed.empty:
        return None
    state = TotalsState(sport)
    rows = completed.dropna(subset=["home_score", "away_score"]).sort_values(["start", "game_id"])
    rows = rows[(rows["home"] != "NON_D1") & (rows["away"] != "NON_D1")]
    for home, away, season, hs, as_ in zip(rows["home"], rows["away"], rows["season"], rows["home_score"], rows["away_score"]):
        state.update(str(home), str(away), int(season), float(hs) + float(as_))
    return state


def total_fields(sport: str, state: Optional[TotalsState], home: str, away: str, season: int, market_total: Optional[float]) -> Dict[str, Any]:
    """The report fields for one upcoming game; all None when there is no projection."""
    out: Dict[str, Any] = {"projectedTotal": None, "totalEdgePts": None, "totalLean": None, "totalEligible": False, "totalThreshold": THRESHOLD.get(sport)}
    if state is None or "NON_D1" in (home, away):
        return out
    pred = state.predict(home, away, season)
    if pred is None:
        return out
    out["projectedTotal"] = round(pred, 1)
    seasoned = min(state.games.get((home, season), 0), state.games.get((away, season), 0)) >= MIN_TEAM_GAMES
    out["totalEligible"] = bool(seasoned)
    if market_total is None or market_total != market_total:
        return out
    edge = pred - float(market_total)
    out["totalEdgePts"] = round(edge, 2)
    out["totalLean"] = ("over" if edge > 0 else "under") if seasoned and abs(edge) >= THRESHOLD[sport] else "none"
    return out
