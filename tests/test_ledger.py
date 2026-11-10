import tempfile
import unittest
from pathlib import Path

from dirtiq_model import scoring
from dirtiq_model.ledger_core import Forecast, Ledger


class ScoringTests(unittest.TestCase):
    def test_american_round_trip(self):
        self.assertAlmostEqual(scoring.american_to_prob(-110), 110 / 210)
        self.assertAlmostEqual(scoring.american_to_prob(150), 0.4)
        self.assertEqual(scoring.prob_to_american(0.5238095), -110)
        self.assertEqual(scoring.prob_to_american(0.4), 150)

    def test_no_vig(self):
        a, b = scoring.no_vig_two_way(-110, -110)
        self.assertAlmostEqual(a, 0.5)
        self.assertAlmostEqual(a + b, 1.0)

    def test_settlement(self):
        self.assertEqual(scoring.settle_units("win", 150), 1.5)
        self.assertEqual(scoring.settle_units("win", -200), 0.5)
        self.assertEqual(scoring.settle_units("loss", -200), -1.0)
        self.assertEqual(scoring.settle_units("push", -110), 0.0)

    def test_margin_distribution_and_cover(self):
        dist = scoring.margin_distribution(3.0, 13.0)
        self.assertAlmostEqual(sum(dist.values()), 1.0, places=6)
        home, away, push = scoring.cover_probabilities(dist, -3.0)
        self.assertAlmostEqual(home + away, 1.0)
        self.assertGreater(push, 0.02)
        home2, _, _ = scoring.cover_probabilities(dist, 0.0)
        self.assertGreater(home2, 0.5)

    def test_calibration_bins(self):
        bins = scoring.calibration_bins([(0.05, 0), (0.07, 1), (0.95, 1)])
        self.assertEqual(sum(b["n"] for b in bins), 3)
        self.assertIsNotNone(scoring.expected_calibration_error(bins))


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(Path(self.tmp.name) / "t.db")

    def tearDown(self):
        self.ledger.close()
        self.tmp.cleanup()

    def forecast(self, **kw):
        base = dict(sport="nfl", event_id="nfl:1", event_label="A at B", market="spread", selection="B",
                    selection_label="B -3", model_id="m", model_version="1", prob=0.55, price=-110, line=-3.0,
                    forecast_at="2026-01-01T00:00:00Z")
        base.update(kw)
        return Forecast(**base)

    def test_record_settle_summarize(self):
        self.ledger.record([self.forecast(), self.forecast(selection="A", selection_label="A +3", prob=0.45)])
        self.assertEqual(len(self.ledger.rows(sport="nfl")), 2)
        # re-recording an open forecast replaces it rather than duplicating
        self.ledger.record([self.forecast(prob=0.6, forecast_at="2026-01-02T00:00:00Z")])
        rows = self.ledger.rows(sport="nfl", settled=False)
        self.assertEqual(len(rows), 2)
        self.assertEqual([r["prob"] for r in rows if r["selection"] == "B"], [0.6])
        self.assertEqual(self.ledger.settle("nfl", "nfl:1", "spread", "B", "win", result_value=7, close_price=-120), 1)
        self.assertEqual(self.ledger.settle("nfl", "nfl:1", "spread", "A", "loss", result_value=7), 1)
        # settled rows are not replaced by a later open forecast
        self.ledger.record([self.forecast(prob=0.7, forecast_at="2026-01-03T00:00:00Z")])
        self.assertEqual(len(self.ledger.rows(sport="nfl", settled=True)), 2)
        summary = self.ledger.summarize()
        m = [x for x in summary["models"] if x["market"] == "spread"][0]
        self.assertEqual(m["settled"], 2)
        self.assertEqual(m["wins"], 1)
        self.assertAlmostEqual(m["units"], 1 / 1.1 - 1, places=3)
        self.assertEqual(m["clvCount"], 1)
        self.assertGreater(m["clvAvg"], 0)

    def test_json_persistence_round_trip(self):
        path = Path(self.tmp.name) / "ledger.json"
        with Ledger(path) as ledger:
            ledger.record([self.forecast(), self.forecast(selection="A", selection_label="A +3", prob=0.45)])
            ledger.settle("nfl", "nfl:1", "spread", "B", "win", result_value=7)
        self.assertTrue(path.exists())
        with Ledger(path) as ledger:
            rows = ledger.rows(sport="nfl")
            self.assertEqual(len(rows), 2)
            self.assertEqual([r["outcome"] for r in rows if r["selection"] == "B"], ["win"])
            summary = ledger.summarize()
            self.assertEqual(summary["models"][0]["settled"], 1)

    def test_validation(self):
        with self.assertRaises(ValueError):
            self.forecast(sport="curling").validate()
        with self.assertRaises(ValueError):
            self.forecast(price=-50).validate()
        with self.assertRaises(ValueError):
            self.forecast(prob=1.2).validate()


if __name__ == "__main__":
    unittest.main()
