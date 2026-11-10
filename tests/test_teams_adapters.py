"""Adapter parsing tests for NCAAB, MLB and NHL plus their sport configs. No network: tiny synthetic payloads."""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from dirtiq_model.teams import model
from dirtiq_model.teams.adapters import SPORTS, get_adapter, mlb, ncaab, nhl
from dirtiq_model.teams.adapters.common import CONTRACT_COLUMNS, finalize


def espn_rows(*rows):
    """Rows: (id, season, season_type, date, home, away, hs, as, status, completed, neutral, home_conf, away_conf)."""
    cols = ["id", "season", "season_type", "date", "home_abbreviation", "away_abbreviation", "home_score", "away_score",
            "status_type_name", "status_type_completed", "neutral_site", "home_conference_id", "away_conference_id"]
    return pd.DataFrame(list(rows), columns=cols)


class NcaabAdapterTests(unittest.TestCase):
    def test_convert_frame_contract_and_statuses(self):
        raw = espn_rows(
            (401, 2026, 2, "2025-11-04T00:00Z", "DUKE", "UNC", 80, 70, "STATUS_FINAL", True, False, 2.0, 2.0),
            (402, 2026, 2, "2025-11-05T00:00Z", "KU", "CHAM", 95, 50, "STATUS_FINAL", True, False, 8.0, None),
            (403, 2026, 3, "2026-03-20T00:00Z", "KU", "DUKE", 0, 0, "STATUS_SCHEDULED", False, True, 8.0, 2.0),
            (404, 2026, 2, "2025-12-01T00:00Z", "UNC", "KU", 70, 71, "STATUS_POSTPONED", False, False, 2.0, 8.0),
            (405, 2026, 1, "2025-10-20T00:00Z", "UNC", "KU", 70, 71, "STATUS_FINAL", True, False, 2.0, 8.0),
        )
        out = ncaab.convert_frame(raw)
        self.assertEqual(sorted(out["game_id"]), ["401", "402", "403"])  # postponed and preseason dropped
        by = out.set_index("game_id")
        self.assertTrue(by.loc["401", "completed"])
        self.assertFalse(by.loc["403", "completed"])
        self.assertTrue(np.isnan(by.loc["403", "home_score"]))
        self.assertEqual(by.loc["403", "neutral"], 1)
        self.assertEqual(by.loc["403", "game_type"], "postseason")
        self.assertFalse(by.loc["402", "away_d1"])
        self.assertTrue(by.loc["402", "home_d1"])
        self.assertTrue(out["spread_line"].isna().all())
        self.assertEqual(by.loc["401", "week"], 1)
        self.assertEqual(by.loc["403", "week"], 20)
        self.assertEqual(str(by.loc["401", "start"]), "2025-11-04 00:00:00+00:00")

    def test_non_d1_pooled_and_minor_teams_pooled(self):
        rows = []
        for i in range(8):  # DUKE plays eight D-I games against UNC-like teams with conference ids
            rows.append((500 + i, 2026, 2, f"2025-11-{10 + i:02d}T00:00Z", "DUKE", f"T{i}", 80, 70, "STATUS_FINAL", True, False, 2.0, 3.0))
        for i in range(8):  # each T{i} also plays six more games so it keeps its own rating
            for j in range(6):
                rows.append((600 + i * 10 + j, 2026, 2, f"2025-12-{1 + j:02d}T00:00Z", f"T{i}", "UNC", 60, 61, "STATUS_FINAL", True, False, 3.0, 2.0))
        rows.append((700, 2026, 2, "2025-11-02T00:00Z", "DUKE", "CHAM", 99, 40, "STATUS_FINAL", True, False, 2.0, None))  # non-D-I visitor
        rows.append((701, 2026, 2, "2025-11-03T00:00Z", "UNC", "WOFF", 90, 60, "STATUS_FINAL", True, False, 2.0, 11.0))  # D-I but one game
        rows.append((702, 2026, 2, "2025-11-04T00:00Z", "CHAM", "WOFF", 70, 60, "STATUS_FINAL", True, False, None, 11.0))  # pooled vs pooled
        out = ncaab.pool_non_d1(ncaab.convert_frame(espn_rows(*rows)))
        self.assertEqual(out[out["game_id"] == "700"]["away"].iloc[0], "NON_D1")
        self.assertEqual(out[out["game_id"] == "701"]["away"].iloc[0], "NON_D1")
        self.assertNotIn("702", set(out["game_id"]))
        self.assertNotIn("home_d1", out.columns)
        self.assertEqual(set(out[out["home"] == "DUKE"]["away"]) - {"NON_D1"}, {f"T{i}" for i in range(8)})

    def test_current_ending_season(self):
        self.assertEqual(ncaab.current_ending_season(pd.Timestamp("2026-11-10", tz="UTC")), 2027)
        self.assertEqual(ncaab.current_ending_season(pd.Timestamp("2027-03-10", tz="UTC")), 2027)
        self.assertEqual(ncaab.current_ending_season(pd.Timestamp("2027-10-05", tz="UTC")), 2028)


