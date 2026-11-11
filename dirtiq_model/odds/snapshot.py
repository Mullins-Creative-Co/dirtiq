"""Fetch, consolidate, persist and apply an odds snapshot."""
from __future__ import annotations

import json
import os
import statistics
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..ledger_core import Ledger, now_iso
from .teams import SPORT_KEYS, TeamMapper

ROOT = Path(__file__).resolve().parent.parent.parent
ODDS_DIR = ROOT / "public" / "data" / "odds"
STATUS_PATH = ODDS_DIR / "status.json"
API_BASE = "https://api.the-odds-api.com/v4"
CONSENSUS_BOOK = "odds-api consensus"
MATCH_WINDOW_HOURS = 36


def api_key() -> Optional[str]:
    key = os.environ.get("ODDS_API_KEY", "").strip()
    return key or None


def fetch_odds(sport: str, key: str, regions: str = "us", timeout: int = 30) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """GET current spreads and moneylines for one sport. Returns (events, quota headers)."""
    sport_key = SPORT_KEYS[sport]
    query = urllib.parse.urlencode({"apiKey": key, "regions": regions, "markets": "h2h,spreads", "oddsFormat": "american"})
    url = f"{API_BASE}/sports/{sport_key}/odds?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "dirtiq-model/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        headers = {k.lower(): v for k, v in resp.headers.items()}
    quota = {k: headers[k] for k in ("x-requests-remaining", "x-requests-used", "x-requests-last") if k in headers}
    return payload, quota


def _median(values: Sequence[float]) -> Optional[float]:
    vals = [float(v) for v in values if v is not None]
    return statistics.median(vals) if vals else None


def consolidate(sport: str, events: List[Dict[str, Any]], mapper: TeamMapper, observed_at: Optional[str] = None) -> List[Dict[str, Any]]:
    """Per event: home/away abbreviations, start, and a median-across-books consensus.

    Spread is the home handicap (negative = home favorite), as the contract uses."""
    observed_at = observed_at or now_iso()
    out: List[Dict[str, Any]] = []
    for ev in events:
        home_name = ev.get("home_team") or ""
        away_name = ev.get("away_team") or ""
        home = mapper.resolve(home_name)
        away = mapper.resolve(away_name)
        if not home or not away:
            continue
        spreads: List[float] = []
        home_sp: List[float] = []
        away_sp: List[float] = []
        home_ml: List[float] = []
        away_ml: List[float] = []
        books: List[Dict[str, Any]] = []
        for bk in ev.get("bookmakers", []):
            row: Dict[str, Any] = {"book": bk.get("key"), "updatedAt": bk.get("last_update")}
            for market in bk.get("markets", []):
                outcomes = {o.get("name"): o for o in market.get("outcomes", [])}
                h = outcomes.get(home_name)
                a = outcomes.get(away_name)
                if market.get("key") == "spreads" and h and a and h.get("point") is not None:
                    spreads.append(float(h["point"]))
                    home_sp.append(float(h["price"]))
                    away_sp.append(float(a["price"]))
                    row.update(spread=float(h["point"]), homeSpreadPrice=h["price"], awaySpreadPrice=a["price"])
                elif market.get("key") == "h2h" and h and a:
                    home_ml.append(float(h["price"]))
                    away_ml.append(float(a["price"]))
                    row.update(homeMl=h["price"], awayMl=a["price"])
            if len(row) > 2:
                books.append(row)
        if not books:
            continue
        out.append({
            "eventId": ev.get("id"), "sport": sport, "home": home, "away": away,
            "homeName": home_name, "awayName": away_name, "startsAt": ev.get("commence_time"),
            "observedAt": observed_at, "books": len(books),
            "homeSpread": _median(spreads),
            "homeSpreadPrice": _round_price(_median(home_sp)), "awaySpreadPrice": _round_price(_median(away_sp)),
            "homeMl": _round_price(_median(home_ml)), "awayMl": _round_price(_median(away_ml)),
            "perBook": books,
        })
    return out


