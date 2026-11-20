"""One fixed market-residual candidate with strictly lagged possession states."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Dict

import numpy as np
import pandas as pd
from ..teams.totals import TotalsState

FEATURES=['eff_margin_gap','eff_total_gap','independent_gap','off_diff','def_diff','pace_gap',
          'rest_diff','rest_sum','home_b2b','away_b2b','neutral','min_games']


def lagged_features(games: pd.DataFrame) -> pd.DataFrame:
    teams: Dict[str,dict]={};last={};pending=deque();records=[]
    league_eff=110.;league_pace=100.;alpha=1-.5**(1/15)
    totals=TotalsState('nba')
    def team(code,season):
        if code not in teams:teams[code]=dict(off=league_eff,defense=league_eff,pace=league_pace,season=season,games=0)
        t=teams[code]
        if t['season']!=season:
            for key,center in [('off',league_eff),('defense',league_eff),('pace',league_pace)]:t[key]=center+.5**(season-t['season'])*(t[key]-center)
            t['season']=season;t['games']=0
        return t
    def update(r):
        nonlocal league_eff,league_pace
        h=team(r.home,int(r.season));a=team(r.away,int(r.season))
        he=r.home_eff-(h['off']+a['defense']-league_eff)
        ae=r.away_eff-(a['off']+h['defense']-league_eff)
        h['off']+=alpha*he/2;a['defense']+=alpha*he/2
        a['off']+=alpha*ae/2;h['defense']+=alpha*ae/2
        for t in (h,a):t['pace']+=alpha*(r.pace-t['pace']);t['games']+=1
        league_eff+=((r.home_eff+r.away_eff)/2-league_eff)/500
        league_pace+=(r.pace-league_pace)/500
        totals.update(r.home,r.away,int(r.season),r.home_score+r.away_score)
    for r in games.sort_values(['start','game_id']).itertuples(index=False):
        day=r.start.tz_convert('America/New_York').date()
        while pending and pending[0].available_at<r.start and pending[0].start.tz_convert('America/New_York').date()<day:
            update(pending.popleft())
        h=team(r.home,int(r.season));a=team(r.away,int(r.season))
        pace=(h['pace']+a['pace'])/2
        hp=pace*(h['off']+a['defense']-league_eff)/100
        ap=pace*(a['off']+h['defense']-league_eff)/100
        rest=[]
        for code in (r.home,r.away):
            prev=last.get((code,r.season));rest.append(min(7.,float((day-prev).days)) if prev is not None else 7.)
            last[(code,r.season)]=day
        records.append(dict(game_id=r.game_id,eff_margin=hp-ap,eff_total=hp+ap,off_diff=h['off']-a['off'],
            def_diff=h['defense']-a['defense'],pace_gap=pace-100,rest_diff=rest[0]-rest[1],rest_sum=sum(rest),
            home_b2b=float(rest[0]<=1),away_b2b=float(rest[1]<=1),neutral=r.neutral,min_games=min(20,h['games'],a['games']),
            baseline_total=totals.predict(r.home,r.away,int(r.season))))
        pending.append(r)
    return pd.DataFrame(records)


def design(frame: pd.DataFrame) -> np.ndarray:
    x=frame.copy()
    x['eff_margin_gap']=x.eff_margin+x.spread_line
    x['eff_total_gap']=x.eff_total-x.total_line
    x['independent_gap']=x.ind_mean+x.spread_line
    return x[FEATURES].to_numpy(dtype=float)


@dataclass
class Fit:
    mu: np.ndarray
    sd: np.ndarray
    coefficients: np.ndarray
    residuals: np.ndarray
    market: str
    trained_through: str
    calibrated_through: str

    def predict(self,frame):
        z=np.column_stack([(design(frame)-self.mu)/self.sd,np.ones(len(frame))])
        return frame.market_line.to_numpy()+np.einsum('ij,j->i',z,self.coefficients,optimize=False)


def fit(train: pd.DataFrame,calibration: pd.DataFrame,market: str):
    if len(train)<500 or len(calibration)<100:return None
    if train.season.max()>=calibration.season.min() or train.start.max()>=calibration.start.min():raise ValueError('Fit and calibration overlap')
    x=design(train)
    if not np.isfinite(x).all():raise ValueError('Nonfinite feature')
    mu=x.mean(axis=0);sd=x.std(axis=0);sd[sd<1e-9]=1.
    z=np.column_stack([(x-mu)/sd,np.ones(len(x))]);y=(train.actual-train.market_line).to_numpy()
    penalty=np.eye(z.shape[1])*100;penalty[-1,-1]=0
    b=np.linalg.solve(np.einsum('ni,nj->ij',z,z,optimize=False)+penalty,np.einsum('ni,n->i',z,y,optimize=False))
    model=Fit(mu,sd,b,np.array([]),market,train.start.max().isoformat(),calibration.start.max().isoformat())
    model.residuals=np.sort(calibration.actual.to_numpy()-model.predict(calibration))
    if not np.isfinite(model.residuals).all():raise ValueError('Nonfinite residual')
    return model


def probabilities(mean,line,residuals):
    residuals=np.sort(residuals)
    if not len(residuals):raise ValueError('Missing calibration')
    low=np.searchsorted(residuals,np.ceil(line)-.5-mean,side='left')/len(residuals)
    high=1-np.searchsorted(residuals,np.floor(line)+.5-mean,side='left')/len(residuals)
    return high,low,np.clip(1-high-low,0,1)
