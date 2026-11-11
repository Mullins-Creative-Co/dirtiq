"""ESPN odds consolidation and NHL/MLB event mapping (pure functions, no network)."""
from __future__ import annotations

import unittest

import pandas as pd

from dirtiq_model.teams.adapters import espn_odds


def item(provider, spread, home_fav, home_ml, away_ml, total=220.5, close=None, open_=None, spread_odds=(-110.0, -110.0)):
    home = {"favorite": home_fav, "moneyLine": home_ml, "spreadOdds": spread_odds[0]}
    away = {"favorite": not home_fav, "moneyLine": away_ml, "spreadOdds": spread_odds[1]}
    if close:
        home["close"] = {"pointSpread": {"american": close[0]}, "spread": {"american": "-105"}, "moneyLine": {"american": close[1]}}
        away["close"] = {"spread": {"american": "-115"}, "moneyLine": {"american": close[2]}}
    if open_:
        home["open"] = {"pointSpread": {"american": open_[0]}, "moneyLine": {"american": open_[1]}}
        away["open"] = {"moneyLine": {"american": open_[2]}}
    return {"provider": {"name": provider}, "spread": spread, "overUnder": total, "homeTeamOdds": home, "awayTeamOdds": away}


class BookRowTests(unittest.TestCase):
    def test_home_favorite_spread_is_negative(self):
        rec = espn_odds.book_row(item("DraftKings", 7.5, True, -300, 240))
        self.assertEqual(rec["spread"], -7.5)
        self.assertEqual(rec["home_ml"], -300)
        self.assertFalse(rec["has_close"])

    def test_away_favorite_spread_is_positive(self):
        rec = espn_odds.book_row(item("DraftKings", -4.5, False, 160, -192))
        self.assertEqual(rec["spread"], 4.5)

    def test_close_block_overrides_top_level(self):
        rec = espn_odds.book_row(item("DraftKings", -3.5, True, -150, 130, close=("-4.5", "-170", "+145"), open_=("-2.5", "-130", "+110")))
        self.assertEqual(rec["spread"], -4.5)
        self.assertEqual(rec["home_ml"], -170)
        self.assertEqual(rec["away_ml"], 145)
        self.assertEqual(rec["home_spread_price"], -105)
        self.assertEqual(rec["away_spread_price"], -115)
        self.assertTrue(rec["has_close"])
        self.assertEqual(rec["open_spread"], -2.5)
        self.assertEqual(rec["open_home_ml"], -130)

    def test_live_and_projection_providers_are_excluded(self):
        self.assertIsNone(espn_odds.book_row(item("ESPN Bet - Live Odds", -11.5, True, -2000, 900)))
        self.assertIsNone(espn_odds.book_row(item("accuscore", -7.5, True, -280, 230)))
        self.assertIsNone(espn_odds.book_row(item("numberfire", -7.5, True, -280, 230)))

    def test_empty_item_is_dropped(self):
        self.assertIsNone(espn_odds.book_row({"provider": {"name": "Unibet"}, "homeTeamOdds": {}, "awayTeamOdds": {}}))


class ConsolidateTests(unittest.TestCase):
    def test_median_across_books_and_legal_prices(self):
        books = [espn_odds.book_row(item(p, s, True, h, a)) for p, s, h, a in
                 [("A", 7.0, -280, 230), ("B", 7.5, -290, 235), ("C", 7.5, -300, 240)]]
        c = espn_odds.consolidate(books)
        self.assertEqual(c["spread_line"], -7.5)
        self.assertEqual(c["home_ml"], -290)
        self.assertEqual(c["away_ml"], 235)
        self.assertEqual(c["books"], 3)
        self.assertFalse(c["closing"])

    def test_price_inside_100_is_nudged(self):
        books = [espn_odds.book_row(item("A", 1.0, True, -105, -105)), espn_odds.book_row(item("B", 1.0, True, 100, -120))]
        c = espn_odds.consolidate(books)
        self.assertIn(c["home_ml"], (-100.0, 100.0))

    def test_empty(self):
        c = espn_odds.consolidate([])
        self.assertIsNone(c["spread_line"])
        self.assertEqual(c["books"], 0)


class MapEventsTests(unittest.TestCase):
    def frame(self):
        return pd.DataFrame({
            "game_id": ["1", "2", "3", "4"],
            "start": pd.to_datetime(["2024-03-01T23:00Z", "2024-03-02T00:30Z", "2024-03-02T02:00Z", "2024-03-02T18:00Z"], utc=True),
            "home": ["TBL", "NJD", "LAK", "BOS"],
            "away": ["BOS", "NYR", "SJS", "TBL"],
        })

    def events(self):
        return pd.DataFrame({
            "espn_id": ["e1", "e2", "e3", "e4"],
            "start": ["2024-03-01T23:00Z", "2024-03-02T00:30Z", "2024-03-02T02:00Z", "2024-03-02T18:00Z"],
            "home_abbr": ["TB", "NJ", "LA", "BOS"],
            "away_abbr": ["BOS", "NYR", "SJ", "TB"],
        })

    def test_aliases_match_same_local_day(self):
        mapped, learned = espn_odds.map_events(self.frame(), self.events(), espn_odds.ALIASES["nhl"])
        self.assertEqual(mapped.tolist(), ["e1", "e2", "e3", "e4"])
        self.assertEqual(learned, {})

    def test_single_leftover_pair_learns_alias(self):
        ev = self.events()
        ev.loc[2, "home_abbr"] = "LAX"  # unknown abbreviation
        mapped, learned = espn_odds.map_events(self.frame(), ev, espn_odds.ALIASES["nhl"])
        self.assertEqual(mapped.tolist(), ["e1", "e2", "e3", "e4"])
        self.assertEqual(learned, {"LAX": "LAK"})

    def test_doubleheader_pairs_in_start_order(self):
        games = pd.DataFrame({"game_id": ["a", "b"], "start": pd.to_datetime(["2024-06-01T17:00Z", "2024-06-01T23:00Z"], utc=True),
                              "home": ["NYY", "NYY"], "away": ["BOS", "BOS"]})
        ev = pd.DataFrame({"espn_id": ["late", "early"], "start": ["2024-06-01T23:00Z", "2024-06-01T17:00Z"],
                           "home_abbr": ["NYY", "NYY"], "away_abbr": ["BOS", "BOS"]})
        mapped, _ = espn_odds.map_events(games, ev, {})
        self.assertEqual(mapped.tolist(), ["early", "late"])

    def test_no_events(self):
        mapped, _ = espn_odds.map_events(self.frame(), pd.DataFrame(columns=["espn_id", "start", "home_abbr", "away_abbr"]), {})
        self.assertTrue(mapped.isna().all())


if __name__ == "__main__":
    unittest.main()
