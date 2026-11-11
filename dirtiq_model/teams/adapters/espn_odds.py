"""Historical and current betting lines from ESPN's core API, attached to NBA, NCAAB,
NHL and MLB frames whose schedule sources carry no market.

Endpoint (one request per game, many books per game)::

    https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds

Each item is one book: ``spread`` is the *home* handicap (negative = home favourite,
confirmed against ``homeTeamOdds.favorite`` and ``details``), ``homeTeamOdds`` /
``awayTeamOdds`` carry ``moneyLine`` and ``spreadOdds``; from 2022 the books also carry
nested ``open`` / ``close`` / ``current`` blocks. Per game we take, across real
sportsbooks (aggregators, projections and in-play feeds are excluded), the median
home spread, median side prices, median moneylines and median total, preferring
each book's closing block for completed games and its current block otherwise.
Opening medians are kept in ``open_*`` columns so offline closing-line value can be
measured where both exist.

Coverage: NBA from the 2015-16 season, MLB from 2017, NHL from 2019-20 and NCAAB
from 2018-19 (earlier seasons have no or near-empty odds). NBA and NCAAB frames
already use ESPN event ids. NHL and MLB frames use league ids, so their games are
mapped to ESPN events through the per-day scoreboard (``site.api.espn.com``) on
local date and team abbreviation, with a small alias table and a learned fallback
for the unmatched leftovers of a day.

Cache (never inside the repo): ``<cache>/espn/scoreboard_YYYYMMDD.json`` and
``<cache>/espn/odds_<season>.jsonl`` (one compact line per event, rewritten whole
after each run; completed games are never refetched, upcoming games are refetched
when older than ``REFRESH_AFTER_HOURS`` or on ``refresh``).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .common import now_iso

LEAGUES: Dict[str, Tuple[str, str]] = {
    "nba": ("basketball", "nba"),
    "ncaab": ("basketball", "mens-college-basketball"),
    "nhl": ("hockey", "nhl"),
    "mlb": ("baseball", "mlb"),
    "ncaaf": ("football", "college-football"),
}
# first frame season (ending year for nba/ncaab/nhl, calendar year for mlb) with usable ESPN odds
FIRST_ODDS_SEASON = {"nba": 2016, "ncaab": 2019, "nhl": 2020, "mlb": 2017, "ncaaf": 2026}
USES_ESPN_IDS = {"nba", "ncaab", "ncaaf"}
BOOK = "ESPN multi-book median"
ODDS_URL = "https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{eid}/competitions/{eid}/odds?limit=50"
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates={date}{extra}"
SCOREBOARD_EXTRA = {"ncaab": "&groups=50&limit=400", "ncaaf": "&groups=80&limit=300", "nba": "&limit=100", "nhl": "&limit=100", "mlb": "&limit=100"}
EXCLUDED_PROVIDER_WORDS = ("live", "accuscore", "numberfire", "teamrankings", "consensus", "pickcenter")
LOCAL_TZ = ZoneInfo("America/New_York")
WORKERS = 16
REFRESH_AFTER_HOURS = 6
UPCOMING_HORIZON_DAYS = 10
RETRIES = 4
USER_AGENT = "Mozilla/5.0 (dirtiq-model)"
# ESPN scoreboard abbreviation -> frame abbreviation where they differ
ALIASES: Dict[str, Dict[str, str]] = {
    "nhl": {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL", "UTAH": "UTA", "ARI": "UTA"},
    "mlb": {"ARI": "AZ", "CHW": "CWS", "OAK": "OAK", "ATH": "ATH"},
}


# ----------------------------------------------------------------------------- HTTP

def _get_json(url: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
    """GET JSON with retries. Returns ``None`` on 404 (no odds for the event); raises on persistent failure."""
    last: Optional[Exception] = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
        except Exception as exc:  # network hiccup
            last = exc
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"ESPN request failed after {RETRIES} attempts: {url} ({last})")


# ----------------------------------------------------------------------------- consolidation (pure)

def _american(block: Any) -> Optional[float]:
    """Parse ``{"american": "-110"}`` / ``{"american": "+4.5"}``; also accepts bare numbers."""
    if block is None:
        return None
    if isinstance(block, dict):
        v = block.get("american")
        if v is None:
            v = block.get("value")
    else:
        v = block
    try:
        s = str(v).strip().replace("EVEN", "100").replace("even", "100")
        return float(s)
    except (TypeError, ValueError):
        return None


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(f) else f


def book_row(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One ESPN odds item -> compact per-book record, or ``None`` for excluded providers.

    ``spread`` is the home handicap. Closing values are taken from the nested ``close``
    block when present (``has_close``), otherwise the item's top-level values."""
    provider = str((item.get("provider") or {}).get("name") or "")
    low = provider.lower()
    if not provider or any(w in low for w in EXCLUDED_PROVIDER_WORDS):
        return None
    home = item.get("homeTeamOdds") or {}
    away = item.get("awayTeamOdds") or {}
    spread = _num(item.get("spread"))
    fav = home.get("favorite")
    if spread is not None and fav is not None:
        spread = -abs(spread) if fav else abs(spread)
    rec: Dict[str, Any] = {
        "provider": provider,
        "spread": spread,
        "home_spread_price": _num(home.get("spreadOdds")),
        "away_spread_price": _num(away.get("spreadOdds")),
        "home_ml": _num(home.get("moneyLine")),
        "away_ml": _num(away.get("moneyLine")),
        "total": _num(item.get("overUnder")),
        "has_close": False,
    }
    close_h = home.get("close") if isinstance(home.get("close"), dict) else None
    close_a = away.get("close") if isinstance(away.get("close"), dict) else None
    if close_h:
        ps = _american(close_h.get("pointSpread"))
        if ps is not None:
            rec["spread"] = ps
        for key, blk in (("home_spread_price", close_h.get("spread")), ("home_ml", close_h.get("moneyLine"))):
            v = _american(blk)
            if v is not None:
                rec[key] = v
        rec["has_close"] = True
    if close_a:
        for key, blk in (("away_spread_price", close_a.get("spread")), ("away_ml", close_a.get("moneyLine"))):
            v = _american(blk)
            if v is not None:
                rec[key] = v
    open_h = home.get("open") if isinstance(home.get("open"), dict) else None
    open_a = away.get("open") if isinstance(away.get("open"), dict) else None
    rec["open_spread"] = _american(open_h.get("pointSpread")) if open_h else None
    rec["open_home_ml"] = _american(open_h.get("moneyLine")) if open_h else None
    rec["open_away_ml"] = _american(open_a.get("moneyLine")) if open_a else None
    # a moneyline price inside (-100, 100) is not a real quote
    for key in ("home_ml", "away_ml", "open_home_ml", "open_away_ml", "home_spread_price", "away_spread_price"):
        v = rec.get(key)
        if v is not None and abs(v) < 100:
            rec[key] = None if abs(v) < 1 else (-100.0 if v < 0 else 100.0)
    if all(rec.get(k) is None for k in ("spread", "home_ml", "away_ml", "total")):
        return None
    return rec


