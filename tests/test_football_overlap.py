import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('overlap', Path(__file__).resolve().parents[1]/'scripts/football/overlap_audit.py')
overlap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlap)


class OverlapTests(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(423)

    def test_exact_duplicate_is_removed_without_changing_baseline_prediction(self):
        b = self.rng.normal(size=(300, 2)); bt = self.rng.normal(size=(60, 2))
        y = 4*b[:, 0]-2*b[:, 1]+3
        fit = overlap.overlap_fit(b, b[:, :1], y, np.ones(300), bt, bt[:, :1])
        np.testing.assert_allclose(fit['new'], fit['baseline'], atol=1e-10)
        self.assertEqual(fit['active_signals'], 0)
        self.assertGreater(np.mean(np.abs(fit['full']-(4*bt[:, 0]-2*bt[:, 1]+3))), np.mean(np.abs(fit['new']-(4*bt[:, 0]-2*bt[:, 1]+3))))

    def test_independent_signal_is_not_discarded(self):
        b = self.rng.normal(size=(500, 2)); z = self.rng.normal(size=(500, 1))
        bt = self.rng.normal(size=(100, 2)); zt = self.rng.normal(size=(100, 1))
        y = 2*b[:, 0]+5*z[:, 0]; actual = 2*bt[:, 0]+5*zt[:, 0]
        fit = overlap.overlap_fit(b, z, y, np.ones(500), bt, zt, .000001)
        self.assertEqual(fit['active_signals'], 1)
        self.assertLess(np.mean((fit['new']-actual)**2), 1e-10)
        self.assertGreater(np.mean((fit['baseline']-actual)**2), 10)

    def test_orthogonalizing_ols_is_not_a_magic_improvement_over_the_same_joint_model(self):
        b = self.rng.normal(size=(500, 3)); z = b[:, :2]+self.rng.normal(size=(500, 2))*.4
        bt = self.rng.normal(size=(100, 3)); zt = bt[:, :2]+self.rng.normal(size=(100, 2))*.4
        y = b @ np.array([2., -3., 1.])+z @ np.array([4., 5.])+7
        weights = np.linspace(.5, 1.5, 500)
        fitted = overlap.overlap_fit(b, z, y, weights, bt, zt, 0.)
        design = np.column_stack([np.ones(500), b, z]); root = np.sqrt(weights)
        coef = np.linalg.lstsq(design*root[:, None], y*root, rcond=1e-10)[0]
        joint = np.column_stack([np.ones(100), bt, zt]) @ coef
        np.testing.assert_allclose(fitted['new'], joint, atol=1e-9)

    def test_weekly_bootstrap_is_deterministic_and_handles_no_selected_sides(self):
        self.assertIsNone(overlap.interval([], [], 21, 100))
        first = overlap.interval([1., 2., -1., -2.], ['a', 'a', 'b', 'b'], 21, 200)
        self.assertEqual(first, overlap.interval([1., 2., -1., -2.], ['a', 'a', 'b', 'b'], 21, 200))
        self.assertEqual(overlap.interval([0., 0.], ['a', 'b'], 21, 200), [0., 0.])

    def test_final_half_and_its_features_are_never_used_in_audit(self):
        dataset = json.loads((Path(__file__).resolve().parents[1]/'public/football/history.json').read_text())['games']
        before = overlap.audit(dataset, 'source', samples=200)
        changed = [dict(r, home_margin=999999, qb_epa_diff=float('nan')) if r['season'] == 2025 and r['week'] >= 10 else r for r in dataset]
        after = overlap.audit(changed, 'source', samples=200)
        self.assertEqual(before['experiments'], after['experiments'])
        self.assertEqual(before['games'], 705)
        self.assertFalse(before['holdout']['evaluated'])
        self.assertEqual(before['settings']['familyComparisons'], 21)
        json.dumps(before, allow_nan=False)

    def test_future_development_outcomes_cannot_change_first_predictions(self):
        dataset = json.loads((Path(__file__).resolve().parents[1]/'public/football/history.json').read_text())['games']
        before = overlap.audit(dataset, samples=100)
        changed = [dict(r, home_margin=-9999) if r['season'] >= 2023 else r for r in dataset]
        after = overlap.audit(changed, samples=100)
        for first, second in zip(before['experiments'], after['experiments']):
            for a, b in zip(first['firstPredictions'], second['firstPredictions']):
                for key in ['baseline', 'full', 'new', 'full_add', 'new_add', 'projected_add']:
                    self.assertEqual(a[key], b[key])


if __name__ == '__main__':
    unittest.main()
