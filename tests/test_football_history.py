import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
import tempfile
import pandas as pd

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

    def test_opponent_adjustments_exclude_future_games_and_preserve_defense_direction(self):
        cutoff = datetime(2024, 10, 2, 18, tzinfo=timezone.utc)
        rows = []
        for i in range(10):
            rows.extend([dict(team='H', opponent='A', available_at=cutoff-timedelta(days=7+i*7), plays=50, epa_sum=10),
                         dict(team='A', opponent='H', available_at=cutoff-timedelta(days=7+i*7), plays=50, epa_sum=-5)])
        original = history.opponent_ratings(rows, cutoff)
        future = dict(team='H', opponent='A', available_at=cutoff+timedelta(days=1), plays=50, epa_sum=999999)
        self.assertEqual(original, history.opponent_ratings(rows+[future], cutoff))
        self.assertGreater(original['H'][0], original['A'][0])
        self.assertLess(original['H'][1], original['A'][1])

    def test_hits_sacks_and_turnovers_do_not_duplicate_the_same_event(self):
        rows = []
        for i in range(2):
            r = {c: 0 for c in history.PBP_COLUMNS}
            r.update(game_id='TEST', posteam='H', defteam='A', epa=-1., pass_attempt=1,
                     qb_dropback=1, passer_player_id='QB', rusher_player_id=None)
            if i == 0:
                r.update(sack=1, qb_hit=1)
            else:
                r.update(interception=1, fumble_lost=1)
            rows.append(r)
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            pd.DataFrame(rows).to_parquet(cache/'play_by_play_2024.parquet')
            offense, _, _, _ = history.aggregate_season(2024, cache, False)
            self.assertEqual(offense.iloc[0].pressure_events, 1)
            self.assertEqual(offense.iloc[0].turnovers, 1)


if __name__ == '__main__':
    unittest.main()
