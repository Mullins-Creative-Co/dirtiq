from __future__ import annotations

import math
import hashlib
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List
import pandas as pd

from .feed import LEAGUES, feed_url, normalize, stamp, iso, team_code
from .projection import project
from .impact import TOTAL_VERSION, VERSION, games_from_boxes, fit, baseline, team_scenario
from ..teams.adapters.common import download

ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'public/data/availability'
RELEASE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_{season}.parquet'
POLICY=('Experimental player/minute associations, not causal injury values or calibrated betting adjustments. '
        'Recent five-game rotation is the reference; existing absences are not charged twice. '
        'Uncertain statuses get play/out scenarios, not assigned probabilities. '
        'Replacement minutes are redistributed among recent participants up to 48 each; announced starters/minute limits are not verified. '
        'Missing reports never mean healthy. A separate experimental injury-adjusted spread/total projection applies listed-out replacement changes when supported. Baseline probabilities, leans, locked cards and stakes stay unchanged.')


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload,indent=1,allow_nan=False)+'\n');tmp.replace(path)


def fetch(url: str) -> Dict[str,Any]:
    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (dirtiq-availability)'})
    with urllib.request.urlopen(request,timeout=15) as response:
        data=json.loads(response.read())
    if not isinstance(data,dict) or data.get('status')!='success' or not isinstance(data.get('injuries'),list):
        raise ValueError('Unexpected injury feed shape')
    return data


def nba_data(cache: Path, now: datetime):
    season=now.year+1 if now.month>=10 else now.year
    frames=[];sources=[]
    for year in range(season-2,season+1):
        path=cache/'nba'/('player_box_%s.parquet'%year)
        sidecar=path.with_suffix(path.suffix+'.meta.json')
        old=json.loads(sidecar.read_text()) if sidecar.exists() else {}
        retrieved=stamp(old.get('retrievedAt'))
        refresh=year==season and (retrieved is None or now-retrieved>timedelta(hours=1))
        sources.append(download(RELEASE.format(season=year),path,refresh=refresh))
        frames.append(pd.read_parquet(path))
    games=games_from_boxes(pd.concat(frames,ignore_index=True),now)
    model=fit(games,now)
    model['sourceHash']=hashlib.sha256('|'.join(s['sha256'] for s in sources).encode()).hexdigest()
    metadata={k:v for k,v in model.items() if k not in ('coefficients','totalCoefficients','minutes','appearances')}
    metadata['sources']=[{k:s[k] for k in ('url','sha256','retrievedAt')} for s in sources]
    metadata['validation']={'evaluatedInjuryGames':0,'promoted':False,'reason':'Timestamped injury evaluation starts with collected snapshots; historical target-game injuries are not inferred from box scores.'}
    return games,model,metadata


