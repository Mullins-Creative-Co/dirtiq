from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/football'))
import pricing_error as p
import decomposition as d


class PricingTests(unittest.TestCase):
    def history(self):
        history=json.loads((ROOT/'public/football/history.json').read_text())['games']
        return [dict(r,components=[r['qb_epa_diff'],r['off_epa_diff'],r['rush_matchup'],-r['def_epa_allowed_diff'],r['rest_diff'],r['home_field']],home=dict(qbPercentile=.5,supportPercentile=.9),away=dict(qbPercentile=.5,supportPercentile=.1)) for r in history]

    def test_market_baseline_is_exact_and_does_not_invent_bets(self):
        values=p.evaluate(self.history())
        self.assertEqual(len(values['market']),705)
        for r in values['market']:self.assertEqual(r['prediction'],r['market'])
        summary=p.summarize(values['market'],'market')
        self.assertEqual(summary['bets'],0);self.assertIsNone(summary['roi'])

    def test_final_half_is_excluded_before_features_or_calibration(self):
        rows=self.history();first=p.evaluate(rows)
        changed=[dict(r,components=None,home_margin=999999) if not p.development(r) else r for r in rows]
        self.assertEqual(first,p.evaluate(changed))

    def test_future_outcomes_cannot_change_first_predictions_or_probabilities(self):
        rows=self.history();first=p.evaluate(rows)
        changed=[dict(r,home_margin=-999999) if r['season']>=2023 else r for r in rows]
        second=p.evaluate(changed)
        for key in first:
            for a,b in zip(first[key][:3],second[key][:3]):
                self.assertEqual(a['prediction'],b['prediction'])
                self.assertEqual(a['homeCoverProbability'],b['homeCoverProbability'])

    def test_late_starter_news_is_not_backdated_and_latest_timely_record_wins(self):
        game=dict(game_id='game',season=2024,week=1,home_team='A',away_team='B',feature_asof='2024-09-04T18:00:00Z')
        row=dict(gameId='game',team='A',qbId='old',source='https://example.com/news',publishedAt='2024-09-03T12:00:00Z',observedAt='2024-09-03T13:00:00Z')
        late=dict(row,qbId='new',publishedAt='2024-09-05T12:00:00Z',observedAt='2024-09-05T13:00:00Z')
        expected,complete,coverage=p.starter_manifest([row,late],[game])
        self.assertEqual(expected,{'game':{'A':'old'}});self.assertEqual(complete,set());self.assertEqual(coverage['lateRecords'],1)
        both=[row,dict(row,team='B',qbId='away')]
        self.assertEqual(p.starter_manifest(both,[game])[1],{'game'})

    def test_source_and_observation_sequence_are_required(self):
        game=dict(game_id='game',season=2024,week=1,home_team='A',away_team='B',feature_asof='2024-09-04T18:00:00Z')
        row=dict(gameId='game',team='A',qbId='id',source='https://example.com/news',publishedAt='2024-09-03T12:00:00Z',observedAt='2024-09-03T11:00:00Z')
        with self.assertRaises(ValueError):p.starter_manifest([row],[game])
        with self.assertRaises(ValueError):p.starter_manifest([dict(row,source='')],[game])

    def test_announced_qb_override_uses_only_earlier_player_data(self):
        cutoff=datetime(2024,9,4,tzinfo=timezone.utc);obs=[]
        for team,other,qb in [('A','B','old'),('B','A','other')]:
            for kind in ['pass','rush']:
                obs.append(dict(posteam=team,defteam=other,qb=qb,name=qb,kind=kind,game_id='past',available=cutoff-timedelta(days=7),total=2.,plays=20))
        result=d.snapshot(obs,cutoff,400.,{'A':'new'})
        self.assertEqual(result['A']['qbId'],'new');self.assertEqual(result['A']['qb'],0.);self.assertEqual(result['A']['qbDropbacks'],0)
        future=dict(obs[0],qb='new',total=99999.,available=cutoff+timedelta(days=1))
        self.assertEqual(result,d.snapshot(obs+[future],cutoff,400.,{'A':'new'}))

    def test_report_has_three_comparators_and_empty_confirmed_test(self):
        report=json.loads((ROOT/'public/football/pricing-error.json').read_text())
        self.assertEqual([r['id'] for r in report['reports']],['market','independent','correction'])
        self.assertEqual(report['starterCoverage']['completeGames'],0)
        self.assertFalse(report['holdoutEvaluated'])
        self.assertEqual({r['confirmed']['games'] for r in report['reports']},{0})


if __name__=='__main__':unittest.main()
