"""Settle open racing ledger rows from completed races, then export model health.

Open rows for 'upcoming' races dated more than ``STALE_UPCOMING_DAYS`` days
before today (America/New_York) are voided with a meta reason so they do not
sit open forever.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional

from ..ledger_core import HEALTH_PATH, Ledger
from .data import runtime, stale_upcoming_days

STALE_REASON = "stale upcoming race; no results recorded"


def _void_stale_event(ledger: Ledger, event_id: str) -> int:
    """Void every open row of one event and tag its meta with the stale reason. Returns rows voided."""
    rows = ledger.con.execute(
        "SELECT id, market, selection, meta FROM forecast_ledger WHERE sport='racing' AND event_id=? AND outcome IS NULL",
        (event_id,)).fetchall()
    for row in rows:
        meta = json.loads(row["meta"]) if row["meta"] else {}
        meta["reason"] = STALE_REASON
        ledger.con.execute("UPDATE forecast_ledger SET meta=? WHERE id=?",
                           (json.dumps(meta, separators=(",", ":")), row["id"]))
    n = 0
    for market, selection in sorted({(r["market"], r["selection"]) for r in rows}):
        n += ledger.settle("racing", event_id, market, selection, "void")
    return n


def settle_open(ledger: Ledger, con: sqlite3.Connection, export: bool = True,
                health_path: Optional[Path] = None, today: Optional[date] = None,
                verbose: bool = False) -> Dict[str, int]:
    counts = {"events": 0, "win": 0, "loss": 0, "void": 0, "pending": 0, "stale_events": 0, "stale_void": 0}
    for event_id in ledger.open_events("racing"):
        try:
            race_id = int(str(event_id).split(":", 1)[1])
        except (IndexError, ValueError):
            continue
        race = con.execute("SELECT status, race_date FROM main.races WHERE id = ?", (race_id,)).fetchone()
        if race is None or str(race[0]) != "complete":
            days = stale_upcoming_days(race[0], race[1], today) if race is not None else None
            if days is None:
                counts["pending"] += 1
                continue
            n = _void_stale_event(ledger, event_id)
            counts["stale_events"] += 1
            counts["stale_void"] += n
            if verbose:
                print(f"void {event_id} | {str(race[1])[:10]} | {n} rows | {STALE_REASON} ({days} days ago)")
            continue
        counts["events"] += 1
        entries: Dict[int, Any] = {}
        for driver_id, fp, status in con.execute(
                "SELECT driver_id, finishing_position, COALESCE(entry_status, 'expected') FROM race_entries WHERE race_id = ?",
                (race_id,)):
            entries[int(driver_id)] = (fp, status)
        rows = ledger.con.execute(
            "SELECT DISTINCT market, selection FROM forecast_ledger WHERE sport='racing' AND event_id=? AND outcome IS NULL",
            (event_id,)).fetchall()
        for market, selection in rows:
            try:
                driver_id = int(str(selection).split(":", 1)[1])
            except (IndexError, ValueError):
                continue
            entry = entries.get(driver_id)
            if entry is None or entry[1] == "scratched" or entry[0] is None:
                ledger.settle("racing", event_id, market, selection, "void")
                counts["void"] += 1
                continue
            fp = int(entry[0])
            hit = fp == 1 if market == "win" else fp <= 3 if market == "top3" else fp <= 5
            outcome = "win" if hit else "loss"
            ledger.settle("racing", event_id, market, selection, outcome, result_value=float(fp))
            counts[outcome] += 1
        if verbose:
            print(f"settled {event_id} | {str(race[1])[:10]}")
    if export:
        ledger.export_health(health_path or HEALTH_PATH)
    return counts


def run(export: bool = True) -> Dict[str, int]:
    db = Path(runtime().DB)
    con = sqlite3.connect(db)
    try:
        with Ledger() as ledger:
            return settle_open(ledger, con, export=export, verbose=True)
    finally:
        con.close()
