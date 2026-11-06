"""Reconstruct strictly lagged NFL features from public nflverse play-by-play.

Raw downloads are cached outside the tracked racing data. This script never imports
or writes racing code, databases, models, or refresh jobs.
Requires pandas and pyarrow: python -m pip install -r scripts/football/requirements.txt
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import urllib.request
from zoneinfo import ZoneInfo

import pandas as pd
import numpy as np

SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
PBP_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet'
PBP_COLUMNS = ['game_id', 'posteam', 'defteam', 'epa', 'pass_attempt', 'rush_attempt',
               'qb_kneel', 'qb_spike', 'qb_dropback', 'qb_scramble', 'passer_player_id', 'rusher_player_id',
               'sack', 'qb_hit', 'interception', 'fumble_lost']
UTC = timezone.utc


def stamp(dt):
    return dt.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def snapshot_time(kickoff):
    # Freeze each NFL week on Wednesday 18:00 UTC, before Thursday kickoff.
    day = kickoff.astimezone(UTC).replace(hour=18, minute=0, second=0, microsecond=0)
    day -= timedelta(days=(day.weekday() - 2) % 7)
    if day >= kickoff:
        day -= timedelta(days=7)
    return day


def eligible(history, cutoff):
    oldest = cutoff - timedelta(days=730)
    return [r for r in history if oldest <= r['available_at'] < cutoff]


def rating(history, cutoff, prior_plays=200, half_life_games=8):
    rows = eligible(history, cutoff)
    total = count = 0.
    for age, r in enumerate(reversed(rows)):
        weight = 2 ** (-age / half_life_games)
        total += weight * r['epa_sum']
        count += weight * r['plays']
    return total / (count + prior_plays), len(rows)


def metric(history, cutoff, numerator, denominator, prior_count=100, prior_mean=0.):
    total, count = prior_count * prior_mean, float(prior_count)
    for age, r in enumerate(reversed(eligible(history, cutoff))):
        weight = 2 ** (-age / 8)
        total += weight * r.get(numerator, 0.)
        count += weight * r.get(denominator, 0.)
    return total / count if count else prior_mean


def opponent_ratings(observations, cutoff):
    """Joint offense/defense ridge on past team-game EPA, weighted by plays.

    y = league mean + offense strength + opposing defense EPA allowed effect.
    A negative defense coefficient is better. No target-game rows or market inputs.
    """
    rows = eligible(observations, cutoff)
    teams = sorted({r['team'] for r in rows} | {r['opponent'] for r in rows})
    if not rows:
        return {}
    ids = {team: i for i, team in enumerate(teams)}; n = len(teams)
    x = np.zeros((len(rows), 2*n))
    y = np.array([r['epa_sum'] / r['plays'] for r in rows])
    w = np.array([r['plays'] * 2 ** (-(cutoff-r['available_at']).days/365) for r in rows])
    for i, r in enumerate(rows):
        x[i, ids[r['team']]] = 1
        x[i, n+ids[r['opponent']]] = 1
    center = float(np.average(y, weights=w))
    beta = np.linalg.solve(x.T @ (w[:, None]*x) + 400*np.eye(2*n), x.T @ (w*(y-center)))
    return {team: (float(beta[i]), float(beta[n+i])) for team, i in ids.items()}


def fetch(url, path, refresh=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'DirtIQ-Football-Research/1.0'})
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()
        temp = path.with_suffix(path.suffix + '.tmp')
        temp.write_bytes(data)
        temp.replace(path)
    return dict(url=url, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size)


def aggregate_season(season, cache, refresh):
    path = cache / f'play_by_play_{season}.parquet'
    source = fetch(PBP_URL.format(season=season), path, refresh)
    p = pd.read_parquet(path, columns=PBP_COLUMNS)
    mask = ((p.pass_attempt.eq(1) | p.rush_attempt.eq(1)) &
            ~p.qb_kneel.eq(1) & ~p.qb_spike.eq(1) & p.epa.notna() & p.posteam.notna() & p.defteam.notna())
    p = p.loc[mask].copy()
    p['dropbacks'] = p.qb_dropback.eq(1).astype(int)
    p['pressure_events'] = (p.qb_dropback.eq(1) & (p.sack.eq(1) | p.qb_hit.eq(1))).astype(int)
    p['turnovers'] = (p.interception.eq(1) | p.fumble_lost.eq(1)).astype(int)
    p['pass_plays'] = p.qb_dropback.eq(1).astype(int)
    p['rush_plays'] = (p.rush_attempt.eq(1) & ~p.qb_dropback.eq(1)).astype(int)
    p['pass_epa_sum'] = p.epa.where(p.pass_plays.eq(1), 0.)
    p['rush_epa_sum'] = p.epa.where(p.rush_plays.eq(1), 0.)
    aggregation = dict(epa_sum=('epa', 'sum'), plays=('epa', 'count'))
    aggregation.update({c: (c, 'sum') for c in ['dropbacks', 'pressure_events', 'turnovers', 'pass_plays', 'rush_plays', 'pass_epa_sum', 'rush_epa_sum']})
    teams = p.groupby(['game_id', 'posteam']).agg(**aggregation).reset_index()
    defenses = p.groupby(['game_id', 'defteam']).agg(**aggregation).reset_index()
    q = p.loc[p.qb_dropback.eq(1)].copy()
    q['qb_id'] = q.passer_player_id.where(q.passer_player_id.notna(), q.rusher_player_id.where(q.qb_scramble.eq(1)))
    q = q[q.qb_id.notna()]
    qbs = q.groupby(['game_id', 'posteam', 'qb_id']).agg(epa_sum=('epa', 'sum'), plays=('epa', 'count')).reset_index()
    print(f'{season}: {len(p):,} offensive plays, {teams.game_id.nunique()} games', flush=True)
    return teams, defenses, qbs, source


def prepare_games(schedule):
    games = []
    for r in schedule.to_dict('records'):
        if pd.isna(r['home_score']) or pd.isna(r['away_score']) or pd.isna(r['gametime']):
            continue
        kickoff = datetime.fromisoformat(f"{r['gameday']}T{r['gametime']}").replace(tzinfo=ZoneInfo('America/New_York')).astimezone(UTC)
        games.append({**r, 'kickoff_dt': kickoff, 'snapshot_dt': snapshot_time(kickoff),
                      'available_at': kickoff + timedelta(hours=24)})
    return sorted(games, key=lambda r: r['kickoff_dt'])


def build_rows(games, offense, defense, quarterbacks):
    team_history, defense_history, qb_history = {}, {}, {}
    observations, adjusted_cache = [], {}
    output, excluded = [], {'insufficient_team_history': 0, 'missing_market': 0, 'missing_pbp': 0, 'missing_qb_history': 0}
    for g in games:
        gid, home, away = g['game_id'], g['home_team'], g['away_team']
        cutoff = g['snapshot_dt']
        h_hist = eligible(team_history.get(home, []), cutoff)
        a_hist = eligible(team_history.get(away, []), cutoff)
        reason = None
        if (gid, home) not in offense or (gid, away) not in offense:
            reason = 'missing_pbp'
        elif min(len(h_hist), len(a_hist)) < 3:
            reason = 'insufficient_team_history'
        elif any(pd.isna(g.get(c)) for c in ['spread_line', 'home_spread_odds', 'away_spread_odds']):
            reason = 'missing_market'
        else:
            # Last game's dominant dropback passer is a pregame proxy. Never inspect
            # the target game's actual starter, injuries, or participation to choose it.
            home_qb, away_qb = h_hist[-1]['qb_id'], a_hist[-1]['qb_id']
            hq, hn = rating(qb_history.get(home_qb, []), cutoff)
            aq, an = rating(qb_history.get(away_qb, []), cutoff)
            if home_qb is None or away_qb is None or not hn or not an:
                reason = 'missing_qb_history'
            else:
                ho, _ = rating(h_hist, cutoff); ao, _ = rating(a_hist, cutoff)
                hd, _ = rating(defense_history.get(home, []), cutoff)
                ad, _ = rating(defense_history.get(away, []), cutoff)
                if cutoff not in adjusted_cache:
                    adjusted_cache[cutoff] = opponent_ratings(observations, cutoff)
                adjusted = adjusted_cache[cutoff]
                hadj, aadj = adjusted.get(home, (0., 0.)), adjusted.get(away, (0., 0.))
                h_def, a_def = defense_history.get(home, []), defense_history.get(away, [])
                hpass = metric(h_hist, cutoff, 'pass_plays', 'plays', 100, .6)
                apass = metric(a_hist, cutoff, 'pass_plays', 'plays', 100, .6)
                pass_match = hpass*(metric(h_hist, cutoff, 'pass_epa_sum', 'pass_plays')+metric(a_def, cutoff, 'pass_epa_sum', 'pass_plays'))-apass*(metric(a_hist, cutoff, 'pass_epa_sum', 'pass_plays')+metric(h_def, cutoff, 'pass_epa_sum', 'pass_plays'))
                rush_match = (1-hpass)*(metric(h_hist, cutoff, 'rush_epa_sum', 'rush_plays')+metric(a_def, cutoff, 'rush_epa_sum', 'rush_plays'))-(1-apass)*(metric(a_hist, cutoff, 'rush_epa_sum', 'rush_plays')+metric(h_def, cutoff, 'rush_epa_sum', 'rush_plays'))
                hrest = min(14., (g['kickoff_dt']-h_hist[-1]['available_at']).total_seconds()/86400+1)
                arest = min(14., (g['kickoff_dt']-a_hist[-1]['available_at']).total_seconds()/86400+1)
                context = dict(adj_off_epa_diff=hadj[0]-aadj[0], adj_def_epa_allowed_diff=hadj[1]-aadj[1],
                    rest_diff=hrest-arest,
                    pressure_allowed_diff=metric(h_hist, cutoff, 'pressure_events', 'dropbacks', 40, .25)-metric(a_hist, cutoff, 'pressure_events', 'dropbacks', 40, .25),
                    pressure_forced_diff=metric(h_def, cutoff, 'pressure_events', 'dropbacks', 40, .25)-metric(a_def, cutoff, 'pressure_events', 'dropbacks', 40, .25),
                    turnover_margin_diff=(metric(h_def, cutoff, 'turnovers', 'plays', 100, .025)-metric(h_hist, cutoff, 'turnovers', 'plays', 100, .025))-(metric(a_def, cutoff, 'turnovers', 'plays', 100, .025)-metric(a_hist, cutoff, 'turnovers', 'plays', 100, .025)),
                    pass_matchup=pass_match, rush_matchup=rush_match)
                output.append(dict(game_id=gid, kickoff=stamp(g['kickoff_dt']), feature_asof=stamp(cutoff),
                    completed_at=stamp(g['available_at']), home_team=home, away_team=away,
                    home_margin=int(g['home_score'] - g['away_score']), market_home_margin=float(g['spread_line']),
                    home_odds=float(g['home_spread_odds']), away_odds=float(g['away_spread_odds']),
                    off_epa_diff=round(ho-ao, 8), def_epa_allowed_diff=round(hd-ad, 8), home_field=0 if g['location'] == 'Neutral' else 1,
                    qb_epa_diff=round(hq-aq, 8), season=int(g['season']), week=int(g['week']),
                    home_qb_proxy=home_qb, away_qb_proxy=away_qb,
                    home_qb_epa=round(hq, 8), away_qb_epa=round(aq, 8),
                    home_adj_net=round(hadj[0]-hadj[1], 8), away_adj_net=round(aadj[0]-aadj[1], 8),
                    home_history_games=len(h_hist), away_history_games=len(a_hist),
                    **{k: round(float(v), 8) for k, v in context.items()}))
        if reason:
            excluded[reason] += 1
        # Add observations only after the current row was constructed. Ratings also
        # enforce an explicit availability cutoff, excluding concurrent/week peers.
        for team in [home, away]:
            stats = offense.get((gid, team)); dstats = defense.get((gid, team))
            qb_stats = quarterbacks.get((gid, team), [])
            qb_id = max(qb_stats, key=lambda r: r['plays'])['qb_id'] if qb_stats else None
            if stats:
                team_history.setdefault(team, []).append({**stats, 'available_at': g['available_at'], 'qb_id': qb_id})
                observations.append({**stats, 'team': team, 'opponent': away if team == home else home, 'available_at': g['available_at']})
            if dstats:
                defense_history.setdefault(team, []).append({**dstats, 'available_at': g['available_at']})
            for q in qb_stats:
                qb_history.setdefault(q['qb_id'], []).append({**q, 'available_at': g['available_at']})
    return output, excluded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start-season', type=int, default=2021)
    parser.add_argument('--end-season', type=int, default=2025)
    parser.add_argument('--cache', type=Path, default=Path('.football-cache'))
    parser.add_argument('--output', type=Path, default=Path('public/football/history.json'))
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    schedule_path = args.cache / 'games.csv'
    schedule_source = fetch(SCHEDULE_URL, schedule_path, args.refresh)
    schedule = pd.read_csv(schedule_path)
    schedule = schedule[schedule.season.between(args.start_season, args.end_season)]
    seasons = list(range(args.start_season, args.end_season + 1))
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda season: aggregate_season(season, args.cache, args.refresh), seasons))
    offense, defense, quarterbacks = {}, {}, {}
    for teams, defenses, qbs, _ in results:
        for r in teams.to_dict('records'):
            offense[(r['game_id'], r['posteam'])] = {k: float(v) for k, v in r.items() if k not in ['game_id', 'posteam']}
        for r in defenses.to_dict('records'):
            defense[(r['game_id'], r['defteam'])] = {k: float(v) for k, v in r.items() if k not in ['game_id', 'defteam']}
        for r in qbs.to_dict('records'):
            quarterbacks.setdefault((r['game_id'], r['posteam']), []).append({'qb_id': r['qb_id'], 'epa_sum': float(r['epa_sum']), 'plays': int(r['plays'])})
    games = prepare_games(schedule)
    rows, excluded = build_rows(games, offense, defense, quarterbacks)
    if not rows:
        raise ValueError('No eligible games; refusing to replace the dataset.')
    metadata = dict(version=2, provider='nflverse / nflfastR', builtAt=stamp(datetime.now(UTC)),
        seasons=seasons, games=len(rows), excluded=excluded,
        seasonCounts={str(s): sum(r['season'] == s for r in rows) for s in seasons},
        sources=[schedule_source] + [r[3] for r in results],
        featurePolicy='Wednesday 18:00 UTC snapshot; earlier games only; 730-day feature window; 8-appearance half-life; 200-play zero-EPA prior.',
        qbPolicy='Last eligible game dominant passer; not the actual target-game starter. No historical injury-feed reconstruction.',
        availabilityPolicy='completed_at conservatively means kickoff + 24h, not a recorded final whistle.',
        marketPolicy='nflverse archived spread and side odds; snapshot time/book not supplied. Benchmark returns, not verified executable bets.',
        vintagePolicy='Historical EPA is from the current downloaded nflfastR release, not contemporaneous archived model snapshots. Future game outcomes are excluded from feature aggregation, but source model-vintage/revision effects remain.',
        attribution='Derived from nflverse and nflfastR play-by-play (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), filtered and aggregated by Dirt IQ. No endorsement implied. Schedule source: nflverse/nfldata.',
        contextPolicy='Opponent-adjusted offense/defense jointly fit on earlier team-game EPA with play-count weights, 365-day decay and 400-play ridge prior. Rest capped at 14 days. Sack-or-QB-hit is a protection proxy, not an offensive-line grade. Passing/rushing EPA matchups use earlier dropback tendencies. Turnovers are turnovers committed/forced per eligible play.',
        evaluationPolicy='Development: 2023–2024 and 2025 weeks 1–9. Final check: 2025 week 10 onward, coefficients frozen before week 10. No claim of a betting edge.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'metadata': metadata, 'games': rows}, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'games': len(rows), 'seasonCounts': metadata['seasonCounts'], 'excluded': excluded, 'output': str(args.output)}, indent=2))


if __name__ == '__main__':
    main()
