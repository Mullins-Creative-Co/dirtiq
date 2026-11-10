"""Team-sport engine tests: Kalman ratings, sign conventions, settlement, reports. No network."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from dirtiq_model.teams import model, ratings
from dirtiq_model.teams.adapters import ncaaf, nfl
from dirtiq_model.teams.adapters.common import finalize
from dirtiq_model.teams.ratings import EmpiricalMargin, Hyper, KalmanRatings, run_filter

HYPER = Hyper(process_sd_day=0.3, season_reversion=0.4, season_sd=3.0, hfa=2.5, sigma=12.0, init_sd=5.0)


def frame(rows):
    """Tiny contract frame from (game_id, season, start, home, away, neutral, home_score, away_score, spread, hp, ap, hml, aml)."""
    cols = ["game_id", "season", "start", "home", "away", "neutral", "home_score", "away_score",
            "spread_line", "spread_home_price", "spread_away_price", "home_ml", "away_ml"]
    df = pd.DataFrame(rows, columns=cols)
    df["week"] = 1
    df["total_line"] = np.nan
    df["completed"] = df["home_score"].notna()
    return finalize(df, [{"url": "synthetic", "sha256": "0", "retrievedAt": "2026-01-01T00:00:00Z"}], "test book", "TEST")


class KalmanTests(unittest.TestCase):
    def test_update_moves_winner_up_and_loser_down(self):
        kf = KalmanRatings(["A", "B", "C"], HYPER)
        kf.start_day(pd.Timestamp("2025-09-07"), 2025)
        before = kf.mean.copy()
        kf.update([("A", "B", 0, 14.0)])  # home A beats B by 14, more than the 2.5 home edge
        self.assertGreater(kf.mean[0], before[0])
        self.assertLess(kf.mean[1], before[1])
        self.assertAlmostEqual(kf.mean[2], before[2])
        self.assertLess(kf.cov[0, 0], HYPER.init_sd ** 2)

    def test_home_loss_moves_home_down(self):
        kf = KalmanRatings(["A", "B"], HYPER)
        kf.start_day(pd.Timestamp("2025-09-07"), 2025)
        kf.update([("A", "B", 0, -3.0)])
        self.assertLess(kf.mean[0], 0)
        self.assertGreater(kf.mean[1], 0)

    def test_neutral_site_removes_home_advantage(self):
        kf = KalmanRatings(["A", "B"], HYPER)
        kf.start_day(pd.Timestamp("2025-09-07"), 2025)
        home_mean, _ = kf.predict("A", "B", neutral=0)
        neutral_mean, _ = kf.predict("A", "B", neutral=1)
        self.assertAlmostEqual(home_mean, HYPER.hfa)
        self.assertAlmostEqual(neutral_mean, 0.0)
        # an exact-hfa home win on a neutral floor is treated as a genuine 2.5 point edge
        kf.update([("A", "B", 1, HYPER.hfa)])
        self.assertGreater(kf.mean[0], 0)

    def test_season_reversion_pulls_toward_mean(self):
        kf = KalmanRatings(["A", "B"], HYPER)
        kf.start_day(pd.Timestamp("2025-09-07"), 2025)
        kf.update([("A", "B", 0, 30.0)])
        spread_before = kf.mean[0] - kf.mean[1]
        kf.start_day(pd.Timestamp("2026-09-07"), 2026)
        spread_after = kf.mean[0] - kf.mean[1]
        self.assertAlmostEqual(spread_after, (1 - HYPER.season_reversion) * spread_before)

    def test_no_future_game_leaks_into_earlier_forecast(self):
        rows = [
            ("g1", 2025, "2025-09-07T17:00:00Z", "A", "B", 0, 24, 10, -3.0, -110, -110, -150, 130),
            ("g2", 2025, "2025-09-14T17:00:00Z", "B", "C", 0, 20, 17, -1.0, -110, -110, -120, 100),
            ("g3", 2025, "2025-09-21T17:00:00Z", "C", "A", 0, 3, 31, 2.5, -110, -110, 110, -130),
            ("g4", 2025, "2025-09-28T17:00:00Z", "A", "C", 0, 7, 7, -7.0, -110, -110, -300, 250),
        ]
        base = frame(rows)
        pred_a = run_filter(KalmanRatings(["A", "B", "C"], HYPER), base)
        shuffled = base.copy()
        shuffled.loc[shuffled["game_id"] == "g3", ["home_score", "away_score"]] = [40.0, 0.0]
        shuffled.loc[shuffled["game_id"] == "g4", ["home_score", "away_score"]] = [0.0, 45.0]
        pred_b = run_filter(KalmanRatings(["A", "B", "C"], HYPER), shuffled)
        for gid in ("g1", "g2", "g3"):
            ia = base.index[base["game_id"] == gid][0]
            self.assertAlmostEqual(pred_a.at[ia, "pred_mean"], pred_b.at[ia, "pred_mean"])
            self.assertAlmostEqual(pred_a.at[ia, "pred_var"], pred_b.at[ia, "pred_var"])
        i4 = base.index[base["game_id"] == "g4"][0]
        self.assertNotAlmostEqual(pred_a.at[i4, "pred_mean"], pred_b.at[i4, "pred_mean"])

    def test_same_day_games_do_not_see_each_other(self):
        rows = [
            ("g1", 2025, "2025-09-07T17:00:00Z", "A", "B", 0, 24, 10, None, None, None, None, None),
            ("g2", 2025, "2025-09-07T20:00:00Z", "A", "C", 0, 3, 30, None, None, None, None, None),
        ]
        pred = run_filter(KalmanRatings(["A", "B", "C"], HYPER), frame(rows))
        self.assertAlmostEqual(pred["pred_mean"].iloc[0], HYPER.hfa)
        self.assertAlmostEqual(pred["pred_mean"].iloc[1], HYPER.hfa)

    def test_incomplete_games_never_update(self):
        rows = [("g1", 2025, "2025-09-07T17:00:00Z", "A", "B", 0, None, None, -3.0, -110, -110, None, None)]
        kf = KalmanRatings(["A", "B"], HYPER)
        run_filter(kf, frame(rows))
        self.assertEqual(kf.mean.tolist(), [0.0, 0.0])

    def test_hyper_round_trip(self):
        v = HYPER.to_vector()
        back = Hyper.from_vector(v, HYPER.init_sd)
        for k in ("process_sd_day", "season_reversion", "season_sd", "hfa", "sigma"):
            self.assertAlmostEqual(getattr(back, k), getattr(HYPER, k), places=6)


class EmpiricalMarginTests(unittest.TestCase):
    def test_falls_back_to_normal_when_short(self):
        emp = EmpiricalMargin([0.1, -0.2, 0.3])
        self.assertFalse(emp.empirical)
        dist = emp.distribution(3.0, 13.0)
        self.assertAlmostEqual(sum(dist.values()), 1.0, places=6)

    def test_empirical_shift_preserves_integer_mass(self):
        rng = np.random.default_rng(0)
        actual = rng.choice([3, -3, 7, -7, 1, -1, 10, -10], size=400)
        pred = rng.normal(0.0, 0.1, size=400)
        emp = EmpiricalMargin((actual - pred) / 13.0)
        self.assertTrue(emp.empirical)
        dist = emp.distribution(0.0, 13.0)
        self.assertAlmostEqual(sum(dist.values()), 1.0, places=6)
        self.assertGreater(dist.get(3, 0) + dist.get(-3, 0), 0.15)
        self.assertEqual(dist.get(2, 0), 0.0)


class SignConventionTests(unittest.TestCase):
    def test_nflverse_spread_negated_to_home_handicap(self):
        raw = pd.DataFrame({
            "game_id": ["2026_10_WAS_NYG", "2026_10_KC_ATL"], "season": [2026, 2026], "week": [10, 10],
            "gameday": ["2026-11-12", "2026-11-15"], "gametime": ["20:15", None], "home_team": ["NYG", "ATL"], "away_team": ["WAS", "KC"],
            "location": ["Home", "Neutral"], "home_score": [None, None], "away_score": [None, None], "result": [None, None],
            "spread_line": [2.5, -3.5], "home_spread_odds": [-110, -118], "away_spread_odds": [-110, -102],
            "home_moneyline": [-130, 150], "away_moneyline": [110, -180], "total_line": [41.5, 45.5], "game_type": ["REG", "REG"],
        })
        out = nfl.convert_frame(raw)
        # nflverse +2.5 means NYG favored by 2.5 -> contract home handicap -2.5
        self.assertEqual(out.loc[0, "spread_line"], -2.5)
        self.assertEqual(out.loc[1, "spread_line"], 3.5)
        self.assertEqual(model.market_margin(out.loc[0, "spread_line"]), 2.5)
        self.assertEqual(out.loc[0, "neutral"], 0)
        self.assertEqual(out.loc[1, "neutral"], 1)
        self.assertEqual(str(out.loc[0, "start"]), "2026-11-13 01:15:00+00:00")  # 20:15 ET -> 01:15 UTC
        self.assertEqual(str(out.loc[1, "start"]), "2026-11-15 18:00:00+00:00")  # default 13:00 ET kickoff
        self.assertFalse(out["completed"].any())

    def test_franchise_moves(self):
        for old, new in (("OAK", "LV"), ("SD", "LAC"), ("STL", "LA")):
            self.assertEqual(nfl.normalize_team(old), new)
        self.assertEqual(nfl.normalize_team("KC"), "KC")


class NcaafLinesTests(unittest.TestCase):
    def test_multi_book_lines_consolidate_to_home_side_median(self):
        rows = []
        # game 1: UTH (id 254) home vs TCU (id 2628); three books, UTH favored by 1.5/2/3
        for book, line, hp, ap in (("A", 1.5, -117, -103), ("B", 2.0, -110, -110), ("C", 3.0, 105, -125)):
            rows.append((1, "spread", "TCU", line, ap, book, 254, 2628))
            rows.append((1, "spread", "UTH", -line, hp, book, 254, 2628))
        rows.append((1, "money_line", "TCU", None, 120, "A", 254, 2628))
        rows.append((1, "money_line", "UTH", None, -140, "A", 254, 2628))
        rows.append((1, "total", "TCU", 48.5, -110, "A", 254, 2628))
        # game 2: TCU home vs UTH so each abbreviation co-occurs with both ids once; game 3 breaks the tie
        rows.append((2, "spread", "UTH", 4.0, -110, "A", 2628, 254))
        rows.append((2, "spread", "TCU", -4.0, -110, "A", 2628, 254))
        rows.append((3, "spread", "UTH", -6.0, -110, "A", 254, 999))
        rows.append((3, "spread", "XYZ", 6.0, -110, "A", 254, 999))
        rows.append((4, "spread", "TCU", -10.0, -110, "A", 2628, 777))
        rows.append((4, "spread", "ABC", 10.0, -110, "A", 2628, 777))
        lines = pd.DataFrame(rows, columns=["game_id", "market_type", "abbr", "lines", "odds", "book", "home_team_id", "away_team_id"])
        out = ncaaf.consolidate_lines(lines).set_index("game_id")
        self.assertEqual(out.loc["1", "spread_line"], -2.0)        # home handicap, median of -1.5/-2/-3
        self.assertEqual(out.loc["1", "spread_home_price"], -110)
        self.assertEqual(out.loc["1", "spread_away_price"], -110)
        self.assertEqual(out.loc["1", "home_ml"], -140)
        self.assertEqual(out.loc["1", "away_ml"], 120)
        self.assertEqual(out.loc["1", "total_line"], 48.5)
        self.assertEqual(out.loc["1", "books"], 3)
        self.assertEqual(out.loc["2", "spread_line"], -4.0)        # TCU is home in game 2
        self.assertEqual(out.loc["3", "spread_line"], -6.0)      # one-game visitor XYZ resolved to the away side
        self.assertEqual(out.loc["4", "spread_line"], -10.0)

    def test_minor_teams_pooled(self):
        rows = [(f"g{i}", 2024, f"2024-09-{7+i:02d}T17:00:00Z", "BIG", f"SMALL{i}", 0, 40, 3, None, None, None, None, None) for i in range(6)]
        pooled = ncaaf.pool_minor_teams(frame(rows))
        self.assertEqual(set(pooled["away"]), {"FCS"})
        self.assertEqual(set(pooled["home"]), {"BIG"})


class SettlementTests(unittest.TestCase):
    def test_spread_win_loss_push(self):
        # home -3 handicap: home margin 7 covers, 3 pushes, 1 loses
        self.assertEqual(model.settle_spread(7, -3.0), "win")
        self.assertEqual(model.settle_spread(3, -3.0), "push")
        self.assertEqual(model.settle_spread(1, -3.0), "loss")
        # away side gets +3: away margin -1 (home won by 1) still covers
        self.assertEqual(model.settle_spread(-1, 3.0), "win")
        self.assertEqual(model.settle_spread(-4, 3.0), "loss")

    def test_moneyline_tie_pushes(self):
        self.assertEqual(model.settle_moneyline(0.0), "push")
        self.assertEqual(model.settle_moneyline(-2.0), "loss")
        self.assertEqual(model.settle_moneyline(5.0), "win")

    def test_grade_selections_uses_archived_prices_only(self):
        scored = pd.DataFrame([
            {"completed": True, "margin": 10.0, "spread_line": -3.0, "spread_home_price": -115, "spread_away_price": -105,
             "ind_pick": "home", "ind_home_cover": 0.6, "ind_away_cover": 0.4},
            {"completed": True, "margin": -10.0, "spread_line": -3.0, "spread_home_price": None, "spread_away_price": None,
             "ind_pick": "home", "ind_home_cover": 0.6, "ind_away_cover": 0.4},
            {"completed": True, "margin": 3.0, "spread_line": -3.0, "spread_home_price": -110, "spread_away_price": -110,
             "ind_pick": "away", "ind_home_cover": 0.4, "ind_away_cover": 0.6},
            {"completed": True, "margin": 3.0, "spread_line": -3.0, "spread_home_price": -110, "spread_away_price": -110,
             "ind_pick": None, "ind_home_cover": 0.5, "ind_away_cover": 0.5},
        ])
        sel = model.grade_selections(scored, "ind", "abs(model - market) >= 2.0")
        self.assertEqual((sel["n"], sel["wins"], sel["losses"], sel["pushes"]), (3, 1, 1, 1))
        self.assertEqual(sel["priced"], 2)
        self.assertEqual(sel["unpriced"], 1)
        self.assertAlmostEqual(sel["units"], 100.0 / 115.0, places=3)

    def test_pick_side_threshold(self):
        self.assertEqual(model.pick_side(2.0, 2.0), "home")
        self.assertEqual(model.pick_side(-2.5, 2.0), "away")
        self.assertIsNone(model.pick_side(1.9, 2.0))
        self.assertIsNone(model.pick_side(None, 2.0))


class ReportTests(unittest.TestCase):
    REQUIRED_TOP = ["sport", "label", "generatedAt", "modelId", "modelVersion", "dataThrough", "sources", "backtest", "ratings", "upcoming", "limitations"]
    REQUIRED_BT = ["seasons", "games", "mae", "marketMae", "brierSpread", "marketBrierSpread", "brierMoneyline", "marketBrierMoneyline",
                   "logLossMoneyline", "ece", "calibration", "selections", "bySeason", "variants"]
    REQUIRED_UP = ["gameId", "home", "away", "startsAt", "projectedHomeMargin", "marginSd", "homeWinProb", "marketHomeSpread", "marketHomePrice",
                   "marketAwayPrice", "marketHomeMl", "marketAwayMl", "book", "lineObservedAt", "homeCoverProb", "awayCoverProb", "pushProb",
                   "edgePts", "lean", "note"]

    def synthetic_games(self):
        rng = np.random.default_rng(1)
        teams = ["A", "B", "C", "D", "E", "F"]
        strength = {t: s for t, s in zip(teams, [6, 3, 1, -1, -3, -6])}
        rows = []
        gid = 0
        for season in range(2015, 2020):
            for week in range(1, 15):
                order = rng.permutation(teams)
                for i in range(0, 6, 2):
                    h, a = order[i], order[i + 1]
                    margin = strength[h] - strength[a] + 2.5 + rng.normal(0, 12)
                    hs = 20 + max(int(round(margin)), 0)
                    as_ = hs - int(round(margin))
                    spread = -(strength[h] - strength[a] + 2.5) + rng.normal(0, 1)
                    spread = round(spread * 2) / 2
                    day = pd.Timestamp(f"{season}-09-01T17:00:00Z") + pd.Timedelta(days=7 * week)
                    rows.append((f"g{gid}", season, day.isoformat(), h, a, 0, hs, as_, spread, -110, -110, -130, 110))
                    gid += 1
        # a few upcoming games in the last season
        last = pd.Timestamp("2019-12-20T17:00:00Z")
        rows.append(("up1", 2019, last.isoformat(), "A", "F", 0, None, None, -9.5, -110, -110, -400, 320))
        rows.append(("up2", 2019, (last + pd.Timedelta(days=1)).isoformat(), "C", "D", 1, None, None, -1.0, -105, -115, -120, 100))
        return frame(rows)

    def test_backtest_and_forecast_reports(self):
        from dirtiq_model.teams import backtest as bt
        from dirtiq_model.teams import forecast as fc
        games = self.synthetic_games()
        cfg = model.SportConfig("nfl", "TEST", threshold=2.0, warm_start=2015, first_test=2018, min_test_games=10)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bt.REPORT_DIR = tmp_path / "sports"
            bt.PRED_DIR = tmp_path / "data"
            report = bt.backtest_command(cfg, games, maxiter=40)
            for key in self.REQUIRED_TOP:
                self.assertIn(key, report)
            for key in self.REQUIRED_BT:
                self.assertIn(key, report["backtest"])
            self.assertEqual(report["backtest"]["seasons"], [2018, 2019])
            self.assertEqual(report["backtest"]["selections"]["rule"], "abs(model - market) >= 2.0")
            self.assertEqual([v["id"] for v in report["backtest"]["variants"]], ["independent", "market-anchored"])
            self.assertGreater(report["backtest"]["mae"], 0)
            ledger_path = tmp_path / "ledger.json"
            health_path = tmp_path / "health.json"
            fc_report = fc.forecast_command(cfg, games, maxiter=40, db_path=ledger_path, now=pd.Timestamp("2019-12-19T00:00:00Z"),
                                            health_path=health_path)
            self.assertEqual(len(fc_report["ratings"]), 6)
            self.assertEqual(fc_report["ratings"][0]["rank"], 1)
            self.assertEqual(len(fc_report["upcoming"]), 2)
            for key in self.REQUIRED_UP:
                self.assertIn(key, fc_report["upcoming"][0])
            self.assertEqual(fc_report["upcoming"][0]["book"], "test book")
            self.assertEqual(fc_report["ledgerRecorded"], 8)  # 2 games x (2 spread + 2 moneyline)
            self.assertIsNotNone(fc_report["backtest"])  # forecast keeps the backtest section
            self.assertTrue((tmp_path / "sports" / "nfl.json").exists())
            # settle: complete the upcoming games and grade
            done = games.copy()
            done.loc[done["game_id"] == "up1", ["home_score", "away_score", "completed"]] = [30.0, 10.0, True]
            done.loc[done["game_id"] == "up2", ["home_score", "away_score", "completed"]] = [20.0, 21.0, True]
            from dirtiq_model.ledger_core import Ledger
            counts = fc.settle_command(cfg, done, db_path=ledger_path, health_path=health_path)
            self.assertEqual(counts["settled"], 8)
            self.assertTrue(health_path.exists())
            with Ledger(ledger_path) as ledger:
                rows = {(r["event_id"], r["market"], r["selection"]): r for r in ledger.rows(sport="nfl")}
            self.assertEqual(rows[("nfl:up1", "spread", "A")]["outcome"], "win")      # A -9.5 won by 20
            self.assertEqual(rows[("nfl:up1", "spread", "F")]["outcome"], "loss")
            self.assertEqual(rows[("nfl:up1", "moneyline", "A")]["outcome"], "win")
            self.assertEqual(rows[("nfl:up2", "spread", "C")]["outcome"], "loss")     # C -1 lost by 1
            self.assertEqual(rows[("nfl:up2", "spread", "D")]["outcome"], "win")
            self.assertEqual(rows[("nfl:up2", "moneyline", "D")]["outcome"], "win")
            self.assertEqual(rows[("nfl:up2", "spread", "D")]["close_line"], 1.0)
            self.assertEqual(rows[("nfl:up2", "spread", "D")]["close_price"], -115)


if __name__ == "__main__":
    unittest.main()
