from __future__ import annotations
import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
from study import baseline_side, stats, schedule_features, wilson, HOLDOUT

class ResearchChecks(unittest.TestCase):
    def test_locked_side_sign_push_and_minus110(self):
        frame = pd.DataFrame({"margin": [5., 5., 3.], "spread_line": [-3., -3., -3.], "mu": [8., -8., 8.]})
        side = baseline_side(frame, "nba")
        np.testing.assert_array_equal(side, [1., -1., 1.])
        result = stats(frame, side)
        self.assertEqual((result['wins'], result['losses'], result['pushesExcluded'], result['n']), (1, 1, 1, 2))
        self.assertAlmostEqual(result['roi'], (10/11-1)/2)
        self.assertEqual(stats(frame, np.zeros(3))['ci95'], [None, None])

    def test_open_and_close_grade_separately(self):
        f = pd.DataFrame({"margin": [4.], "spread_line": [-5.]})
        self.assertEqual(stats(f, [1])['losses'], 1)
        self.assertEqual(stats(f, [1], [-3])['wins'], 1)
        # Away side reverses the home margin and home handicap together.
        self.assertEqual(stats(f, [-1], [-5])['wins'], 1)

    def test_rest_and_travel_use_only_prior_schedule(self):
        g = pd.DataFrame({"game_id": ['1','2','3'], "season": [2025]*3,
            "start": pd.to_datetime(['2024-11-01T12:00Z','2024-11-03T12:00Z','2024-11-20T12:00Z']),
            "home": ['A','B','A'], "away": ['B','A','B']})
        meta = pd.DataFrame({"game_id": ['1','2','3'], "city": ['Boston','Chicago','Boston'], "state": ['MA','IL','MA'],
            "home_conference": [1]*3, "away_conference": [1]*3})
        cities = {('boston','MA'):(42.36,-71.06),('chicago','IL'):(41.88,-87.63)}
        full = schedule_features(g, meta, cities)
        prior = schedule_features(g.iloc[:2], meta.iloc[:2], cities)
        np.testing.assert_allclose(full.home_rest.iloc[:2], prior.home_rest)
        np.testing.assert_allclose(full.away_travel.iloc[:2], prior.away_travel, equal_nan=True)
        self.assertEqual(full.home_rest.iloc[1], 2)
        self.assertTrue(np.isnan(full.home_travel.iloc[0]))
        self.assertTrue(full.home_travel.iloc[1] > 6)

    def test_pooled_opponents_are_not_one_physical_team(self):
        games = pd.DataFrame({"game_id":['1','2','3'], "season":[2024]*3,
            "start":pd.to_datetime(['2024-09-01T12:00Z','2024-09-02T12:00Z','2024-09-03T12:00Z']),
            "home":['H1','H2','H3'], "away":['FCS']*3})
        meta = pd.DataFrame({"game_id":['1','2','3'],"away_identity":['A','B','A'],
            "city":[None]*3,"state":[None]*3,"home_conference":[None]*3,"away_conference":[None]*3})
        out=schedule_features(games,meta,{})
        self.assertEqual(out.away_rest.tolist(),[7,7,2])

    def test_back_to_back_uses_calendar_dates_not_24_hours(self):
        games = pd.DataFrame({"game_id":['1','2'],"season":[2024]*2,
            "start":pd.to_datetime(['2024-11-01T23:00Z','2024-11-03T00:00Z']),
            "home":['A','B'],"away":['B','A']})
        out=schedule_features(games,pd.DataFrame(),{})
        self.assertEqual(out.home_b2b.tolist(),[0,1])
        self.assertEqual(out.home_rest.tolist(),[7,1])

    def test_blas_matches_scalar_arithmetic(self):
        # Accelerate on some Apple chips emits false floating-point warnings.
        # Check the actual numbers, not whether a warning was emitted.
        rng = np.random.default_rng(20261113)
        a,b = rng.normal(size=(30,12)),rng.normal(size=(12,17))
        product = a @ b
        reference = np.array([[sum(float(a[i,k])*float(b[k,j]) for k in range(12))
                               for j in range(17)] for i in range(30)])
        self.assertTrue(np.isfinite(product).all())
        np.testing.assert_allclose(product,reference,atol=1e-12,rtol=1e-12)

    def test_intervals_and_holdouts(self):
        low, high = wilson(50,100)
        self.assertLess(low,.5)
        self.assertGreater(high,.5)
        self.assertEqual(HOLDOUT['ncaab'],(2025,2026))
        self.assertEqual(HOLDOUT['nfl'],(2024,2025))

if __name__ == '__main__':
    unittest.main()