def mlb_game(pk, gtype, date, home_id, away_id, hs=None, as_=None, state="Final", coded="F", venue="Fenway Park", season="2026"):
    g = {
        "gamePk": pk, "gameType": gtype, "season": season, "gameDate": date, "officialDate": date[:10],
        "status": {"abstractGameState": "Final" if state in ("Final", "Postponed", "Cancelled", "Completed Early") else "Preview",
                   "codedGameState": coded, "detailedState": state},
        "teams": {"away": {"team": {"id": away_id, "name": "Away"}}, "home": {"team": {"id": home_id, "name": "Home"}}},
        "venue": {"id": 1, "name": venue}, "doubleHeader": "N", "gameNumber": 1, "isTie": hs is not None and hs == as_,
    }
    if hs is not None:
        g["teams"]["home"]["score"] = hs
        g["teams"]["away"]["score"] = as_
    return g


class MlbAdapterTests(unittest.TestCase):
    TEAMS = {"teams": [{"id": 111, "abbreviation": "BOS"}, {"id": 147, "abbreviation": "NYY"}, {"id": 133, "abbreviation": "ATH"}]}

    def test_convert_frame(self):
        payload = {"dates": [
            {"date": "2026-04-01", "games": [mlb_game(1, "R", "2026-04-01T23:10:00Z", 111, 147, 5, 3)]},
            {"date": "2026-04-02", "games": [mlb_game(2, "R", "2026-04-02T23:10:00Z", 111, 147, None, None, state="Postponed", coded="D")]},
            {"date": "2026-04-03", "games": [mlb_game(2, "R", "2026-04-03T17:10:00Z", 111, 147, 2, 2, state="Completed Early", coded="F")]},
            {"date": "2026-06-15", "games": [mlb_game(3, "R", "2026-06-15T18:10:00Z", 133, 147, 1, 4, venue="London Stadium")]},
            {"date": "2026-10-20", "games": [mlb_game(4, "W", "2026-10-20T00:08:00Z", 147, 111, None, None, state="Scheduled", coded="S")]},
            {"date": "2026-03-10", "games": [mlb_game(5, "S", "2026-03-10T18:05:00Z", 111, 147, 9, 1)]},
        ]}
        out = mlb.convert_frame(payload, mlb.team_map(self.TEAMS)).set_index("game_id")
        self.assertEqual(sorted(out.index), ["1", "2", "3", "4"])  # spring training excluded, postponed row collapsed into its makeup
        self.assertEqual(out.loc["1", "home"], "BOS")
        self.assertEqual(out.loc["1", "away"], "NYY")
        self.assertEqual(out.loc["1", "home_score"] - out.loc["1", "away_score"], 2)
        self.assertTrue(out.loc["2", "completed"])  # the completed-early makeup game
        self.assertEqual(str(out.loc["2", "start"]), "2026-04-03 17:10:00+00:00")
        self.assertTrue(out.loc["2", "tie"])
        self.assertEqual(out.loc["3", "neutral"], 1)
        self.assertEqual(out.loc["3", "home"], "ATH")
        self.assertEqual(out.loc["1", "neutral"], 0)
        self.assertFalse(out.loc["4", "completed"])
        self.assertTrue(np.isnan(out.loc["4", "home_score"]))
        self.assertEqual(out.loc["4", "game_type"], "world-series")
        self.assertTrue(out["home_ml"].isna().all())
        self.assertEqual(out.loc["1", "week"], 1)
        self.assertEqual(out.loc["4", "week"], 29)  # 202 days after the opener

    def test_bubble_postseason_is_neutral(self):
        self.assertEqual(mlb.is_neutral("Globe Life Field", 2020, "W"), 1)
        self.assertEqual(mlb.is_neutral("Globe Life Field", 2020, "R"), 0)
        self.assertEqual(mlb.is_neutral("Globe Life Field", 2023, "W"), 0)
        self.assertEqual(mlb.is_neutral("Tokyo Dome", 2025, "R"), 1)

    def test_empty_payload(self):
        out = mlb.convert_frame({"dates": []}, {})
        self.assertEqual(len(out), 0)
        for col in CONTRACT_COLUMNS:
            self.assertIn(col, out.columns)


