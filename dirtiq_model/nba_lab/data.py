"""Audit historical team boxes and exact schedule/OOF joins before scoring."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd
from ..teams.adapters.nba import normalize_team

COUNTS=['field_goals_made','field_goals_attempted','three_point_field_goals_made',
        'three_point_field_goals_attempted','free_throws_made','free_throws_attempted',
        'offensive_rebounds','total_turnovers']


def source(path: Path) -> dict:
    meta=path.with_suffix(path.suffix+'.meta.json')
    info=json.loads(meta.read_text()) if meta.exists() else {}
    return {'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,
            'url':info.get('url'),'retrievedAt':info.get('retrievedAt')}


def prepare(box_cache: Path, schedule_cache: Path, predictions: Path, cutoff: pd.Timestamp) -> Tuple[pd.DataFrame,pd.DataFrame,dict]:
    boxes=[];schedules=[];sources=[source(predictions)]
    for season in range(2016,2028):
        bp=box_cache/('team_box_%s.parquet'%season);sp=schedule_cache/('nba_schedule_%s.parquet'%season)
        if not bp.exists() or not sp.exists():
            raise ValueError('Missing required audited source season '+str(season))
        sources.extend([source(bp),source(sp)])
        boxes.append(pd.read_parquet(bp));schedules.append(pd.read_parquet(sp))
    b=pd.concat(boxes,ignore_index=True);s=pd.concat(schedules,ignore_index=True)
    audit={'teamRows':len(b),'scheduleRows':len(s),'sources':sources,
           'historicalFirstPublicationVerified':False,'assumedReleaseDelayHours':8,
           'vintageLimitation':'Retrospectively downloaded files can contain later corrections. First publication timestamps are not verified.'}
    s['game_id']=pd.to_numeric(s.id,errors='raise').astype('int64').astype(str)
    if s.game_id.duplicated().any(): raise ValueError('Duplicate schedule game IDs')
    s['start']=pd.to_datetime(s.date,utc=True)
    s=s[(s.status_type_name=='STATUS_FINAL') & s.status_type_completed.astype(bool) & (s.start<cutoff) & s.season_type.isin([2,3])].copy()
    s['home']=s.home_abbreviation.map(normalize_team);s['away']=s.away_abbreviation.map(normalize_team)
    s=s.set_index('game_id')
    b['game_id']=pd.to_numeric(b.game_id,errors='raise').astype('int64').astype(str)
    b['start']=pd.to_datetime(b.game_date_time,utc=True)
    b['team']=b.team_abbreviation.map(normalize_team)
    b=b[b.game_id.isin(s.index)].copy()
    audit['exactDuplicateTeamRows']=int(b.duplicated().sum());b=b.drop_duplicates()
    invalid_ids=set(b.loc[b.duplicated(['game_id','team_home_away'],keep=False),'game_id'])
    audit['conflictingDuplicateGames']=len(invalid_ids)
    valid=np.ones(len(b),dtype=bool)
    for col in COUNTS+['team_score']:
        b[col]=pd.to_numeric(b[col],errors='coerce')
        valid &= np.isfinite(b[col]) & (b[col]>=0) & (b[col]%1==0)
    valid &= (b.field_goals_made<=b.field_goals_attempted) & (b.three_point_field_goals_made<=b.three_point_field_goals_attempted)
    valid &= (b.three_point_field_goals_made<=b.field_goals_made) & (b.free_throws_made<=b.free_throws_attempted)
    valid &= (2*b.field_goals_made+b.three_point_field_goals_made+b.free_throws_made==b.team_score)
    invalid_ids.update(b.loc[~valid,'game_id'])
    audit['invalidStatRows']=int((~valid).sum())
    audit['rowsWherePlayerAndTeamTurnoversDiffer']=int((pd.to_numeric(b.turnovers,errors='coerce')!=b.total_turnovers).sum())
    games=[];reasons={}
    def reject(reason):reasons[reason]=reasons.get(reason,0)+1
    for gid,group in b.groupby('game_id',sort=False):
        if gid in invalid_ids:reject('invalidCountsOrDuplicate');continue
        if len(group)!=2 or set(group.team_home_away)!=set(['home','away']):reject('notTwoSides');continue
        h=group[group.team_home_away=='home'].iloc[0];a=group[group.team_home_away=='away'].iloc[0];r=s.loc[gid]
        if (h.team,a.team)!=(r.home,r.away) or h.team_score!=r.home_score or a.team_score!=r.away_score:reject('teamOrScoreMismatch');continue
        if any(abs((x-r.start).total_seconds())>60 for x in group.start):reject('tipMismatch');continue
        if h.opponent_team_id!=a.team_id or a.opponent_team_id!=h.team_id:reject('opponentIdentityMismatch');continue
        period=float(r.status_period)
        if not np.isfinite(period) or period%1 or not 4<=period<=8:reject('invalidPeriod');continue
        duration=48+5*(period-4)
        hp=h.field_goals_attempted+.44*h.free_throws_attempted-h.offensive_rebounds+h.total_turnovers
        ap=a.field_goals_attempted+.44*a.free_throws_attempted-a.offensive_rebounds+a.total_turnovers
        possessions=(hp+ap)/2;pace=possessions*48/duration
        if not 55<=pace<=160:reject('implausiblePossessionEstimate');continue
        games.append(dict(game_id=gid,season=int(r.season),start=r.start,available_at=r.start+pd.Timedelta(hours=8),
            home=r.home,away=r.away,neutral=int(r.neutral_site),home_score=float(h.team_score),away_score=float(a.team_score),
            possessions=float(possessions),pace=float(pace),duration=duration,
            home_eff=float(h.team_score/possessions*100),away_eff=float(a.team_score/possessions*100),completed=True))
    g=pd.DataFrame(games).sort_values(['start','game_id']).reset_index(drop=True)
    audit['eligibleBySeason']={str(int(k)):int(v) for k,v in g.groupby('season').size().items()}
    audit.update(eligibleGames=len(g),rejectedGames=reasons,missingPairedBoxGames=int(len(s)-b.game_id.nunique()),overtimeGames=int((g.duration>48).sum()))
    oof=pd.read_csv(predictions,dtype={'game_id':str},low_memory=False)
    if oof.game_id.duplicated().any():raise ValueError('Duplicate OOF game IDs')
    oof['oof_start']=pd.to_datetime(oof.start,utc=True)
    oof=oof.drop(columns=['start'])
    joined=g.merge(oof,on='game_id',how='inner',suffixes=('','_oof'),validate='one_to_one')
    consistent=(joined.home==joined.home_oof) & (joined.away==joined.away_oof) & (joined.season==joined.season_oof)
    consistent &= (joined.home_score==joined.home_score_oof) & (joined.away_score==joined.away_score_oof)
    consistent &= (joined.start-joined.oof_start).abs()<=pd.Timedelta(minutes=1)
    audit['oofJoinConflicts']=int((~consistent).sum())
    joined=joined[consistent & (joined.season<=2026)].copy()
    joined['spread_line']=pd.to_numeric(joined.spread_line,errors='coerce')
    joined['total_line']=pd.to_numeric(joined.total_line,errors='coerce')
    bad=joined.spread_line.notna() & ((joined.spread_line.abs()>60) | (joined.spread_line*2%1!=0))
    audit['invalidSpreadLines']=int(bad.sum());joined.loc[bad,'spread_line']=np.nan
    bad=joined.total_line.notna() & ((joined.total_line<100) | (joined.total_line>400) | (joined.total_line*2%1!=0))
    audit['invalidTotalLines']=int(bad.sum());joined.loc[bad,'total_line']=np.nan
    audit.update(oofInputGames=len(oof),joinedCompleteSeasonGames=len(joined),firstStart=g.start.min().isoformat(),lastStart=g.start.max().isoformat())
    return g,joined,audit


def player_audit(player_cache: Path, team_games: pd.DataFrame, cutoff: pd.Timestamp) -> dict:
    frames=[];sources=[]
    for year in (2025,2026,2027):
        path=player_cache/('player_box_%s.parquet'%year)
        if path.exists():frames.append(pd.read_parquet(path));sources.append(source(path))
    if not frames:return {'available':False,'reason':'No player sources','sources':[]}
    d=pd.concat(frames,ignore_index=True)
    d['tip']=pd.to_datetime(d.game_date_time,utc=True)
    d=d[d.tip+pd.Timedelta(hours=8)<cutoff].copy()
    minutes=pd.to_numeric(d.minutes,errors='coerce')
    unknown=pd.to_numeric(d.athlete_id,errors='coerce').isna() & (minutes>0)
    duplicates=d.duplicated(['game_id','team_id','athlete_id'])
    known=d[~duplicates].copy();known['game_id']=known.game_id.astype('int64').astype(str)
    known['team']=known.team_abbreviation.map(normalize_team)
    sums=known.groupby(['game_id','team']).agg(minutes=('minutes','sum'),points=('points','sum'),turnovers=('turnovers','sum')).reset_index()
    targets=pd.concat([team_games[['game_id','home','home_score','duration']].rename(columns={'home':'team','home_score':'score'}),
                       team_games[['game_id','away','away_score','duration']].rename(columns={'away':'team','away_score':'score'})])
    j=targets.merge(sums,on=['game_id','team'],validate='one_to_one')
    return {'available':True,'sources':sources,'playedRowsWithoutAthleteId':int(unknown.sum()),'duplicatePlayerRows':int(duplicates.sum()),
            'matchedTeamGames':len(j),'scoreSumMismatches':int((j.points!=j.score).sum()),
            'minuteSumMismatchesOverOneMinute':int(((j.minutes-j.duration*5).abs()>1).sum()),
            'minuteSumMismatchesOverFiveMinutes':int(((j.minutes-j.duration*5).abs()>5).sum()),
            'minuteSumMismatchesOverTenMinutes':int(((j.minutes-j.duration*5).abs()>10).sum()),
            'announcedStarterOrHistoricalInjuryVerified':False,'usedInCandidate':False,
            'reason':'Participation is postgame evidence. Current injury snapshots cannot be backfilled into older games.'}
