from __future__ import annotations

import tempfile
import unittest
from unittest import mock
from pathlib import Path

import numpy as np
import pandas as pd

from dirtiq_model.fair_lines.model import fit, probabilities, score_features
from dirtiq_model.fair_lines.evaluate import load, metrics, selections


def games():
    return pd.DataFrame([
        dict(game_id=str(i), season=2024, start=pd.Timestamp(day, tz="UTC"), home="A", away="B", neutral=0,
             home_score=hs, away_score=aws, completed=True, ind_mean=0.0, spread_line=-3.5,
             spread_home_price=-110, spread_away_price=-110, total_line=44.5)
        for i, (day, hs, aws) in enumerate([("2024-09-01 17:00", 25, 20), ("2024-09-01 23:00", 30, 10), ("2024-09-02 20:00", 21, 20)])])


class FairLineTests(unittest.TestCase):
    def test_same_day_scores_cannot_change_features(self):
        d = games()
        original = score_features(d, "nfl")
        d.loc[0, "home_score"] = 100
        changed = score_features(d, "nfl")
        np.testing.assert_array_equal(original.iloc[:2].to_numpy(), changed.iloc[:2].to_numpy())
        self.assertNotEqual(original.iloc[2].score_total, changed.iloc[2].score_total)

    def test_rest_is_eastern_calendar_not_elapsed_hours(self):
        d = games().iloc[:2].copy()
        d.loc[0, "start"] = pd.Timestamp("2024-09-01 23:30Z")
        d.loc[1, "start"] = pd.Timestamp("2024-09-03 00:30Z")
        f = score_features(d, "nba")
        self.assertEqual(f.iloc[1].home_b2b, 1.0)
        self.assertEqual(f.iloc[1].rest_sum, 2.0)

    def test_future_scores_and_market_lines_do_not_change_states(self):
        d = games()
        a = score_features(d, "nba")
        d.loc[2, "home_score"] = 999
        d["spread_line"] = 400
        d["total_line"] = 999
        pd.testing.assert_frame_equal(a, score_features(d, "nba"))

    def test_integer_push_and_half_point_probabilities(self):
        residual = np.array([-1., 0., 1., 2.])
        above, below, push = probabilities(np.array([10., 10.]), np.array([10., 10.5]), residual)
        np.testing.assert_allclose(above, [0.5, 0.5])
        np.testing.assert_allclose(below, [0.25, 0.5])
        np.testing.assert_allclose(push, [0.25, 0.0])
        np.testing.assert_allclose(above+below+push, 1.0)

    def test_calibration_targets_do_not_fit_ridge(self):
        d = pd.concat([games()]*100, ignore_index=True)
        d = d.join(score_features(d, "nfl"))
        d["actual"] = d.home_score-d.away_score
        d["market_line"] = 3.5
        cal = d.iloc[:100].copy()
        cal["season"] = 2025
        cal["start"] += pd.Timedelta(days=366)
        a = fit(d, cal, "spread", True)
        cal["actual"] += 100
        b = fit(d, cal, "spread", True)
        self.assertIsNotNone(a)
        np.testing.assert_array_equal(a.coef, b.coef)
        np.testing.assert_allclose(a.residuals+100, b.residuals)
        cal["season"] = 2024
        with self.assertRaises(ValueError):
            fit(d, cal, "spread", True)

    def test_missing_and_impossible_lines_are_not_imputed(self):
        d = games()
        d.loc[0, "spread_line"] = -110
        d.loc[1, "total_line"] = 999
        d.loc[2, "spread_home_price"] = -50
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"games.csv"
            d.to_csv(path, index=False)
            out, audit = load(path, "nfl", pd.Timestamp("2026-11-19T00:00:00Z"))
        self.assertEqual(audit["invalidSpreadLines"], 1)
        self.assertTrue(pd.isna(out.iloc[0].spread_line))
        self.assertTrue(pd.isna(out.iloc[1].total_line))
        self.assertTrue(pd.isna(out.iloc[2].spread_home_price))

    def test_conflicting_duplicate_fails(self):
        d = games()
        d.loc[1, "game_id"] = "0"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"games.csv"
            d.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "Conflicting"):
                load(path, "nfl", pd.Timestamp("2026-11-19T00:00Z"))

    def test_pooled_and_incomplete_excluded(self):
        d = games()
        d.loc[0, "home"] = "FCS"
        d.loc[1, "season"] = 2026
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"games.csv"
            d.to_csv(path, index=False)
            out, audit = load(path, "nfl", pd.Timestamp("2026-11-19T00:00Z"))
        self.assertEqual(len(out), 1)
        self.assertEqual(audit["pooledOpponentGames"], 1)
        self.assertEqual(audit["incompleteSeasonGames"], 1)

    def test_actual_price_profit_counts_push_stake(self):
        d = pd.DataFrame(dict(select=[True]*3, has_price=[True]*3, won=[True,False,False], push=[False,False,True], price=[150,-110,-110]))
        # pandas 3 exposes DataFrame.select; column lookup must not resolve that method.
        with mock.patch.object(pd.DataFrame, "select", lambda self: self, create=True):
            result = selections(d, True)
        self.assertEqual(result["bets"], 3)
        self.assertEqual(result["units"], 0.5)
        self.assertAlmostEqual(result["roi"], 0.5/3)
        self.assertEqual(result["coverRate"], 0.5)
        self.assertEqual(selections(d, False)["bets"], 0)


if __name__ == "__main__":
    unittest.main()
