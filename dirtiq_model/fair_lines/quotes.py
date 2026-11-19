"""Exact-book pregame observations, paired with a frozen published forecast.

No betting decisions, no network calls, no inferred quote timestamps. Consensus
prices are never presented as executable book prices.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def timestamp(value: Any) -> Optional[datetime]:
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.astimezone(timezone.utc) if result.tzinfo is not None else None
    except (ValueError, TypeError):
        return None


def finite(value: Any) -> Optional[float]:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def valid_price(value: Any) -> bool:
    n = finite(value)
    return n is not None and abs(n) >= 100 and n == int(n)


def extract_quotes(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parse only complete, coherent two-way pairs from exact bookmaker markets."""
    result = []
    home, away = event.get("home_team"), event.get("away_team")
    if not home or not away or home == away:
        return result
    for book in event.get("bookmakers", []):
        if not book.get("key"):
            continue
        for market in book.get("markets", []):
            key = market.get("key")
            outcomes = market.get("outcomes", [])
            if len(outcomes) != 2:
                continue
            names = {o.get("name"): o for o in outcomes}
            labels = ("Over", "Under") if key == "totals" else (home, away)
            if set(names) != set(labels) or key not in ("spreads", "h2h", "totals"):
                continue
            a, b = names[labels[0]], names[labels[1]]
            if not valid_price(a.get("price")) or not valid_price(b.get("price")):
                continue
            line = opposite = None
            if key != "h2h":
                line, opposite = finite(a.get("point")), finite(b.get("point"))
                if line is None or opposite is None or line * 2 % 1:
                    continue
                if key == "spreads" and (line != -opposite or abs(line) > 90):
                    continue
                if key == "totals" and (line != opposite or not 10 <= line <= 400):
                    continue
            result.append({"book": book["key"], "market": key, "line": line,
                           "firstSide": "over" if key == "totals" else "home",
                           "firstPrice": int(a["price"]), "secondPrice": int(b["price"]),
                           "marketUpdatedAt": market.get("last_update"),
                           "bookUpdatedAt": book.get("last_update")})
    return result


def observe(snapshot: List[Dict[str, Any]], report: Dict[str, Any]) -> Dict[str, Any]:
    """Archive all valid pregame pairs, including explicit stale/missing clocks.

    Ambiguous fixture matches receive no forecast; match requires home/away plus
    start within one minute. A baseline is captured for future exact-line grading,
    never treated as the experimental candidate or a proven betting probability.
    """
    events = []
    generated = timestamp(report.get("generatedAt"))
    for event in snapshot:
        observed, start = timestamp(event.get("observedAt")), timestamp(event.get("startsAt"))
        if observed is None or start is None or observed >= start:
            continue
        candidates = []
        for game in report.get("upcoming", []):
            gs = timestamp(game.get("startsAt"))
            if (game.get("home"), game.get("away")) == (event.get("home"), event.get("away")) and gs is not None and abs((gs-start).total_seconds()) <= 60:
                candidates.append(game)
        baseline = None
        if len(candidates) == 1 and generated is not None and generated <= observed and generated < start:
            game = candidates[0]
            baseline = {"gameId": game.get("gameId"), "forecastAt": report.get("generatedAt"),
                        "modelId": report.get("modelId"), "modelVersion": report.get("modelVersion"),
                        "projectedHomeMargin": game.get("projectedHomeMargin"),
                        "projectedTotal": game.get("projectedTotal"), "marginSd": game.get("marginSd"),
                        "status": "published baseline; not a promoted fair-line candidate"}
        quotes = []
        for quote in event.get("bookQuotes", []):
            q = dict(quote)
            source = timestamp(q.get("marketUpdatedAt"))
            age = (observed-source).total_seconds() if source is not None else None
            q["ageSecondsAtObservation"] = age
            q["freshAtObservation"] = age is not None and 0 <= age <= 15*60
            quotes.append(q)
        if quotes:
            events.append({"eventId": event.get("eventId"), "home": event["home"], "away": event["away"],
                           "startsAt": event["startsAt"], "observedAt": event["observedAt"],
                           "baseline": baseline, "quotes": quotes})
    return {"schemaVersion": 1, "sport": report.get("sport"), "events": events,
            "note": "Frozen pregame observations; freshness does not establish model value or availability at acceptance."}


def archive(root: Path, sport: str, snapshot: List[Dict[str, Any]]) -> Optional[Path]:
    report_path = root / "public" / "sports" / (sport + ".json")
    try:
        report = json.loads(report_path.read_text())
    except (OSError, ValueError):
        report = {"sport": sport}
    payload = observe(snapshot, report)
    if not payload["events"]:
        return None
    data = json.dumps(payload, sort_keys=True, allow_nan=False) + "\n"
    digest = hashlib.sha256(data.encode()).hexdigest()
    stamp = min(e["observedAt"] for e in payload["events"])
    parsed = timestamp(stamp)
    if parsed is None:
        return None
    # Offline git/CI observations deliberately live outside deployed public assets.
    directory = root / "observations" / "book-quotes" / sport / parsed.strftime("%Y-%m-%d")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (parsed.strftime("%H%M%S") + "-" + digest[:16] + ".json")
    try:
        with path.open("x") as handle:
            handle.write(data)
    except FileExistsError:
        if path.read_text() != data:
            raise ValueError("Existing immutable quote observation differs")
    return path
