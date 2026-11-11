"""MLB games from the MLB Stats API schedule (seasons 2015 to the current year).

Source: ``https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=YYYY&gameType=R,F,D,L,W``
(one JSON document per season, cached as ``schedule_YYYY.json`` with a ``.meta.json``
sidecar). Each ``dates[].games[]`` row carries ``gamePk, gameType, season, gameDate
(UTC), officialDate, status{abstractGameState, codedGameState, detailedState},
teams{home,away}{team{id,name}, score, isWinner}, venue{name}, doubleHeader,
gameNumber, isTie, description``. Final games carry ``teams.home.score`` /
``teams.away.score`` without ``hydrate=linescore`` (the hydrated and ``fields``-
filtered variants are much slower to generate server side, so they are not used).
Team abbreviations come from ``https://statsapi.mlb.com/api/v1/teams?sportId=1``
keyed by team id, so franchise renames/moves (Indians -> Guardians, Oakland ->
Sacramento Athletics) keep one rating.

Included: regular season (R) and postseason (F wild card, D division series, L league
championship, W World Series). Excluded by the request itself: spring training,
exhibitions and the All-Star game. Postponed and cancelled rows are dropped (a
postponed game reappears under its makeup date with the same gamePk).

Margin: runs. Ties are possible only for games called early and are kept as a zero
margin (``ties=False`` still drops the tie mass from forecasts). The feed has no
neutral-site flag: games at the known international venues and the 2020 bubble
postseason are flagged neutral; everything else is a home game. The feed has no
betting lines; market columns are filled from ESPN's per-game odds (``espn_odds``)
from 2017 onward, with each game mapped to its ESPN event through the ESPN
scoreboard on local date and team abbreviation (doubleheaders pair in start order).
Probable pitchers (``hydrate=probablePitcher``, one document per season cached as
``pitchers_YYYY.json``) give ``home_starter`` / ``away_starter`` player ids for the
stacked layer's starter adjustment; for completed games the last listed probable is
the actual starter in all but a handful of scratches.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from . import espn_odds
from .common import cache_dir_for, download, finalize

SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&season={season}&gameType=R,F,D,L,W"
# probable pitchers per game (the final listed probable is the actual starter for completed games);
# one document per season, kept separate from the schedule because the hydrated call is slower
PITCHERS_URL = (SCHEDULE_URL + "&hydrate=probablePitcher&fields=dates,games,gamePk,teams,home,away,probablePitcher,id")
TEAMS_URL = "https://statsapi.mlb.com/api/v1/teams?sportId=1"
FIRST_SEASON = 2015
LABEL = "MLB"
BOOK = None
GAME_TYPES = {"R": "regular", "F": "wild-card", "D": "division-series", "L": "league-championship", "W": "world-series"}
DROPPED_STATES = ("Postponed", "Cancelled", "Canceled", "Suspended")
NEUTRAL_VENUES = {
    "london stadium", "estadio alfredo harp helu", "estadio alfredo harp helú", "gocheok sky dome", "tokyo dome",
    "hiram bithorn stadium", "sydney cricket ground", "estadio de beisbol monterrey", "estadio de béisbol monterrey",
    "fort bragg field",
}
DOWNLOAD_TIMEOUT = 600
NO_LINES = "MLB Stats API carries no betting lines; ESPN per-game odds fill them from 2017"


def current_season(today: Optional[pd.Timestamp] = None) -> int:
    today = today or pd.Timestamp.now(tz="UTC")
    return int(today.year)


def team_map(teams_payload: Dict[str, Any]) -> Dict[int, str]:
    return {int(t["id"]): str(t["abbreviation"]) for t in teams_payload.get("teams", []) if t.get("abbreviation")}


def is_neutral(venue: str, season: int, game_type: str) -> int:
    if str(venue).strip().lower() in NEUTRAL_VENUES:
        return 1
    if season == 2020 and game_type in ("D", "L", "W"):  # bubble postseason at neutral parks
        return 1
    return 0


def starters(payload: Dict[str, Any]) -> Dict[str, Dict[str, Optional[str]]]:
    """``gamePk -> {"home_starter": id, "away_starter": id}`` from a probable-pitcher schedule document (pure)."""
    out: Dict[str, Dict[str, Optional[str]]] = {}
    for day in payload.get("dates", []):
        for g in day.get("games", []):
            teams = g.get("teams") or {}
            rec = {}
            for side in ("home", "away"):
                pid = ((teams.get(side) or {}).get("probablePitcher") or {}).get("id")
                rec[f"{side}_starter"] = str(pid) if pid is not None else None
            out[str(g.get("gamePk"))] = rec
    return out


def convert_frame(payload: Dict[str, Any], teams: Dict[int, str]) -> pd.DataFrame:
    """Map one season's schedule payload into the contract columns (pure, no I/O)."""
    rows: List[Dict[str, Any]] = []
    for day in payload.get("dates", []):
        for g in day.get("games", []):
            gtype = str(g.get("gameType"))
            if gtype not in GAME_TYPES:
                continue
            status = g.get("status") or {}
            detailed = str(status.get("detailedState", ""))
            if any(detailed.startswith(s) for s in DROPPED_STATES):
                continue
            home, away = (g.get("teams") or {}).get("home") or {}, (g.get("teams") or {}).get("away") or {}
            home_id, away_id = int((home.get("team") or {}).get("id", 0)), int((away.get("team") or {}).get("id", 0))
            season = int(g.get("season") or str(g.get("officialDate", ""))[:4])
            rows.append({
                "game_id": str(g["gamePk"]), "season": season, "start": g.get("gameDate"),
                "home": teams.get(home_id, str(home_id)), "away": teams.get(away_id, str(away_id)),
                "neutral": is_neutral((g.get("venue") or {}).get("name", ""), season, gtype),
                "home_score": home.get("score"), "away_score": away.get("score"),
                "final": str(status.get("abstractGameState", "")) == "Final" and str(status.get("codedGameState", "")) in ("F", "O"),
                "game_type": GAME_TYPES[gtype], "status": detailed, "double_header": str(g.get("doubleHeader", "N")),
                "tie": bool(g.get("isTie", False)),
            })
    cols = ["game_id", "season", "week", "start", "home", "away", "neutral", "home_score", "away_score", "spread_line",
            "spread_home_price", "spread_away_price", "home_ml", "away_ml", "total_line", "completed", "game_type", "status",
            "double_header", "tie"]
    if not rows:
        return pd.DataFrame(columns=cols)
    d = pd.DataFrame(rows)
    start = pd.to_datetime(d["start"], utc=True, errors="coerce")
    home_score = pd.to_numeric(d["home_score"], errors="coerce")
    away_score = pd.to_numeric(d["away_score"], errors="coerce")
    completed = d["final"].astype(bool) & home_score.notna() & away_score.notna()
    season_start = start.groupby(d["season"]).transform("min")
    week = ((start - season_start).dt.days // 7 + 1).astype("Int64")
    out = pd.DataFrame({
        "game_id": d["game_id"], "season": d["season"].astype(int), "week": week, "start": start,
        "home": d["home"], "away": d["away"], "neutral": d["neutral"].astype(int),
        "home_score": home_score.where(completed), "away_score": away_score.where(completed),
        "spread_line": float("nan"), "spread_home_price": float("nan"), "spread_away_price": float("nan"),
        "home_ml": float("nan"), "away_ml": float("nan"), "total_line": float("nan"),
        "completed": completed, "game_type": d["game_type"], "status": d["status"],
        "double_header": d["double_header"], "tie": d["tie"],
    })
    out = out[out["start"].notna() & (out["home"] != out["away"])]
    # a game listed twice (postponed then played) keeps its completed row
    return out.sort_values(["completed", "start"]).drop_duplicates("game_id", keep="last")


def load_games(cache_dir: Optional[Path] = None, refresh: bool = False, last_season: Optional[int] = None,
               lines: bool = True) -> pd.DataFrame:
    cache = cache_dir_for("mlb", cache_dir)
    last = last_season or current_season()
    sources = [download(TEAMS_URL, cache / "teams.json", refresh=refresh, timeout=DOWNLOAD_TIMEOUT)]
    teams = team_map(json.loads((cache / "teams.json").read_text()))
    frames: List[pd.DataFrame] = []
    for season in range(FIRST_SEASON, last + 1):
        dest = cache / f"schedule_{season}.json"
        try:
            meta = download(SCHEDULE_URL.format(season=season), dest, refresh=refresh, timeout=DOWNLOAD_TIMEOUT)
            payload = json.loads(dest.read_text())
        except Exception as exc:
            if season >= last:
                print(f"mlb: no schedule for season {season} ({exc})")
                continue
            raise
        if not payload.get("dates"):
            if season >= last:
                print(f"mlb: season {season} has no games yet")
                continue
        sources.append(meta)
        converted = convert_frame(payload, teams)
        pdest = cache / f"pitchers_{season}.json"
        try:
            pmeta = download(PITCHERS_URL.format(season=season), pdest, refresh=refresh and season >= last, timeout=DOWNLOAD_TIMEOUT)
            pitchers = starters(json.loads(pdest.read_text()))
            sources.append(pmeta)
        except Exception as exc:  # starters are a feature, not a requirement
            print(f"mlb: no probable pitchers for season {season} ({exc})")
            pitchers = {}
        converted["home_starter"] = converted["game_id"].map(lambda g: (pitchers.get(g) or {}).get("home_starter"))
        converted["away_starter"] = converted["game_id"].map(lambda g: (pitchers.get(g) or {}).get("away_starter"))
        frames.append(converted)
    frame = pd.concat(frames, ignore_index=True).drop_duplicates("game_id", keep="last")
    book = BOOK
    if lines:
        frame, odds_meta = espn_odds.attach(frame, "mlb", cache, refresh=refresh)
        if odds_meta.get("priced"):
            sources.append(odds_meta)
            book = espn_odds.BOOK
    return finalize(frame, sources, book, LABEL)