def nhl_game(gid, gtype, eastern, home, away, hs, as_, state=7, period=3, sched=1, season=20262027):
    return {"id": gid, "season": season, "gameType": gtype, "gameDate": eastern[:10], "easternStartTime": eastern,
            "gameStateId": state, "gameScheduleStateId": sched, "homeTeamId": home, "visitingTeamId": away,
            "homeScore": hs, "visitingScore": as_, "period": period}


class NhlAdapterTests(unittest.TestCase):
    TEAMS = {"data": [{"id": 10, "triCode": "TOR"}, {"id": 8, "triCode": "MTL"}, {"id": 53, "triCode": "ARI"}, {"id": 68, "triCode": "UTA"}]}

    def test_convert_frame_margins_and_states(self):
        payload = {"data": [
            nhl_game(2026020001, 2, "2026-10-07T19:00:00", 10, 8, 4, 1),                         # regulation, TOR by 3
            nhl_game(2026020002, 2, "2026-10-09T19:00:00", 8, 10, 3, 2, period=4),               # OT, MTL by 1
            nhl_game(2026020003, 2, "2026-10-11T19:00:00", 10, 8, 2, 3, period=5),               # shootout, MTL by 1 (feed credits the goal)
            nhl_game(2026020004, 2, "2026-11-20T19:00:00", 10, 8, 0, 0, state=1, period=1),      # scheduled
            nhl_game(2026010001, 1, "2026-09-25T19:00:00", 10, 8, 5, 0),                         # preseason excluded
            nhl_game(2026020005, 2, "2026-10-12T19:00:00", 10, 8, 0, 0, state=1, sched=3),       # postponed excluded
            nhl_game(2026020006, 2, "2026-10-13T19:00:00", 53, 8, 2, 0),                         # ARI -> UTA alias
        ]}
        out = nhl.convert_frame(payload, nhl.team_map(self.TEAMS)).set_index("game_id")
        self.assertEqual(sorted(out.index), ["2026020001", "2026020002", "2026020003", "2026020004", "2026020006"])
        self.assertEqual(out.loc["2026020001", "home_score"] - out.loc["2026020001", "away_score"], 3)
        self.assertFalse(out.loc["2026020001", "extra_time"])
        self.assertEqual(out.loc["2026020002", "home_score"] - out.loc["2026020002", "away_score"], 1)
        self.assertTrue(out.loc["2026020002", "extra_time"])
        self.assertEqual((out.loc["2026020003", "home_score"], out.loc["2026020003", "away_score"]), (2.0, 3.0))
        self.assertFalse(out.loc["2026020004", "completed"])
        self.assertTrue(np.isnan(out.loc["2026020004", "home_score"]))
        self.assertEqual(out.loc["2026020006", "home"], "UTA")
        self.assertEqual(int(out.loc["2026020001", "season"]), 2027)
        self.assertEqual(str(out.loc["2026020001", "start"]), "2026-10-07 23:00:00+00:00")  # 19:00 EDT -> 23:00 UTC
        self.assertEqual(out.loc["2026020001", "neutral"], 0)
        self.assertTrue(out["spread_line"].isna().all())
        self.assertEqual(out.loc["2026020001", "game_type"], "regular")

    def test_overtime_margin_clamped_when_feed_shows_more(self):
        payload = {"data": [nhl_game(2026030001, 3, "2027-04-20T19:00:00", 10, 8, 5, 2, period=4)]}
        out = nhl.convert_frame(payload, nhl.team_map(self.TEAMS))
        self.assertEqual(float(out["home_score"].iloc[0] - out["away_score"].iloc[0]), 1.0)
        self.assertEqual(out["game_type"].iloc[0], "playoffs")

    def test_unplayed_if_necessary_rows_dropped_for_past_seasons(self):
        payload = {"data": [
            nhl_game(2025030411, 3, "2026-06-01T20:00:00", 10, 8, 3, 1, season=20252026),
            nhl_game(2025030417, 3, "2026-06-15T20:00:00", 10, 8, 0, 0, state=1, period=1, season=20252026),  # never played
            nhl_game(2025030416, 3, "2026-05-20T20:00:00", 8, 10, 0, 0, state=1, period=1, sched=2, season=20252026),  # dated before last final
            nhl_game(2026020001, 2, "2026-10-07T19:00:00", 10, 8, 4, 1),
            nhl_game(2026020002, 2, "2026-12-07T19:00:00", 10, 8, 0, 0, state=1, period=1),
        ]}
        conv = nhl.convert_frame(payload, nhl.team_map(self.TEAMS))
        self.assertNotIn("2025030416", set(conv["game_id"]))
        out = nhl.drop_unplayed_past(conv)
        self.assertEqual(sorted(out["game_id"]), ["2025030411", "2026020001", "2026020002"])

    def test_season_helpers(self):
        self.assertEqual(nhl.season_id(2016), "20152016")
        self.assertEqual(nhl.current_ending_season(pd.Timestamp("2026-11-10", tz="UTC")), 2027)
        self.assertEqual(nhl.current_ending_season(pd.Timestamp("2027-05-10", tz="UTC")), 2027)
        self.assertEqual(nhl.current_ending_season(pd.Timestamp("2027-09-20", tz="UTC")), 2028)


