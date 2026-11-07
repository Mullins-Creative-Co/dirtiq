"""Three-model pricing-error experiment. Final 2025 half is never evaluated."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np

from decomposition import construct_features, load_observations, profit
from overlap_audit import development, dt, interval, ridge


def starter_manifest(records, history):
    games = {r['game_id']:r for r in history if development(r)}
    final = {r['game_id'] for r in history if not development(r)}
    accepted = {}; late = 0
    for r in records:
        gid = r.get('gameId')
        if gid in final: continue
        if gid not in games: raise ValueError('Starter record has an unknown development game.')
        game = games[gid]
        if r.get('team') not in [game['home_team'], game['away_team']] or not isinstance(r.get('qbId'), str) or not r['qbId'].strip(): raise ValueError('Invalid starter team or QB identifier.')
        if not isinstance(r.get('source'), str) or not r['source'].startswith('https://'): raise ValueError('Starter designation requires an HTTPS provenance source.')
        published, observed = dt(r['publishedAt']), dt(r['observedAt'])
        if observed < published: raise ValueError('Observation cannot precede publication.')
        if max(published, observed) > dt(game['feature_asof']):
            late += 1; continue
        key = (gid, r['team'])
        if key not in accepted or observed > dt(accepted[key]['observedAt']): accepted[key] = r
    expected = {}
    for (gid, team), r in accepted.items(): expected.setdefault(gid, {})[team] = r['qbId']
    complete = {gid for gid, teams in expected.items() if len(teams) == 2}
    return expected, complete, dict(records=len(records), acceptedSides=len(accepted), completeGames=len(complete), lateRecords=late,
        status='Source-referenced designations supplied; provenance still requires review.' if accepted else 'No source-referenced pregame starter records supplied. Confirmed-starter test not run.')


def implied(price): return 100/(100+price) if price > 0 else abs(price)/(100+abs(price))


def evaluate(rows):
    rows = sorted((r for r in rows if development(r)), key=lambda r:r['kickoff'])
    forecasts = {k:[] for k in ['market','independent','correction']}
    for cutoff_string in sorted({r['feature_asof'] for r in rows if r['season'] >= 2022}):
        cutoff = dt(cutoff_string)
        train = [r for r in rows if dt(r['completed_at']) < cutoff and 0 < (cutoff-dt(r['kickoff'])).total_seconds() <= 730*86400]
        test = [r for r in rows if r['feature_asof'] == cutoff_string]
        if len(train) < 80: continue
        x = np.array([r['components'] for r in train]); xt = np.array([r['components'] for r in test])
        y = np.array([r['home_margin'] for r in train]); market_train = np.array([r['market_home_margin'] for r in train])
        weights = np.array([2**(-(cutoff-dt(r['kickoff'])).days/365) for r in train])
        independent = ridge(x,y,weights,20.)(xt)
        correction = ridge(x,y-market_train,weights,20.)(xt)
        for model in forecasts:
            past = [r for r in forecasts[model] if dt(r['available']) < cutoff and 0 < (cutoff-dt(r['kickoff'])).days <= 730]
            errors = [r['actual']-r['prediction'] for r in past]
            for i,g in enumerate(test):
                market = g['market_home_margin']
                pred = market if model == 'market' else float(independent[i]) if model == 'independent' else market+float(correction[i])
                p = None
                if model == 'market':
                    home, away = implied(g['home_odds']), implied(g['away_odds']); p = home/(home+away)
                elif len(errors) >= 100:
                    # Empirical calibration uses strictly prior OOS forecast errors.
                    p = (sum(e > market-pred for e in errors)+1)/(len(errors)+2)
                h,a = g['home'],g['away']
                qualifies = lambda r:.25 <= r['qbPercentile'] <= .75 and r['supportPercentile'] >= .75
                forecasts[model].append(dict(gameId=g['game_id'],season=g['season'],week=g['week'],kickoff=g['kickoff'],available=g['completed_at'],block=cutoff_string,
                    actual=g['home_margin'],market=market,prediction=pred,homeCoverProbability=p,homeOdds=g['home_odds'],awayOdds=g['away_odds'],
                    supportGroup=qualifies(h) != qualifies(a)))
    return {k:[r for r in v if r['season'] >= 2023] for k,v in forecasts.items()}


def summarize(rows, model):
    picked = []
    if model != 'market':
        for r in rows:
            edge = r['prediction']-r['market']
            if abs(edge) < 2: continue
            error = np.sign(edge)*(r['actual']-r['market']); odds=r['homeOdds'] if edge > 0 else r['awayOdds']
            picked.append(dict(r,error=float(error),units=profit(odds) if error>0 else -1. if error<0 else 0.))
    wins=sum(r['error']>0 for r in picked); losses=sum(r['error']<0 for r in picked)
    prob=[r for r in rows if r['homeCoverProbability'] is not None and r['actual'] != r['market']]
    return dict(games=len(rows),mae=float(np.mean([abs(r['prediction']-r['actual']) for r in rows])) if rows else None,
        bets=len(picked),wins=wins,losses=losses,pushes=len(picked)-wins-losses,coverRate=wins/(wins+losses) if wins+losses else None,
        roi=float(np.mean([r['units'] for r in picked])) if picked else None,
        roiInterval=interval([r['units'] for r in picked],[r['block'] for r in picked],2),
        probabilityGames=len(prob),brier=float(np.mean([(r['homeCoverProbability']-int(r['actual']>r['market']))**2 for r in prob])) if prob else None,
        calibration=[dict(low=lo,high=hi,games=len(bucket),predicted=float(np.mean([r['homeCoverProbability'] for r in bucket])) if bucket else None,observed=float(np.mean([r['actual']>r['market'] for r in bucket])) if bucket else None) for lo,hi in [(0,.4),(.4,.5),(.5,.6),(.6,1.01)] for bucket in [[r for r in prob if lo<=r['homeCoverProbability']<hi]]])


def report(forecasts, complete):
    reports=[]
    market=forecasts['market']
    for name,rows in forecasts.items():
        delta=[abs(r['prediction']-r['actual'])-abs(m['prediction']-m['actual']) for r,m in zip(rows,market)]
        reports.append(dict(id=name,**summarize(rows,name),maeDelta=float(np.mean(delta)) if delta else None,
            maeDeltaInterval=interval(delta,[r['block'] for r in rows],2),
            periods=[dict(season=y,**summarize([r for r in rows if r['season']==y],name)) for y in [2023,2024,2025]],
            supportingTeamGroup=summarize([r for r in rows if r['supportGroup']],name),
            confirmed=summarize([r for r in rows if r['gameId'] in complete],name),firstPredictions=rows[:3]))
    return reports


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);p.add_argument('--starters',type=Path,default=Path('scripts/football/confirmed-starters.json'));p.add_argument('--output',type=Path,default=Path('public/football/pricing-error.json'));args=p.parse_args()
    history=json.loads(Path('public/football/history.json').read_text())['games'];records=json.loads(args.starters.read_text())
    expected,complete,coverage=starter_manifest(records,history)
    obs,_=load_observations(args.cache)
    rows=construct_features(history,obs,400.,expected)
    forecasts=evaluate(rows)
    data=dict(version=1,generatedAt=datetime.now(timezone.utc).isoformat(),holdoutEvaluated=False,starterCoverage=coverage,
        settings=dict(qbPrior=400,marginRidge=20,lookbackDays=730,weightHalfLifeDays=365,edgeThresholdPoints=2,minimumPriorErrors=100),
        reports=report(forecasts,complete),
        limitations=['Primary report uses QB proxies wherever timely sourced designations are missing. It is not a confirmed-starter test.', 'Confirmed designations must be published and observed by the frozen feature timestamp. Later news is excluded, never backdated. Unknown QBs shrink to zero effect rather than borrowing future performance.', 'The pricing-error model learns actual margin minus archived market margin from earlier games, then adds only that learned correction to the target line. No manual full-QB penalty is added.', 'Market cover probabilities remove vig from paired archived prices. Model probabilities use empirical errors from strictly earlier out-of-sample forecasts; they are development estimates, not validated live probabilities.', 'The two-point selection rule is fixed. Archived lines and prices are not timestamp-synchronized with the feature snapshot; returns are hypothetical, not verified executable profit.', 'The supporting-team cohort was already inspected in development. Its new results are diagnostics, not another independent discovery or an untouched validation.', '2025 week 10 onward is excluded before feature construction, fitting, calibration, and reporting. No final holdout has been evaluated.'])
    args.output.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
    print(json.dumps([dict(id=r['id'],games=r['games'],mae=r['mae'],bets=r['bets'],coverRate=r['coverRate'],roi=r['roi'],brier=r['brier']) for r in data['reports']],indent=2))


if __name__=='__main__':main()
