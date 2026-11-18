"""NBA player/minute association model for scenarios, NOT causal injury point values.

Ridge on game margins: home field, team identities, observed player minutes/48.
Actual minutes only enter training games already available before the snapshot.
Today's scenarios change a lagged five-game rotation; they never use today's boxes.
The measured coefficients are confounded by teammates/role/garbage time. No headline,
probability, lean, bet or stake is changed by these experimental calculations.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from itertools import combinations
import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import lsqr

VERSION='nba-minute-ridge-v1'
LOOKBACK_DAYS=730
ROTATION_GAMES=5
MIN_ROTATION_GAMES=3
PLAYER_PENALTY=100.0
TEAM_PENALTY=10.0


def games_from_boxes(frame: pd.DataFrame, now: datetime) -> List[Dict[str,Any]]:
    p=frame.copy()
    p['tip']=pd.to_datetime(p.game_date_time,utc=True,errors='coerce')
    p=p[(p.tip+pd.Timedelta(hours=8)<pd.Timestamp(now)) & (p.tip>=pd.Timestamp(now)-pd.Timedelta(days=LOOKBACK_DAYS))
        & p.season_type.isin([2,3]) & p.team_id.between(1,30)]
    p['athlete_id']=pd.to_numeric(p.athlete_id,errors='coerce')
    invalid=set(p.loc[p.athlete_id.isna() & (pd.to_numeric(p.minutes,errors='coerce')>0),'game_id'])
    p=p[p.athlete_id.notna() & ~p.game_id.isin(invalid)]
    p=p.drop_duplicates(['game_id','team_id','athlete_id'],keep='last')
    games=[]
    for gid,rows in p.groupby('game_id',sort=False):
        sides={}
        for side in ('home','away'):
            r=rows[rows.home_away==side]
            if r.empty or r.team_id.nunique()!=1 or r.team_score.nunique()!=1: break
            mins=pd.to_numeric(r.minutes,errors='coerce').fillna(0).clip(lower=0)
            total=float(mins.sum()); score=float(r.team_score.iloc[0])
            if not np.isfinite(score) or not 220<=total<=400: break
            rotation={str(int(pid)):float(m)*240/total for pid,m in zip(r.athlete_id,mins) if m>0}
            sides[side]={'id':str(int(r.team_id.iloc[0])),'code':str(r.team_abbreviation.iloc[0]),
                         'rotation':rotation,'score':score,'names':dict(zip(r.athlete_id.astype(int).astype(str),r.athlete_display_name))}
        if len(sides)!=2: continue
        games.append({'gameId':str(int(gid)),'tip':rows.tip.iloc[0].to_pydatetime(),
                      'availableAt':(rows.tip.iloc[0]+pd.Timedelta(hours=8)).to_pydatetime(),
                      'season':int(rows.season.iloc[0]),'home':sides['home'],'away':sides['away']})
    return sorted(games,key=lambda g:(g['tip'],g['gameId']))


def fit(games: List[Dict[str,Any]], now: datetime) -> Dict[str,Any]:
    games=[g for g in games if g['availableAt']<now and g['tip']>=now-timedelta(days=LOOKBACK_DAYS)]
    if len(games)<500: raise ValueError('At least 500 eligible completed games are required for player associations')
    teams=sorted({g[s]['id'] for g in games for s in ('home','away')})
    players=sorted({p for g in games for s in ('home','away') for p in g[s]['rotation']})
    ti={p:i+1 for i,p in enumerate(teams)}; pi={p:i+1+len(teams) for i,p in enumerate(players)}
    rr=[]; cc=[]; vv=[]; y=[]; weights=[]; minutes={}; appearances={}
    for i,g in enumerate(games):
        rr.append(i);cc.append(0);vv.append(1.)
        y.append(g['home']['score']-g['away']['score'])
        weights.append(2**(-(now-g['tip']).total_seconds()/86400/120))
        for side,sign in [('home',1),('away',-1)]:
            team=g[side];rr.append(i);cc.append(ti[team['id']]);vv.append(sign)
            for p,m in team['rotation'].items():
                rr.append(i);cc.append(pi[p]);vv.append(sign*m/48)
                minutes[p]=minutes.get(p,0)+m;appearances[p]=appearances.get(p,0)+1
    x=sparse.csr_matrix((vv,(rr,cc)),shape=(len(games),1+len(teams)+len(players)))
    w=np.asarray(weights);w/=w.mean(); sw=np.sqrt(w)
    penalties=np.r_[1.,np.full(len(teams),TEAM_PENALTY),np.full(len(players),PLAYER_PENALTY)]
    design=sparse.vstack([x.multiply(sw[:,None]),sparse.diags(np.sqrt(penalties))],format='csr')
    result=lsqr(design,np.r_[np.asarray(y)*sw,np.zeros(len(penalties))],atol=1e-9,btol=1e-9,iter_lim=2000)
    if result[1] not in (1,2) or not np.isfinite(result[0]).all(): raise ValueError('Player association fit did not converge')
    return {'version':VERSION,'trainedThrough':max(g['availableAt'] for g in games).isoformat(),
            'trainingGames':len(games),'playerPenalty':PLAYER_PENALTY,'teamPenalty':TEAM_PENALTY,
            'coefficients':{p:float(result[0][pi[p]]) for p in players},'minutes':minutes,'appearances':appearances}


def baseline(games: List[Dict[str,Any]], team_id: str, now: datetime) -> Optional[Dict[str,Any]]:
    eligible=[g for g in games if g['availableAt']<now and g['tip']>=now-timedelta(days=21)
              and any(g[s]['id']==team_id for s in ('home','away'))][-ROTATION_GAMES:]
    if len(eligible)<MIN_ROTATION_GAMES: return None
    rotation={};last_played={};names={}
    for g in eligible:
        t=next(g[s] for s in ('home','away') if g[s]['id']==team_id)
        names.update(t['names'])
        for p,m in t['rotation'].items():
            rotation[p]=rotation.get(p,0)+m/len(eligible);last_played[p]=g['tip'].isoformat()
    return {'minutes':rotation,'games':len(eligible),'lastPlayed':last_played,'names':names,
            'through':eligible[-1]['availableAt'].isoformat()}


def redistribute(rotation: Dict[str,float], missing: set, eligible: Optional[set] = None) -> Optional[Dict[str,float]]:
    """Fixed scenario, not a learned/announced lineup. Conserve 240 minutes, cap 48.
    Remaining recent participants receive extra minutes in proportion to spare capacity.
    Fewer than five known available players means replacement capacity is unknown.
    """
    out={p:(0. if p in missing else m) for p,m in rotation.items()}
    present=[p for p in out if p not in missing and rotation[p]>0]
    available=[p for p in present if eligible is None or p in eligible]
    if len(present)<5 or not available: return None
    remaining=240-sum(out.values())
    for _ in range(len(available)+1):
        capacity={p:max(0.,48-out[p]) for p in available}
        total=sum(capacity.values())
        if remaining<=1e-7: return out
        if total<remaining-1e-7: return None
        for p,cap in capacity.items(): out[p]+=remaining*cap/total
        remaining=240-sum(out.values())
    return out if abs(sum(out.values())-240)<1e-5 else None


def team_scenario(base: Optional[Dict[str,Any]], players: List[Dict[str,Any]], model: Optional[Dict[str,Any]]) -> Dict[str,Any]:
    if base is None: return {'coverage':'unknown','reason':'Fewer than three recent complete team box scores','outMinutes':None,'uncertainMinutes':None,'points':None,'players':players}
    rotation=base['minutes']; confirmed=set(); uncertain=set(); listed=[]; unresolved=[]
    for original in players:
        p=dict(original);pid=p.get('athleteId');m=rotation.get(pid,0.)
        p['baselineMinutes']=round(m,1);p['impactPointsIfOut']=None
        last=base['lastPlayed'].get(pid)
        contradicted=p['category']=='out' and last is not None and pd.Timestamp(last)>pd.Timestamp(p['publishedAt'])
        p['contradictedByAppearance']=contradicted
        if p.get('stale') or p['category']=='unknown' or pid is None or contradicted:
            if m>0 or pid is None: unresolved.append(p['name'])
        elif p['category']=='out': confirmed.add(pid)
        elif p['category']=='uncertain': uncertain.add(pid)
        listed.append(p)
    confirmed_minutes=sum(rotation.get(p,0) for p in confirmed)
    uncertain_minutes=sum(rotation.get(p,0) for p in uncertain)
    def change(missing: set) -> Optional[float]:
        if model is None: return None
        eligible={p for p in rotation if model['appearances'].get(p,0)>=5 and model['minutes'].get(p,0)>=100}
        target=redistribute(rotation,missing,eligible)
        if target is None: return None
        moving=[p for p in rotation if abs(target[p]-rotation[p])>1e-7]
        if any(model['appearances'].get(p,0)<5 or model['minutes'].get(p,0)<100 for p in moving): return None
        return sum(model['coefficients'][p]*(target[p]-rotation[p])/48 for p in moving)
    points=None
    variable=sorted(p for p in uncertain if rotation.get(p,0)>0)
    if not unresolved and len(variable)<=8:
        values=[change(confirmed|set(subset)) for n in range(len(variable)+1) for subset in combinations(variable,n)]
        if all(v is not None for v in values):
            points={'listedOut':round(values[0],3),'allUncertainOut':round(values[-1],3),
                    'min':round(min(values),3),'max':round(max(values),3),'scenarios':len(values)}
    for p in listed:
        if p.get('athleteId') in confirmed|uncertain:
            v=change({p['athleteId']});p['impactPointsIfOut']=round(v,3) if v is not None else None
    return {'coverage':'partial' if unresolved or points is None else 'scenario',
            'reason':'Unresolved/stale identity or status: '+', '.join(unresolved) if unresolved else 'Insufficient player/replacement history or too many unresolved combinations.' if points is None else None,
            'baselineGames':base['games'],'baselineThrough':base['through'],
            'outMinutes':round(confirmed_minutes,1),'uncertainMinutes':round(uncertain_minutes,1),
            'points':points,'players':listed}
