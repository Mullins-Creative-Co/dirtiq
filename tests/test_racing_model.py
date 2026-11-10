"""Model, backtest and scoring tests on synthetic data (no dependency on data/dirtiq.db)."""
from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, timedelta
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
        self.assertEqual(st["ranks"].shape, (500, 4))
        # a higher temperature flattens the field: the favorite's expected finish worsens
        hot = M.plackett_luce_stats(np.array([3.0, 0.0, 0.0, -3.0]), n_samples=500, temperature=3.0)
        self.assertGreater(hot["expected_finish"][0], st["expected_finish"][0])

    def test_pairwise_ahead(self):
        st = M.plackett_luce_stats(np.array([3.0, 0.0, -3.0]), n_samples=2000)
        m = M.pairwise_ahead(st["ranks"], [0, 1, 2])
        self.assertEqual(m.shape, (3, 3))
        np.testing.assert_allclose(np.diag(m), 0.5)
        np.testing.assert_allclose(m + m.T, 1.0, atol=1e-12)
        self.assertGreater(m[0, 1], 0.9)
        self.assertGreater(m[1, 2], 0.9)
        # a subset in a different order
        sub = M.pairwise_ahead(st["ranks"], [2, 0])
        self.assertAlmostEqual(float(sub[0, 1]), float(m[2, 0]))

    def test_apply_temperature_matches_scaled_scores(self):
        rng = np.random.default_rng(5)
        race = np.repeat([1, 2], [6, 9])
        scores = rng.normal(scale=2, size=len(race))
        p = M.field_softmax(scores, race)
        for t in (0.5, 1.0, 2.5):
            np.testing.assert_allclose(M.apply_temperature(p, race, t), M.field_softmax(scores / t, race), atol=1e-10)

    def test_fit_temperature_recovers_overconfidence(self):
        rng = np.random.default_rng(8)
        n_races, field = 1500, 10
        race = np.repeat(np.arange(n_races), field)
        true_scores = rng.normal(scale=1.0, size=len(race))
        p_true = M.field_softmax(true_scores, race)
        won = np.zeros(len(race))
        for r in range(n_races):
            idx = np.flatnonzero(race == r)
            won[rng.choice(idx, p=p_true[idx])] = 1.0
        # a model twice as sharp as the truth needs T ~ 2; a well-calibrated one keeps T = 1
        over = M.field_softmax(2.0 * true_scores, race)
        t_over = B.fit_temperature(over, race, won)
        self.assertGreater(t_over, 1.5)
        self.assertLess(t_over, 2.6)
        t_true = B.fit_temperature(p_true, race, won)
        self.assertLess(abs(t_true - 1.0), 0.15)
        # the deadband snaps a near-1 fit to exactly 1
        self.assertEqual(B.fit_temperature(p_true, race, won, deadband=0.2), 1.0)
        self.assertEqual(B.fit_temperature(over, race, won, deadband=0.2), t_over)
        before = B._mean_race_log_loss(over, won)
        after = B._mean_race_log_loss(M.apply_temperature(over, race, t_over), won)
        self.assertLess(after, before)
        fav = B.favorites_bin(over, won)
        self.assertIn("n", fav)
        self.assertEqual(B.fit_temperature(np.full(10, 0.1), np.repeat([1], 10), np.zeros(10)), 1.0)

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
        self.assertIn("out-of-fold", report["method"])
        entry = [e for e in report["series"] if e["slug"] != "pooled"][0]
        for key in ("series", "slug", "stage", "races", "entries", "seasons", "logLoss", "uniformLogLoss", "top1",
                    "top3Overlap", "brier", "ece", "calibration", "calibrationTemperature", "bySeason", "features"):
            self.assertIn(key, entry)
        self.assertLess(entry["logLoss"], entry["uniformLogLoss"])
        cal = entry["calibrationTemperature"]
        for key in ("temperature", "logLossBefore", "logLossAfter", "eceBefore", "eceAfter", "favoritesBefore",
                    "favoritesAfter", "fittedOn", "calibrationAfter"):
            self.assertIn(key, cal)
        self.assertGreaterEqual(cal["temperature"], 0.5)
        self.assertLessEqual(cal["temperature"], 3.0)
        self.assertEqual(cal["logLossBefore"], entry["logLoss"])
        self.assertLessEqual(cal["logLossAfter"], cal["logLossBefore"] + 1e-9)
        self.assertEqual(cal["favoritesBefore"]["threshold"], 0.5)
        pooled = [e for e in report["series"] if e["slug"] == "pooled"][0]
        self.assertIsNone(pooled["calibrationTemperature"]["temperature"])
        self.assertIsNotNone(pooled["calibrationTemperature"]["logLossAfter"])

    def test_train_score_settle_round_trip(self):
        report = B.run_backtest(self.data, self.feat, series_list=["WoO Late Models"], stages=["early"],
                                variants=["cl", "boosted", "uniform"], out_path=None, verbose=False)
        entry = B.chosen_variants(report)[("WoO Late Models", "early")]
        params = TR.train_one(self.feat, self.data, "WoO Late Models", "early", "cl", entry, self.model_dir)
        self.assertEqual(params["model_engine"], "conditional_logit")
        self.assertIn("calibration_temperature", params)
        if entry["variant"] == "cl":
            self.assertEqual(params["calibration_temperature"], entry["calibrationTemperature"]["temperature"])
        else:
            self.assertEqual(params["calibration_temperature"], 1.0)
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
        self.assertEqual(payload["calibrationTemperature"], params["calibration_temperature"])
        # the written probability is the temperature-scaled field softmax of the artifact's scores
        model = TR.load_artifact("WoO Late Models", "early", self.model_dir)["model"]
        rows_f = self.feat[self.feat["race_id"] == rid].reset_index(drop=True)
        expect = M.field_softmax(model.scores(rows_f) / params["calibration_temperature"], rows_f["race_id"].to_numpy())
        by_driver = {int(d): float(v) for d, v in zip(rows_f["driver_id"], expect)}
        for p in payload["predictions"]:
            self.assertAlmostEqual(p["probability"], by_driver[p["driverId"]], places=9)
        written = json.loads((self.out_dir / f"race_{rid}.json").read_text())
        self.assertEqual(written["raceId"], rid)
        pw = written["pairwise"]
        top = [p["driverId"] for p in payload["predictions"][:S.PAIRWISE_TOP]]
        self.assertEqual(pw["driverIds"], top)
        k = len(top)
        self.assertEqual(len(pw["probabilities"]), k)
        for i in range(k):
            self.assertEqual(len(pw["probabilities"][i]), k)
            self.assertEqual(pw["probabilities"][i][i], 0.5)
            for j in range(k):
                self.assertAlmostEqual(pw["probabilities"][i][j] + pw["probabilities"][j][i], 1.0, places=3)
        self.assertGreater(pw["probabilities"][0][k - 1], 0.5)

        rows = ledger.rows(sport="racing", settled=False)
        self.assertEqual(len(rows), 3 * len(payload["predictions"]))
        self.assertEqual({r["market"] for r in rows}, {"win", "top3", "top5"})
        priced = [r for r in rows if r["price"] is not None]
        self.assertEqual(len(priced), 1)
        self.assertEqual(priced[0]["book"], "house")
        # re-scoring replaces the open rows instead of duplicating them
        S.score_races([rid], data=self.data, feat=self.feat, directory=self.model_dir, out_dir=self.out_dir,
                      ledger=ledger, con=self.con, record=True, verbose=False)
        self.assertEqual(len(ledger.rows(sport="racing", settled=False)), 3 * len(payload["predictions"]))

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
        self.assertEqual(counts["void"], 3)
        self.assertEqual(counts["win"], 1 + 3 + 5)  # one winner + three top-3 + five top-5 hits
        self.assertEqual(counts["stale_events"], 0)
        settled = ledger.rows(sport="racing", settled=True)
        self.assertEqual(len(settled), 3 * len(preds))
        fifth = [r for r in settled if r["market"] == "top5" and r["selection"] == f"driver:{preds[4]['driverId']}"][0]
        self.assertEqual(fifth["outcome"], "win")
        sixth = [r for r in settled if r["market"] == "top5" and r["selection"] == f"driver:{preds[5]['driverId']}"][0]
        self.assertEqual(sixth["outcome"], "loss")
        winner = [r for r in settled if r["market"] == "win" and r["selection"] == f"driver:{preds[0]['driverId']}"][0]
        self.assertEqual(winner["outcome"], "win")
        self.assertEqual(winner["result_value"], 1.0)
        self.assertTrue((Path(self.tmp.name) / "health.json").exists())
        ledger.close()

    def _train_early(self):
        report = B.run_backtest(self.data, self.feat, series_list=["WoO Late Models"], stages=["early"],
                                variants=["cl", "uniform"], out_path=None, verbose=False)
        entry = B.chosen_variants(report)[("WoO Late Models", "early")]
        TR.train_one(self.feat, self.data, "WoO Late Models", "early", "cl", entry, self.model_dir)

    def test_score_upcoming_skips_stale_races(self):
        self._train_early()
        upcoming = S.upcoming_race_ids(self.data)
        self.assertEqual(len(upcoming), 2)
        dates = {rid: pd.Timestamp(self.data.race(rid)["race_date"]).date() for rid in upcoming}
        first, second = upcoming
        # today = three days after the first race: not stale (exactly 3 days), second race in the future
        today = dates[first] + timedelta(days=3)
        fresh, stale = S.split_stale(self.data, upcoming, today)
        self.assertEqual((fresh, stale), ([first, second], []))
        # four days after the first race: the first is stale by 4 days, the second is not
        today = dates[first] + timedelta(days=4)
        fresh, stale = S.split_stale(self.data, upcoming, today)
        self.assertEqual(fresh, [second])
        self.assertEqual(stale, [(first, 4)])
        ledger = Ledger(Path(self.tmp.name) / "ledger-stale.db")
        buf = io.StringIO()
        with redirect_stdout(buf):
            payloads = S.score_upcoming(today=today, con=self.con, data=self.data, feat=self.feat, directory=self.model_dir,
                                        out_dir=self.out_dir, ledger=ledger, record=True, verbose=False)
        out = buf.getvalue()
        self.assertEqual([p["raceId"] for p in payloads], [second])
        self.assertIn(f"skip {first}", out)
        self.assertIn("stale upcoming race", out)
        self.assertIn("stale skipped: 1", out)
        self.assertFalse((self.out_dir / f"race_{first}.json").exists())
        self.assertTrue((self.out_dir / f"race_{second}.json").exists())
        self.assertEqual({r["event_id"] for r in ledger.rows(sport="racing")}, {f"race:{second}"})
        # a limit applies after the stale filter
        with redirect_stdout(io.StringIO()):
            payloads = S.score_upcoming(limit=1, today=today, con=self.con, data=self.data, feat=self.feat,
                                        directory=self.model_dir, out_dir=self.out_dir, ledger=ledger, record=False, verbose=False)
        self.assertEqual([p["raceId"] for p in payloads], [second])
        # everything stale: nothing scored, no error
        with redirect_stdout(io.StringIO()):
            payloads = S.score_upcoming(today=dates[second] + timedelta(days=30), con=self.con, data=self.data, feat=self.feat,
                                        directory=self.model_dir, out_dir=self.out_dir, ledger=ledger, record=False, verbose=False)
        self.assertEqual(payloads, [])
        ledger.close()

    def test_settle_voids_stale_upcoming_rows(self):
        self._train_early()
        upcoming = S.upcoming_race_ids(self.data)
        first, second = upcoming
        race_day = pd.Timestamp(self.data.race(first)["race_date"]).date()
        ledger = Ledger(Path(self.tmp.name) / "ledger-void.db")
        payloads = S.score_races(upcoming, data=self.data, feat=self.feat, directory=self.model_dir, out_dir=self.out_dir,
                                 ledger=ledger, con=self.con, record=True, verbose=False)
        n_first = 3 * len(payloads[0]["predictions"])
        n_second = 3 * len(payloads[1]["predictions"])
        self.assertEqual(len(ledger.rows(sport="racing", settled=False)), n_first + n_second)
        # within three days: rows stay open and are counted as pending
        counts = T.settle_open(ledger, self.con, export=False, today=race_day + timedelta(days=3))
        self.assertEqual(counts["stale_events"], 0)
        self.assertEqual(counts["pending"], 2)
        self.assertEqual(len(ledger.rows(sport="racing", settled=False)), n_first + n_second)
        # four days on: the first race's rows are voided with the stale reason, the second's stay open
        buf = io.StringIO()
        with redirect_stdout(buf):
            counts = T.settle_open(ledger, self.con, export=False, today=race_day + timedelta(days=4), verbose=True)
        self.assertEqual(counts["stale_events"], 1)
        self.assertEqual(counts["stale_void"], n_first)
        self.assertEqual(counts["pending"], 1)
        self.assertEqual(counts["events"], 0)
        self.assertIn(f"void race:{first}", buf.getvalue())
        voided = [r for r in ledger.rows(sport="racing", settled=True)]
        self.assertEqual(len(voided), n_first)
        for r in voided:
            self.assertEqual(r["event_id"], f"race:{first}")
            self.assertEqual(r["outcome"], "void")
            self.assertEqual(json.loads(r["meta"])["reason"], T.STALE_REASON)
            self.assertEqual(json.loads(r["meta"])["series"], "WoO Late Models")
        open_rows = ledger.rows(sport="racing", settled=False)
        self.assertEqual(len(open_rows), n_second)
        self.assertTrue(all(r["event_id"] == f"race:{second}" for r in open_rows))
        # reloading the persisted ledger keeps the voids and the reason
        ledger.close()
        reloaded = Ledger(Path(self.tmp.name) / "ledger-void.db")
        self.assertEqual(len(reloaded.rows(sport="racing", settled=True)), n_first)
        self.assertEqual(json.loads(reloaded.rows(sport="racing", settled=True)[0]["meta"])["reason"], T.STALE_REASON)
        reloaded.close()


if __name__ == "__main__":
    unittest.main()
