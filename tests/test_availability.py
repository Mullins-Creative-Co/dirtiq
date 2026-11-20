from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from unittest import mock
from copy import deepcopy
from datetime import datetime,timedelta,timezone
import numpy as np
import pandas as pd
from dirtiq_model.availability.feed import normalize,athlete_id,iso
from dirtiq_model.availability.impact import games_from_boxes,baseline,redistribute,team_scenario,fit,VERSION
from dirtiq_model.availability.build import build_games,evaluate_history,refresh
from dirtiq_model.availability.projection import project
from dirtiq_model.availability.impact import TOTAL_VERSION

NOW=datetime(2026,11,18,15,tzinfo=timezone.utc)


def injury(pid='1',status='Out',date='2026-11-18T13:00:00Z'):
    return {'id':'news-not-player','status':status,'date':date,'shortComment':'Editorial text is not republished',
        'details':{'type':'Ankle'},'athlete':{'displayName':'Player '+pid,'team':{'id':'2','abbreviation':'BOS'},
        'position':{'abbreviation':'G'},'links':[{'rel':['playercard'],'href':'https://www.espn.com/nba/player/_/id/'+pid+'/name'}]}}


def payload(rows):
    return {'timestamp':iso(NOW),'injuries':[{'id':'2','displayName':'Boston','injuries':rows}]}


def player(pid,category='out',**kwargs):
    return dict(athleteId=pid,name='P'+pid,category=category,status=category,stale=False,publishedAt=iso(NOW),**kwargs)


def model():
    return {'coefficients':{'1':4.,'2':-4.,'3':0.,'4':0.,'5':0.,'6':0.},
            'appearances':{str(p):10 for p in range(1,7)},'minutes':{str(p):300 for p in range(1,7)}}


def base():
    return {'minutes':{str(p):40. for p in range(1,7)},'games':5,'through':iso(NOW-timedelta(days=1)),
            'lastPlayed':{str(p):iso(NOW-timedelta(days=1)) for p in range(1,7)}}


