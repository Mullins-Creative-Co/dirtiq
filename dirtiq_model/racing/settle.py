"""Settle open racing ledger rows from completed races, then export model health."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional

from ..ledger_core import HEALTH_PATH, Ledger
from .data import runtime


def settle_open(ledger: Ledger, con: sqlite3.Connection, export: bool = True,
                health_path: Optional[Path] = None) -> Dict[str, int]:
    counts = {"events": 0, "win": 0, "loss": 0, "void": 0, "pending": 0}
    for event_id in ledger.open_events("racing"):
        try:
            race_id = int(str(event_id).split(":", 1)[1])
        except (IndexError, ValueError):
            continue
        race = con.execute("SELECT status FROM main.races WHERE id = ?", (race_id,)).fetchone()
        if race is None or str(race[0]) != "complete":
            counts["pending"] += 1
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
    if export:
        ledger.export_health(health_path or HEALTH_PATH)
    return counts


def run(export: bool = True) -> Dict[str, int]:
    db = Path(runtime().DB)
    con = sqlite3.connect(db)
    try:
        with Ledger() as ledger:
            return settle_open(ledger, con, export=export)
    finally:
        con.close()
