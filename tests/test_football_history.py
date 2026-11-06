import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('football_history', Path(__file__).resolve().parents[1] / 'scripts/football/build_history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class HistoryTests(unittest.TestCase):
    def fixture(self):
        games, offense, defense, qbs = [], {}, {}, {}
        start = datetime(2023, 9, 10, 17, tzinfo=timezone.utc)
        for i in range(6):
            kickoff = start + timedelta(weeks=i)
            gid = f'2023_{i+1:02d}_A_H'
            games.append(dict(game_id=gid, home_team='H', away_team='A', kickoff_dt=kickoff,
                snapshot_dt=history.snapshot_time(kickoff), available_at=kickoff+timedelta(hours=24),
                home_score=24, away_score=17, spread_line=3.5, home_spread_odds=-110,
                away_spread_odds=-105, location='Home', season=2023, week=i+1))
            for team, value in [('H', .2), ('A', -.1)]:
                offense[(gid, team)] = dict(epa_sum=value*50, plays=50)
                defense[(gid, team)] = dict(epa_sum=-value*50, plays=50)
                qbs[(gid, team)] = [dict(qb_id=f'{team}-QB', epa_sum=value*30, plays=30)]
        return games, offense, defense, qbs

    def test_current_and_future_observations_cannot_change_pregame_features(self):
        games, offense, defense, qbs = self.fixture()
        before, _ = history.build_rows(games, offense, defense, qbs)
        gid = games[3]['game_id']
        for g in games[3:]:
            offense[(g['game_id'], 'H')] = dict(epa_sum=99999, plays=50)
            qbs[(g['game_id'], 'H')] = [dict(qb_id='FUTURE-STARTER', epa_sum=99999, plays=30)]
        after, _ = history.build_rows(games, offense, defense, qbs)
        self.assertEqual(next(r for r in before if r['game_id'] == gid), next(r for r in after if r['game_id'] == gid))
        self.assertEqual(before[0]['home_qb_proxy'], 'H-QB')

    def test_rating_excludes_unavailable_and_over_two_year_observations(self):
        cutoff = datetime(2024, 10, 2, 18, tzinfo=timezone.utc)
        recent = dict(available_at=cutoff-timedelta(days=7), epa_sum=10, plays=50)
        old = dict(available_at=cutoff-timedelta(days=731), epa_sum=999999, plays=50)
        future = dict(available_at=cutoff, epa_sum=999999, plays=50)
        self.assertEqual(history.rating([old, recent, future], cutoff), (.04, 1))

    def test_market_sign_and_neutral_field_are_not_inverted(self):
        games, offense, defense, qbs = self.fixture()
        games[3]['location'] = 'Neutral'
        rows, excluded = history.build_rows(games, offense, defense, qbs)
        self.assertEqual(rows[0]['market_home_margin'], 3.5)
        self.assertEqual(rows[0]['home_field'], 0)
        self.assertEqual(excluded['insufficient_team_history'], 3)

    def test_no_imputed_prices_when_market_data_is_missing(self):
        games, offense, defense, qbs = self.fixture()
        games[3]['home_spread_odds'] = float('nan')
        rows, excluded = history.build_rows(games, offense, defense, qbs)
        self.assertEqual(excluded['missing_market'], 1)
        self.assertNotIn(games[3]['game_id'], [r['game_id'] for r in rows])


if __name__ == '__main__':
    unittest.main()
