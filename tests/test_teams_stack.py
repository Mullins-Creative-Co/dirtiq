"""Rest/starter features and the stacked layer (pure, no network)."""
from __future__ import annotations

import unittest
from statistics import NormalDist

import numpy as np
import pandas as pd

from dirtiq_model.teams import features, stack
from dirtiq_model.teams.model import config_for


def synthetic(n_games=1200, seed=3, with_market=True, with_starters=True):
    rng = np.random.default_rng(seed)
    teams = [f"T{i}" for i in range(10)]
    strength = {t: rng.normal(0, 4) for t in teams}
    rows = []
    start = pd.Timestamp("2023-10-01", tz="UTC")
    starters = {t: [f"{t}-p{j}" for j in range(5)] for t in teams}
    starter_q = {p: rng.normal(0, 1.5) for ps in starters.values() for p in ps}
    for i in range(n_games):
        h, a = rng.choice(teams, 2, replace=False)
        day = start + pd.Timedelta(days=int(i // 5))
        season = 2024 if day < pd.Timestamp("2024-03-01", tz="UTC") else 2025
        hs, as_ = starters[h][i % 5], starters[a][(i // 3) % 5]
        rest_h = rng.integers(1, 4)
        exp = strength[h] - strength[a] + 2.0 + (starter_q[hs] - starter_q[as_] if with_starters else 0.0)
        margin = exp + rng.normal(0, 8)
        home_score = 100 + margin / 2
        rows.append({"game_id": str(i), "season": season, "week": 1, "start": day + pd.Timedelta(hours=int(rest_h)),
                     "home": h, "away": a, "neutral": 0, "home_score": round(home_score), "away_score": round(home_score - margin),
                     "spread_line": (-round(exp * 2) / 2 + rng.normal(0, 1)) if with_market else np.nan,
                     "spread_home_price": -110.0, "spread_away_price": -110.0,
                     "home_ml": -150.0 if with_market else np.nan, "away_ml": 130.0 if with_market else np.nan,
                     "total_line": np.nan, "completed": True,
                     "home_starter": hs if with_starters else None, "away_starter": as_ if with_starters else None,
                     "_exp": exp})
    g = pd.DataFrame(rows)
    pred = pd.DataFrame({"pred_mean": g["_exp"] - (g["home_starter"].map(starter_q) - g["away_starter"].map(starter_q) if with_starters else 0.0) + rng.normal(0, 2, len(g)),
                         "pred_var": np.full(len(g), 64.0)}, index=g.index)
    return g.drop(columns="_exp"), pred


class RestFeaturesTests(unittest.TestCase):
    def test_rest_and_back_to_back(self):
        g = pd.DataFrame({
            "season": [2025] * 4, "start": pd.to_datetime(["2025-01-01", "2025-01-02", "2025-01-05", "2025-01-06"], utc=True),
            "home": ["A", "B", "A", "C"], "away": ["B", "A", "C", "A"],
        })
        f = features.rest_features(g)
        self.assertEqual(f.loc[0, "home_rest"], features.REST_CAP)      # season opener
        self.assertEqual(f.loc[1, "away_rest"], 1.0)                    # A played the day before
        self.assertEqual(f.loc[1, "away_b2b"], 1.0)
        self.assertEqual(f.loc[2, "home_rest"], 3.0)                    # A: Jan 2 -> Jan 5
        self.assertEqual(f.loc[3, "away_games7"], 3.0)                  # A has played 3 games in the prior week
        self.assertEqual(f.loc[3, "away_rest"], 1.0)

    def test_new_season_resets(self):
        g = pd.DataFrame({"season": [2024, 2025], "start": pd.to_datetime(["2024-04-01", "2025-04-01"], utc=True),
                          "home": ["A", "A"], "away": ["B", "B"]})
        f = features.rest_features(g)
        self.assertEqual(f.loc[1, "home_rest"], features.REST_CAP)


class StarterTests(unittest.TestCase):
    def test_as_of_and_shrinkage(self):
        g = pd.DataFrame({
            "start": pd.to_datetime(["2025-04-01", "2025-04-02", "2025-04-03"], utc=True),
            "home_score": [5, 6, 2], "away_score": [1, 1, 3], "completed": [True, True, False],
            "home_starter": ["p1", "p1", "p2"], "away_starter": ["p9", "p8", "p1"],
            "ind_mean": [0.0, 0.0, 0.0],
        })
        f = features.starter_adjustments(g)
        self.assertEqual(f.loc[0, "home_starter_adj"], 0.0)                     # nothing known yet
        self.assertAlmostEqual(f.loc[1, "home_starter_adj"], 4.0 / (1 + features.STARTER_PRIOR))
        # before game 3, p1 has residuals +4 and +5 and now pitches away
        d = 0.5 ** (1 / features.STARTER_HALF_LIFE)
        self.assertAlmostEqual(f.loc[2, "away_starter_adj"], (4 * d + 5) / (d + 1 + features.STARTER_PRIOR))
        self.assertEqual(f.loc[2, "starter_known"], 1.0)

    def test_missing_columns(self):
        g = pd.DataFrame({"start": pd.to_datetime(["2025-04-01"], utc=True), "home_score": [1], "away_score": [0], "completed": [True]})
        f = features.starter_adjustments(g)
        self.assertEqual(f.loc[0, "starter_diff"], 0.0)


class StackTests(unittest.TestCase):
    def test_fit_apply_and_learns_starters(self):
        cfg = config_for("nba")
        g, pred = synthetic()
        train = g[g["season"] == 2024]
        test = g[g["season"] == 2025]
        fits, cols = stack.fit_fold(cfg, train, pred.loc[train.index], test, pred.loc[test.index], burn_in_seasons=0)
        self.assertIsNotNone(fits["stk"])
        self.assertIsNotNone(fits["stkm"])
        self.assertEqual(len(cols), len(test))
        self.assertTrue(cols["stk_home_win"].notna().all())
        self.assertTrue(((cols["stk_home_win"].astype(float) > 0) & (cols["stk_home_win"].astype(float) < 1)).all())
        self.assertTrue(cols["stk_pick"].dropna().isin(["home", "away"]).all())
        # the stack sees starter quality the filter cannot: its margin error should beat the raw filter
        margin = (test["home_score"] - test["away_score"]).to_numpy(dtype=float)
        raw = np.mean(np.abs(margin - pred.loc[test.index, "pred_mean"].to_numpy()))
        stk = np.mean(np.abs(margin - cols["stk_mean"].astype(float).to_numpy()))
        self.assertLess(stk, raw)
        d = fits["stk"].to_dict()
        self.assertGreater(d["ridge"]["starter_diff"], 0.0)
        self.assertIn("logit", d)

    def test_market_stack_requires_lines(self):
        cfg = config_for("nhl")
        g, pred = synthetic(with_market=False, with_starters=False)
        train = g[g["season"] == 2024]
        test = g[g["season"] == 2025]
        fits, cols = stack.fit_fold(cfg, train, pred.loc[train.index], test, pred.loc[test.index], burn_in_seasons=0)
        self.assertIsNotNone(fits["stk"])
        self.assertIsNone(fits["stkm"])
        self.assertTrue(cols["stkm_mean"].isna().all())
        self.assertTrue(cols["stk_edge"].isna().all())  # no market, no edge

    def test_too_few_rows(self):
        g, pred = synthetic(n_games=100)
        f = stack.feature_frame(g, pred)
        self.assertIsNone(stack.fit_stack(f, stack.BASE_FEATURES, ties=False))


if __name__ == "__main__":
    unittest.main()


class MoneylineMarginTests(unittest.TestCase):
    def test_moneyline_margin_round_trips_probability(self):
        from statistics import NormalDist
        from dirtiq_model.teams.model import implied_market_margin, moneyline_margin
        m = moneyline_margin(0.6, 2.3)
        self.assertAlmostEqual(NormalDist(m, 2.3).cdf(0), 0.4, places=6)
        self.assertAlmostEqual(moneyline_margin(0.5, 2.3), 0.0)
        self.assertIsNone(moneyline_margin(None, 2.3))
        row = pd.Series({"home_ml": -150.0, "away_ml": 130.0, "spread_line": -1.5})
        self.assertNotEqual(implied_market_margin(row, 2.3, True), 1.5)   # puck line is ignored
        self.assertEqual(implied_market_margin(row, 2.3, False), 1.5)
        self.assertEqual(implied_market_margin(pd.Series({"spread_line": -1.5}), 2.3, True), 1.5)  # no moneyline: fall back
