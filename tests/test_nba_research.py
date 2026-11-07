from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nba', ROOT/'scripts/nba_research.py')
nba = importlib.util.module_from_spec(spec); spec.loader.exec_module(nba)


class NbaTests(unittest.TestCase):
    def test_rotation_change_measures_new_information_not_the_same_absence_again(self):
        base = [dict(rotation={1:.5, 2:.5}) for _ in range(10)]
        self.assertEqual(nba.rotation_change(base), 0.)
        self.assertEqual(nba.rotation_change(base+[dict(rotation={2:.5, 3:.5})]), .5)
        self.assertEqual(nba.rotation_change([dict(rotation={2:.5, 3:.5}) for _ in range(10)]), 0.)

    def test_missing_box_does_not_erase_actual_back_to_back_or_assume_rotation_known(self):
        cutoff = datetime(2024, 1, 20, 22, tzinfo=timezone.utc)
        rates = dict(netEfficiency=1., efg=.5, turnoverRate=.1, offReboundRate=.2, ftRate=.1)
        hist = [dict(tip=cutoff-timedelta(days=20-i),available=cutoff-timedelta(days=20-i,hours=-8), rates=rates,rotation={1:1.}) for i in range(10)]
        hist.append(dict(tip=cutoff-timedelta(days=1),available=cutoff-timedelta(hours=16), rates=None,rotation={}))
        result = nba.team_features(hist,cutoff)
        self.assertEqual(result['b2b'],1); self.assertEqual(result['rest'],0); self.assertEqual(result['rotationUnknown'],1)

    def test_target_and_future_box_scores_cannot_change_features(self):
        cutoff = datetime(2024,1,20,22,tzinfo=timezone.utc)
        hist = [dict(tip=cutoff-timedelta(days=20-i),available=cutoff-timedelta(days=20-i,hours=-8),rates=dict(netEfficiency=1.),rotation={1:1.}) for i in range(10)]
        before=nba.team_features(hist,cutoff)
        bad=dict(tip=cutoff,available=cutoff+timedelta(hours=8),rates=dict(netEfficiency=float('nan')),rotation={99:1.})
        self.assertEqual(before,nba.team_features(hist+[bad],cutoff))

    def test_final_season_is_rejected_before_reading_its_inputs(self):
        self.assertEqual(nba.build_rows([dict(season=2025)],{}, {},{}),[])
        self.assertEqual(nba.evaluate([dict(season=2025)]), {name:[] for name,_ in nba.MODELS})

    def test_current_result_cannot_change_its_own_forecast_or_probability(self):
        start=datetime(2022,1,1,tzinfo=timezone.utc);rows=[]
        for i in range(600):
            tip=start+timedelta(days=i)
            rows.append(dict(gameId=str(i),season=tip.year,tip=tip,cutoff=tip-timedelta(hours=1),available=tip+timedelta(hours=8),homeId=1,awayId=2,homeField=1,actual=float(i%10),market=3.,**{k:float(i%3) for _,ctx in nba.MODELS for k in ctx}))
        before=nba.evaluate(rows)
        target=before['strength'][-1]['gameId']
        changed=[dict(r,actual=99999.) if r['gameId']==target else dict(r) for r in rows]
        after=nba.evaluate(changed)
        for name,_ in nba.MODELS:
            self.assertEqual(before[name][-1]['prediction'],after[name][-1]['prediction'])
            self.assertEqual(before[name][-1]['homeCoverProbability'],after[name][-1]['homeCoverProbability'])

    def test_pushes_and_missing_prices_are_not_invented_profit(self):
        base=dict(market=3.,prediction=5.,actual=3.,homeCoverProbability=.6)
        r=nba.metrics([base]);self.assertEqual(r['pushes'],1);self.assertIsNone(r['coverRate']);self.assertEqual(r['hypotheticalRoi110'],0.)
        r=nba.metrics([dict(base,market=None)]);self.assertEqual(r['selected'],0);self.assertIsNone(r['hypotheticalRoi110'])

    def test_report_keeps_unseen_seasons_unrun(self):
        r=json.loads((ROOT/'public/nba/research.json').read_text())
        self.assertFalse(r['holdoutEvaluated']); self.assertEqual(len(r['reports']),4)
        self.assertEqual({m['games'] for m in r['reports']},{1230})
        self.assertIn('illustrative only',r['limitations'][0])


if __name__=='__main__':unittest.main()