def build_games(reports: Dict[str,Any],feeds: Dict[str,Any],games: List[Dict[str,Any]],model,now: datetime) -> List[Dict[str,Any]]:
    result=[]
    for sport in LEAGUES:
        feed=feeds[sport]
        teams={t['team']:t for t in feed['teams'] if t.get('team')}
        rows=sorted((r for r in (reports.get(sport) or {}).get('upcoming',[]) if stamp(r.get('startsAt')) and stamp(r['startsAt'])>now),key=lambda r:(r['startsAt'],str(r['gameId'])))
        seen=set()
        for g in rows:
            # A generic team status is scoped to its NEXT game, never the whole week.
            home,away=team_code(sport,g['home']),team_code(sport,g['away'])
            if home in seen and away in seen: continue
            start=stamp(g['startsAt'])
            if start>now+timedelta(days=7 if sport in ('nfl','ncaaf') else 2): continue
            contexts={}
            for side,code in [('home',home),('away',away)]:
                team=teams.get(code)
                covered=code not in seen and feed['coverage']!='unavailable' and team is not None
                if not covered:
                    contexts[side]={'team':g[side],'name':g[side],'coverage':'unknown','reason':feed.get('reason') or 'No report for this team/game; do not assume healthy.',
                                    'players':[],'points':None,'outMinutes':None,'uncertainMinutes':None,'qbFlag':False}
                    continue
                if sport=='nba':
                    value=team_scenario(baseline(games,team['teamId'],now),team['players'],model)
                else:
                    value={'coverage':'listed','players':team['players'],'points':None,'outMinutes':None,'uncertainMinutes':None,
                           'reason':'Player status flags only: no validated player-to-spread conversion for this league.'}
                contexts[side]={**value,'team':g[side],'name':team['name'],'qbFlag':team['qbFlag']}
            seen.update((home,away))
            point_range=None
            h,a=contexts['home'].get('points'),contexts['away'].get('points')
            if h is not None and a is not None:
                changes=[h['min']-a['max'],h['max']-a['min']]
                point_range={'min':round(min(changes),3),'max':round(max(changes),3),
                             'listedOut':round(h['listedOut']-a['listedOut'],3)}
            total_range=None
            ht,at=contexts['home'].get('totalPoints'),contexts['away'].get('totalPoints')
            if ht is not None and at is not None:
                total_range={k:round(ht[k]+at[k],3) for k in ('min','max','listedOut')}
            result.append({'id':sport+':'+str(g['gameId']),'sport':sport,'gameId':str(g['gameId']),
                           'home':g['home'],'away':g['away'],'startsAt':g['startsAt'],'asOf':iso(now),
                           'baselineHomeMargin':g.get('projectedHomeMargin'),'baselineTotal':g.get('projectedTotal'),
                           'marketTotal':g.get('marketTotal'),'totalChange':total_range,'totalModelVersion':TOTAL_VERSION,'baselineForecastAt':reports[sport].get('forecastGeneratedAt') or reports[sport].get('generatedAt'),
                           'marketHomeMargin':-g['marketHomeSpread'] if isinstance(g.get('marketHomeSpread'),(int,float)) and math.isfinite(g['marketHomeSpread']) and abs(g['marketHomeSpread'])<100 else None,
                           'marketObservedAt':g.get('lineObservedAt'),'book':g.get('book'),'homeMarginChange':point_range,
                           'sourceUrl':feed['sourceUrl'],'contexts':contexts,'appliedToBaselineForecast':False,'appliedToForecast':False})
    return result


def evaluate_history(observations: List[Dict[str,Any]], results: Dict[str,Any], total: bool=False) -> Dict[str,Any]:
    selected={}
    baseline_key='baselineTotal' if total else 'baselineHomeMargin'
    change_key='totalChange' if total else 'homeMarginChange'
    market_key='marketTotal' if total else 'marketHomeMargin'
    for row in observations:
        if row.get('modelVersion') != VERSION or (total and row.get('totalModelVersion')!=TOTAL_VERSION): continue
        observed,start=stamp(row.get('asOf')),stamp(row.get('startsAt'))
        trained=stamp(row.get('modelTrainedThrough')); baseline_at=stamp(row.get('baselineForecastAt'))
        if observed is None or start is None or trained is None or trained>=observed or baseline_at is None or baseline_at>observed or observed>start-timedelta(hours=1): continue
        if not row.get(change_key) or row.get(baseline_key) is None: continue
        if row['id'] not in selected or row['asOf']>selected[row['id']]['asOf']: selected[row['id']]=row
    errors=[]; priced=[]
    for key,row in selected.items():
        actual=results.get(key)
        if actual is None: continue
        change=row[change_key]
        pair=(abs(row[baseline_key]-actual),abs(row[baseline_key]+change['listedOut']-actual))
        errors.append(pair)
        quote=stamp(row.get('marketObservedAt')); observed=stamp(row['asOf'])
        market=row.get(market_key)
        if isinstance(market,(int,float)) and math.isfinite(market) and quote is not None and timedelta(0)<=observed-quote<=timedelta(hours=3):
            priced.append((*pair,abs(market-actual)))
    return {'pricedGames':len(priced),'baselineMaeOnPricedGames':sum(x[0] for x in priced)/len(priced) if priced else None,
            'listedOutScenarioMaeOnPricedGames':sum(x[1] for x in priced)/len(priced) if priced else None,
            'marketMae':sum(x[2] for x in priced)/len(priced) if priced else None,
            'games':len(errors),'baselineMae':sum(x[0] for x in errors)/len(errors) if errors else None,
            'listedOutScenarioMae':sum(x[1] for x in errors)/len(errors) if errors else None,
            'promoted':False,'policy':'Latest snapshot at least one hour before start, same games, no retrospective injury backfill; at least 100 paired games required before considering a separately reviewed model change.'}


