"""NBA games from sportsdataverse ESPN schedule parquets (ending seasons 2016 to now).

The schedule files carry no betting lines, so the NBA frame has null market
columns and the NBA report is an independent model only.

Included: regular season (season_type 2), playoffs (3) and play-in games (5).
Excluded: preseason, All-Star/exhibition rows (non-NBA abbreviations such as
EAST/WEST/STARS/STRIPES/WORLD/TBD), and postponed rows. In-season tournament
(NBA Cup) group and knockout games are ordinary games and are kept.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import pandas as pd

from .common import cache_dir_for, download, finalize

RELEASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules/nba_schedule_{season}.parquet"
FIRST_SEASON = 2016
LABEL = "NBA"
BOOK = None

NBA_TEAMS = {
    "ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS", "HOU", "IND", "LAC", "LAL",
    "MEM", "MIA", "MIL", "MIN", "NO", "NY", "OKC", "ORL", "PHI", "PHX", "POR", "SA", "SAC", "TOR", "UTAH", "WSH",
}
SEASON_TYPES = {2: "regular", 3: "playoffs", 5: "play-in"}
# Older ESPN abbreviations that differ from the current ones.
TEAM_ALIASES = {"GSW": "GS", "NOP": "NO", "NYK": "NY", "SAS": "SA", "UTA": "UTAH", "WAS": "WSH", "PHO": "PHX", "BRK": "BKN", "NJN": "BKN"}


def normalize_team(team: str) -> str:
    return TEAM_ALIASES.get(str(team), str(team))


def current_ending_season(today: Optional[pd.Timestamp] = None) -> int:
    """ESPN ending-season for the season in progress on ``today`` (new season starts in October)."""
    today = today or pd.Timestamp.now(tz="UTC")
    return int(today.year + 1 if today.month >= 9 else today.year)


def convert_frame(raw: pd.DataFrame) -> pd.DataFrame:
    """Map an ESPN schedule frame into the contract columns (pure, no I/O)."""
    d = raw.copy()
    d["home"] = d["home_abbreviation"].map(normalize_team)
    d["away"] = d["away_abbreviation"].map(normalize_team)
    d = d[d["home"].isin(NBA_TEAMS) & d["away"].isin(NBA_TEAMS)]
    d = d[d["season_type"].isin(list(SEASON_TYPES))]
    status = d["status_type_name"].astype(str)
    d = d[~status.str.contains("POSTPONED|CANCELED", regex=True)]
    start = pd.to_datetime(d["date"], utc=True, errors="coerce")
    completed = (status == "STATUS_FINAL") & d["status_type_completed"].astype(bool)
    home_score = pd.to_numeric(d["home_score"], errors="coerce").where(completed)
    away_score = pd.to_numeric(d["away_score"], errors="coerce").where(completed)
    completed = completed & home_score.notna() & away_score.notna() & ((home_score + away_score) > 0)
    season = d["season"].astype(int)
    season_start = start.groupby(season).transform("min")
    week = ((start - season_start).dt.days // 7 + 1).astype("Int64")
    out = pd.DataFrame({
        "game_id": d["id"].astype(str),
        "season": season,
        "week": week,
        "start": start,
        "home": d["home"],
        "away": d["away"],
        "neutral": d["neutral_site"].astype(bool).astype(int),
        "home_score": home_score,
        "away_score": away_score,
        "spread_line": float("nan"),
        "spread_home_price": float("nan"),
        "spread_away_price": float("nan"),
        "home_ml": float("nan"),
        "away_ml": float("nan"),
        "total_line": float("nan"),
        "completed": completed,
        "game_type": d["season_type"].map(SEASON_TYPES),
        "status": status,
    })
    return out[out["start"].notna()]


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False, last_season: Optional[int] = None) -> pd.DataFrame:
    cache = cache_dir_for("nba", cache_dir)
    last = last_season or current_ending_season()
    frames: List[pd.DataFrame] = []
    sources = []
    for season in range(FIRST_SEASON, last + 1):
        url = RELEASE.format(season=season)
        dest = cache / f"nba_schedule_{season}.parquet"
        try:
            meta = download(url, dest, refresh=refresh)
        except Exception as exc:  # a season file that does not exist yet
            if season >= last:
                print(f"nba: no schedule file for season {season} ({exc})")
                continue
            raise
        sources.append(meta)
        frames.append(convert_frame(pd.read_parquet(dest)))
    frame = pd.concat(frames, ignore_index=True).drop_duplicates("game_id", keep="last")
    return finalize(frame, sources, BOOK, LABEL)
