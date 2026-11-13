"""Build the daily card from the published sport reports.

The card is a selection over forecasts that already exist; it fits nothing. A game
qualifies when it starts today (US Eastern), has a priced spread, and the published
model margin disagrees with that spread by at least the sport's fixed backtest
threshold (the report's ``lean``). Qualifiers are ranked, capped per sport and in
total, and given a flat stake. A pick is locked at the line it was first listed
with, so a card read in the morning is the card that gets graded.

Nothing here claims an edge: every pick carries its sport's backtest record for the
same rule, and ``record`` on the card is the graded history of the cards themselves.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..ledger_core import now_iso
from ..scoring import american_to_prob, settle_units

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - tzdata missing
    EASTERN = timezone(timedelta(hours=-5))

ROOT = Path(__file__).resolve().parents[2]
SPORTS_DIR = ROOT / "public" / "sports"
RESULTS_DIR = ROOT / "public" / "data" / "results"
CARD_PATH = ROOT / "public" / "data" / "daily-card.json"
ARCHIVE_DIR = ROOT / "public" / "data" / "cards"

CARD_SPORTS = ("nfl", "ncaaf", "nba", "ncaab")
MAX_PICKS = 15
MAX_PER_SPORT = 6
# Every pick carries the same stake. Over the backtests, picks the market-aware model agreed with
# covered no more often than the rest (NCAAB 51.1% v 53.7%, NFL 49.3% v 49.8%), and no edge size
# covered more often than another, so there is nothing to justify staking one pick above the next.
STAKE = 0.5
MAX_UNITS = MAX_PICKS * STAKE
# A disagreement this many thresholds wide is a rating or data error, not value: a team in its
# first Division I season, or a rating built on a few blowouts. Such games are left off.
MAX_EDGE_RATIO = 4.0
# A game must be at least this far from its start to be added; a bet needs time to be placed.
MIN_LEAD = timedelta(minutes=20)
# A line older than this is not a price anyone can still get.
MAX_LINE_AGE = timedelta(hours=3)

RULES = [
    "Spread bets only, in NFL, college football, NBA and college basketball; one bet per game.",
    "A game qualifies when the model margin disagrees with the spread by at least the sport's fixed backtest threshold.",
    "A game is left off when the disagreement is %.0f thresholds or more: a gap that wide is a rating or data error, not value." % MAX_EDGE_RATIO,
    "Ranked by whether the market-aware model takes the same side, then by the size of the disagreement in threshold units.",
    "At most %d picks a day, %d per sport, %.1f units in total." % (MAX_PICKS, MAX_PER_SPORT, MAX_UNITS),
    "Every pick is staked %.1f unit: in the backtests no kind of pick covered often enough to earn a larger stake. One unit is 1%% of bankroll." % STAKE,
    "A pick is locked at the line it was first listed with and graded at that line.",
]


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def eastern_date(moment: datetime) -> str:
    return moment.astimezone(EASTERN).strftime("%Y-%m-%d")


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _num(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def sport_record(report: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The sport's backtest record for the rule that qualifies a pick."""
    backtest = report.get("backtest") or {}
    sel = backtest.get("selections") or {}
    if not sel.get("n"):
        return None
    decided = (sel.get("wins") or 0) + (sel.get("losses") or 0)
    return {
        "rule": sel.get("rule"), "picks": sel.get("n"), "wins": sel.get("wins"), "losses": sel.get("losses"),
        "winRate": round(sel["wins"] / decided, 4) if decided else None, "roi": sel.get("roi"),
        "seasons": [min(backtest["seasons"]), max(backtest["seasons"])] if backtest.get("seasons") else None,
    }


