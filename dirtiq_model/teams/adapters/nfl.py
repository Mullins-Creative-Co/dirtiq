"""NFL games from the nflverse ``games.csv`` archive (1999 to the current season).

Sign convention: nflverse ``spread_line`` is POSITIVE when the HOME team is favored
(verified empirically: home teams with spread_line > 0 won 67% of games and
outscored opponents by +5.95 on average; spread_line < 0 home teams won 35%).
The contract's ``spread_line`` is the home handicap (negative = home favorite), so
it is the negation. ``home_spread_odds``/``away_spread_odds`` are the prices for
the home/away side of that spread. Moneylines and totals carry over unchanged.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

from .common import cache_dir_for, download, finalize

URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
LABEL = "NFL"
BOOK = "nflverse consensus"

# Franchise moves: keep one id per franchise so ratings carry across the move.
TEAM_ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA"}
DEFAULT_KICKOFF_ET = "13:00"


def normalize_team(team: str) -> str:
    return TEAM_ALIASES.get(str(team), str(team))


def nflverse_spread_to_home_handicap(spread_line: pd.Series) -> pd.Series:
    """nflverse spread_line (home favored => positive) -> contract home handicap."""
    return -pd.to_numeric(spread_line, errors="coerce")


def convert_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Map the raw nflverse frame into the contract columns (pure, no I/O)."""
    gametime = raw["gametime"].fillna(DEFAULT_KICKOFF_ET).astype(str)
    local = pd.to_datetime(raw["gameday"].astype(str) + " " + gametime, errors="coerce")
    start = local.dt.tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward").dt.tz_convert("UTC")
    out = pd.DataFrame({
        "game_id": raw["game_id"].astype(str),
        "season": raw["season"].astype(int),
        "week": raw["week"].astype(int),
        "start": start,
        "home": raw["home_team"].map(normalize_team),
        "away": raw["away_team"].map(normalize_team),
        "neutral": (raw["location"].astype(str).str.lower() == "neutral").astype(int),
        "home_score": pd.to_numeric(raw["home_score"], errors="coerce"),
        "away_score": pd.to_numeric(raw["away_score"], errors="coerce"),
        "spread_line": nflverse_spread_to_home_handicap(raw["spread_line"]),
        "spread_home_price": pd.to_numeric(raw["home_spread_odds"], errors="coerce"),
        "spread_away_price": pd.to_numeric(raw["away_spread_odds"], errors="coerce"),
        "home_ml": pd.to_numeric(raw["home_moneyline"], errors="coerce"),
        "away_ml": pd.to_numeric(raw["away_moneyline"], errors="coerce"),
        "total_line": pd.to_numeric(raw["total_line"], errors="coerce"),
        "game_type": raw["game_type"].astype(str),
    })
    out["completed"] = out["home_score"].notna() & out["away_score"].notna() & pd.to_numeric(raw["result"], errors="coerce").notna()
    return out


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False) -> pd.DataFrame:
    cache = cache_dir_for("nfl", cache_dir)
    meta = download(URL, cache / "games.csv", refresh=refresh)
    raw = pd.read_csv(cache / "games.csv", low_memory=False)
    frame = convert_frame(raw)
    frame = frame[frame["start"].notna()]
    return finalize(frame, [meta], BOOK, LABEL)
