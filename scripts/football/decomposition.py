"""Pregame QB/team attribution research. Never evaluate 2025 week 10 onward.

Additive, regularized associations, not causal player values. Only historical
QB substitutions/transfers distinguish QB from team effects. No market inputs
enter ratings or margin fits; market outcomes are evaluation targets only.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from build_history import prepare_games, PBP_COLUMNS
from overlap_audit import development, dt, interval, ridge

FEATURES = ['qb', 'passSupport', 'rush', 'defense', 'specialTeams', 'home']
PRIORS = [100., 400., 1600.]


def load_observations(cache):
    schedule = pd.read_csv(cache/'games.csv')
    # Exclude the final test before loading any of its play rows or scores.
    schedule = schedule[schedule.season.between(2021, 2025) & ((schedule.season < 2025) | (schedule.week <= 9))]
    games = prepare_games(schedule)
    timing = {g['game_id']: g['available_at'] for g in games}
    parts = []
    sources = []
    for year in range(2021, 2026):
        path = cache/f'play_by_play_{year}.parquet'
        sources.append(dict(season=year, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        p = pd.read_parquet(path, columns=PBP_COLUMNS+['play_type', 'passer_player_name', 'rusher_player_name'])
        p = p[p.game_id.isin(timing) & p.epa.notna() & p.posteam.notna() & p.defteam.notna()].copy()
        p['available'] = p.game_id.map(timing)
        p['qb'] = p.passer_player_id.where(p.passer_player_id.notna(), p.rusher_player_id.where(p.qb_scramble.eq(1)))
        p['name'] = p.passer_player_name.where(p.passer_player_name.notna(), p.rusher_player_name.where(p.qb_scramble.eq(1)))
        normal = ~p.qb_kneel.eq(1) & ~p.qb_spike.eq(1)
        p['kind'] = np.select([normal & p.qb_dropback.eq(1) & p.qb.notna(), normal & p.rush_attempt.eq(1) & ~p.qb_dropback.eq(1), p.play_type.isin(['kickoff', 'punt', 'field_goal', 'extra_point'])], ['pass', 'rush', 'st'], default='exclude')
        p = p[p.kind.ne('exclude')]
        # ST EPA is from possession team's perspective; give the opponent the
        # opposite value, so each team's rating includes both ST units.
        st = p[p.kind.eq('st')].copy()
        reverse = st.copy(); reverse['posteam'] = st.defteam; reverse['defteam'] = st.posteam; reverse['epa'] = -st.epa
        p = pd.concat([p, reverse], ignore_index=True)
        p['qb'] = p.qb.fillna('none'); p['name'] = p.name.fillna('Unknown')
        parts.append(p.groupby(['game_id', 'posteam', 'defteam', 'qb', 'kind', 'available'], dropna=False).agg(total=('epa', 'sum'), plays=('epa', 'count'), name=('name', 'first')).reset_index())
    return pd.concat(parts, ignore_index=True).to_dict('records'), sources


def joint_fit(rows, penalty=400., include_qb=True):
    """Weighted additive EPA/play fit with fixed zero-centered Gaussian priors."""
    teams = sorted({r['posteam'] for r in rows} | {r['defteam'] for r in rows})
    qbs = sorted({r['qb'] for r in rows}) if include_qb else []
    ti = {t: i for i, t in enumerate(teams)}; qi = {q: i for i, q in enumerate(qbs)}
    n = len(teams); size = 2*n+len(qbs)
    x = np.zeros((len(rows), size))
    for i, r in enumerate(rows):
        x[i, ti[r['posteam']]] = 1.; x[i, n+ti[r['defteam']]] = 1.
        if include_qb:
            x[i, 2*n+qi[r['qb']]] = 1.
    y = np.array([r['total']/r['plays'] for r in rows])
    w = np.array([r['weight']*r['plays'] for r in rows])
    center = float(np.average(y, weights=w))
    prior = np.full(size, 400.)
    if include_qb:
        prior[2*n:] = penalty
    beta = np.linalg.solve(x.T @ (w[:, None]*x)+np.diag(prior), x.T @ (w*(y-center)))
    return dict(off={t: float(beta[i]) for t, i in ti.items()}, defense={t: float(beta[n+i]) for t, i in ti.items()}, qb={q: float(beta[2*n+i]) for q, i in qi.items()})


def snapshot(observations, cutoff, penalty):
    past = [dict(r, weight=2**(-(cutoff-r['available']).total_seconds()/86400/365)) for r in observations if 0 < (cutoff-r['available']).total_seconds() <= 730*86400]
    passing = [r for r in past if r['kind'] == 'pass']
    rushing = [r for r in past if r['kind'] == 'rush']
    fitted = joint_fit(passing, penalty)
    rush = joint_fit(rushing, include_qb=False)
    teams = sorted(fitted['off'])
    team_qbs = {t: {r['qb'] for r in passing if r['posteam'] == t} for t in teams}
    qb_teams = {q: {r['posteam'] for r in passing if r['qb'] == q} for q in fitted['qb']}
    ratings = {}
    for t in teams:
        team_pass = [r for r in passing if r['posteam'] == t]
        last_game = max(team_pass, key=lambda r: r['available'])['game_id']
        proxy = max((r for r in team_pass if r['game_id'] == last_game), key=lambda r: r['plays'])
        st = [r for r in past if r['kind'] == 'st' and r['posteam'] == t]
        # Shrink ST net EPA per game toward zero with eight prior games.
        game_weights = {r['game_id']: r['weight'] for r in st}
        special = sum(r['total']*r['weight'] for r in st)/(8+sum(game_weights.values()))
        defense = -.6*fitted['defense'].get(t, 0.)-.4*rush['defense'].get(t, 0.)
        support = .6*fitted['off'][t]+.4*rush['off'].get(t, 0.)+defense+special/65
        ratings[t] = dict(qb=fitted['qb'][proxy['qb']], passSupport=fitted['off'][t], rush=rush['off'].get(t, 0.), defense=defense, specialTeams=special, support=support,
            qbId=proxy['qb'], qbName=proxy['name'], priorGame=last_game,
            qbDropbacks=sum(r['plays'] for r in passing if r['qb'] == proxy['qb']),
            alternateQbDropbacks=sum(r['plays'] for r in team_pass if r['qb'] != proxy['qb']),
            multiQbTeam=len(team_qbs[t]) > 1, multiTeamQb=len(qb_teams[proxy['qb']]) > 1)
    for t, r in ratings.items():
        r['qbPercentile'] = sum(v['qb'] < r['qb'] for v in ratings.values())/max(1, len(ratings)-1)
        r['supportPercentile'] = sum(v['support'] < r['support'] for v in ratings.values())/max(1, len(ratings)-1)
    return ratings


def construct_features(history, observations, penalty):
    rows = []; last = None; ratings = {}
    for g in sorted((r for r in history if development(r)), key=lambda r: r['feature_asof']):
        if g['feature_asof'] != last:
            last = g['feature_asof']; ratings = snapshot(observations, dt(last), penalty)
        h, a = ratings.get(g['home_team']), ratings.get(g['away_team'])
        if h is None or a is None:
            continue
        rows.append(dict(g, components=[h[k]-a[k] for k in FEATURES[:-1]]+[g['home_field']], home=h, away=a))
    return rows


def evaluate(rows):
    """Outer margin coefficients also see only earlier pregame feature rows."""
    results = []
    blocks = sorted({r['feature_asof'] for r in rows if r['season'] >= 2023})
    for block in blocks:
        cutoff = dt(block)
        train = [r for r in rows if dt(r['completed_at']) < cutoff and 0 < (cutoff-dt(r['kickoff'])).total_seconds() <= 730*86400]
        if len(train) < 80:
            continue
        test = [r for r in rows if r['feature_asof'] == block]
        w = np.array([2**(-(cutoff-dt(r['kickoff'])).days/365) for r in train])
        y = np.array([r['home_margin'] for r in train])
        get = lambda data, split: np.array([r['components'] if split else [r['adj_off_epa_diff'], r['adj_def_epa_allowed_diff'], r['home_field']] for r in data])
        split = ridge(get(train, True), y, w, 20.)(get(test, True))
        baseline = ridge(get(train, False), y, w, 20.)(get(test, False))
        for i, r in enumerate(test):
            results.append(dict(gameId=r['game_id'], season=r['season'], week=r['week'], block=block, homeTeam=r['home_team'], awayTeam=r['away_team'], actual=r['home_margin'], market=r['market_home_margin'], split=float(split[i]), baseline=float(baseline[i]), homeOdds=r['home_odds'], awayOdds=r['away_odds'], home=r['home'], away=r['away']))
    return results


def profit(odds):
    return odds/100 if odds > 0 else 100/abs(odds)


def check_proxies(rows, observations):
    """Post-prediction diagnostic only; never chooses a QB or selects a bet."""
    totals = {}
    for r in observations:
        if r['kind'] == 'pass':
            key = (r['game_id'], r['posteam'])
            totals.setdefault(key, {})[r['qb']] = r['plays']
    matches = checked = alternate = 0
    for r in rows:
        for side, team in [('home', r['homeTeam']), ('away', r['awayTeam'])]:
            actual = totals.get((r['gameId'], team), {})
            if actual:
                checked += 1
                matches += max(actual, key=actual.get) == r[side]['qbId']
            alternate += r[side]['alternateQbDropbacks'] >= 50
    return dict(checkedSides=checked, matchingDominantPasser=int(matches), matchRate=matches/checked if checked else None,
        sidesWith50AlternateDropbacks=alternate,
        explanation='Compared after predictions with the target game’s dominant dropback QB, not its announced starter. Does not filter results or replace the pregame proxy.')


def group_rows(rows, reverse=False):
    selected = []
    for r in rows:
        eligible = []
        for side, sign in [('home', 1), ('away', -1)]:
            q, s = r[side]['qbPercentile'], r[side]['supportPercentile']
            match = q >= .75 and s < .5 if reverse else .25 <= q <= .75 and s >= .75
            if match:
                eligible.append((side, sign))
        # Both sides qualifying supplies no directional hypothesis; omit game.
        if len(eligible) != 1:
            continue
        side, sign = eligible[0]
        # Reverse hypothesis fades strong-QB / weak-support teams.
        sign *= -1 if reverse else 1
        picked = 'home' if sign > 0 else 'away'
        error = sign*(r['actual']-r['market'])
        selected.append(dict(r, picked=r['homeTeam'] if picked == 'home' else r['awayTeam'], marketError=error, units=profit(r[picked+'Odds']) if error > 0 else -1. if error < 0 else 0., modelEdge=sign*(r['split']-r['market'])))
    return selected


def group_metrics(rows, samples=4000):
    wins = sum(r['marketError'] > 0 for r in rows); losses = sum(r['marketError'] < 0 for r in rows)
    values = [r['marketError'] for r in rows]; blocks = [r['block'] for r in rows]
    return dict(games=len(rows), wins=wins, losses=losses, pushes=len(rows)-wins-losses, coverRate=wins/(wins+losses) if wins+losses else None,
        meanMarketError=float(np.mean(values)) if values else None, marketErrorInterval=interval(values, blocks, 9, samples),
        roi=float(np.mean([r['units'] for r in rows])) if rows else None,
        roiInterval=interval([r['units'] for r in rows], blocks, 9, samples),
        positiveModelEdge=sum(r['modelEdge'] >= 1. for r in rows))


def report_for(rows, penalty, samples=4000):
    delta = [abs(r['split']-r['actual'])-abs(r['baseline']-r['actual']) for r in rows]
    groups = []
    for reverse, label in [(False, 'Average QB / strong support'), (True, 'Fade strong QB / weaker support')]:
        picked = group_rows(rows, reverse)
        summary = group_metrics(picked, samples)
        groups.append(dict(label=label, **summary, periods=[dict(label=str(y) if y != 2025 else '2025 weeks 1–9', **group_metrics([r for r in picked if r['season'] == y], samples)) for y in [2023, 2024, 2025]], examples=[{k: r[k] for k in ['gameId', 'picked', 'modelEdge', 'marketError', 'home', 'away']} for r in sorted(picked, key=lambda r: r['gameId'])[:5]]))
    return dict(qbPrior=penalty, games=len(rows), baselineMae=float(np.mean([abs(r['baseline']-r['actual']) for r in rows])), splitMae=float(np.mean([abs(r['split']-r['actual']) for r in rows])), marketMae=float(np.mean([abs(r['market']-r['actual']) for r in rows])), maeDelta=float(np.mean(delta)), maeDeltaInterval=interval(delta, [r['block'] for r in rows], 9, samples), groups=groups,
        firstPredictions=[{k: r[k] for k in ['gameId', 'split', 'baseline', 'home', 'away']} for r in rows[:3]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--history', type=Path, default=Path('public/football/history.json'))
    parser.add_argument('--output', type=Path, default=Path('public/football/decomposition.json'))
    args = parser.parse_args()
    history = json.loads(args.history.read_text())['games']
    observations, sources = load_observations(args.cache)
    reports = []
    for prior in PRIORS:
        print(f'Building QB prior {prior:g}', flush=True)
        rows = construct_features(history, observations, prior)
        evaluated = evaluate(rows)
        reports.append(report_for(evaluated, prior))
        reports[-1]['proxyCheck'] = check_proxies(evaluated, observations)
        print(f'{len(evaluated)} games; split MAE {reports[-1]["splitMae"]:.3f}', flush=True)
    output = dict(version=1, title='QB versus supporting team', holdoutEvaluated=False, holdout='2025 week 10 onward', sources=sources,
        settings=dict(trainingDays=730, weightHalfLifeDays=365, primaryQbPrior=400, sensitivityQbPriors=PRIORS, marginRidge=20, familyComparisons=9, bootstrapSamples=4000), reports=reports,
        limitations=['QB is the previous game’s dominant passer, not a verified announced starter. This blocks live betting readiness.', 'QB and passing support remain partly confounded; ridge priors determine how shared signal is allocated. No separate receiver or offensive-line causal values are claimed.', 'Rushing is a team unit association; defense combines pass/run prevention. Special teams uses net possession-perspective EPA per game.', 'Supporting-cast ranks use a fixed 60/40 pass/run blend, defense, and special-teams EPA divided by 65. These are research definitions, not optimized thresholds.', 'Archived odds are not timestamp-aligned with Wednesday ratings. Returns are hypothetical one-unit stakes at archived prices, not executable historical results.', 'EPA source vintages are retrospective. Nine primary checks cover three priors × (MAE improvement and two market-error groups); ROI intervals are descriptive, and prior project searches are not covered.'])
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
