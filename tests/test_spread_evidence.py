from __future__ import annotations
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
from dirtiq_model.teams.evidence import (wilson_lower, staking_gate, clv_summary, spread_clv,
    ledger_spread_rows, backtest_evidence, empirical_cover, backtest_clv)
from dirtiq_model.card.build import attach_clv, build_card
from dirtiq_model.teams.adapters.espn_odds import consolidate
from dirtiq_model.teams.forecast import ledger_rows
from dirtiq_model.teams.model import config_for


class EvidenceTest(unittest.TestCase):
    def test_gate_requires_both_conditions_and_fails_closed(self):
        good = {'selections': {'wins': 650, 'losses': 350}}
        live = clv_summary([0.5]*100)
        self.assertGreater(wilson_lower(650,350), .524)
        self.assertTrue(staking_gate(good,live)['passed'])
        for evidence, quotes in [({},live),(good,clv_summary([1]*99)),(good,clv_summary([0]*100)),
                                 (good,clv_summary([-1]*100)),({'selections':{'wins':52,'losses':48}},live)]:
            self.assertFalse(staking_gate(evidence,quotes)['passed'])

    def test_buckets_pushes_missing_and_headline(self):
        p = pd.DataFrame({'ind_mean':[0,0,0,0,0], 'stk_mean':[3,6,-6,12,0],
                          'spread_line':[0,0,0,0,None], 'margin':[1,-1,0,1,1]})
        e = backtest_evidence(p,3,'stacked')
        self.assertEqual(e['selections']['games'],3) # 4x excluded
        self.assertEqual(e['selections']['coverRate'],.5)
        b = empirical_cover(e,6,3)
        self.assertEqual((b['minRatio'],b['sample'],b['pushes']), (2,1,1))
        self.assertEqual(empirical_cover(e,12,3)['minRatio'],4)
        self.assertIsNone(empirical_cover(e,None,3))
        self.assertIsNone(empirical_cover({},3,3))

    def test_open_selection_not_close_selection_and_sign(self):
        p = pd.DataFrame({'ind_mean':[5,0,1], 'open_spread_line':[-2,4,None], 'spread_line':[-7,6,-4]})
        # First leans home at open, away at close: sign must come from OPEN.
        c = backtest_clv(p,3,'ind')
        self.assertEqual(c['count'],2)
        self.assertEqual(c['meanPts'],1.5) # +5 and -2
        self.assertEqual(spread_clv(3,2),1)
        self.assertEqual(spread_clv(-3,-5),2)
        self.assertIsNone(spread_clv(3,None))

    def test_live_one_side_dedup_future_invalid_missing(self):
        def row(eid='x',side='home',lean='home',line=-3,close=-5,start='2026-11-16T20:00:00Z',**kw):
            return dict(event_id=eid,sport='nfl',market='spread',event_start=start,line=line,close_line=close,value=8,
                        meta=json.dumps(dict(side=side,lean=lean)),forecast_at="2026-11-16T10:00:00Z",**kw)
        rows=[row(),row(),row(side='away',line=3,close=5),row('future',start='2026-11-18T00:00:00Z'),
              row('invalid',lean=float('nan')),row('missing',close=None),row('stale',line=-7,close=-8)]
        out=ledger_spread_rows(rows,datetime(2026,11,17,tzinfo=timezone.utc))
        self.assertEqual(list(out),['x'])
        self.assertEqual(out['x']['clvPts'],2)
        pick=dict(id='x',pick='H',line=-2,startsAt='2026-11-16T20:00:00Z')
        rows[0]['selection']='H'
        self.assertTrue(attach_clv(pick,rows,datetime(2026,11,17,tzinfo=timezone.utc)))
        self.assertEqual(pick['clv']['points'],3)
        self.assertFalse(attach_clv(pick,rows,datetime(2026,11,17,tzinfo=timezone.utc)))

    def test_conflicting_sources_withheld_not_flipped(self):
        a=dict(provider='Westgate',spread=-10.5,home_ml=-600,away_ml=425,total=150)
        b=dict(provider='Caesars',spread=10.5,home_ml=425,away_ml=-550,total=150)
        c=consolidate([a,b])
        self.assertTrue(c['conflictingSides'])
        self.assertIsNone(c['spread_line'])
        self.assertIsNone(c['home_ml'])
        self.assertEqual(c['total_line'],150)
        self.assertEqual(consolidate([a])['spread_line'],-10.5)

    def test_price_placeholder_rejected_in_raw_and_cached_books_before_median(self):
        from dirtiq_model.teams.adapters.espn_odds import compact_event
        raw=json.loads((Path(__file__).parent/'fixtures/espn-malformed-handicap.json').read_text())
        books=compact_event(raw)
        self.assertTrue(all(b.get('spread') is None for b in books))
        self.assertIsNone(consolidate(books)['spread_line'])
        # An old cache carries only the erroneous -110 value. Do not median it with -49.5.
        old=[dict(provider='ESPN BET',spread=-110,home_spread_price=-110,away_spread_price=-110),
             dict(provider='Unibet',spread=-49.5,home_spread_price=-114,away_spread_price=-110)]
        self.assertEqual(consolidate(old)['spread_line'],-49.5)
        self.assertEqual(consolidate(old)['spread_home_price'],-114)

    def test_build_stakes_only_passing_sport_and_preserves_past_card(self):
        from test_card import game, report, NOW
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); sports=root/'sports'; archive=root/'cards'
            sports.mkdir(); archive.mkdir()
            r=report('nfl',[game('1',8,-3.5)])
            r['backtest']['spreadEvidence']={'selections':{'wins':650,'losses':350}}
            (sports/'nfl.json').write_text(json.dumps(r))
            rows=[dict(sport='nfl',event_id='old:'+str(i),market='spread',event_start='2026-11-11T00:00:00Z',
                       line=3,close_line=2,value=-2,forecast_at='2026-11-10T20:00:00Z',meta={'side':'away','lean':'away'}) for i in range(100)]
            card=build_card(NOW,sports,archive,{},rows)
            self.assertEqual(card['totalUnits'],.5)
            # The live condition fails: current unstarted stake drops to zero, line stays locked.
            card=build_card(NOW,sports,archive,{},[])
            self.assertEqual(card['totalUnits'],0)
            self.assertEqual(card['picks'][0]['line'],-3.5)
            # Pre-existing past stakes and results are immutable under the normal build.
            past={'date':'2026-11-10','picks':[dict(id='past',sport='nfl',pick='H',line=-3.5,price=-110,
                  stakeUnits=.5,startsAt='2026-11-10T20:00:00Z',result={'outcome':'win','units':.455})]}
            path=archive/'2026-11-10.json'; path.write_text(json.dumps(past))
            before=path.read_bytes()
            build_card(NOW,sports,archive,{},rows)
            self.assertEqual(path.read_bytes(),before)

    def test_stacked_no_lean_clears_filter_pick_but_missing_prediction_falls_back(self):
        from dirtiq_model.teams.forecast import promote_variant, VARIANT_KEYS
        rows={}
        for key in VARIANT_KEYS:
            rows['ind_'+key]=['away','away'] if key=='pick' else [10.0,10.0]
            rows['stk_'+key]=[None,None] if key=='pick' else [1.0,float('nan')]
        scored=promote_variant(pd.DataFrame(rows),'stk')
        self.assertTrue(pd.isna(scored.loc[0,'ind_pick']))
        self.assertEqual(scored.loc[1,'ind_pick'],'away')

    def test_nan_lean_normalized_when_recording_all_games(self):
        row=pd.Series(dict(game_id='g',home='H',away='A',start=pd.Timestamp('2026-11-18',tz='UTC'),
            ind_mean=1,ind_sd=12,spread_line=-2,spread_home_price=-110,spread_away_price=-110,
            ind_home_cover=.5,ind_away_cover=.5,ind_push=0,ind_pick=float('nan'),ind_edge=-1))
        forecasts=ledger_rows(config_for('ncaab'),row,'book',None,'2026-11-17T00:00:00Z')
        self.assertEqual(len(forecasts),2)
        self.assertTrue(all(f.meta['lean']=='none' for f in forecasts))
