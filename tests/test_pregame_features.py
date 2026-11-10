import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/football'))
import unittest
from datetime import datetime, timezone, timedelta
import pandas as pd
from pregame_features import build_features
class FeaturesTest(unittest.TestCase):
    def fixture(self):
        now=datetime(2026,11,10,13,tzinfo=timezone.utc); rows=[]; team=[]; defense=[]
        for i in range(3):
            day=(now-timedelta(days=7*(3-i))).date().isoformat()
            rows.append(dict(game_id=f'g{i}',home_team='H',away_team='A',home_score=10,away_score=7,gameday=day,gametime='13:00',location='Home',espn=i))
            for t in ['H','A']:
                team.append(dict(game_id=f'g{i}',posteam=t,epa_sum=10 if t=='H' else -10,plays=50));defense.append(dict(game_id=f'g{i}',defteam=t,epa_sum=-10 if t=='H' else 10,plays=50))
        rows.append(dict(game_id='next',home_team='H',away_team='A',home_score=float('nan'),away_score=float('nan'),gameday='2026-11-12',gametime='13:00',location='Home',espn=99))
        return pd.DataFrame(rows),team,defense,now
    def test_ignore_target_outcome(self):
        s,t,d,n=self.fixture();g,b=build_features(s,t,d,n);self.assertEqual(len(g),1);self.assertEqual(b,[]);self.assertGreater(g[0]['off_epa_diff'],0)
        s.loc[3,['home_score','away_score']]=[999,0];self.assertEqual(build_features(s,t,d,n)[0],g)
    def test_missing_latest_pbp_blocks(self):
        s,t,d,n=self.fixture();g,b=build_features(s,t[:-1],d,n);self.assertEqual(g,[]);self.assertTrue(b)
    def test_started_game_not_forecast(self):
        s,t,d,n=self.fixture();g,b=build_features(s,t,d,n+timedelta(days=4));self.assertEqual(g,[])
if __name__=='__main__':unittest.main()
