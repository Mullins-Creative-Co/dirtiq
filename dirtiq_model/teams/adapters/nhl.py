"""NHL games from the NHL stats REST API (seasons 2015-16 to the season in progress).

Source: ``https://api.nhle.com/stats/rest/en/game?cayenneExp=season=YYYYYYYY`` returns
every game of a season in one JSON document (``data`` rows with ``id, season,
gameType, gameDate, easternStartTime, gameStateId, gameScheduleStateId, homeTeamId,
visitingTeamId, homeScore, visitingScore, period``), including scheduled games with
zero scores. It was chosen over the day-based ``api-web.nhle.com/v1/schedule`` (one
request per day) and the per-club season endpoint (32 requests per season) because
one request per season is enough and it returns scores; the call can take 50-90 s,
so the download timeout is generous. Tri-codes come from
``https://api.nhle.com/stats/rest/en/team`` (``id`` -> ``triCode``).

Included: regular season (gameType 2) and playoffs (3). Excluded: preseason (1),
All-Star (4) and other exhibitions, postponed/cancelled rows (gameScheduleStateId 3/5)
and never-played "if necessary" playoff rows (unfinished games dated before the
season's last final).

Margin: goals. Any game decided after regulation (``period`` > 3: overtime or
shootout) is recorded as a one-goal margin for the winner (the feed already credits
the shootout winner with one goal). Ties cannot occur (``ties=False`` in the sport
config). The feed carries no neutral-site flag (Global Series games abroad count as
home games) and no betting lines; market columns are filled from ESPN's per-game
odds (``espn_odds``) for the 2019-20 season onward, with each game mapped to its ESPN
event through the ESPN scoreboard on local date and team abbreviation.

Team ids: NHL tri-code. The Arizona Coyotes (id 53) became Utah (id 68) in 2024 with
the same roster, so both ids map to ``UTA`` and the rating carries across the move.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import espn_odds
from .common import cache_dir_for, download, finalize

GAMES_URL = "https://api.nhle.com/stats/rest/en/game?cayenneExp=season={season_id}"
TEAMS_URL = "https://api.nhle.com/stats/rest/en/team"
FIRST_SEASON = 2016  # ending year of 2015-16
LABEL = "NHL"
BOOK = None
GAME_TYPES = {2: "regular", 3: "playoffs"}
FINAL_STATES = {6, 7}  # 7 = official final; 6 = final (seen on exhibition rows)
DROPPED_SCHEDULE_STATES = {3, 5}  # postponed, cancelled
TEAM_ALIASES = {"ARI": "UTA"}
DOWNLOAD_TIMEOUT = 600
NO_LINES = "NHL stats API carries no betting lines; ESPN per-game odds fill them from 2019-20"


def normalize_team(team: str) -> str:
    return TEAM_ALIASES.get(str(team), str(team))


def season_id(ending_year: int) -> str:
    return f"{ending_year - 1}{ending_year}"


def current_ending_season(today: Optional[pd.Timestamp] = None) -> int:
    """Ending year of the season in progress on ``today`` (the season opens in October)."""
    today = today or pd.Timestamp.now(tz="UTC")
    return int(today.year + 1 if today.month >= 9 else today.year)


def team_map(teams_payload: Dict[str, Any]) -> Dict[int, str]:
    return {int(t["id"]): str(t["triCode"]) for t in teams_payload.get("data", []) if t.get("triCode")}


def convert_frame(payload: Dict[str, Any], teams: Dict[int, str]) -> pd.DataFrame:
    """Map one season's stats-API payload into the contract columns (pure, no I/O)."""
    rows: List[Dict[str, Any]] = []
    for g in payload.get("data", []):
        gtype = int(g.get("gameType", 0))
        if gtype not in GAME_TYPES:
            continue
        if int(g.get("gameScheduleStateId", 1)) in DROPPED_SCHEDULE_STATES:
            continue
        season = int(str(g["season"])[-4:])
        rows.append({
            "game_id": str(g["id"]), "season": season, "game_date": str(g.get("gameDate")),
            "eastern": g.get("easternStartTime"),
            "home": normalize_team(teams.get(int(g["homeTeamId"]), str(g["homeTeamId"]))),
            "away": normalize_team(teams.get(int(g["visitingTeamId"]), str(g["visitingTeamId"]))),
            "home_goals": g.get("homeScore"), "away_goals": g.get("visitingScore"),
            "state": int(g.get("gameStateId", 0)), "period": int(g.get("period") or 0), "game_type": GAME_TYPES[gtype],
        })
    if not rows:
        return pd.DataFrame(columns=["game_id", "season", "week", "start", "home", "away", "neutral", "home_score", "away_score",
                                     "spread_line", "spread_home_price", "spread_away_price", "home_ml", "away_ml", "total_line",
                                     "completed", "game_type", "extra_time"])
    d = pd.DataFrame(rows)
    local = pd.to_datetime(d["eastern"], errors="coerce")
    start = local.dt.tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward").dt.tz_convert("UTC")
    start = start.fillna(pd.to_datetime(d["game_date"], utc=True, errors="coerce") + pd.Timedelta(hours=24))
    home_goals = pd.to_numeric(d["home_goals"], errors="coerce")
    away_goals = pd.to_numeric(d["away_goals"], errors="coerce")
    completed = d["state"].isin(FINAL_STATES) & home_goals.notna() & away_goals.notna() & ((home_goals + away_goals) > 0)
    extra_time = completed & (d["period"] > 3)
    margin = home_goals - away_goals
    # overtime/shootout rows: loser keeps its goals, winner is loser + 1 (a one-goal margin)
    loser = np.minimum(home_goals, away_goals)
    home_score = np.where(extra_time, loser + (margin > 0).astype(float), home_goals)
    away_score = np.where(extra_time, loser + (margin < 0).astype(float), away_goals)
    home_score = pd.Series(home_score, index=d.index).where(completed)
    away_score = pd.Series(away_score, index=d.index).where(completed)
    season_start = start.groupby(d["season"]).transform("min")
    week = ((start - season_start).dt.days // 7 + 1).astype("Int64")
    out = pd.DataFrame({
        "game_id": d["game_id"], "season": d["season"].astype(int), "week": week, "start": start,
        "home": d["home"], "away": d["away"], "neutral": 0,
        "home_score": home_score, "away_score": away_score,
        "spread_line": float("nan"), "spread_home_price": float("nan"), "spread_away_price": float("nan"),
        "home_ml": float("nan"), "away_ml": float("nan"), "total_line": float("nan"),
        "completed": completed, "game_type": d["game_type"], "extra_time": extra_time,
    })
    out = out[out["start"].notna() & (out["home"] != out["away"])]
    # never-played "if necessary" playoff rows: unfinished games dated before the season's last final
    last_final = out[out["completed"]].groupby("season")["start"].max()
    cutoff = out["season"].map(last_final)
    stale = (~out["completed"]) & cutoff.notna() & (out["start"] < cutoff.dt.normalize())
    return out[~stale]


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False, last_season: Optional[int] = None,
               lines: bool = True) -> pd.DataFrame:
    cache = cache_dir_for("nhl", cache_dir)
    last = last_season or current_ending_season()
    sources = [download(TEAMS_URL, cache / "teams.json", refresh=refresh, timeout=DOWNLOAD_TIMEOUT)]
    teams = team_map(json.loads((cache / "teams.json").read_text()))
    frames: List[pd.DataFrame] = []
    for season in range(FIRST_SEASON, last + 1):
        sid = season_id(season)
        dest = cache / f"games_{sid}.json"
        try:
            meta = download(GAMES_URL.format(season_id=sid), dest, refresh=refresh, timeout=DOWNLOAD_TIMEOUT)
            payload = json.loads(dest.read_text())
        except Exception as exc:
            if season >= last:
                print(f"nhl: no games for season {sid} ({exc})")
                continue
            raise
        if not payload.get("data"):
            if season >= last:
                print(f"nhl: season {sid} has no games yet")
                continue
        sources.append(meta)
        frames.append(convert_frame(payload, teams))
    frame = pd.concat(frames, ignore_index=True).drop_duplicates("game_id", keep="last")
    frame = drop_unplayed_past(frame)
    book = BOOK
    if lines:
        frame, odds_meta = espn_odds.attach(frame, "nhl", cache, refresh=refresh)
        if odds_meta.get("priced"):
            sources.append(odds_meta)
            book = espn_odds.BOOK
    return finalize(frame, sources, book, LABEL)


def drop_unplayed_past(frame: pd.DataFrame) -> pd.DataFrame:
    """Only the latest season keeps unfinished rows; earlier seasons' unfinished rows are
    never-played "if necessary" playoff games."""
    if frame.empty:
        return frame
    latest = int(frame["season"].max())
    return frame[frame["completed"] | (frame["season"] == latest)]
