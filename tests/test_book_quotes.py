from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dirtiq_model.fair_lines.quotes import archive, extract_quotes, observe
from dirtiq_model.odds.snapshot import consolidate, write_snapshot
from dirtiq_model.odds.teams import TeamMapper


def event():
    return {"id": "book-event", "home_team": "Kansas City Chiefs", "away_team": "Denver Broncos", "commence_time": "2026-11-22T18:00:00Z", "bookmakers": [
        {"key": "draftkings", "last_update": "2026-11-20T12:00:00Z", "markets": [
            {"key": "spreads", "last_update": "2026-11-20T11:59:00Z", "outcomes": [{"name": "Kansas City Chiefs", "point": -3.5, "price": -105}, {"name": "Denver Broncos", "point": 3.5, "price": -115}]},
            {"key": "totals", "last_update": "2026-11-20T11:58:00Z", "outcomes": [{"name": "Over", "point": 44.5, "price": -110}, {"name": "Under", "point": 44.5, "price": -110}]}]},
        {"key": "fanduel", "markets": [{"key": "spreads", "outcomes": [{"name": "Kansas City Chiefs", "point": -3, "price": -120}, {"name": "Denver Broncos", "point": 3, "price": 100}]}]}]}


def snapshot():
    return consolidate("nfl", [event()], TeamMapper("nfl"), "2026-11-20T12:00:00Z")


def report():
    return {"sport": "nfl", "generatedAt": "2026-11-20T11:30:00Z", "modelId": "nfl-kalman", "modelVersion": "1.1", "upcoming": [
        {"gameId": "canonical", "home": "KC", "away": "DEN", "startsAt": "2026-11-22T18:00:00Z", "projectedHomeMargin": 3.2, "projectedTotal": 43.8, "marginSd": 14}]}


class BookQuoteTests(unittest.TestCase):
    def test_exact_book_line_and_price_stay_paired(self):
        quotes = extract_quotes(event())
        self.assertEqual(len(quotes), 3)
        dk, total, fd = quotes
        self.assertEqual((dk["book"], dk["line"], dk["firstPrice"]), ("draftkings", -3.5, -105))
        self.assertEqual((fd["book"], fd["line"], fd["firstPrice"]), ("fanduel", -3, -120))
        self.assertEqual(total["firstSide"], "over")
        self.assertEqual(dk["marketUpdatedAt"], "2026-11-20T11:59:00Z")

    def test_incoherent_pair_and_invalid_price_rejected(self):
        ev = event()
        ev["bookmakers"][0]["markets"][0]["outcomes"][1]["point"] = 4
        ev["bookmakers"][0]["markets"][1]["outcomes"][1]["price"] = -50
        self.assertEqual(len(extract_quotes(ev)), 1)

    def test_no_book_timestamp_substituted_for_market_clock(self):
        obs = observe(snapshot(), report())["events"][0]
        self.assertTrue(obs["quotes"][0]["freshAtObservation"])
        self.assertFalse(obs["quotes"][2]["freshAtObservation"])
        self.assertIsNone(obs["quotes"][2]["marketUpdatedAt"])
        self.assertEqual(obs["baseline"]["gameId"], "canonical")

    def test_stale_and_future_market_clocks_are_not_fresh(self):
        snap = snapshot()
        snap[0]["bookQuotes"][0]["marketUpdatedAt"] = "2026-11-20T12:00:01Z"
        snap[0]["bookQuotes"][1]["marketUpdatedAt"] = "2026-11-20T10:00:00Z"
        self.assertFalse(any(q["freshAtObservation"] for q in observe(snap, report())["events"][0]["quotes"]))

    def test_poststart_observation_rejected(self):
        snap = snapshot()
        snap[0]["observedAt"] = snap[0]["startsAt"]
        self.assertEqual(observe(snap, report())["events"], [])

    def test_future_or_ambiguous_forecast_not_attached(self):
        rep = report()
        rep["generatedAt"] = "2026-11-20T13:00:00Z"
        self.assertIsNone(observe(snapshot(), rep)["events"][0]["baseline"])
        rep = report()
        rep["upcoming"] *= 2
        self.assertIsNone(observe(snapshot(), rep)["events"][0]["baseline"])
        rep = report()
        rep["upcoming"][0]["startsAt"] = "2026-11-22T19:00:00Z"
        self.assertIsNone(observe(snapshot(), rep)["events"][0]["baseline"])

    def test_writer_retains_quotes_and_archive_is_immutable(self):
        from dirtiq_model.odds import snapshot as module
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/"public/sports").mkdir(parents=True)
            (root/"public/sports/nfl.json").write_text(json.dumps(report()))
            with patch.object(module, "ROOT", root), patch.object(module, "ODDS_DIR", root/"public/data/odds"):
                written = write_snapshot("nfl", snapshot(), {}, TeamMapper("nfl"))
            payload = json.loads(written.read_text())
            self.assertEqual(len(payload["events"][0]["bookQuotes"]), 3)
            paths = list((root/"observations").rglob("*.json"))
            self.assertEqual(len(paths), 1)
            before = paths[0].read_bytes()
            self.assertEqual(archive(root, "nfl", snapshot()), paths[0])
            self.assertEqual(before, paths[0].read_bytes())


if __name__ == "__main__":
    unittest.main()
