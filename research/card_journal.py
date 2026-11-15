"""Descriptive review of published, locked card picks; never fits/tunes on observed wins.

Read only public card/results/ledger artifacts. Write ignored research/output. Do not
infer injuries, weather or motivation from a final score. Policies changed across days.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from study import wilson


def parse(ts):
    try:return datetime.fromisoformat(str(ts).replace('Z','+00:00'))
    except (ValueError,TypeError):return None


def review_pick(pick, final, close=None):
    start,locked=parse(pick.get('startsAt')),parse(pick.get('lockedAt'))
    out={'id':pick['id'],'sport':pick['sport'],'pick':pick['pick'],'line':pick['line'],'price':pick['price'],'stakeUnits':pick['stakeUnits'],
         'startsAt':pick.get('startsAt'),'lockedAt':pick.get('lockedAt'),'context':'Pregame injuries, lineups and weather not verified; no causal label assigned.'}
    if not start or not locked or locked>start:
        return dict(out,status='excluded',reason='No verified pregame lock')
    if not final or not isinstance(final.get('homeScore'),(int,float)) or not isinstance(final.get('awayScore'),(int,float)):
        return dict(out,status='pending')
    actual=final['homeScore']-final['awayScore']
    side=1 if pick['side']=='home' else -1
    cover=actual*side+pick['line']
    outcome='win' if cover>0 else 'loss' if cover<0 else 'push'
    price=pick['price'];payout=(price/100 if price>0 else 100/abs(price))*pick['stakeUnits']
    model=pick.get('modelHomeMargin')
    market_home=pick['line'] if side==1 else -pick['line']
    tags=[]
    if abs(cover)<=3:tags.append('within_3_points_of_cover')
    if abs(actual)>=20:tags.append('final_margin_20_plus')
    model_error=abs(actual-model) if isinstance(model,(int,float)) and math.isfinite(model) else None
    market_error=abs(actual+market_home)
    if model_error is not None:tags.append('model_closer' if model_error<market_error else 'market_closer' if model_error>market_error else 'equal_error')
    clv=pick['line']-close if isinstance(close,(int,float)) and math.isfinite(close) else None
    if clv is not None:tags.append('price_moved_toward_pick' if clv>0 else 'price_moved_against_pick' if clv<0 else 'line_unchanged')
    return dict(out,status='graded',outcome=outcome,homeScore=final['homeScore'],awayScore=final['awayScore'],
       coverMargin=cover,units=payout if outcome=='win' else -pick['stakeUnits'] if outcome=='loss' else 0,
       modelAbsoluteError=model_error,lockedMarketAbsoluteError=market_error,closingLine=close,clvPoints=clv,tags=tags)


def aggregate(rows):
    decided=[r for r in rows if r.get('outcome')in('win','loss')]
    w=sum(r['outcome']=='win'for r in decided)
    graded=[r for r in rows if r['status']=='graded']
    staked=sum(r['stakeUnits']for r in graded)
    units=sum(r['units']for r in graded)
    return {'decided':len(decided),'wins':w,'losses':len(decided)-w,'pushes':sum(r.get('outcome')=='push'for r in rows),
      'pending':sum(r['status']=='pending'for r in rows),'excluded':sum(r['status']=='excluded'for r in rows),
      'coverRate':w/len(decided) if decided else None,'coverCI95':wilson(w,len(decided)),
      'units':units,'stakedUnits':staked,'roi':units/staked if staked else None}


def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--through',default='2026-11-15');args=p.parse_args()
    results={};sources={}
    for path in (args.data/'results').glob('*.json'):
        payload=path.read_bytes();sources[str(path)]=hashlib.sha256(payload).hexdigest()
        for row in json.loads(payload).get('games',[]):results[row['eventId']]=row
    ledger=json.loads((args.data/'forecast-ledger.json').read_text())
    closing={(r['event_id'],r['selection']):r.get('close_line')for r in ledger.get('rows',[])if r.get('close_line')is not None}
    sources[str(args.data/'forecast-ledger.json')]=hashlib.sha256((args.data/'forecast-ledger.json').read_bytes()).hexdigest()
    rows=[];policies={}
    for path in sorted((args.data/'cards').glob('*.json')):
        if path.stem>args.through:continue
        payload=path.read_bytes();card=json.loads(payload)
        sources[str(path)]=hashlib.sha256(payload).hexdigest()
        policies[path.stem]=hashlib.sha256(json.dumps(card.get('rules',[]),sort_keys=True).encode()).hexdigest()
        for pick in card.get('picks',[]):
            final=results.get(pick['id']) or pick.get('result')
            row=review_pick(pick,final,closing.get((pick['id'],pick['pick'])))
            row['date']=path.stem;rows.append(row)
    output=Path(__file__).parent/'output';output.mkdir(exist_ok=True)
    report={'checkedAt':datetime.now(timezone.utc).isoformat(),'through':args.through,'scope':'Published card picks, not private bet history. Descriptive only; policies/stakes changed, no new strategy validation.',
      'totals':aggregate(rows),'byDate':{d:aggregate([r for r in rows if r['date']==d])for d in sorted(set(r['date']for r in rows))},
      'bySport':{s:aggregate([r for r in rows if r['sport']==s])for s in sorted(set(r['sport']for r in rows))},'policyHashes':policies,'sourceHashes':sources,'picks':rows}
    (output/'card-journal.json').write_text(json.dumps(report,indent=2)+'\n')
    lines=['# Locked-card journal through '+args.through,'','Descriptive, not a new holdout test. Published card picks only; selection, staking and NBA participation changed within this window. Unfinished games are pending, never losses. Context causes are not inferred from scores.','',
      'Date | W-L-P | Pending | Units | ROI','---|---|---:|---:|---:']
    for day,s in report['byDate'].items():lines.append('%s | %d-%d-%d | %d | %+.3f | %s'%(day,s['wins'],s['losses'],s['pushes'],s['pending'],s['units'],'—'if s['roi']is None else '%.1f%%'%(s['roi']*100)))
    lines+=['','## Pick-level evidence','','Date | Sport | Pick | Locked line | Result | Cover margin | Model error | Locked-market error | Facts, not causes','---|---|---|---:|---|---:|---:|---:|---']
    for r in rows:lines.append('%s | %s | %s | %+.1f | %s | %s | %s | %s | %s'%(r['date'],r['sport'],r['pick'],r['line'],r.get('outcome',r['status']),r.get('coverMargin','—'),r.get('modelAbsoluteError','—'),r.get('lockedMarketAbsoluteError','—'),', '.join(r.get('tags',[]))))
    (output/'CARD_JOURNAL.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'byDate':report['byDate'],'bySport':report['bySport']},indent=2))

if __name__=='__main__':main()
