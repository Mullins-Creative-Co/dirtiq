from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pandas as pd
from dirtiq_model.nba_lab.model import lagged_features,fit,probabilities
from dirtiq_model.nba_lab.data import prepare,COUNTS
from dirtiq_model.nba_lab.evaluate import selections


def games(starts):
    rows=[]
    for i,start in enumerate(starts):
        tip=pd.Timestamp(start)
        rows.append(dict(game_id=str(i),season=2024,start=tip,available_at=tip+pd.Timedelta(hours=8),home='BOS',away='NY',neutral=0,
                         home_score=120.,away_score=100.,home_eff=120.,away_eff=100.,pace=100.,completed=True))
    return pd.DataFrame(rows)


class NbaLagTests(unittest.TestCase):
    def test_eight_hour_availability_and_same_day_cutoffs(self):
        g=games(['2024-01-01T23:00Z','2024-01-02T05:00Z','2024-01-02T08:00Z'])
        a=lagged_features(g);g.loc[0,['home_score','home_eff']]=[200.,200.]
        b=lagged_features(g)
        np.testing.assert_array_equal(a.iloc[:2].eff_margin,b.iloc[:2].eff_margin)
        self.assertNotEqual(a.iloc[2].eff_margin,b.iloc[2].eff_margin)
        g=games(['2024-01-01T06:00Z','2024-01-01T23:00Z'])
        a=lagged_features(g);g.loc[0,'home_eff']=300.
        np.testing.assert_array_equal(a.eff_margin,lagged_features(g).eff_margin)

    def test_target_and_future_results_never_change_target_features(self):
        g=games(['2024-01-01T23:00Z','2024-01-03T23:00Z','2024-01-05T23:00Z'])
        a=lagged_features(g);g.loc[1:,'home_eff']=999.
        b=lagged_features(g)
        np.testing.assert_array_equal(a.iloc[:2].eff_margin,b.iloc[:2].eff_margin)

    def test_missing_year_carry_is_per_elapsed_season(self):
        g=games(['2016-01-01T23:00Z','2018-01-03T23:00Z'])
        g['season']=[2016,2018];gap=lagged_features(g).iloc[1].eff_margin
        g['season']=[2016,2017];single=lagged_features(g).iloc[1].eff_margin
        self.assertAlmostEqual(gap,single/2)

    def test_rest_uses_eastern_calendar(self):
        g=games(['2024-01-01T23:30Z','2024-01-03T00:30Z'])
        f=lagged_features(g)
        self.assertEqual(f.iloc[1].rest_sum,2.)
        self.assertEqual(f.iloc[1].home_b2b,1.)


class NbaFitTests(unittest.TestCase):
    def frame(self,n,season):
        rng=np.random.default_rng(9)
        f=pd.DataFrame({k:rng.normal(size=n) for k in ['off_diff','def_diff','pace_gap','rest_diff','rest_sum','home_b2b','away_b2b','neutral','min_games']})
        f['eff_margin']=rng.normal(size=n);f['eff_total']=220+rng.normal(size=n)
        f['spread_line']=-3.5;f['total_line']=220.;f['ind_mean']=4.;f['market_line']=3.5
        f['actual']=4.+f.eff_margin;f['season']=season
        f['start']=pd.date_range('%s-01-01'%season,periods=n,freq='h',tz='UTC')
        return f

    def test_calibration_and_test_outcomes_cannot_fit_coefficients(self):
        tr=self.frame(600,2023);cal=self.frame(200,2024);te=self.frame(50,2025)
        a=fit(tr,cal,'spread');cal['actual']+=50;b=fit(tr,cal,'spread')
        np.testing.assert_array_equal(a.coefficients,b.coefficients)
        np.testing.assert_allclose(a.residuals+50,b.residuals)
        pred=a.predict(te);te['actual']=999.
        np.testing.assert_array_equal(pred,a.predict(te))
        cal['season']=2023
        with self.assertRaises(ValueError):fit(tr,cal,'spread')

    def test_integer_and_half_point_distributions_conserve_probability(self):
        high,low,push=probabilities(np.array([10.,10.]),np.array([10.,10.5]),np.array([-1.,0.,1.,2.]))
        np.testing.assert_allclose(high,[.5,.5]);np.testing.assert_allclose(low,[.25,.5]);np.testing.assert_allclose(push,[.25,0.])
        np.testing.assert_allclose(high+low+push,1.)

    def test_paper_profit_counts_push_in_stake_denominator(self):
        f=pd.DataFrame(dict(select=[True]*3,has_price=[True]*3,won=[True,False,False],push=[False,False,True],price=[150,-110,-110]))
        r=selections(f,True);self.assertAlmostEqual(r['units'],.5);self.assertAlmostEqual(r['roi'],.5/3)
        self.assertIn('paper',r['priceBasis'])


class NbaAuditTests(unittest.TestCase):
    def test_missing_team_turnovers_and_impossible_lines_are_not_substituted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);frames={}
            for year in range(2016,2028):
                tip=pd.Timestamp('%s-11-01T00:00Z'%(year-1));gid=str(year)
                s=pd.DataFrame([dict(id=year,date=tip,status_type_name='STATUS_FINAL',status_type_completed=True,season_type=2,
                    season=year,status_period=4,home_abbreviation='BOS',away_abbreviation='NY',home_score=100,away_score=90,neutral_site=False)])
                b=[]
                for side,team,tid,oid,score,fg in [('home','BOS',1,2,100,40),('away','NY',2,1,90,35)]:
                    row=dict(game_id=year,game_date_time=tip,team_abbreviation=team,team_home_away=side,team_id=tid,opponent_team_id=oid,team_score=score,
                        field_goals_made=fg,field_goals_attempted=80,three_point_field_goals_made=10,three_point_field_goals_attempted=20,
                        free_throws_made=10,free_throws_attempted=15,offensive_rebounds=10,total_turnovers=12,turnovers=10)
                    if year==2018:row['total_turnovers']=np.nan
                    b.append(row)
                for name,data in [('nba_schedule_%s.parquet'%year,s),('team_box_%s.parquet'%year,pd.DataFrame(b))]:
                    (root/name).touch();frames[name]=data
            csv=root/'pred.csv';pd.DataFrame([dict(game_id='2019',start='2018-11-01T00:00Z',home='BOS',away='NY',season=2019,home_score=100,away_score=90,spread_line=-110,total_line=999)]).to_csv(csv,index=False)
            with patch('dirtiq_model.nba_lab.data.pd.read_parquet',side_effect=lambda p:frames[p.name].copy()):
                games,joined,audit=prepare(root,root,csv,pd.Timestamp('2026-11-20T05:00Z'))
            self.assertNotIn(2018,games.season.to_list());self.assertEqual(audit['invalidStatRows'],2)
            self.assertTrue(pd.isna(joined.iloc[0].spread_line));self.assertTrue(pd.isna(joined.iloc[0].total_line))
