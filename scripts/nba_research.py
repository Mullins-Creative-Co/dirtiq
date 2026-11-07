"""Independent NBA walk-forward development study; no 2024-25+ outcomes loaded."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

MODELS = [('strength', []), ('rest', ['rest', 'b2b', 'threeInFour']),
          ('efficiency', ['rest', 'b2b', 'threeInFour', 'netEfficiency', 'efg', 'turnoverRate', 'offReboundRate', 'ftRate']),
          ('rotation', ['rest', 'b2b', 'threeInFour', 'netEfficiency', 'efg', 'turnoverRate', 'offReboundRate', 'ftRate', 'rotationChange', 'rotationUnknown'])]


def interval(values, blocks):
    if not values or len(set(blocks)) < 2: return None
    keys = sorted(set(blocks)); grouped = np.array([(sum(v for v, b in zip(values, blocks) if b == k), blocks.count(k)) for k in keys])
    rng = np.random.default_rng(1609); ids = rng.integers(0, len(keys), size=(4000, len(keys)))
    draws = grouped[ids, 0].sum(axis=1)/grouped[ids, 1].sum(axis=1)
    # Three paired model additions; approximate family-adjusted weekly blocks.
    return [float(v) for v in np.quantile(draws, [.05/6, 1-.05/6])]


def box_rates(h, a):
    def possession(r): return r['field_goals_attempted']+.44*r['free_throws_attempted']-r['offensive_rebounds']+r['total_turnovers']
    poss = (possession(h)+possession(a))/2
    if not np.isfinite(poss) or not 60 < poss < 180: return None
    def rates(r, opp):
        fga = r['field_goals_attempted']; opportunities = r['offensive_rebounds']+opp['defensive_rebounds']
        if fga <= 0 or opportunities <= 0: return None
        result = dict(netEfficiency=100*(r['team_score']-opp['team_score'])/poss, efg=(r['field_goals_made']+.5*r['three_point_field_goals_made'])/fga,
            turnoverRate=r['total_turnovers']/poss, offReboundRate=r['offensive_rebounds']/opportunities, ftRate=r['free_throw_pct']/100 * r['free_throws_attempted']/fga)
        return result if all(np.isfinite(v) for v in result.values()) else None
    return rates(h, a), rates(a, h)


def rotation_change(history):
    if len(history) < 3: return 0.
    last = history[-1]['rotation']; earlier = history[-11:-1]
    if not last or any(not r['rotation'] for r in earlier): return 0.
    weights = np.array([2**(-i/5) for i in reversed(range(len(earlier)))]); weights /= weights.sum()
    players = set(last) | {p for r in earlier for p in r['rotation']}
    return .5*sum(abs(last.get(p, 0.)-sum(w*r['rotation'].get(p, 0.) for w, r in zip(weights, earlier))) for p in players)


def team_features(history, cutoff):
    past = [r for r in history if cutoff-timedelta(days=730) <= r['available'] < cutoff]
    selected = [r for r in past if r['rates'] is not None][-40:]
    if len(selected) < 10: return None
    weights = np.array([2**(-i/10) for i in reversed(range(len(selected)))])
    rates = {k: float(np.average([r['rates'][k] for r in selected], weights=weights)) for k in selected[-1]['rates']}
    gap = (cutoff.astimezone(ZoneInfo('America/New_York')).date()-past[-1]['tip'].astimezone(ZoneInfo('America/New_York')).date()).days
    rates.update(rest=max(0, min(5, gap-1)), b2b=int(gap == 1), threeInFour=int(sum(cutoff-timedelta(days=3) <= r['tip'] for r in past) >= 2), rotationChange=rotation_change(past), rotationUnknown=int(len(past)<3 or any(not r['rotation'] for r in past[-11:])))
    return rates


def build_rows(schedule, boxes, players, spreads):
    history = {}; output = []
    for g in sorted((r for r in schedule if int(r['season']) <= 2024), key=lambda r: r['date']):
        if int(g['season_type']) != 2 or not g['status_type_completed'] or g['status_type_name'] != 'STATUS_FINAL': continue
        if int(g['home_id']) > 30 or int(g['away_id']) > 30 or 'Championship' in str(g.get('notes_headline', '')): continue
        gid, home, away = int(g['game_id']), int(g['home_id']), int(g['away_id'])
        tip = pd.Timestamp(g['date']).to_pydatetime(); cutoff = tip-timedelta(hours=1)
        h, a = team_features(history.get(home, []), cutoff), team_features(history.get(away, []), cutoff)
        if h is not None and a is not None:
            output.append(dict(gameId=str(gid), season=int(g['season']), tip=tip, cutoff=cutoff, available=tip+timedelta(hours=8), homeId=home, awayId=away, homeTeam=g['home_display_name'], awayTeam=g['away_display_name'], homeField=int(not g['neutral_site']), actual=float(g['home_score']-g['away_score']), market=spreads.get(gid), **{k:h[k]-a[k] for k in h}))
        hb, ab = boxes.get((gid, home)), boxes.get((gid, away))
        rates = box_rates(hb, ab) if hb and ab else None
        if rates is None: rates = (None, None)
        for team, r in [(home, rates[0]), (away, rates[1])]:
            rotation = players.get((gid, team), {})
            total = sum(rotation.values())
            normalized = {p: mins/total for p, mins in rotation.items()} if 220 <= total <= 350 else {}
            history.setdefault(team, []).append(dict(tip=tip, available=tip+timedelta(hours=8), rates=r, rotation=normalized))
    return output


def predict(train, test, context):
    teams = sorted({r[k] for r in train for k in ['homeId', 'awayId']}); ids = {t:i for i,t in enumerate(teams)}
    cutoff = min(r['cutoff'] for r in test)
    w = np.array([2**(-(cutoff-r['tip']).total_seconds()/86400/120) for r in train]); w /= w.mean()
    def design(rows):
        x = np.zeros((len(rows), len(teams)+1+len(context)))
        for i, r in enumerate(rows):
            x[i, ids[r['homeId']]] = 1.; x[i, ids[r['awayId']]] = -1.; x[i,len(teams)] = r['homeField']
            if context: x[i,len(teams)+1:] = [r[k] for k in context]
        return x
    x, xt = design(train), design(test); n = len(teams)+1
    if context:
        center = np.average(x[:, n:], axis=0, weights=w); sd = np.sqrt(np.average((x[:, n:]-center)**2, axis=0, weights=w)); sd = np.where(sd < 1e-10, 1., sd)
        # Do not center paired differences: zero difference retains its meaning.
        x[:, n:] /= sd; xt[:, n:] /= sd
    y = np.array([r['actual'] for r in train]); penalties = np.full(x.shape[1], 20.); penalties[:len(teams)] = 10.; penalties[len(teams)] = 1.
    beta = np.linalg.solve(x.T@(w[:,None]*x)+np.diag(penalties), x.T@(w*y))
    return xt@beta


def evaluate(rows):
    rows = [r for r in rows if r['season'] <= 2024]
    blocks = {}
    for r in rows:
        if r['season'] >= 2023:
            blocks.setdefault(r['tip'].astimezone(ZoneInfo('America/New_York')).date().isoformat(), []).append(r)
    predictions = {name:[] for name,_ in MODELS}
    for _, test in sorted(blocks.items()):
        cutoff = min(r['cutoff'] for r in test)
        train = [r for r in rows if cutoff-timedelta(days=730) <= r['tip'] and r['available'] < cutoff]
        if len(train) < 300: continue
        for name, context in MODELS:
            values = predict(train, test, context)
            # Calibration errors come only from earlier OUT-OF-SAMPLE forecasts.
            errors = [r['actual']-r['prediction'] for r in predictions[name] if r['available'] < cutoff and r['tip'] >= cutoff-timedelta(days=730)]
            for i, g in enumerate(test):
                p = None
                if g['market'] is not None and len(errors) >= 100:
                    p = (sum(e > g['market']-values[i] for e in errors)+1)/(len(errors)+2)
                predictions[name].append(dict(g, prediction=float(values[i]), homeCoverProbability=p, block=g['tip'].strftime('%G-W%V')))
    return predictions


def metrics(rows):
    quoted = [r for r in rows if r['market'] is not None]
    selected = [r for r in quoted if abs(r['prediction']-r['market']) >= 2.]
    outcomes = [np.sign(r['prediction']-r['market'])*(r['actual']-r['market']) for r in selected]
    wins = int(sum(v > 0 for v in outcomes)); losses = int(sum(v < 0 for v in outcomes))
    calibrated = [r for r in quoted if r['homeCoverProbability'] is not None and r['actual'] != r['market']]
    return dict(games=len(rows), quotedGames=len(quoted), mae=float(np.mean([abs(r['prediction']-r['actual']) for r in rows])), marketMae=float(np.mean([abs(r['market']-r['actual']) for r in quoted])) if quoted else None,
        selected=len(selected), wins=int(wins), losses=int(losses), pushes=len(selected)-wins-losses, coverRate=wins/(wins+losses) if wins+losses else None,
        hypotheticalRoi110=float(np.mean([100/110 if v>0 else -1. if v<0 else 0. for v in outcomes])) if outcomes else None,
        calibratedGames=len(calibrated), brier=float(np.mean([(r['homeCoverProbability']-int(r['actual']>r['market']))**2 for r in calibrated])) if calibrated else None)


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--cache',type=Path,required=True); p.add_argument('--output',type=Path,default=Path('public/nba/research.json')); args=p.parse_args()
    schedules=[]; boxes={}; players={}; sources=[]
    for year in [2022,2023,2024]:
        for tag,prefix in [('espn_nba_schedules','nba_schedule'),('espn_nba_team_boxscores','team_box'),('espn_nba_player_boxscores','player_box')]:
            path=args.cache/f'{prefix}_{year}.parquet'; frame=pd.read_parquet(path)
            sources.append(dict(url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{path.name}', sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
            if prefix=='nba_schedule': schedules.extend(frame.to_dict('records'))
            elif prefix=='team_box':
                for r in frame.to_dict('records'): boxes[(int(r['game_id']),int(r['team_id']))]=r
            else:
                for r in frame.to_dict('records'):
                    if pd.notna(r['minutes']) and r['minutes']>0: players.setdefault((int(r['game_id']),int(r['team_id'])),{})[int(r['athlete_id'])]=float(r['minutes'])
    path=args.cache/'play_by_play_2024.parquet'
    spread_frame=pd.read_parquet(path,columns=['game_id','home_team_spread','game_spread_available'])
    spreads={}
    for gid,group in spread_frame.groupby('game_id'):
        values=group.loc[group.game_spread_available.eq(True),'home_team_spread'].dropna().unique()
        if len(values)==1:spreads[int(gid)]=float(values[0])
    sources.append(dict(url='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_pbp/play_by_play_2024.parquet',sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    rows=build_rows(schedules,boxes,players,spreads); predicted=evaluate(rows); reports=[]
    for index,(name,context) in enumerate(MODELS):
        dev=[r for r in predicted[name] if r['season']==2024]
        parent=MODELS[max(0,index-1)][0]; comparator={r['gameId']:r for r in predicted[parent]}
        delta=[abs(r['prediction']-r['actual'])-abs(comparator[r['gameId']]['prediction']-r['actual']) for r in dev]
        reports.append(dict(id=name,features=context,**metrics(dev),maeDelta=float(np.mean(delta)),maeDeltaInterval=interval(delta,[r['block'] for r in dev]),
            examples=[dict(gameId=r['gameId'],home=r['homeTeam'],away=r['awayTeam'],prediction=r['prediction'],market=r['market'],actual=r['actual'],homeCoverProbability=r['homeCoverProbability']) for r in dev[:5]]))
    result=dict(version=1,generatedAt=datetime.now(timezone.utc).isoformat(),developmentSeason='2023–24 (ending 2024)',holdout='2024–25 and later',holdoutEvaluated=False,settings=dict(trainingDays=730,weightHalfLifeDays=120,minimumTrainingGames=300,edgeThreshold=2,minimumPriorTeamGames=10),sources=sources,reports=reports,
        limitations=['Historical spreads are processed ESPN/SportsDataverse values, not verified single-book executable quotes. No quote timestamps or side prices are provided; −110 ROI is illustrative only.', 'Lineup continuity uses only previous-game minutes compared with earlier rotations. It is not today’s injury report, expected minutes, or a causal player-impact estimate.', 'Current-season predictions are not enabled. A live model needs current data, timestamped injury reports, projected replacement minutes, and synchronized odds.', 'No full-season Win Shares is used: doing so during that season would leak future data. Win Shares is not directly convertible to a missing player’s spread impact.', 'Probabilities use empirical errors from strictly earlier out-of-sample predictions. Brier scores measure development calibration; these probabilities are not validated live cover probabilities.', 'Three feature additions and a fixed two-point selection rule were defined before this run. Weekly-block intervals are approximate; neither prior project searches nor every reported statistic are covered.'])
    args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(reports,indent=2))


if __name__=='__main__':main()