def refresh(cache: Path, output: Path=OUTPUT, now=None) -> Dict[str,Any]:
    fixed_clock=now is not None
    now=now or datetime.now(timezone.utc);feeds={};failures=[]
    def collect(sport):
        try:
            raw=fetch(feed_url(sport))
            # Immutable raw evidence outside the deploy bundle; normalized game observations persist in git.
            retrieved=now if fixed_clock else datetime.now(timezone.utc)
            digest=hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest()
            raw_path=cache/'raw'/sport/(retrieved.strftime('%Y%m%dT%H%M%SZ')+'_'+digest[:12]+'.json')
            if not raw_path.exists(): write_json(raw_path,raw)
            data=normalize(sport,raw,retrieved)
            data['sourceHash']=digest
            return sport,data,None
        except Exception as exc:
            return sport,{'sport':sport,'coverage':'unavailable','teams':[],'listedPlayers':0,'recentPlayers':0,
                          'reason':str(exc),'sourceUrl':feed_url(sport),'retrievedAt':iso(now)},str(exc)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for sport,data,error in pool.map(collect,LEAGUES):
            feeds[sport]=data
            if error: failures.append(sport+': '+error)
    games=[];model=None;metadata=None
    try:
        games,model,metadata=nba_data(cache,now)
    except Exception as exc:
        failures.append('NBA valuation: '+str(exc))
    reports={}
    for sport in LEAGUES:
        path=ROOT/'public/sports'/(sport+'.json')
        reports[sport]=json.loads(path.read_text()) if path.exists() else {}
    # Observation time is after all sources and the fit were actually available.
    now=now if fixed_clock else datetime.now(timezone.utc)
    contexts=build_games(reports,feeds,games,model,now)
    for context in contexts:
        context['injuryAdjustedProjection']=project(context,metadata,now)
        context['appliedToForecast']=context['injuryAdjustedProjection']['status']=='applied'
    day=output/'history'/(now.strftime('%Y-%m-%d')+'.json')
    history=json.loads(day.read_text()) if day.exists() else {'observations':[]}
    history.setdefault('feeds',[])
    if not any(r['asOf']==iso(now) for r in history['feeds']):
        history['feeds'].append({'asOf':iso(now),'sports':{sport:{
            'coverage':feed['coverage'],'sourceHash':feed.get('sourceHash'),
            'sourcePublishedAt':feed.get('sourcePublishedAt'),
            'players':[dict(teamId=t['teamId'],team=t['team'],**{k:p.get(k) for k in
                ('athleteId','name','position','category','status','publishedAt','stale')})
                for t in feed['teams'] for p in t['players']]}
            for sport,feed in feeds.items()}})
    existing={(r['id'],r['asOf']) for r in history['observations']}
    for row in contexts:
        if row['sport']!='nba' or (row['id'],row['asOf']) in existing: continue
        observation={**row,'modelVersion':VERSION,'modelSourceHash':metadata.get('sourceHash') if metadata else None,
                     'modelTrainedThrough':metadata.get('trainedThrough') if metadata else None,
                     'feedSourceHash':feeds['nba'].get('sourceHash')}
        history['observations'].append(observation)
    write_json(day,history)
    all_observations=[]
    for path in sorted((output/'history').glob('*.json')):
        all_observations.extend(json.loads(path.read_text()).get('observations',[]))
    actual={};actual_totals={}
    path=ROOT/'public/data/results/nba.json'
    for row in (json.loads(path.read_text()).get('games',[]) if path.exists() else []):
        if row.get('homeScore') is not None and row.get('awayScore') is not None:
            actual[row['eventId']]=row['homeScore']-row['awayScore']
            actual_totals[row['eventId']]=row['homeScore']+row['awayScore']
    evaluation=evaluate_history(all_observations,actual)
    total_evaluation=evaluate_history(all_observations,actual_totals,total=True)
    for context in contexts:
        context['injuryAdjustedProjection']['validation']={
            'marginGames':evaluation['games'],'baselineMae':evaluation['baselineMae'],
            'adjustedMae':evaluation['listedOutScenarioMae'],'totalGames':total_evaluation['games']}
    if metadata is not None:
        metadata['validation']['evaluatedInjuryGames']=evaluation['games']
    report={'generatedAt':iso(now),'policy':POLICY,'feeds':feeds,'model':metadata,'games':contexts,
            'evaluation':evaluation,'totalEvaluation':total_evaluation,'failures':failures}
    write_json(output/'latest.json',report)
    print('Availability:',len(contexts),'next-game contexts;',sum(r['homeMarginChange'] is not None for r in contexts),'NBA valued scenarios;',len(failures),'errors')
    return report
