from __future__ import annotations

import unittest
from dirtiq_model.teams.adapters.espn_odds import align_books, book_row, consolidate
from dirtiq_model.card.build import refresh_status, grade
from datetime import datetime, timezone

class QuoteIdentityTest(unittest.TestCase):
    def test_mercyhurst_reversed_sides_and_prices(self):
        b = book_row({"provider": {"name": "DraftKings"}, "spread": -5.5,
            "homeTeamOdds": {"team": {"$ref": "https://espn.com/teams/2385?lang=en"}, "favorite": True, "moneyLine": -245, "spreadOdds": -112, "open": {"pointSpread": {"american": "-6.5"}}},
            "awayTeamOdds": {"teamId": 2710, "moneyLine": 200, "spreadOdds": -108}})
        c = consolidate(align_books([b], "2710", "2385"))
        self.assertEqual(c["spread_line"], 5.5)
        self.assertEqual(c["spread_away_price"], -112)
        self.assertEqual(c["home_ml"], 200)
        self.assertEqual(c["open_spread_line"], 6.5)
        self.assertEqual(align_books([b], "99", "2385"), [])
        self.assertEqual(align_books([{}], "2710", "2385"), [])

    def test_legacy_wrong_quote_withdrawn_without_rewriting_terms(self):
        p = {"id": "ncaab:1", "startsAt": "2026-11-22T00:00:00Z", "pick": "MERC", "side": "away", "line": 6.5, "threshold": 3}
        g = {"home": "WIU", "away": "MERC", "quoteTeamOrderCorrected": True, "marketHomeSpread": 5.5, "projectedHomeMargin": -3}
        refresh_status(p, {p["id"]: g}, datetime(2026,11,21,tzinfo=timezone.utc))
        self.assertTrue(p["quoteWithdrawn"])
        self.assertEqual(p["line"], 6.5)
        self.assertEqual(p["current"]["line"], -5.5)
        self.assertFalse(grade(p, {p["id"]: {"homeScore": 50, "awayScore": 60}}))