def _round_price(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    rounded = int(round(value))
    if abs(rounded) < 100:
        rounded = -100 if rounded <= 0 else 100
    return rounded


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def apply_to_ledger(ledger: Ledger, sport: str, snapshot: List[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, int]:
    """Fill missing lines and refresh closing lines on open ledger rows for matched events."""
    now = now or datetime.now(timezone.utc)
    rows = ledger.rows(sport=sport, settled=False)
    by_key: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for snap in snapshot:
        by_key.setdefault((snap["home"], snap["away"]), []).append(snap)
    filled = closed = matched_events = 0
    seen_events = set()
    for r in rows:
        meta = json.loads(r["meta"]) if r["meta"] else {}
        home = meta.get("home")
        away = meta.get("away")
        if not home or not away:
            # selection-only rows: infer from event label "AWAY at HOME" if present
            label = r["event_label"] or ""
            if " at " in label:
                away, home = [part.strip() for part in label.split(" at ", 1)]
        if not home or not away:
            continue
        cands = by_key.get((home, away), [])
        start = _parse(r["event_start"])
        snap = None
        for c in cands:
            cstart = _parse(c.get("startsAt"))
            if start is None or cstart is None or abs((cstart - start).total_seconds()) <= MATCH_WINDOW_HOURS * 3600:
                snap = c
                break
        if snap is None:
            continue
        if start is not None and start <= now:
            continue  # already started; the last snapshot before start stands as the close
        is_home = r["selection"] == home
        if r["market"] == "spread":
            if snap["homeSpread"] is None:
                continue
            line = snap["homeSpread"] if is_home else -snap["homeSpread"]
            price = snap["homeSpreadPrice"] if is_home else snap["awaySpreadPrice"]
        elif r["market"] == "moneyline":
            line = None
            price = snap["homeMl"] if is_home else snap["awayMl"]
        else:
            continue
        if price is None:
            continue
        seen_events.add(r["event_id"])
        if r["price"] is None:
            ledger.set_line(sport, r["event_id"], r["market"], r["selection"], line, int(price), CONSENSUS_BOOK, snap["observedAt"])
            filled += 1
        ledger.set_close(sport, r["event_id"], r["market"], r["selection"], line, int(price))
        closed += 1
    matched_events = len(seen_events)
    return {"openRows": len(rows), "matchedEvents": matched_events, "linesFilled": filled, "closesUpdated": closed}


def write_snapshot(sport: str, snapshot: List[Dict[str, Any]], quota: Dict[str, str], mapper: TeamMapper) -> Path:
    ODDS_DIR.mkdir(parents=True, exist_ok=True)
    path = ODDS_DIR / f"{sport}-latest.json"
    payload = {
        "sport": sport, "generatedAt": now_iso(), "source": "The Odds API", "book": CONSENSUS_BOOK,
        "events": [{k: v for k, v in e.items() if k != "perBook"} for e in snapshot],
        "unresolvedTeams": mapper.unresolved, "quota": quota,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    tmp.replace(path)
    return path


def write_status(configured: bool, runs: Optional[Dict[str, Any]] = None, error: Optional[str] = None, quota: Optional[Dict[str, str]] = None) -> Path:
    ODDS_DIR.mkdir(parents=True, exist_ok=True)
    existing: Dict[str, Any] = {}
    if STATUS_PATH.exists():
        try:
            existing = json.loads(STATUS_PATH.read_text())
        except ValueError:
            existing = {}
    sports = dict(existing.get("sports", {}))
    if runs:
        sports.update(runs)
    payload = {
        "configured": configured, "checkedAt": now_iso(), "source": "The Odds API",
        "quota": quota or existing.get("quota"), "error": error, "sports": sports,
        "setup": "Set ODDS_API_KEY in the environment (and as a GitHub Actions secret) and run: npm run odds:snapshot -- --sport nfl",
    }
    tmp = STATUS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    tmp.replace(STATUS_PATH)
    return STATUS_PATH


GAMES_SOON_HOURS = 30


def games_within(sport: str, hours: int = GAMES_SOON_HOURS, now: Optional[datetime] = None) -> int:
    """Upcoming games of ``sport`` in the published report that start within ``hours``.
    Used to skip API calls on days a sport has nothing to price."""
    path = ROOT / "public" / "sports" / f"{sport}.json"
    if not path.exists():
        return 0
    try:
        report = json.loads(path.read_text())
    except ValueError:
        return 0
    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(hours=hours)
    count = 0
    for g in report.get("upcoming", []):
        start = _parse(g.get("startsAt"))
        if start is not None and now <= start <= horizon:
            count += 1
    return count


def known_teams(sport: str) -> List[str]:
    path = ROOT / "public" / "sports" / f"{sport}.json"
    if not path.exists():
        return []
    try:
        report = json.loads(path.read_text())
    except ValueError:
        return []
    return [str(t.get("team")) for t in report.get("ratings", []) if t.get("team")]


def snapshot_command(sport: str, ledger: Optional[Ledger] = None, regions: str = "us") -> Dict[str, Any]:
    if sport not in SPORT_KEYS:
        raise SystemExit(f"unsupported sport {sport!r}; choose one of {', '.join(SPORT_KEYS)}")
    key = api_key()
    if not key:
        write_status(False)
        print("ODDS_API_KEY is not set; wrote public/data/odds/status.json with configured=false and did nothing else.")
        return {"configured": False}
    soon = games_within(sport)
    if not soon:
        write_status(True, runs={sport: {"snapshotAt": now_iso(), "skipped": f"no {sport} games in the next {GAMES_SOON_HOURS} hours"}})
        print(f"{sport}: no games in the next {GAMES_SOON_HOURS} hours; skipped the API call to save quota")
        return {"configured": True, "skipped": True}
    mapper = TeamMapper(sport, known_teams(sport))
    try:
        events, quota = fetch_odds(sport, key, regions=regions)
    except Exception as exc:  # network or auth failure: record and exit non-zero
        write_status(True, error=f"{sport}: {exc}")
        raise SystemExit(f"odds fetch failed for {sport}: {exc}")
    snap = consolidate(sport, events, mapper)
    path = write_snapshot(sport, snap, quota, mapper)
    own = ledger is None
    ledger = ledger or Ledger()
    try:
        applied = apply_to_ledger(ledger, sport, snap)
    finally:
        if own:
            ledger.close()
    run = {"snapshotAt": now_iso(), "events": len(snap), "unresolved": len(mapper.unresolved), **applied}
    write_status(True, runs={sport: run}, quota=quota)
    print(f"{sport}: {len(snap)} events with lines ({len(mapper.unresolved)} unresolved names); "
          f"{applied['matchedEvents']} ledger events matched, {applied['linesFilled']} lines filled, {applied['closesUpdated']} closes updated; wrote {path}")
    return {"configured": True, **run}
