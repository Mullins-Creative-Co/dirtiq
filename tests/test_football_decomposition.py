import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts/football'))
import decomposition as model


class DecompositionTests(unittest.TestCase):
    def test_switches_allow_qb_effect_to_follow_player_instead_of_team(self):
        rows = []
        for team, support in [('A', .06), ('B', -.06)]:
            for opponent in ['A', 'B']:
                for qb, effect in [('good', .2), ('weak', -.2)]:
                    rows.append(dict(posteam=team, defteam=opponent, qb=qb, total=(support+effect)*10000, plays=10000, weight=1.))
        fitted = model.joint_fit(rows, penalty=1.)
        self.assertGreater(fitted['qb']['good']-fitted['qb']['weak'], .39)
        self.assertAlmostEqual(fitted['off']['A']-fitted['off']['B'], .12, delta=.003)

    def test_no_switches_are_prior_sensitive_rather_than_causally_identified(self):
        rows = [dict(posteam=t, defteam=o, qb=q, total=value*1000, plays=1000, weight=1.) for t, q, value in [('A', 'q1', .3), ('B', 'q2', -.3)] for o in ['A', 'B']]
        low, high = model.joint_fit(rows, 100.), model.joint_fit(rows, 1600.)
        self.assertGreater(low['qb']['q1'], high['qb']['q1'])
        self.assertLess(low['off']['A'], high['off']['A'])

    def test_snapshot_excludes_target_and_future_observations(self):
        cutoff = datetime(2024, 9, 4, tzinfo=timezone.utc)
        past = []
        for t, o, q in [('A', 'B', 'q1'), ('B', 'A', 'q2')]:
            for kind in ['pass', 'rush', 'st']:
                past.append(dict(posteam=t, defteam=o, qb=q, name=q, kind=kind, game_id='past', available=cutoff-timedelta(days=7), total=1., plays=20))
        first = model.snapshot(past, cutoff, 400.)
        future = [dict(r, available=cutoff, total=float('nan'), game_id='target') for r in past]
        future += [dict(r, available=cutoff+timedelta(days=1), total=float('nan'), game_id='future') for r in past]
        self.assertEqual(first, model.snapshot(past+future, cutoff, 400.))
        self.assertEqual(first['A']['priorGame'], 'past')

    def test_outer_predictions_do_not_use_future_outcomes_or_market_inputs(self):
        history = json.loads((ROOT/'public/football/history.json').read_text())['games']
        rows = [dict(r, components=[r['qb_epa_diff'], r['off_epa_diff'], r['rush_matchup'], -r['def_epa_allowed_diff'], r['rest_diff'], r['home_field']], home={}, away={}) for r in history if model.development(r)]
        first = model.evaluate(rows)
        changed = [dict(r, market_home_margin=999999., home_margin=-999999 if r['season'] >= 2023 else r['home_margin']) for r in rows]
        second = model.evaluate(changed)
        for a, b in zip(first[:3], second[:3]):
            self.assertEqual(a['split'], b['split'])
            self.assertEqual(a['baseline'], b['baseline'])

    def test_group_selection_omits_dual_qualifiers_and_accounts_for_juice(self):
        rating = dict(qbPercentile=.5, supportPercentile=.9)
        row = dict(home=rating, away=rating, actual=4., market=3., split=5., homeOdds=-110, awayOdds=100, homeTeam='A', awayTeam='B', block='week')
        self.assertEqual(model.group_rows([row]), [])
        row['away'] = dict(qbPercentile=.5, supportPercentile=.2)
        picked = model.group_rows([row])
        self.assertEqual(picked[0]['picked'], 'A')
        self.assertAlmostEqual(picked[0]['units'], 100/110)
        self.assertEqual(model.group_metrics(picked, 20)['coverRate'], 1.)

    def test_holdout_is_excluded_before_feature_construction(self):
        # Invalid final-test timestamps must never be parsed or used in ratings.
        final = dict(season=2025, week=10, feature_asof='invalid')
        self.assertEqual(model.construct_features([final], [], 400.), [])
        report = json.loads((ROOT/'public/football/decomposition.json').read_text())
        self.assertFalse(report['holdoutEvaluated'])
        self.assertEqual([r['games'] for r in report['reports']], [705, 705, 705])
        self.assertEqual(report['settings']['primaryQbPrior'], 400)

    def test_proxy_diagnostic_reports_mismatch_without_mutating_forecast(self):
        rows = [dict(gameId='game', homeTeam='A', awayTeam='B', split=3., home=dict(qbId='old', alternateQbDropbacks=70), away=dict(qbId='same', alternateQbDropbacks=0))]
        observations = [dict(kind='pass', game_id='game', posteam='A', qb='new', plays=40), dict(kind='pass', game_id='game', posteam='B', qb='same', plays=35)]
        before = json.dumps(rows, sort_keys=True)
        check = model.check_proxies(rows, observations)
        self.assertEqual(check['matchRate'], .5)
        self.assertEqual(check['sidesWith50AlternateDropbacks'], 1)
        self.assertEqual(before, json.dumps(rows, sort_keys=True))


if __name__ == '__main__':
    unittest.main()
