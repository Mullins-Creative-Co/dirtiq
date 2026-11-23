from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd
from scripts.research.historical_model_audit import audit, selection_stats


class HistoricalModelAuditTest(unittest.TestCase):
    def test_selected_side_prices_and_pushes(self):
        d = pd.DataFrame({"edge": [4., -4., 4.], "margin": [10., -10., 0.],
            "spread_line": [0., 0., 0.], "spread_home_price": [-110., -150., -110.],
            "spread_away_price": [150., 200., -110.], "pick_prob": [.65, .65, .65]})
        r = selection_stats(d)
        self.assertEqual((r["wins"], r["losses"], r["pushes"]), (2, 0, 1))
        self.assertAlmostEqual(r["paperRoiAtArchivedPrices"], (100/110+2)/3)
        self.assertEqual(r["coverRate"], 1.)
        self.assertEqual(r["priced"], 3)
        self.assertIsNone(selection_stats(d.iloc[:0])["coverRate"])

    def test_same_games_exclude_partial_pooled_missing_and_impossible_lines(self):
        rows = []
        for i, (season, home, spread) in enumerate([(2025,"A",-3.),(2025,"B",3.),
                (2026,"C",1.),(2025,"FCS",1.),(2025,"D",None),(2025,"E",110.)]):
            rows.append(dict(game_id=str(i), season=season, home=home, away="Z", start="%s-09-%02dT18:00:00Z"%(season,i+1),
                margin=7., spread_line=spread, ind_mean=7., ind_home_cover=.65, ind_away_cover=.35,
                ind_home_win=.7, home_ml=-150., away_ml=130., spread_home_price=-110., spread_away_price=-110.))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"nfl.csv"
            pd.DataFrame(rows).to_csv(path,index=False)
            r = audit(path,"nfl")
        self.assertEqual(r["sameGameSpreadGames"],2)
        self.assertEqual(r["excludedInvalidOrPooled"],3)
        self.assertEqual(r["modelMae"],0.)
        self.assertEqual(r["marketMae"],7.)
        self.assertEqual(r["pairedMoneylineGames"],2)
        self.assertEqual(r["seasons"],[2025,2025])