class AvailabilityTest(unittest.TestCase):
    def test_player_identity_is_not_news_id_and_latest_active_clears_out(self):
        r=injury();self.assertEqual(athlete_id(r['athlete']),'1')
        r['athlete']['links']=[];self.assertIsNone(athlete_id(r['athlete']))
        result=normalize('nba',payload([injury(),injury(status='Active',date='2026-11-18T14:00:00Z'),injury('2','Questionable')]),NOW)
        self.assertEqual([p['athleteId'] for p in result['teams'][0]['players']],['2'])
        self.assertEqual(result['teams'][0]['players'][0]['note'],'Ankle')

    def test_empty_stale_future_feeds_are_unavailable_not_healthy(self):
        for data in [payload([]),dict(payload([injury()]),timestamp=iso(NOW-timedelta(hours=7))),
                     dict(payload([injury()]),timestamp=iso(NOW+timedelta(seconds=1))),
                     payload([injury(date='2020-11-01T00:00:00Z')]),payload([injury(date=iso(NOW+timedelta(seconds=1)))])]:
            self.assertEqual(normalize('ncaab',data,NOW)['coverage'],'unavailable')

    def test_conflicting_team_identity_does_not_join_by_name(self):
        data=payload([injury()]);data['injuries'][0]['id']='3'
        self.assertEqual(normalize('nba',data,NOW)['coverage'],'unavailable')

    def test_conservation_replacements_and_too_few_players(self):
        new=redistribute(base()['minutes'],{'1'})
        self.assertAlmostEqual(sum(new.values()),240)
        self.assertEqual(new['1'],0)
        self.assertTrue(all(0<=v<=48 for v in new.values()))
        self.assertIsNone(redistribute(base()['minutes'],{'1','2'}))

    def test_new_absence_has_value_but_long_absence_is_not_charged_twice(self):
        r=team_scenario(base(),[player('1')],model())
        self.assertEqual(r['outMinutes'],40)
        self.assertLess(r['points']['listedOut'],0)
        b=base();b['minutes']={'1':0.,**{str(p):48. for p in range(2,7)}}
        r=team_scenario(b,[player('1')],model())
        self.assertEqual(r['outMinutes'],0)
        self.assertEqual(r['points']['listedOut'],0)

    def test_uncertainty_enumerates_mixed_statuses_not_just_everyone_out(self):
        b=base();b['minutes']={str(p):30. for p in range(1,9)}
        m=model();m['coefficients'].update({'7':0.,'8':0.});m['appearances'].update({'7':10,'8':10});m['minutes'].update({'7':300,'8':300})
        r=team_scenario(b,[player('1','uncertain'),player('2','uncertain')],m)
        self.assertEqual(r['points']['scenarios'],4)
        self.assertLess(r['points']['min'],r['points']['listedOut'])
        self.assertGreater(r['points']['max'],r['points']['listedOut'])
        self.assertNotIn('probability',r)

    def test_missing_model_stale_report_or_unknown_replacement_is_unvalued(self):
        self.assertIsNone(team_scenario(base(),[player('1')],None)['points'])
        stale=player('1');stale['stale']=True
        self.assertIsNone(team_scenario(base(),[stale],model())['points'])
        m=model();m['appearances']['1']=0
        self.assertIsNone(team_scenario(base(),[player('1')],m)['points'])
        old=player('1');old['publishedAt']=iso(NOW-timedelta(days=3))
        self.assertTrue(team_scenario(base(),[old],model())['players'][0]['contradictedByAppearance'])

    def test_only_next_game_gets_status_and_missing_team_is_unknown(self):
        report={'upcoming':[dict(gameId=str(i),home='BOS',away='NY' if i==1 else 'GS',
             startsAt=iso(NOW+timedelta(hours=i+1)),projectedHomeMargin=1) for i in (1,2)]}
        feeds={s:{'coverage':'unavailable','teams':[],'sourceUrl':'https://example.test','reason':'unavailable'} for s in ('nba','nfl','ncaaf','ncaab')}
        feeds['nba']=normalize('nba',payload([injury()]),NOW)
        out=build_games({'nba':report},feeds,[],None,NOW)
        self.assertEqual(out[0]['contexts']['home']['coverage'],'unknown') # no boxes means unknown
        self.assertEqual(len(out[0]['contexts']['home']['players']),1)
        self.assertEqual(len(out[1]['contexts']['home']['players']),0)
        self.assertEqual(out[1]['contexts']['home']['coverage'],'unknown')
        self.assertTrue(all(g['homeMarginChange'] is None and not g['appliedToForecast'] for g in out))

    def test_future_boxes_and_incomplete_identity_never_enter_training(self):
        rows=[]
        for gid,tip in [(1,NOW-timedelta(days=1)),(2,NOW+timedelta(days=1))]:
            for side,tid in [('home',1),('away',2)]:
                for p in range(6):
                    rows.append(dict(game_id=gid,game_date_time=tip,season=2027,season_type=2,team_id=tid,
                        athlete_id=tid*10+p,athlete_display_name='P',team_abbreviation='BOS',minutes=40,
                        home_away=side,team_score=100 if side=='home' else 90))
        frame=pd.DataFrame(rows)
        self.assertEqual([g['gameId'] for g in games_from_boxes(frame,NOW)],['1'])
        frame.loc[0,'athlete_id']=np.nan
        self.assertEqual(games_from_boxes(frame,NOW),[])
        self.assertIsNone(baseline([], '1',NOW))

    def test_fit_ignores_future_outcomes_and_requires_sample(self):
        with self.assertRaises(ValueError):fit([],NOW)
        games=[]
        for i in range(500):
            games.append({'gameId':str(i),'tip':NOW-timedelta(days=2+i/10),'availableAt':NOW-timedelta(days=1+i/10),
                'home':{'id':'1','score':100,'rotation':{str(p):48. for p in range(1,6)}},
                'away':{'id':'2','score':90,'rotation':{str(p):48. for p in range(6,11)}}})
        a=fit(games,NOW)
        future=deepcopy(games[0]);future['availableAt']=NOW+timedelta(days=1);future['home']['score']=9999
        b=fit(games+[future],NOW)
        self.assertEqual(a['coefficients'],b['coefficients'])
        self.assertEqual(a['totalCoefficients'],b['totalCoefficients'])

    def test_network_and_box_failure_replace_old_report_with_unknown_not_healthy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); output=root/'output'; output.mkdir()
            (output/'latest.json').write_text('{"oldHealthyReport":true}')
            with mock.patch('dirtiq_model.availability.build.ROOT',root), \
                 mock.patch('dirtiq_model.availability.build.fetch',side_effect=RuntimeError('offline')), \
                 mock.patch('dirtiq_model.availability.build.nba_data',side_effect=RuntimeError('no boxes')):
                result=refresh(root/'cache',output,NOW)
            self.assertEqual(len(result['failures']),5)
            self.assertTrue(all(f['coverage']=='unavailable' for f in result['feeds'].values()))
            self.assertIsNone(result['model'])
            self.assertEqual(result['games'],[])
            self.assertNotIn('oldHealthyReport',(output/'latest.json').read_text())

    def test_evaluation_cutoff_never_uses_post_start_or_future_model(self):
        row={'id':'nba:1','asOf':iso(NOW),'startsAt':iso(NOW+timedelta(hours=2)),
             'modelTrainedThrough':iso(NOW-timedelta(days=1)),'modelVersion':VERSION,'baselineForecastAt':iso(NOW-timedelta(hours=1)),
             'marketHomeMargin':2,'marketObservedAt':iso(NOW-timedelta(minutes=30)),
             'homeMarginChange':{'listedOut':-2},'baselineHomeMargin':3}
        late=dict(row,asOf=iso(NOW+timedelta(hours=2)))
        invalid=dict(row,modelTrainedThrough=iso(NOW+timedelta(days=1)))
        result=evaluate_history([row,late,invalid],{'nba:1':1})
        self.assertEqual(result['games'],1)
        self.assertEqual(result['baselineMae'],2)
        self.assertEqual(result['listedOutScenarioMae'],0)
        self.assertFalse(result['promoted'])
        self.assertEqual(result['pricedGames'],1)
        self.assertEqual(result['marketMae'],1)
        self.assertEqual(result['listedOutScenarioMaeOnPricedGames'],0)
        self.assertEqual(evaluate_history([dict(row,marketObservedAt=iso(NOW-timedelta(hours=4)))],{'nba:1':1})['pricedGames'],0)
        self.assertEqual(evaluate_history([dict(row,baselineForecastAt=iso(NOW+timedelta(hours=1)))],{'nba:1':1})['games'],0)