def candidate(sport: str, report: Dict[str, Any], game: Dict[str, Any], now: datetime) -> Optional[Dict[str, Any]]:
    """One qualifying pick for ``game``, or None."""
    start = _parse(game.get("startsAt"))
    spread = _num(game.get("marketHomeSpread"))
    margin = _num(game.get("projectedHomeMargin"))
    threshold = _num((report.get("backtest") or {}).get("selectionThreshold"))
    observed = _parse(game.get("lineObservedAt"))
    if start is None or spread is None or margin is None or not threshold or threshold <= 0:
        return None
    if eastern_date(start) != eastern_date(now) or start - now < MIN_LEAD:
        return None
    if observed is None or now - observed > MAX_LINE_AGE:
        return None
    edge = margin + spread  # positive: the model likes the home side at this number
    if abs(edge) < threshold or abs(edge) >= MAX_EDGE_RATIO * threshold:
        return None
    home_pick = edge > 0
    price = _num(game.get("marketHomePrice" if home_pick else "marketAwayPrice"))
    if price is None or abs(price) < 100:
        return None
    aware_margin = _num(game.get("stackedMarketHomeMargin"))
    aware_edge = None if aware_margin is None else aware_margin + spread
    agrees = aware_edge is not None and aware_edge != 0 and (aware_edge > 0) == home_pick
    cover = _num(game.get("homeCoverProb" if home_pick else "awayCoverProb"))
    team, opponent = (game["home"], game["away"]) if home_pick else (game["away"], game["home"])
    line = spread if home_pick else -spread
    return {
        "id": "%s:%s" % (sport, game["gameId"]), "sport": sport, "sportLabel": report.get("label") or sport.upper(),
        "gameId": str(game["gameId"]), "home": game["home"], "away": game["away"], "startsAt": game["startsAt"],
        "neutral": int(game.get("neutral") or 0),
        "market": "spread", "pick": team, "opponent": opponent, "side": "home" if home_pick else "away",
        "line": line, "price": int(price), "homeSpread": spread,
        "book": game.get("book"), "lineObservedAt": game.get("lineObservedAt"),
        "modelHomeMargin": round(margin, 2), "edgePts": round(abs(edge), 2), "threshold": threshold,
        "edgeRatio": round(abs(edge) / threshold, 3),
        "marketAwareAgrees": bool(agrees),
        "marketAwareEdgePts": None if aware_edge is None else round(aware_edge if home_pick else -aware_edge, 2),
        "modelCoverProb": cover, "breakEvenProb": round(american_to_prob(price) or 0.0, 4),
        "stakeUnits": STAKE,
        "record": sport_record(report),
        "homeRating": game.get("homeRating"), "awayRating": game.get("awayRating"),
        "homeForm": _form(game.get("homeForm")), "awayForm": _form(game.get("awayForm")),
        "note": game.get("note"),
    }


