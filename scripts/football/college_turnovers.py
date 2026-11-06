"""Fixed NCAA turnover-inflated blowout hypothesis; 2025 is not evaluated.

Uses retrospective public box scores and archived DraftKings spread values.
No price or quote timestamps are inferred. No threshold optimization.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from overlap_audit import interval


def trigger(margin, turnover_margin, ypp_difference):
    return margin >= 21 and turnover_margin >= 3 and ypp_difference <= 1


def box_stats(row):
    try:
        attempts = int(str(row['completionAttempts']).split('/')[-1])
        rushes = int(row['rushingAttempts']); yards = int(row['totalYards'])
        turnovers = int(row['turnovers'])
        if min(attempts, rushes, turnovers) < 0 or attempts+rushes <= 0:
            return None
        if turnovers != int(row['fumblesLost'])+int(row['interceptions']):
            return None
        if yards != int(row['rushingYards'])+int(row['netPassingYards']):
            return None
        return dict(ypp=yards/(attempts+rushes), turnovers=turnovers, plays=attempts+rushes)
    except (TypeError, ValueError, KeyError):
        return None


def load(cache):
    schedules, boxes, sources = [], [], []
    for year in [2022, 2023, 2024, 2026]:
        for kind, collection in [('cfb_schedules', schedules), ('team_box', boxes)]:
            path = cache/f'{kind}_{year}.parquet'
            collection.append(pd.read_parquet(path))
            tag = 'cfb_schedules' if kind == 'cfb_schedules' else 'espn_cfb_team_box'
            sources.append(dict(file=path.name, url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{path.name}', sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    path = cache/'cfb_line_odds.parquet'
    odds = pd.read_parquet(path)
    # Never select or evaluate final NFL/college 2025 outcomes.
    odds = odds[odds.season.isin([2022, 2023, 2024]) & odds.market_type.eq('spread') & odds.book.eq('DraftKings')]
    quotes = {}
    for gid, group in odds.groupby('game_id'):
        rows = group[['game_desc', 'abbr', 'lines']].drop_duplicates()
        if len(rows) != 2 or rows.lines.isna().any():
            continue
        away_name, home_name = str(rows.iloc[0].game_desc).split('@')
        home = rows[rows.abbr.eq(home_name)]; away = rows[rows.abbr.eq(away_name)]
        if len(home) != 1 or len(away) != 1 or abs(float(home.iloc[0].lines)+float(away.iloc[0].lines)) > .01:
            continue
        quotes[int(gid)] = -float(home.iloc[0].lines)
    sources.append(dict(file=path.name, url='https://github.com/sportsdataverse/cfbfastR-data/blob/main/betting/parquet/cfb_line_odds.parquet', sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    schedule = pd.concat(schedules, ignore_index=True)
    schedule = schedule[schedule.fbs_participant & schedule.season_type.eq('regular')].copy()
    schedule['_time'] = pd.to_datetime(schedule.start_date, utc=True)
    boxes = pd.concat(boxes, ignore_index=True)
    stats = {}
    for r in boxes.to_dict('records'):
        key = (int(r['game_id']), int(r['team_id']))
        if key in stats:
            raise ValueError('Duplicate team box score.')
        stats[key] = box_stats(r)
    return schedule.sort_values('_time').to_dict('records'), stats, quotes, sources


def feature_rows(games, boxes, quotes, asof):
    previous = {}; rows = []; upcoming = []; missing = 0
    for g in games:
        if int(g['season']) not in [2022, 2023, 2024, 2026]:
            continue
        kickoff = g['_time'].to_pydatetime()
        season = int(g['season']); gid = int(g['game_id'])
        home, away = int(g['home_id']), int(g['away_id'])
        # The immediate previous game counts, even if its box score is missing.
        # Do not jump backward to an older qualifying game or across seasons.
        h, a = previous.get((season, home)), previous.get((season, away))
        available = lambda r: r is not None and r['available'] < min(kickoff, asof)
        hflag = bool(available(h) and h['fbsBoth'] and h['statsValid'] and h['qualifies'])
        aflag = bool(available(a) and a['fbsBoth'] and a['statsValid'] and a['qualifies'])
        row = dict(gameId=str(gid), season=season, week=int(g['week']), kickoff=g['start_date'], homeTeam=g['home_team'], awayTeam=g['away_team'], homeId=home, awayId=away,
            neutral=bool(g['neutral_site']), homeFlag=hflag, awayFlag=aflag,
            priorStatsKnown=bool(available(h) and available(a) and h['statsValid'] and a['statsValid']),
            homePrevious=None if not h else {k: v for k, v in h.items() if k != 'available'}, awayPrevious=None if not a else {k: v for k, v in a.items() if k != 'available'},
            market=quotes.get(gid))
        if g['fbs_game']:
            if g['completed'] and kickoff+timedelta(hours=24) < asof and season <= 2024:
                row['actual'] = float(g['home_points']-g['away_points']); row['_time'] = kickoff
                rows.append(row)
                missing += int(row['market'] is None)
            elif season == 2026 and kickoff >= asof and kickoff < asof+timedelta(days=8):
                upcoming.append(row)
        if not g['completed'] or kickoff >= asof:
            continue
        hs, aws = boxes.get((gid, home)), boxes.get((gid, away))
        valid = hs is not None and aws is not None and kickoff+timedelta(hours=24) < asof
        for team, sign in [(home, 1), (away, -1)]:
            margin = sign*float(g['home_points']-g['away_points'])
            to = sign*(aws['turnovers']-hs['turnovers']) if valid else None
            ypp = sign*(hs['ypp']-aws['ypp']) if valid else None
            previous[(season, team)] = dict(gameId=str(gid), opponent=g['away_team'] if sign == 1 else g['home_team'], margin=margin, turnoverMargin=to, yppDifference=ypp,
                statsValid=valid, fbsBoth=bool(g['fbs_game']), qualifies=bool(valid and trigger(margin, to, ypp)), available=kickoff+timedelta(hours=24))
    return rows, upcoming, missing


def fit_predict(train, test, with_signal):
    teams = sorted({r[k] for r in train for k in ['homeId', 'awayId']})
    ids = {t: i for i, t in enumerate(teams)}
    def design(rows):
        x = np.zeros((len(rows), len(teams)+1+int(with_signal)))
        for i, r in enumerate(rows):
            if r['homeId'] in ids: x[i, ids[r['homeId']]] = 1
            if r['awayId'] in ids: x[i, ids[r['awayId']]] = -1
            x[i, len(teams)] = int(not r['neutral'])
            if with_signal: x[i, -1] = int(r['homeFlag'])-int(r['awayFlag'])
        return x
    x, xt = design(train), design(test)
    cutoff = min(r['_time'] for r in test)
    w = np.array([2**(-(cutoff-r['_time']).days/365) for r in train])
    y = np.array([r['actual'] for r in train])
    # Ratings: 5 game-equivalent prior; flag effect: 20-game prior, no grid search.
    penalty = np.full(x.shape[1], 5.); penalty[len(teams)] = 1.
    if with_signal: penalty[-1] = 20.
    beta = np.linalg.solve(x.T@(w[:, None]*x)+np.diag(penalty), x.T@(w*y))
    return xt@beta, float(beta[-1]) if with_signal else None


def predict(rows):
    results = []
    # Weekly Monday freeze prevents current-week outcomes leaking into peers.
    for r in rows:
        t = r['_time']; r['_freeze'] = (t-timedelta(days=t.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    for cutoff in sorted({r['_freeze'] for r in rows if r['season'] in [2023, 2024]}):
        train = [r for r in rows if cutoff-timedelta(days=730) <= r['_time'] and r['_time']+timedelta(hours=24) < cutoff]
        test = [r for r in rows if r['_freeze'] == cutoff and r['season'] in [2023, 2024]]
        if len(train) < 100: continue
        base, _ = fit_predict(train, test, False); signal, coef = fit_predict(train, test, True)
        for i, r in enumerate(test):
            out = {k: v for k, v in r.items() if not k.startswith('_')}
            out.update(baseline=float(base[i]), model=float(signal[i]), learnedFlagEffect=coef, block=cutoff.isoformat())
            results.append(out)
    return results


def bets(rows):
    selected = []
    for r in rows:
        if not r['priorStatsKnown'] or r['homeFlag'] == r['awayFlag'] or r['market'] is None: continue
        sign = -1 if r['homeFlag'] else 1
        selected.append(dict(r, faded=r['homeTeam'] if r['homeFlag'] else r['awayTeam'], selected=r['awayTeam'] if r['homeFlag'] else r['homeTeam'], coverMargin=sign*(r['actual']-r['market']), modelEdge=sign*(r['model']-r['market'])))
    return selected


def metrics(rows):
    selected = bets(rows); errors = [r['coverMargin'] for r in selected]
    wins = sum(e > 0 for e in errors); losses = sum(e < 0 for e in errors)
    net = [100/110 if e > 0 else -1. if e < 0 else 0. for e in errors]
    return dict(games=len(rows), qualifiers=len(selected), wins=wins, losses=losses, pushes=len(errors)-wins-losses, coverRate=wins/(wins+losses) if wins+losses else None,
        hypotheticalRoi110=float(np.mean(net)) if net else None, hypotheticalRoiInterval=interval(net, [r['block'] for r in selected], 1),
        baselineMae=float(np.mean([abs(r['actual']-r['baseline']) for r in rows])), modelMae=float(np.mean([abs(r['actual']-r['model']) for r in rows])),
        meanCoverMargin=float(np.mean(errors)) if errors else None, coverMarginInterval=interval(errors, [r['block'] for r in selected], 1))


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--cache', type=Path, required=True); p.add_argument('--output', type=Path, default=Path('public/football/college-turnovers.json')); args = p.parse_args()
    asof = datetime.now(timezone.utc)
    games, boxes, quotes, sources = load(args.cache)
    rows, upcoming, missing = feature_rows(games, boxes, quotes, asof)
    results = predict(rows)
    selected = bets(results)
    future = []
    for r in upcoming:
        if not r['priorStatsKnown'] or r['homeFlag'] == r['awayFlag']: continue
        future.append(dict(r, faded=r['homeTeam'] if r['homeFlag'] else r['awayTeam'], selected=r['awayTeam'] if r['homeFlag'] else r['homeTeam'], status='Research flag only — current price and lineup not verified'))
    summary = metrics(results)
    tomorrow = (asof.astimezone(ZoneInfo('America/New_York'))+timedelta(days=1)).date().isoformat()
    tomorrow_rows = [r for r in upcoming if datetime.fromisoformat(r['kickoff'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).date().isoformat() == tomorrow]
    changes = [abs(r['model']-r['actual'])-abs(r['baseline']-r['actual']) for r in results]
    output = dict(version=1, generatedAt=asof.isoformat(), hypothesis='Fade turnover-inflated blowout winners in their next game', thresholds=dict(winMargin=21, turnoverMargin=3, maxYppAdvantage=1),
        scope='FBS versus FBS regular-season prior and target games; same season; immediate previous game only', holdoutEvaluated=False, evaluatedSeasons=[2023, 2024], trainingSeasons=[2022, 2023, 2024],
        sources=sources, summary=summary, periods=[dict(season=y, **metrics([r for r in results if r['season'] == y])) for y in [2023, 2024]], maeDelta=float(np.mean(changes)), maeDeltaInterval=interval(changes, [r['block'] for r in results], 2),
        missingMarketGames=sum(r['market'] is None for r in results), qualifyingGames=selected, upcoming=future,
        upcomingCoverage=dict(games=len(upcoming), bothPriorStatsKnown=sum(r['priorStatsKnown'] for r in upcoming), horizonDays=8, targetDate=tomorrow, tomorrowGames=len(tomorrow_rows), tomorrowKnown=sum(r['priorStatsKnown'] for r in tomorrow_rows)),
        limitations=['Archived DraftKings spread values have no quote timestamps or spread-side prices. ROI assumes −110 solely for illustration; actual price-required profitability cannot be tested from this archive.', 'The trigger uses full-game box-score YPP: total yards / (rushing attempts + pass attempts), including sacks in NCAA rushing totals. This is not garbage-time-adjusted efficiency or a causal measure of turnover luck.', 'All thresholds were fixed from the supplied hypothesis. The model is a simple opponent-adjusted margin baseline with a jointly learned, shrunk flag coefficient; no parameter search.', '2023–2024 results are development evidence. No 2025 outcomes are evaluated. 2026 flags are prospective screens, not trained live predictions or confirmed selections.', 'Missing or inconsistent prior box scores make the flag unknown, never a reason to search backward to an older qualifying game. Historical source corrections and sparse signals limit inference.', 'Only FBS-v-FBS regular-season games are in the primary study. FCS mismatches, bowls, and cross-season follow-ups are excluded. Weekly-block intervals do not cover all prior project searches.'])
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False)+'\n')
    print(json.dumps(dict(summary=summary, periods=output['periods'], upcoming=future), indent=2))


if __name__ == '__main__': main()