class InjuryProjectionTests(unittest.TestCase):
    def row(self):
        return dict(id='nba:1',sport='nba',gameId='1',home='BOS',away='NY',
                    startsAt=iso(NOW+timedelta(hours=2)),asOf=iso(NOW),
                    baselineForecastAt=iso(NOW-timedelta(minutes=30)),baselineHomeMargin=3.,baselineTotal=220.,
                    homeMarginChange=dict(min=-3.,max=0.,listedOut=-2.),
                    totalChange=dict(min=-5.,max=2.,listedOut=-4.),
                    contexts=dict(home=dict(team='BOS',coverage='scenario'),away=dict(team='NY',coverage='scenario')))

    def metadata(self):
        return dict(version=VERSION,totalVersion=TOTAL_VERSION,trainedThrough=iso(NOW-timedelta(days=1)))

    def test_adjusts_real_numbers_without_mutating_the_baseline(self):
        row=self.row();before=deepcopy(row)
        p=project(row,self.metadata(),NOW)
        self.assertEqual(p['homeMargin'],1.)
        self.assertEqual(p['homeSpread'],-1.)
        self.assertEqual(p['total'],216.)
        self.assertEqual(p['homeMarginRange'],[0.,3.])
        self.assertEqual(p['totalRange'],[215.,222.])
        self.assertEqual(row,before)

    def test_unknown_stale_started_identity_and_future_evidence_withhold(self):
        rows=[dict(self.row(),sport='nfl'),dict(self.row(),asOf=iso(NOW-timedelta(hours=4))),
              dict(self.row(),asOf=iso(NOW+timedelta(seconds=1))),dict(self.row(),startsAt=iso(NOW)),
              dict(self.row(),id='nba:other'),dict(self.row(),baselineForecastAt=iso(NOW+timedelta(seconds=1))),
              dict(self.row(),baselineForecastAt=iso(NOW-timedelta(hours=4)))]
        partial=self.row();partial['contexts']['away']['coverage']='partial';rows.append(partial)
        for row in rows:
            p=project(row,self.metadata(),NOW)
            self.assertEqual(p['status'],'unavailable');self.assertIsNone(p['homeMargin']);self.assertIsNone(p['total'])
        self.assertEqual(project(self.row(),dict(self.metadata(),trainedThrough=iso(NOW)),NOW)['status'],'unavailable')

    def test_totals_require_a_separate_total_model_and_finite_changes(self):
        p=project(self.row(),dict(self.metadata(),totalVersion='unsupported'),NOW)
        self.assertEqual(p['homeMargin'],1.);self.assertIsNone(p['total'])
        row=self.row();row['homeMarginChange']['listedOut']=float('nan')
        self.assertIsNone(project(row,self.metadata(),NOW)['homeMargin'])
        row=self.row();row['totalChange']['listedOut']=100.
        self.assertIsNone(project(row,self.metadata(),NOW)['total'])

    def test_margin_and_total_player_effects_are_independent(self):
        m=model();m['totalCoefficients']={str(p):0. for p in range(1,7)};m['totalCoefficients']['1']=-4.
        scenario=team_scenario(base(),[player('1')],m)
        self.assertLess(scenario['points']['listedOut'],0.)
        self.assertGreater(scenario['totalPoints']['listedOut'],0.)
        b=base();b['minutes']={'1':0.,**{str(p):48. for p in range(2,7)}}
        self.assertEqual(team_scenario(b,[player('1')],m)['totalPoints']['listedOut'],0.)

    def test_total_evaluation_is_versioned_and_uses_actual_totals(self):
        row=dict(self.row(),modelVersion=VERSION,totalModelVersion=TOTAL_VERSION,
                 modelTrainedThrough=self.metadata()['trainedThrough'])
        result=evaluate_history([row],{'nba:1':216.},total=True)
        self.assertEqual(result['games'],1);self.assertEqual(result['baselineMae'],4.)
        self.assertEqual(result['listedOutScenarioMae'],0.)
        self.assertEqual(evaluate_history([dict(row,totalModelVersion='other')],{'nba:1':216.},total=True)['games'],0)
