from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts/football'))
import college_turnovers as model


class CollegeTests(unittest.TestCase):
    def test_exact_rule_boundaries_and_negative_ypp_advantage(self):
        self.assertTrue(model.trigger(21, 3, 1.))
        self.assertTrue(model.trigger(35, 4, -2.))
        self.assertFalse(model.trigger(20, 3, 1.))
        self.assertFalse(model.trigger(21, 2, 1.))
        self.assertFalse(model.trigger(21, 3, 1.0001))

    def test_box_ypp_and_turnovers_require_consistent_inputs(self):
        row = dict(completionAttempts='15/30', rushingAttempts='30', totalYards='300', rushingYards='100', netPassingYards='200', turnovers='1', fumblesLost='1', interceptions='0')
        self.assertEqual(model.box_stats(row)['ypp'], 5.)
        self.assertIsNone(model.box_stats(dict(row, turnovers='2')))
        self.assertIsNone(model.box_stats(dict(row, totalYards='301')))
        self.assertIsNone(model.box_stats(dict(row, completionAttempts=None)))

    def game(self, gid, day, season=2024):
        return dict(game_id=gid, season=season, week=day, _time=pd.Timestamp(datetime(season, 9, 1, tzinfo=timezone.utc)+timedelta(days=day)), start_date=f'{season}-09-{day+1:02d}T00:00:00Z', home_id=1, away_id=2, home_team='A', away_team='B', neutral_site=False, fbs_game=True, completed=True, home_points=28., away_points=0.)

    def test_missing_immediate_prior_does_not_reuse_older_qualifier(self):
        games = [self.game(1, 0), self.game(2, 7), self.game(3, 14)]
        boxes = {(1, 1):dict(ypp=5., turnovers=0), (1, 2):dict(ypp=5., turnovers=3)}
        rows, _, _ = model.feature_rows(games, boxes, {}, datetime(2026, 11, 6, tzinfo=timezone.utc))
        self.assertTrue(rows[1]['homeFlag'])
        self.assertFalse(rows[2]['homeFlag'])
        self.assertFalse(rows[2]['priorStatsKnown'])
        self.assertEqual(rows[2]['homePrevious']['gameId'], '2')

    def test_no_cross_season_flags_or_2025_holdout_reads(self):
        games = [self.game(1, 0), dict(season=2025, _time='invalid'), self.game(2, 0, season=2026)]
        boxes = {(1, 1):dict(ypp=5., turnovers=0), (1, 2):dict(ypp=5., turnovers=3)}
        rows, _, _ = model.feature_rows(games, boxes, {}, datetime(2026, 11, 6, tzinfo=timezone.utc))
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]['homeFlag'])

    def test_fade_direction_pushes_and_unknown_or_dual_flags(self):
        base = dict(priorStatsKnown=True, homeFlag=True, awayFlag=False, market=7., actual=3., homeTeam='A', awayTeam='B', model=4.)
        self.assertEqual(model.bets([base])[0]['coverMargin'], 4.)
        self.assertEqual(model.bets([dict(base, homeFlag=False, awayFlag=True)])[0]['coverMargin'], -4.)
        self.assertEqual(model.bets([dict(base, actual=7.)])[0]['coverMargin'], 0.)
        self.assertEqual(model.bets([dict(base, awayFlag=True)]), [])
        self.assertEqual(model.bets([dict(base, priorStatsKnown=False)]), [])

    def test_future_outcomes_cannot_change_first_predictions(self):
        rows = []
        start = datetime(2022, 1, 1, tzinfo=timezone.utc)
        for i in range(140):
            t = start+timedelta(days=3*i)
            rows.append(dict(_time=t, season=t.year, homeId=1, awayId=2, neutral=False, homeFlag=i%7 == 0, awayFlag=False, actual=float(i%20-3)))
        before = model.predict([dict(r) for r in rows])
        self.assertGreater(len(before), 0)
        changed = [dict(r, actual=99999. if r['season'] >= 2023 else r['actual']) for r in rows]
        after = model.predict(changed)
        for a, b in zip(before[:2], after[:2]):
            self.assertEqual(a['baseline'], b['baseline'])
            self.assertEqual(a['model'], b['model'])

    def test_real_report_is_development_only_and_does_not_invent_prices(self):
        report = json.loads((ROOT/'public/football/college-turnovers.json').read_text())
        self.assertFalse(report['holdoutEvaluated'])
        self.assertEqual(report['evaluatedSeasons'], [2023, 2024])
        self.assertIn('no quote timestamps', report['limitations'][0])
        self.assertEqual(report['thresholds'], dict(winMargin=21, turnoverMargin=3, maxYppAdvantage=1))


if __name__ == '__main__': unittest.main()