def _form(form: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(form, dict):
        return None
    return {"record": "%s-%s" % (form.get("wins"), form.get("losses")), "avgMargin": form.get("avgMargin"), "last": form.get("lastRecord")}


def rank_key(pick: Dict[str, Any]) -> Tuple[int, float, str]:
    return (0 if pick["marketAwareAgrees"] else 1, -pick["edgeRatio"], pick["id"])


def select(locked: List[Dict[str, Any]], candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep every locked pick and add ranked candidates inside the caps."""
    picks = list(locked)
    taken = {p["id"] for p in picks}
    per_sport: Dict[str, int] = {}
    units = 0.0
    for p in picks:
        per_sport[p["sport"]] = per_sport.get(p["sport"], 0) + 1
        units += p["stakeUnits"]
    for cand in sorted(candidates, key=rank_key):
        if len(picks) >= MAX_PICKS:
            break
        if cand["id"] in taken or per_sport.get(cand["sport"], 0) >= MAX_PER_SPORT:
            continue
        if units + cand["stakeUnits"] > MAX_UNITS + 1e-9:
            continue
        picks.append(cand)
        taken.add(cand["id"])
        per_sport[cand["sport"]] = per_sport.get(cand["sport"], 0) + 1
        units += cand["stakeUnits"]
    return picks


def refresh_status(pick: Dict[str, Any], games: Dict[str, Dict[str, Any]], now: datetime) -> None:
    """Describe a locked pick against the newest published line without changing its terms."""
    start = _parse(pick.get("startsAt"))
    game = games.get(pick["id"])
    current: Dict[str, Any] = {"checkedAt": now_iso()}
    if start is not None and start <= now:
        pick["status"] = "started"
    elif game is None or _num(game.get("marketHomeSpread")) is None or _num(game.get("projectedHomeMargin")) is None:
        pick["status"] = "no-current-line"
    else:
        spread = float(game["marketHomeSpread"])
        edge = float(game["projectedHomeMargin"]) + spread
        signed = edge if pick["side"] == "home" else -edge
        current.update({
            "line": spread if pick["side"] == "home" else -spread,
            "price": game.get("marketHomePrice" if pick["side"] == "home" else "marketAwayPrice"),
            "edgePts": round(signed, 2), "lineObservedAt": game.get("lineObservedAt"),
        })
        pick["status"] = "playable" if signed >= pick["threshold"] else "edge-gone"
    pick["current"] = current


def grade(pick: Dict[str, Any], results: Dict[str, Dict[str, Any]]) -> bool:
    """Grade one pick at its locked line. Returns True when a result was written."""
    if pick.get("result") or pick["id"] not in results:
        return False
    game = results[pick["id"]]
    home, away = _num(game.get("homeScore")), _num(game.get("awayScore"))
    if home is None or away is None:
        return False
    margin = (home - away) if pick["side"] == "home" else (away - home)
    covered = margin + pick["line"]
    outcome = "win" if covered > 0 else "loss" if covered < 0 else "push"
    units = settle_units(outcome, pick["price"]) or 0.0
    pick["result"] = {"outcome": outcome, "homeScore": int(home), "awayScore": int(away),
                      "units": round(units * pick["stakeUnits"], 3)}
    pick["status"] = "graded"
    return True


def load_results() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for sport in CARD_SPORTS:
        data = _read(RESULTS_DIR / ("%s.json" % sport)) or {}
        for game in data.get("games") or []:
            if game.get("eventId"):
                out[str(game["eventId"])] = game
    return out


def card_record(archive_dir: Path) -> Dict[str, Any]:
    """Graded history of every archived card."""
    wins = losses = pushes = 0
    units = staked = 0.0
    days = 0
    for path in sorted(archive_dir.glob("*.json")):
        card = _read(path) or {}
        graded = [p for p in card.get("picks") or [] if p.get("result")]
        if graded:
            days += 1
        for p in graded:
            outcome = p["result"]["outcome"]
            wins += outcome == "win"
            losses += outcome == "loss"
            pushes += outcome == "push"
            units += p["result"]["units"]
            staked += p["stakeUnits"]
    return {"days": days, "wins": wins, "losses": losses, "pushes": pushes, "units": round(units, 3),
            "staked": round(staked, 2), "roi": round(units / staked, 4) if staked else None}


def build_card(now: Optional[datetime] = None, sports_dir: Path = SPORTS_DIR, archive_dir: Path = ARCHIVE_DIR,
               results: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    today = eastern_date(now)
    results = load_results() if results is None else results

    # Grade every archived card that still has ungraded picks.
    archive_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(archive_dir.glob("*.json")):
        card = _read(path)
        if not card or path.stem == today:
            continue
        if any([grade(p, results) for p in card.get("picks") or []]):
            path.write_text(json.dumps(card, indent=1) + "\n")

    games: Dict[str, Dict[str, Any]] = {}
    candidates: List[Dict[str, Any]] = []
    considered = 0
    refreshed: List[str] = []
    for sport in CARD_SPORTS:
        report = _read(sports_dir / ("%s.json" % sport))
        if not report:
            continue
        stamp = report.get("forecastGeneratedAt") or report.get("generatedAt")
        if stamp:
            refreshed.append(stamp)
        for game in report.get("upcoming") or []:
            games["%s:%s" % (sport, game.get("gameId"))] = game
            start = _parse(game.get("startsAt"))
            if start is None or eastern_date(start) != today or start <= now:
                continue
            if _num(game.get("marketHomeSpread")) is not None:
                considered += 1
            pick = candidate(sport, report, game, now)
            if pick:
                candidates.append(pick)

    previous = _read(archive_dir / ("%s.json" % today)) or {}
    locked = [p for p in previous.get("picks") or [] if p.get("id")]
    picks = select(locked, candidates)
    stamp_now = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    for pick in picks:
        pick.setdefault("lockedAt", stamp_now)
        grade(pick, results)
        if not pick.get("result"):
            refresh_status(pick, games, now)
    picks.sort(key=lambda p: (p["startsAt"], p["id"]))
    for index, pick in enumerate(sorted(picks, key=rank_key), start=1):
        pick["rank"] = index

    card = {
        "date": today, "generatedAt": stamp_now, "forecastsRefreshedAt": max(refreshed) if refreshed else None,
        "unit": "1 unit = 1% of bankroll", "rules": RULES,
        "evidence": ("Backtested over many seasons, picks made by this rule have lost money in every sport after the "
                     "vig; each pick shows its sport's record. Treat the card as a shortlist to check, not as proven value."),
        "priced": considered, "qualified": len(candidates),
        "totalUnits": round(sum(p["stakeUnits"] for p in picks), 2),
        "record": None, "picks": picks,
    }
    (archive_dir / ("%s.json" % today)).write_text(json.dumps(card, indent=1) + "\n")
    card["record"] = card_record(archive_dir)
    (archive_dir / ("%s.json" % today)).write_text(json.dumps(card, indent=1) + "\n")
    return card


def build_command() -> Dict[str, Any]:
    card = build_card()
    CARD_PATH.write_text(json.dumps(card, indent=1) + "\n")
    print("card %s: %d picks, %.1f units, from %d qualifying of %d priced games today; wrote %s"
          % (card["date"], len(card["picks"]), card["totalUnits"], card["qualified"], card["priced"], CARD_PATH))
    return card
