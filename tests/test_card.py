from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dirtiq_model.card import build

NOW = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)  # 10 AM Eastern


def game(game_id, margin, spread, start="2026-11-13T00:00:00Z", aware=None, observed="2026-11-12T14:30:00Z", **extra):
    row = {"gameId": game_id, "home": "H" + game_id, "away": "A" + game_id, "startsAt": start,
           "projectedHomeMargin": margin, "marketHomeSpread": spread, "marketHomePrice": -110, "marketAwayPrice": -110,
           "stackedMarketHomeMargin": aware, "lineObservedAt": observed, "homeCoverProb": 0.6, "awayCoverProb": 0.4}
    row.update(extra)
    return row


def report(sport, games, threshold=3.0):
    return {"sport": sport, "label": sport.upper(), "generatedAt": "2026-11-12T14:35:00Z",
            "backtest": {"selectionThreshold": threshold, "seasons": [2019, 2025],
                         "selections": {"rule": "r", "n": 100, "wins": 49, "losses": 51, "roi": -0.06}},
            "upcoming": games}


class CardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sports = Path(self.tmp.name) / "sports"
        self.archive = Path(self.tmp.name) / "cards"
        self.sports.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, sport, games, threshold=3.0):
        (self.sports / ("%s.json" % sport)).write_text(json.dumps(report(sport, games, threshold)))

    def card(self, now=NOW, results=None):
        return build.build_card(now=now, sports_dir=self.sports, archive_dir=self.archive, results=results or {})

    def test_qualification_side_and_stake(self):
        self.write("nba", [
            game("1", 2.0, -9.5, aware=10.0),   # model likes the away side by 7.5; market-aware model is on the home side
            game("2", 8.0, -3.5, aware=4.5),    # home by 4.5, market-aware agrees
            game("3", 4.0, -3.5),               # only 0.5 of disagreement
            game("4", 9.0, -3.5, start="2026-11-14T00:00:00Z"),   # tomorrow
            game("5", 9.0, -3.5, start="2026-11-12T15:10:00Z"),   # starts in ten minutes
            game("6", 9.0, -3.5, observed="2026-11-12T09:00:00Z"),  # six-hour-old line
            game("7", 9.0, None),               # no spread
        ])
        picks = {p["gameId"]: p for p in self.card()["picks"]}
        self.assertEqual(sorted(picks), ["1", "2"])
        self.assertEqual((picks["1"]["pick"], picks["1"]["line"], picks["1"]["stakeUnits"]), ("A1", 9.5, 0.5))
        self.assertEqual((picks["2"]["pick"], picks["2"]["line"], picks["2"]["stakeUnits"]), ("H2", -3.5, 1.0))
        self.assertEqual(picks["2"]["rank"], 1)
        self.assertEqual(picks["1"]["record"]["winRate"], 0.49)

    def test_caps(self):
        self.write("ncaab", [game(str(i), 10.0 + i, -3.5, aware=5.0) for i in range(10)])
        self.write("nba", [game("n%d" % i, 10.0 + i, -3.5, aware=5.0) for i in range(10)])
        card = self.card()
        by_sport = {}
        for p in card["picks"]:
            by_sport[p["sport"]] = by_sport.get(p["sport"], 0) + 1
        self.assertLessEqual(max(by_sport.values()), build.MAX_PER_SPORT)
        self.assertLessEqual(card["totalUnits"], build.MAX_UNITS)
        self.assertLessEqual(len(card["picks"]), build.MAX_PICKS)

    def test_pick_is_locked_then_graded_at_its_line(self):
        self.write("nba", [game("1", 8.0, -3.5, aware=4.5)])
        self.card()
        # The line moves to -7.5: the edge is gone, but the locked terms stay.
        self.write("nba", [game("1", 8.0, -7.5, aware=7.6, observed="2026-11-12T15:30:00Z")])
        later = datetime(2026, 11, 12, 16, 0, tzinfo=timezone.utc)
        pick = self.card(now=later)["picks"][0]
        self.assertEqual((pick["line"], pick["status"], pick["current"]["line"]), (-3.5, "edge-gone", -7.5))
        self.assertEqual(pick["lockedAt"], "2026-11-12T15:00:00Z")
        # Next day: home wins by 5, covering -3.5 (it would not have covered -7.5).
        results = {"nba:1": {"eventId": "nba:1", "homeScore": 105, "awayScore": 100}}
        self.write("nba", [])
        tomorrow = datetime(2026, 11, 13, 15, 0, tzinfo=timezone.utc)
        card = self.card(now=tomorrow, results=results)
        self.assertEqual(card["picks"], [])
        self.assertEqual((card["record"]["wins"], card["record"]["losses"], card["record"]["units"]), (1, 0, 0.909))
        graded = json.loads((self.archive / "2026-11-12.json").read_text())["picks"][0]
        self.assertEqual(graded["result"]["outcome"], "win")

    def test_push_and_away_loss(self):
        home_pick = {"id": "nba:1", "side": "home", "line": -5.0, "price": -110, "stakeUnits": 1.0}
        away_pick = {"id": "nba:2", "side": "away", "line": 4.5, "price": -110, "stakeUnits": 0.5}
        results = {"nba:1": {"homeScore": 105, "awayScore": 100}, "nba:2": {"homeScore": 105, "awayScore": 100}}
        build.grade(home_pick, results)
        build.grade(away_pick, results)
        self.assertEqual((home_pick["result"]["outcome"], home_pick["result"]["units"]), ("push", 0.0))
        self.assertEqual((away_pick["result"]["outcome"], away_pick["result"]["units"]), ("loss", -0.5))


if __name__ == "__main__":
    unittest.main()