def compact_event(payload: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = (payload or {}).get("items") or []
    rows = [book_row(i) for i in items]
    return [r for r in rows if r is not None]


def _median(values: Iterable[Optional[float]]) -> Optional[float]:
    vals = [float(v) for v in values if v is not None and not (isinstance(v, float) and np.isnan(v))]
    return float(np.median(vals)) if vals else None


def _legal_price(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    r = float(round(v))
    if abs(r) < 100:
        return -100.0 if r < 0 else 100.0
    return r


def consolidate(books: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Median across books -> contract market columns plus ``open_*`` and ``books``."""
    if not books:
        return {"spread_line": None, "spread_home_price": None, "spread_away_price": None, "home_ml": None, "away_ml": None,
                "total_line": None, "open_spread_line": None, "open_home_ml": None, "open_away_ml": None, "books": 0, "closing": False}
    # moneylines must come from books quoting both sides, so the pair is vig-consistent
    ml_books = [b for b in books if b.get("home_ml") is not None and b.get("away_ml") is not None]
    sp_books = [b for b in books if b.get("spread") is not None]
    return {
        "spread_line": _median(b["spread"] for b in sp_books),
        "spread_home_price": _legal_price(_median(b.get("home_spread_price") for b in sp_books)),
        "spread_away_price": _legal_price(_median(b.get("away_spread_price") for b in sp_books)),
        "home_ml": _legal_price(_median(b["home_ml"] for b in ml_books)),
        "away_ml": _legal_price(_median(b["away_ml"] for b in ml_books)),
        "total_line": _median(b.get("total") for b in books),
        "open_spread_line": _median(b.get("open_spread") for b in books),
        "open_home_ml": _legal_price(_median(b.get("open_home_ml") for b in books if b.get("open_away_ml") is not None)),
        "open_away_ml": _legal_price(_median(b.get("open_away_ml") for b in books if b.get("open_home_ml") is not None)),
        "books": len(books),
        "closing": any(b.get("has_close") for b in books),
    }


# ----------------------------------------------------------------------------- odds cache

def _espn_dir(cache: Path) -> Path:
    d = Path(cache) / "espn"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_odds_cache(cache: Path, season: int) -> Dict[str, Dict[str, Any]]:
    path = _espn_dir(cache) / f"odds_{season}.jsonl"
    out: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        return out
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            out[str(rec["id"])] = rec
    return out


def save_odds_cache(cache: Path, season: int, records: Dict[str, Dict[str, Any]]) -> Path:
    path = _espn_dir(cache) / f"odds_{season}.jsonl"
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as fh:
        for eid in sorted(records, key=lambda s: (len(s), s)):
            fh.write(json.dumps(records[eid], separators=(",", ":")) + "\n")
    tmp.replace(path)
    return path


def _stale(rec: Dict[str, Any], now: datetime) -> bool:
    try:
        fetched = datetime.fromisoformat(str(rec.get("fetchedAt", "")).replace("Z", "+00:00"))
    except ValueError:
        return True
    return (now - fetched) > timedelta(hours=REFRESH_AFTER_HOURS)


def fetch_odds(sport: str, cache: Path, wanted: pd.DataFrame, refresh: bool = False, workers: int = WORKERS,
               now: Optional[datetime] = None, log: bool = True) -> Dict[str, Dict[str, Any]]:
    """Ensure the cache holds odds for every row of ``wanted`` (``espn_id, season, completed``).

    Returns ``{espn_id: record}`` with ``record = {id, season, fetchedAt, final, books: [...]}``."""
    sp, lg = LEAGUES[sport]
    now = now or datetime.now(timezone.utc)
    out: Dict[str, Dict[str, Any]] = {}
    for season, grp in wanted.groupby("season"):
        season = int(season)
        records = load_odds_cache(cache, season)
        todo: List[Tuple[str, bool]] = []
        for eid, completed in zip(grp["espn_id"].astype(str), grp["completed"].astype(bool)):
            rec = records.get(eid)
            if rec is None:
                todo.append((eid, completed))
            elif not rec.get("final") and (refresh or completed or _stale(rec, now)):
                todo.append((eid, completed))
        if todo:
            if log:
                print(f"{sport}: fetching ESPN odds for {len(todo)} games of season {season}")

            def one(job: Tuple[str, bool]) -> Tuple[str, Optional[Dict[str, Any]]]:
                eid, completed = job
                try:
                    payload = _get_json(ODDS_URL.format(sport=sp, league=lg, eid=eid))
                except RuntimeError as exc:
                    if log:
                        print(f"  {eid}: {exc}")
                    return eid, None
                books = compact_event(payload)
                return eid, {"id": eid, "season": season, "fetchedAt": now_iso(), "final": bool(completed), "books": books}

            with ThreadPoolExecutor(max_workers=workers) as ex:
                for eid, rec in ex.map(one, todo):
                    if rec is not None:
                        records[eid] = rec
            save_odds_cache(cache, season, records)
        for eid in grp["espn_id"].astype(str):
            if eid in records:
                out[eid] = records[eid]
    return out


# ----------------------------------------------------------------------------- NHL / MLB id mapping

def local_date(ts: pd.Series) -> pd.Series:
    return pd.to_datetime(ts, utc=True).dt.tz_convert(LOCAL_TZ).dt.strftime("%Y%m%d")


def scoreboard_events(sport: str, cache: Path, dates: Sequence[str], refresh: bool = False, workers: int = WORKERS,
                      today: Optional[str] = None, log: bool = True) -> pd.DataFrame:
    """ESPN events for each ``YYYYMMDD`` (local) date: ``espn_id, date, start, home_abbr, away_abbr``.

    Past days are cached forever; today and future days are refetched on ``refresh``."""
    sp, lg = LEAGUES[sport]
    sdir = _espn_dir(cache)
    today = today or datetime.now(LOCAL_TZ).strftime("%Y%m%d")
    todo = []
    for d in sorted(set(dates)):
        path = sdir / f"scoreboard_{d}.json"
        if not path.exists() or (d >= today and refresh):
            todo.append(d)
        elif d < today and refresh and _scoreboard_unfinished(path):
            todo.append(d)
    if todo:
        if log:
            print(f"{sport}: fetching ESPN scoreboards for {len(todo)} days")

        def one(d: str) -> None:
            url = SCOREBOARD_URL.format(sport=sp, league=lg, date=d, extra=SCOREBOARD_EXTRA.get(sport, ""))
            try:
                payload = _get_json(url) or {"events": []}
            except RuntimeError as exc:  # a day that fails stays uncached and is retried next run
                if log:
                    print(f"  scoreboard {d}: {exc}")
                return
            rows = []
            for ev in payload.get("events", []):
                comp = (ev.get("competitions") or [{}])[0]
                teams = {c.get("homeAway"): c for c in comp.get("competitors", [])}
                h, a = teams.get("home"), teams.get("away")
                if not h or not a:
                    continue
                rows.append({"espn_id": str(ev.get("id")), "start": comp.get("date") or ev.get("date"),
                             "home_abbr": (h.get("team") or {}).get("abbreviation"), "away_abbr": (a.get("team") or {}).get("abbreviation"),
                             "season": (ev.get("season") or {}).get("year"), "season_type": (ev.get("season") or {}).get("type"),
                             "week": (ev.get("week") or {}).get("number"), "neutral": int(bool(comp.get("neutralSite"))),
                             "status": ((ev.get("status") or {}).get("type") or {}).get("name"),
                             "home_score": h.get("score"), "away_score": a.get("score")})
            tmp = (sdir / f"scoreboard_{d}.json").with_suffix(".tmp")
            tmp.write_text(json.dumps({"date": d, "fetchedAt": now_iso(), "events": rows}))
            tmp.replace(sdir / f"scoreboard_{d}.json")

        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(one, todo))
    rows: List[Dict[str, Any]] = []
    for d in sorted(set(dates)):
        path = sdir / f"scoreboard_{d}.json"
        if not path.exists():
            continue
        for ev in json.loads(path.read_text()).get("events", []):
            rows.append({"date": d, **ev})
    cols = ["espn_id", "date", "start", "home_abbr", "away_abbr", "season", "season_type", "week", "neutral", "status", "home_score", "away_score"]
    return pd.DataFrame(rows, columns=cols) if rows else pd.DataFrame(columns=cols)


def upcoming_frame(sport: str, cache: Path, days: int = UPCOMING_HORIZON_DAYS, refresh: bool = False,
                   now: Optional[datetime] = None, log: bool = True, lookback: int = 7) -> pd.DataFrame:
    """ESPN events from ``lookback`` days ago through the next ``days`` local days as
    contract-shaped rows (``game_id`` = ESPN event id, teams = ESPN abbreviations, market
    columns null): scheduled games as upcoming rows, final games with their scores as
    completed rows, so results the schedule archive has not published yet still settle.

    Used where the schedule archive has no future games (NCAAF). Scoreboards from the
    last ``lookback`` days, today and the future are refetched on ``refresh``."""
    now = now or datetime.now(timezone.utc)
    local_now = now.astimezone(LOCAL_TZ)
    dates = [(local_now + timedelta(days=i)).strftime("%Y%m%d") for i in range(-lookback, days + 1)]
    ev = scoreboard_events(sport, cache, dates, refresh=refresh, today=dates[0], log=log)
    cols = ["game_id", "season", "week", "start", "home", "away", "neutral", "home_score", "away_score", "completed", "game_type"]
    if ev.empty:
        return pd.DataFrame(columns=cols)
    status = ev["status"].astype(str).str.upper()
    ev = ev[status.isin(["STATUS_SCHEDULED", "STATUS_FINAL"])].drop_duplicates("espn_id", keep="last")
    status = ev["status"].astype(str).str.upper()
    season_type = pd.to_numeric(ev["season_type"], errors="coerce")
    home_score = pd.to_numeric(ev["home_score"], errors="coerce")
    away_score = pd.to_numeric(ev["away_score"], errors="coerce")
    final = status.eq("STATUS_FINAL") & home_score.notna() & away_score.notna() & ((home_score + away_score) > 0)
    out = pd.DataFrame({
        "game_id": ev["espn_id"].astype(str), "season": pd.to_numeric(ev["season"], errors="coerce"),
        "week": pd.to_numeric(ev["week"], errors="coerce"), "start": pd.to_datetime(ev["start"], utc=True, errors="coerce"),
        "home": ev["home_abbr"].astype(str), "away": ev["away_abbr"].astype(str), "neutral": ev["neutral"].fillna(0).astype(int),
        "home_score": home_score.where(final), "away_score": away_score.where(final), "completed": final,
        "game_type": np.where(season_type == 3, "postseason", "regular"),
    })
    out = out[out["start"].notna() & out["season"].notna() & (out["completed"] | (out["start"] >= pd.Timestamp(now)))]
    out["season"] = out["season"].astype(int)
    return out.reset_index(drop=True)


def _scoreboard_unfinished(path: Path) -> bool:
    """A cached past day whose events are not all final (cached before the games ended)."""
    try:
        events = json.loads(path.read_text()).get("events", [])
    except ValueError:
        return True
    return any(str(e.get("status", "")).upper() not in ("STATUS_FINAL", "STATUS_CANCELED", "STATUS_POSTPONED") for e in events)


def map_events(games: pd.DataFrame, events: pd.DataFrame, aliases: Dict[str, str]) -> Tuple[pd.Series, Dict[str, str]]:
    """Match frame games to ESPN events on local date + home/away abbreviation (pure).

    Returns (``espn_id`` indexed like ``games``, learned aliases). Unmatched leftovers
    of a day are paired when exactly one game and one event remain, and the
    abbreviation pair is learned for the rest of the run (and reported)."""
    g = games[["game_id", "start", "home", "away"]].copy()
    g["date"] = local_date(g["start"])
    e = events.copy()
    if e.empty:
        return pd.Series(index=games.index, dtype=object), {}
    e["date"] = local_date(e["start"])
    learned: Dict[str, str] = {}
    result: Dict[str, str] = {}
    alias = dict(aliases)
    for _ in range(2):  # second pass applies learned aliases
        e["home"] = e["home_abbr"].map(lambda s: alias.get(str(s), str(s)))
        e["away"] = e["away_abbr"].map(lambda s: alias.get(str(s), str(s)))
        for date, gg in g[~g["game_id"].isin(result)].groupby("date"):
            ee = e[(e["date"] == date) & ~e["espn_id"].isin(result.values())]
            if ee.empty:
                continue
            used = set()
            # exact matches; doubleheaders pair in start order
            for (h, a), sub in gg.groupby(["home", "away"]):
                cand = ee[(ee["home"] == h) & (ee["away"] == a) & ~ee["espn_id"].isin(used)].sort_values("start")
                for gid, eid in zip(sub.sort_values("start")["game_id"], cand["espn_id"]):
                    result[gid] = eid
                    used.add(eid)
            left_g = gg[~gg["game_id"].isin(result)]
            left_e = ee[~ee["espn_id"].isin(used)]
            if len(left_g) == 1 and len(left_e) == 1:
                lg_row, le_row = left_g.iloc[0], left_e.iloc[0]
                for frame_abbr, espn_abbr in ((lg_row["home"], le_row["home_abbr"]), (lg_row["away"], le_row["away_abbr"])):
                    if frame_abbr != alias.get(espn_abbr, espn_abbr):
                        learned[espn_abbr] = frame_abbr
                        alias[espn_abbr] = frame_abbr
                result[lg_row["game_id"]] = le_row["espn_id"]
    mapped = g["game_id"].map(result)
    mapped.index = games.index
    return mapped, learned


# ----------------------------------------------------------------------------- entry point

def attach(frame: pd.DataFrame, sport: str, cache: Path, refresh: bool = False, workers: int = WORKERS,
           now: Optional[datetime] = None, log: bool = True, overwrite: bool = True) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Fill the contract market columns of ``frame`` from ESPN odds; returns (frame, source meta).

    Rows before ``FIRST_ODDS_SEASON[sport]`` and upcoming rows beyond
    ``UPCOMING_HORIZON_DAYS`` are left untouched. With ``overwrite=False`` only rows
    that have neither a spread nor a moneyline are filled (NCAAF keeps its archive)."""
    if sport not in LEAGUES:
        raise ValueError(f"no ESPN odds mapping for {sport!r}")
    now = now or datetime.now(timezone.utc)
    out = frame.copy()
    for col in ("open_spread_line", "open_home_ml", "open_away_ml", "books"):
        if col not in out.columns:
            out[col] = np.nan
    start = pd.to_datetime(out["start"], utc=True)
    horizon = pd.Timestamp(now) + pd.Timedelta(days=UPCOMING_HORIZON_DAYS)
    scope = (out["season"].astype(int) >= FIRST_ODDS_SEASON[sport]) & (out["completed"].astype(bool) | (start <= horizon))
    if not overwrite:
        scope &= out["spread_line"].isna() & out["home_ml"].isna()
    sub = out[scope].copy()
    meta: Dict[str, Any] = {"url": ODDS_URL.format(sport=LEAGUES[sport][0], league=LEAGUES[sport][1], eid="{event}"),
                            "book": BOOK, "inScope": int(len(sub))}
    if sub.empty:
        meta.update(matched=0, priced=0)
        return out, meta
    if sport in USES_ESPN_IDS:
        sub["espn_id"] = sub["game_id"].astype(str)
        learned: Dict[str, str] = {}
    else:
        dates = local_date(sub["start"]).unique().tolist()
        events = scoreboard_events(sport, cache, dates, refresh=refresh, workers=workers, log=log)
        mapped, learned = map_events(sub, events, ALIASES.get(sport, {}))
        sub["espn_id"] = mapped
        if learned and log:
            print(f"{sport}: learned ESPN abbreviation aliases {learned}")
    matched = sub[sub["espn_id"].notna()]
    meta["matched"] = int(len(matched))
    meta["unmatched"] = int(len(sub) - len(matched))
    meta["learnedAliases"] = learned
    records = fetch_odds(sport, cache, matched[["espn_id", "season", "completed"]], refresh=refresh, workers=workers, now=now, log=log)
    cons = {eid: consolidate(rec.get("books", [])) for eid, rec in records.items()}
    fetched_at = [rec.get("fetchedAt") for rec in records.values() if rec.get("fetchedAt")]
    priced = 0
    cols = ("spread_line", "spread_home_price", "spread_away_price", "home_ml", "away_ml", "total_line",
            "open_spread_line", "open_home_ml", "open_away_ml", "books")
    values = {c: [] for c in cols}
    idx = []
    for i, eid in zip(matched.index, matched["espn_id"].astype(str)):
        c = cons.get(eid)
        if not c:
            continue
        idx.append(i)
        for col in cols:
            values[col].append(c.get(col))
        if c.get("spread_line") is not None or c.get("home_ml") is not None:
            priced += 1
    for col in cols:
        out.loc[idx, col] = pd.to_numeric(pd.Series(values[col], index=idx), errors="coerce")
    meta["priced"] = priced
    meta["retrievedAt"] = max(fetched_at) if fetched_at else now_iso()
    meta["sha256"] = ""
    if log:
        print(f"{sport}: ESPN odds attached to {priced} of {len(sub)} games in scope ({meta['unmatched']} unmatched)")
    return out, meta
