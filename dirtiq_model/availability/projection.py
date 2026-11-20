"""Numeric user-enabled NBA projections; unknown never means zero adjustment."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from .feed import stamp
from .impact import VERSION, TOTAL_VERSION


def finite(value: Any) -> bool:
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def project(game: Dict[str,Any], metadata: Optional[Dict[str,Any]], now: datetime) -> Dict[str,Any]:
    out={'status':'unavailable','experimental':True,'homeMargin':None,'homeSpread':None,'total':None,
         'marginChange':None,'totalChange':None,'homeMarginRange':None,'totalRange':None,
         'baselineHomeMargin':game.get('baselineHomeMargin'),
         'baselineHomeSpread':-game['baselineHomeMargin'] if finite(game.get('baselineHomeMargin')) else None,'baselineTotal':game.get('baselineTotal'),
         'asOf':game.get('asOf'),'method':metadata.get('version') if metadata else None,
         'totalMethod':metadata.get('totalVersion') if metadata else None,
         'reason':'No supported player-value model for this league.'}
    if game.get('sport')!='nba': return out
    if not metadata or metadata.get('version')!=VERSION:
        out['reason']='Supported NBA player model unavailable.';return out
    observed,start=stamp(game.get('asOf')),stamp(game.get('startsAt'))
    baseline_at=stamp(game.get('baselineForecastAt'))
    trained=stamp(metadata.get('trainedThrough')) if metadata else None
    if (observed is None or start is None or start<=now or not timedelta(0)<=now-observed<=timedelta(hours=3)
            or baseline_at is None or not timedelta(0)<=observed-baseline_at<=timedelta(hours=3) or trained is None or trained>=observed):
        out['reason']='Missing, stale, future or post-start forecast/model evidence.';return out
    if game.get('id')!='nba:'+str(game.get('gameId')):
        out['reason']='Event identity is not verified.';return out
    for side in ('home','away'):
        context=game.get('contexts',{}).get(side,{})
        if context.get('team')!=game.get(side) or context.get('coverage')!='scenario':
            out['reason']='Both teams need complete current status and replacement evidence.';return out
    for change_key,baseline_key,result_key,delta_key,range_key in (
            ('homeMarginChange','baselineHomeMargin','homeMargin','marginChange','homeMarginRange'),
            ('totalChange','baselineTotal','total','totalChange','totalRange')):
        if result_key=='total' and metadata.get('totalVersion')!=TOTAL_VERSION: continue
        change=game.get(change_key);base=game.get(baseline_key)
        if not finite(base) or not isinstance(change,dict) or not all(finite(change.get(k)) for k in ('min','max','listedOut')): continue
        if change['min']>change['max'] or not change['min']-1e-6<=change['listedOut']<=change['max']+1e-6: continue
        value=base+change['listedOut']
        if result_key=='total' and value<=0: continue
        out[result_key]=round(value,2);out[delta_key]=round(change['listedOut'],3)
        out[range_key]=[round(base+change['min'],2),round(base+change['max'],2)]
    if out['homeMargin'] is not None: out['homeSpread']=round(-out['homeMargin'],2)
    if out['homeMargin'] is not None or out['total'] is not None:
        out['status']='applied';out['reason']='Listed-out replacement scenario applied; unresolved players retain reference minutes in the point estimate. Ranges include their play/out scenarios. Not a validated betting probability.'
    else: out['reason']='Missing baseline or learned point changes; no adjustment invented.'
    return out
