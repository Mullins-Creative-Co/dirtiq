"""Model, backtest and scoring tests on synthetic data (no dependency on data/dirtiq.db)."""
from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import approx_fprime

from dirtiq_model.ledger_core import Ledger
from dirtiq_model.racing import backtest as B
from dirtiq_model.racing import data as racing_data
from dirtiq_model.racing import features as F
from dirtiq_model.racing import model as M
from dirtiq_model.racing import score as S
from dirtiq_model.racing import settle as T
from dirtiq_model.racing import train as TR

from test_racing_features import build_synthetic_db

LEGACY_KEYS = {"driverId", "driverName", "metricSeries", "modelSlug", "modelSeries", "modelReason", "modelStage",
               "rawProbability", "probability", "calibration", "trainedOn", "testAuc", "top1Accuracy", "modelEngine",
               "modelAlgorithm", "featureCount"}
NEW_KEYS = {"top3Probability", "top5Probability", "expectedFinish", "backtestLogLoss", "backtestTop1"}


class SoftmaxAndGradientTests(unittest.TestCase):
    def test_field_softmax_sums_to_one(self):
        rng = np.random.default_rng(1)
        race = np.repeat([7, 3, 11], [5, 8, 3])
        scores = rng.normal(scale=3, size=len(race))
        p = M.field_softmax(scores, race)
        for rid in (7, 3, 11):
            self.assertAlmostEqual(float(p[race == rid].sum()), 1.0, places=12)
        self.assertTrue((p > 0).all())
        # invariance to a per-race constant
        p2 = M.field_softmax(scores + np.where(race == 3, 100.0, -5.0), race)
        np.testing.assert_allclose(p, p2, atol=1e-12)

    def test_gradient_matches_finite_differences(self):
        rng = np.random.default_rng(2)
        Z = rng.normal(size=(9, 4))
        race = np.array([1, 1, 1, 2, 2, 2, 2, 3, 3])
        won = np.zeros(9)
        won[[0, 5, 8]] = 1
        w = rng.normal(size=4)
        f = lambda v: M.cl_objective(v, Z, race, won, 0.7)[0]
        analytic = M.cl_objective(w, Z, race, won, 0.7)[1]
        numeric = approx_fprime(w, f, 1e-6)
        np.testing.assert_allclose(analytic, numeric, rtol=1e-4, atol=1e-5)

    def test_plackett_luce_stats(self):
        st = M.plackett_luce_stats(np.array([3.0, 0.0, 0.0, -3.0]), n_samples=500)
        self.assertAlmostEqual(float(st["top3"].sum()), 3.0, places=6)
        self.assertAlmostEqual(float(st["top5"].sum()), 4.0, places=6)
        self.assertAlmostEqual(float(st["expected_finish"].sum()), 10.0, places=6)
        self.assertGreater(st["top3"][0], st["top3"][3])

    def test_legacy_normalizer_caps(self):
        p = M.legacy_normalizer(np.array([0.99, 0.01, 0.01, 0.01]))
        self.assertAlmostEqual(float(p.sum()), 1.0)
        self.assertLessEqual(float(p.max()), 0.45 + 1e-9)


class BacktestFoldTests(unittest.TestCase):
    def test_season_folds_boundaries(self):
        years = [2021] * 10 + [2022] * 20 + [2023] * 14 + [2024] * 40 + [2025] * 16
        folds = B.season_folds(years, min_test=15, min_train=30)
        self.assertEqual([f["season"] for f in folds], [2024, 2025])
        f24 = folds[0]
        self.assertEqual(f24["trainYears"], [2021, 2022, 2023])
        self.assertEqual(f24["trainRaces"], 44)
        self.assertEqual(f24["testRaces"], 40)
        self.assertEqual(folds[1]["trainRaces"], 84)
        self.assertEqual(B.season_folds([2024] * 50), [])


class EndToEndSyntheticTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        # ~10-day gaps spread 120 races over four seasons so rolling folds exist
        self.con = build_synthetic_db(root / "s.db", n_races=120, n_drivers=14, seed=11, upcoming=2, gap=(6, 14))
        self.con.row_factory = sqlite3.Row
        # make all synthetic races one series so folds have enough races
        self.con.execute("UPDATE races SET division='WoO Late Models', series_mode='WoO Late Models'")
        self.con.commit()
        self.data = racing_data.load_dataset(self.con)
        self.feat = F.build_features(self.data)
        self.model_dir = root / "models"
        self.out_dir = root / "ml-predictions"

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def test_models_fit_and_predict_fields(self):
        pool = B.trainable_pool(self.feat, self.data.races, "WoO Late Models", "early")
        train = pool[pool["year"] <= pool["year"].min()] if pool["year"].nunique() > 1 else pool
        for name in ("cl", "boosted", "legacy-method", "form-only", "uniform"):
            m = M.VARIANTS[name](F.EARLY_FEATURES).fit(pool)
            p = m.predict_win(pool)
            sums = pd.Series(p).groupby(pool["race_id"].to_numpy()).sum()
            np.testing.assert_allclose(sums.to_numpy(), 1.0, atol=1e-9)
        cl = M.ConditionalLogit(F.EARLY_FEATURES).fit(pool)
        self.assertIn(cl.l2, M.ConditionalLogit.L2_GRID)
        self.assertEqual(len(cl.feature_weights()), len(cl.transform.names))
        # the stronger-driver signal should be learned: elo weight positive
        weights = {r["name"]: r["weight"] for r in cl.feature_weights()}
        self.assertGreater(weights["elo"], 0.0)
        del train

    def test_backtest_report_shape(self):
        report = B.run_backtest(self.data, self.feat, series_list=["WoO Late Models"], stages=["early"],
                                variants=["cl", "uniform"], out_path=None, verbose=False)
        self.assertEqual(report["modelId"], "racing-cl")
        entry = [e for e in report["series"] if e["slug"] != "pooled"][0]
        for key in ("series", "slug", "stage", "races", "entries", "seasons", "logLoss", "uniformLogLoss", "top1",
                    "top3Overlap", "brier", "ece", "calibration", "bySeason", "features"):
            self.assertIn(key, entry)
        self.assertLess(entry["logLoss"], entry["uniformLogLoss"])

    def test_train_score_settle_round_trip(self):
        report = B.run_backtest(self.data, self.feat, series_list=["WoO Late Models"], stages=["early"],
                                variants=["cl", "boosted", "uniform"], out_path=None, verbose=False)
        entry = B.chosen_variants(report)[("WoO Late Models", "early")]
        params = TR.train_one(self.feat, self.data, "WoO Late Models", "early", "cl", entry, self.model_dir)
        self.assertEqual(params["model_engine"], "conditional_logit")
        self.assertTrue((self.model_dir / "dirtiq_model_pl_woo_late_models.pkl").exists())
        self.assertTrue((self.model_dir / "feature_params_pl_woo_late_models.json").exists())

        upcoming = S.upcoming_race_ids(self.data)
        self.assertGreaterEqual(len(upcoming), 1)
        rid = upcoming[0]
        self.con.execute("INSERT INTO market_lines VALUES (?, ?, '+450', 'manual', '2026-01-01T00:00:00Z')",
                         (rid, int(self.feat[self.feat["race_id"] == rid].iloc[0]["driver_id"])))
        self.con.commit()
        ledger = Ledger(Path(self.tmp.name) / "ledger.db")
        payloads = S.score_races([rid], data=self.data, feat=self.feat, directory=self.model_dir,
                                 out_dir=self.out_dir, ledger=ledger, con=self.con, record=True, verbose=False)
        payload = payloads[0]
        for key in ("raceId", "modelSeries", "modelSlug", "modelReason", "modelStage", "raceNightCoverage", "predictions"):
            self.assertIn(key, payload)
        self.assertEqual(payload["modelSeries"], "WoO Late Models")
        self.assertGreater(len(payload["predictions"]), 0)
        for p in payload["predictions"]:
            self.assertTrue(LEGACY_KEYS <= set(p), LEGACY_KEYS - set(p))
            self.assertTrue(NEW_KEYS <= set(p), NEW_KEYS - set(p))
            self.assertEqual(p["calibration"], "softmax_field")
            self.assertEqual(p["modelEngine"], "conditional_logit")
            self.assertIsNone(p["testAuc"])
            self.assertIsNotNone(p["backtestLogLoss"])
        self.assertAlmostEqual(sum(p["probability"] for p in payload["predictions"]), 1.0, places=9)
        written = json.loads((self.out_dir / f"race_{rid}.json").read_text())
        self.assertEqual(written["raceId"], rid)

        rows = ledger.rows(sport="racing", settled=False)
        self.assertEqual(len(rows), 2 * len(payload["predictions"]))
        priced = [r for r in rows if r["price"] is not None]
        self.assertEqual(len(priced), 1)
        self.assertEqual(priced[0]["book"], "house")
        # re-scoring replaces the open rows instead of duplicating them
        S.score_races([rid], data=self.data, feat=self.feat, directory=self.model_dir, out_dir=self.out_dir,
                      ledger=ledger, con=self.con, record=True, verbose=False)
        self.assertEqual(len(ledger.rows(sport="racing", settled=False)), 2 * len(payload["predictions"]))

        # complete the race: the top-probability driver wins, one entrant scratched
        preds = payload["predictions"]
        self.con.execute("UPDATE races SET status='complete' WHERE id=?", (rid,))
        for pos, p in enumerate(preds, start=1):
            self.con.execute("UPDATE race_entries SET finishing_position=? WHERE race_id=? AND driver_id=?", (pos, rid, p["driverId"]))
        self.con.execute("UPDATE race_entries SET entry_status='scratched', finishing_position=NULL WHERE race_id=? AND driver_id=?",
                         (rid, preds[-1]["driverId"]))
        self.con.commit()
        counts = T.settle_open(ledger, self.con, export=True, health_path=Path(self.tmp.name) / "health.json")
        self.assertEqual(counts["events"], 1)
        self.assertEqual(counts["void"], 2)
        self.assertEqual(counts["win"], 1 + 3)  # one winner + three top-3 hits
        settled = ledger.rows(sport="racing", settled=True)
        self.assertEqual(len(settled), 2 * len(preds))
        winner = [r for r in settled if r["market"] == "win" and r["selection"] == f"driver:{preds[0]['driverId']}"][0]
        self.assertEqual(winner["outcome"], "win")
        self.assertEqual(winner["result_value"], 1.0)
        self.assertTrue((Path(self.tmp.name) / "health.json").exists())
        ledger.close()


if __name__ == "__main__":
    unittest.main()
