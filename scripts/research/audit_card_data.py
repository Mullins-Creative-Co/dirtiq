"""Reproduce the two card data checks without reading credentials or bets.

Usage: python3 scripts/research/audit_card_data.py --predictions PATH --cache PATH
Output includes before/after quarantine metrics using unchanged saved model margins.
The full rolling backtest is still required because market-aware fits can change.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import pandas as pd
from dirtiq_model.teams.adapters.espn_odds import load_odds_cache, consolidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--predictions', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--comparison-predictions',type=Path,help='Fresh rerun CSV for a comparison on matching live games')
    args = parser.parse_args()
    p = pd.read_csv(args.predictions, dtype={'game_id': str})
    records = {}
    for season in p.season.unique():
        records.update(load_odds_cache(args.cache, int(season)))
    original = p[(p.ind_mean+p.spread_line).abs() > 15]
    conflicts = {eid for eid, r in records.items() if consolidate(r.get('books', [])).get('conflictingSides')}
    tail = original[~original.game_id.isin(conflicts)]
    p['validated_spread'] = p.game_id.map(lambda eid: consolidate(records.get(eid,{}).get('books',[])).get('spread_line'))
    corrected = p[(p.ind_mean+p.validated_spread).abs()>15].copy()
    corrected['spread_line'] = corrected['validated_spread']
    malformed = {eid for eid,r in records.items() if any(b.get('spread') is not None and abs(b['spread'])>=100 for b in r.get('books',[]))}

    def tail_stats(frame):
        outcome = (frame.margin+frame.spread_line)*(frame.ind_mean+frame.spread_line)
        return {'games': len(frame), 'wins': int((outcome>0).sum()), 'losses': int((outcome<0).sum()), 'pushes': int((outcome==0).sum()), 'winRate': float((outcome>0).mean())}
    rows = json.load(open('public/data/forecast-ledger.json'))['rows']
    by_event = {}
    for row in rows:
        if row['sport'] != 'ncaab' or row['market'] != 'spread': continue
        meta = json.loads(row['meta']) if isinstance(row['meta'],str) else row['meta'] or {}
        if meta.get('side') != 'home': continue
        if not ('2026-11-11' <= row['event_start'] < '2026-11-17'): continue
        by_event[row['event_id']] = dict(row,meta=meta)
    valid = sum(r['meta'].get('lean') in ('home','away') for r in by_event.values())
    invalid = sum(r['meta'].get('lean') not in ('home','away','none') for r in by_event.values())
    def actual_lean(r):
        edge=r['value']+r['line']
        return 'home' if edge>=3 else 'away' if edge<=-3 else 'none'
    first225 = sorted(by_event.values(),key=lambda r:(r['event_start'],r['event_id']))[:225]
    joined = p[p.game_id.isin(e.split(':')[1] for e in by_event)]
    early = p[(pd.to_datetime(p.start,utc=True).dt.month == 11) & (pd.to_datetime(p.start,utc=True).dt.day <= 16) & p.spread_line.notna()]
    early_ind = ((early.ind_mean+early.spread_line).abs()>=3).mean()
    early_stk = ((early.stk_mean+early.spread_line).abs()>=3).mean()
    comparison = None
    if args.comparison_predictions:
        fresh = pd.read_csv(args.comparison_predictions,dtype={'game_id':str})
        live = pd.DataFrame([dict(game_id=r['event_id'].split(':')[1],liveMargin=r['value'],liveLine=r['line'],liveLean=r['meta'].get('lean')) for r in by_event.values()])
        shared = fresh.merge(live,on='game_id')
        headline = json.load(open('public/sports/ncaab.json'))['backtest']['headline']
        mean = shared['stk_mean'].fillna(shared.ind_mean) if headline=='stacked' else shared.ind_mean
        comparison = {'games':len(shared),'headline':headline,
            'liveExplicitLabels':int(shared.liveLean.isin(['home','away']).sum()),
            'liveMathLeans':int(((shared.liveMargin+shared.liveLine).abs()>=3).sum()),
            'backtestLeansAtLiveLine':int(((mean+shared.liveLine).abs()>=3).sum()),
            'backtestLeansAtClose':int(((mean+shared.spread_line).abs()>=3).sum()),
            'meanAbsoluteMarginDifference':float((mean-shared.liveMargin).abs().mean()) if len(shared) else None,
            'meanAbsoluteLineDifference':float((shared.spread_line-shared.liveLine).abs().mean()) if len(shared) else None,
            'missingLiveGames':sorted(set(live.game_id)-set(shared.game_id))}
    data = {'tailBefore':tail_stats(original), 'tailAfterConflictQuarantineOnly':tail_stats(tail), 'tailAfterAllValidationFixedMargins':tail_stats(corrected),
      'malformedHandicapEventsInPredictions':int(p.game_id.isin(malformed).sum()),
      'tailWithMalformedBook':int(original.game_id.isin(malformed).sum()),
      'quarantinedPricedGames':int(p.game_id.isin(conflicts).sum()),
      'tailQuarantined':int(original.game_id.isin(conflicts).sum()),
      'sourceExamples':[{ 'eventId':eid,'books':records.get(eid,{}).get('books',[]) } for eid in ['401090034','401099942','401489751','401489513']],
      'ledgerNov11Through16':{'games':len(by_event),'explicitHomeAwayLabels':valid,
        'derivedFromMarginAndLine':sum(actual_lean(r)!='none' for r in by_event.values()),
        'inconsistentExplicitLabels':sum(r['meta'].get('lean') in ('home','away') and r['meta']['lean']!=actual_lean(r) for r in by_event.values()),'invalidNaNLeans':invalid,
        'first225Chronological':{'naiveNotNone':sum(r['meta'].get('lean')!='none' for r in first225),
          'explicitHomeAwayLabels':sum(r['meta'].get('lean') in ('home','away') for r in first225),
          'derivedFromMarginAndLine':sum(actual_lean(r)!='none' for r in first225),
          'invalidNaN':sum(r['meta'].get('lean') not in ('home','away','none') for r in first225)},
        'naiveNotNoneCount':sum(r['meta'].get('lean') != 'none' for r in by_event.values()),
        'sameGamesInSavedBacktest':len(joined)},
      'earlyNovemberBacktest':{'priced':len(early),'independentLeanRate':early_ind,'stackedLeanRate':early_stk},
      'savedBacktestThrough':str(p.start.max()),'sameGameComparison':comparison}
    print(json.dumps(data,indent=2,allow_nan=False))

if __name__ == '__main__': main()
