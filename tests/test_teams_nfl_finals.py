from __future__ import annotations
import unittest
import pandas as pd
from dirtiq_model.teams.forecast import late_finals, supplement_finals
from dirtiq_model.teams.model import config_for

NOW = pd.Timestamp('2026-11-15T22:00:00Z')
START = pd.Timestamp('2026-11-15T18:00:00Z')

def event(eid='401873057', home='TEN', away='JAX', start='2026-11-15T18:00:00Z', name='STATUS_FINAL', done=True, score=(23,40)):
    return {'id':eid,'date':start,'status':{'type':{'name':name,'completed':done}},
            'competitions':[{'date':start,'competitors':[
                {'homeAway':'home','team':{'abbreviation':home},'score':str(score[0])},
                {'homeAway':'away','team':{'abbreviation':away},'score':str(score[1])}]}]}

def games():
    return pd.DataFrame([{'game_id':'2026_10_JAX_TEN','home':'TEN','away':'JAX','start':START,
                         'neutral':0,'completed':False,'home_score':float('nan'),'away_score':float('nan'),'spread_line':10.5}])

class NflFinalsTest(unittest.TestCase):
    def test_match_preserves_nflverse_id_and_locked_market(self):
        original=games()
        fetch=lambda url:{'events':[event()]}
        rows=late_finals(config_for('nfl'),original,now=NOW,fetch=fetch)
        self.assertEqual(rows[0]['eventId'],'nfl:2026_10_JAX_TEN')
        self.assertEqual((rows[0]['homeScore'],rows[0]['awayScore']),(23,40))
        enriched=supplement_finals(config_for('nfl'),original,now=NOW,fetch=fetch)
        self.assertTrue(enriched.iloc[0].completed)
        self.assertFalse(original.iloc[0].completed)
        self.assertEqual(enriched.iloc[0].spread_line,10.5)
        self.assertIn('football/nfl/scoreboard',enriched.attrs['sources'][0]['url'])

    def test_live_postponed_wrong_time_or_side_and_ambiguous_are_not_finals(self):
        cases=[ [event(name='STATUS_IN_PROGRESS',done=False)], [event(name='STATUS_POSTPONED',done=False)],
                [event(start='2026-11-15T21:00:00Z')], [event(home='JAX',away='TEN')],
                [event(),event(eid='999')], [event(score=(-1,40))] ]
        for events in cases:
            with self.subTest(events=events):
                self.assertEqual(late_finals(config_for('nfl'),games(),now=NOW,fetch=lambda u:{'events':events}),[])

    def test_aliases_and_zero_zero_final_tie(self):
        frame=games();frame.loc[0,['home','away']]=['LA','WAS']
        rows=late_finals(config_for('nfl'),frame,now=NOW,fetch=lambda u:{'events':[event(home='LAR',away='WSH',score=(0,0))]})
        self.assertEqual((rows[0]['home'],rows[0]['away'],rows[0]['homeScore']),('LA','WAS',0))

    def test_existing_final_and_outage_leave_data_intact(self):
        frame=games();frame.loc[0,['completed','home_score','away_score']]=[True,24,30]
        self.assertIs(supplement_finals(config_for('nfl'),frame,now=NOW,fetch=lambda u:self.fail('unexpected fetch')),frame)
        def fail(url):raise RuntimeError('offline')
        pending=games()
        pd.testing.assert_frame_equal(supplement_finals(config_for('nfl'),pending,now=NOW,fetch=fail),pending)
        self.assertEqual(late_finals(config_for('nfl'),games(),now=NOW,fetch=fail),[])

if __name__=='__main__':unittest.main()