class SportConfigTests(unittest.TestCase):
    def test_all_sports_registered(self):
        for sport in SPORTS:
            cfg = model.config_for(sport)
            self.assertEqual(cfg.sport, sport)
            self.assertTrue(get_adapter(sport).LABEL)

    def test_new_sport_thresholds_noise_and_ties(self):
        mlb_cfg, nhl_cfg, ncaab_cfg = model.config_for("mlb"), model.config_for("nhl"), model.config_for("ncaab")
        self.assertEqual((mlb_cfg.threshold, mlb_cfg.unit, mlb_cfg.ties), (1.0, "runs", False))
        self.assertAlmostEqual(mlb_cfg.sigma_prior, 4.3)
        self.assertEqual(mlb_cfg.rule, "abs(model - market) >= 1.0")
        self.assertEqual((nhl_cfg.threshold, nhl_cfg.unit, nhl_cfg.ties), (0.5, "goals", False))
        self.assertAlmostEqual(nhl_cfg.sigma_prior, 2.3)
        self.assertEqual(nhl_cfg.rule, "abs(model - market) >= 0.5")
        self.assertEqual((ncaab_cfg.threshold, ncaab_cfg.ties, ncaab_cfg.first_test), (3.0, False, 2019))
        self.assertIsNotNone(ncaab_cfg.maxiter)
        self.assertEqual((mlb_cfg.warm_start, nhl_cfg.warm_start, ncaab_cfg.warm_start), (2015, 2016, 2016))

    def test_initial_hyper_applies_priors(self):
        rows = []
        for i in range(40):
            rows.append({"game_id": f"g{i}", "season": 2025, "week": 1, "start": f"2025-04-{1 + i % 28:02d}T17:00:00Z",
                         "home": "A" if i % 2 else "B", "away": "B" if i % 2 else "A", "neutral": 0,
                         "home_score": 5 + (i % 3), "away_score": 4, "completed": True})
        games = finalize(pd.DataFrame(rows), [], None, "T")
        mlb_hyper = model.initial_hyper(model.config_for("mlb"), games)
        self.assertAlmostEqual(mlb_hyper.sigma, 4.3)
        self.assertAlmostEqual(mlb_hyper.hfa, 0.2)
        nfl_hyper = model.initial_hyper(model.config_for("nfl"), games)
        self.assertNotAlmostEqual(nfl_hyper.sigma, 4.3)
        self.assertAlmostEqual(nfl_hyper.hfa, float((games["home_score"] - games["away_score"]).mean()))

    def test_scorer_drops_tie_mass_for_hockey(self):
        from dirtiq_model.teams.ratings import EmpiricalMargin
        scorer = model.Scorer(0.5, EmpiricalMargin([]), ties=False)
        row = pd.Series({"spread_line": np.nan, "home_ml": np.nan, "away_ml": np.nan, "spread_home_price": np.nan, "spread_away_price": np.nan})
        out = scorer.score_one(0.3, 2.3 ** 2, row)
        self.assertAlmostEqual(out["ind_tie"], 0.0)
        self.assertGreater(out["ind_home_win"], 0.5)
        self.assertIsNone(out["ind_pick"])


if __name__ == "__main__":
    unittest.main()
