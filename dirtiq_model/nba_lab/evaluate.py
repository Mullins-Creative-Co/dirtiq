"""Frozen evaluation; shared scoring arithmetic from fair-line lab commit 782641b."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
import json
import numpy as np
import pandas as pd
from .data import prepare, player_audit
from .model import lagged_features, fit, probabilities, FEATURES

def payout(price: np.ndarray) -> np.ndarray:
    return np.where(price >= 100, price / 100.0, 100.0 / np.maximum(np.abs(price), 1.0))


def interval(values: np.ndarray, dates: pd.Series) -> list:
    """Paired date-cluster bootstrap; resample sums and counts, not cluster means."""
    if len(values) == 0:
        return [None, None]
    groups = pd.DataFrame({"date": np.asarray(dates), "value": values}).groupby("date").value.agg(["sum", "count"])
    rng = np.random.default_rng(20261120)
    sums, counts = groups["sum"].to_numpy(), groups["count"].to_numpy()
    estimates = []
    for _ in range(499):
        ix = rng.integers(0, len(groups), len(groups))
        estimates.append(sums[ix].sum() / counts[ix].sum())
    return [round(float(v), 5) for v in np.quantile(estimates, [0.025, 0.975])]


def selections(d: pd.DataFrame, real_price: bool) -> Dict[str, Any]:
    chosen = d[d.select & (d.has_price == real_price)]
    wins = int(chosen.won.sum())
    pushes = int(chosen.push.sum())
    losses = int(len(chosen) - wins - pushes)
    profit = np.where(chosen.won, payout(chosen.price.to_numpy()), np.where(chosen.push, 0.0, -1.0))
    n = wins + losses
    p = wins / n if n else 0.0
    den = 1 + 1.96 ** 2 / n if n else 1.0
    lower = ((p + 1.96 ** 2 / (2 * n) - 1.96 * np.sqrt(p * (1-p)/n + 1.96 ** 2/(4*n*n))) / den) if n else None
    return {"bets": len(chosen), "wins": wins, "losses": losses, "pushes": pushes,
            "coverRate": wins / n if n else None, "lower95": lower,
            "units": float(profit.sum()), "roi": float(profit.mean()) if len(chosen) else None,
            "priceBasis": "archived reported side price; consensus may mix books; paper returns" if real_price else "assumed -110 sensitivity; not executable ROI"}


def metrics(d: pd.DataFrame) -> Dict[str, Any]:
    ae = np.abs(d.actual - d.prediction)
    me = np.abs(d.actual - d.market_line)
    no_push = d[d.actual != d.market_line]
    y = (no_push.actual > no_push.market_line).to_numpy(dtype=float)
    p = np.clip(no_push.conditional.to_numpy(), 1e-6, 1-1e-6)
    pm = no_push.market_probability.to_numpy()
    priced = no_push[no_push.paired_price]
    py = (priced.actual > priced.market_line).to_numpy(dtype=float)
    return {"pricedBrier": float(np.mean((priced.conditional.to_numpy()-py)**2)) if len(priced) else None,
            "pricedBenchmarkBrier": float(np.mean((priced.market_probability.to_numpy()-py)**2)) if len(priced) else None,
            "games": len(d), "mae": float(ae.mean()), "rmse": float(np.sqrt(np.mean((d.actual-d.prediction)**2))),
            "marketMae": float(me.mean()), "maeDelta": float((ae-me).mean()),
            "maeDelta95": interval((ae-me).to_numpy(), d.day),
            "nonPushGames": len(no_push), "brier": float(np.mean((p-y)**2)),
            "benchmarkBrier": float(np.mean((pm-y)**2)),
            "pairedPriceGames": int(no_push.paired_price.sum()),
            "logLoss": float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p))),
            "archivedPriceSelections": selections(d, True), "assumedPriceSelections": selections(d, False)}



def score(model,test,market,mode):
    if model.calibrated_through>=test.start.min().isoformat():raise ValueError('Calibration overlaps test')
    d=test.copy();d['prediction']=model.predict(test)
    high,low,push=probabilities(d.prediction.to_numpy(),d.market_line.to_numpy(),model.residuals)
    p=np.divide(high,high+low,out=np.full(len(high),.5),where=high+low>0)
    d['conditional']=p;d['push_probability']=push;d['selected_high']=p>=.5
    hp=pd.to_numeric(d.spread_home_price,errors='coerce').to_numpy() if market=='spread' else np.full(len(d),np.nan)
    ap=pd.to_numeric(d.spread_away_price,errors='coerce').to_numpy() if market=='spread' else np.full(len(d),np.nan)
    hp=np.where(np.isfinite(hp)&(np.abs(hp)>=100),hp,np.nan);ap=np.where(np.isfinite(ap)&(np.abs(ap)>=100),ap,np.nan)
    d['paired_price']=np.isfinite(hp)&np.isfinite(ap)
    hi=1/(1+payout(hp));lo=1/(1+payout(ap));d['market_probability']=np.where(d.paired_price,hi/(hi+lo),.5)
    prices=np.where(p>=.5,hp,ap);d['has_price']=np.isfinite(prices);d['price']=np.where(d.has_price,prices,-110.)
    d['selected_probability']=np.maximum(p,1-p)
    ev=np.where(p>=.5,high,low)*payout(d.price.to_numpy())-np.where(p>=.5,low,high)
    d['select']=(d.selected_probability>=.55)&(ev>0)
    d['push']=d.actual==d.market_line;d['won']=((d.actual>d.market_line)==d.selected_high)&~d.push
    d['market']=market;d['mode']=mode;d['trainedThrough']=model.trained_through;d['calibratedThrough']=model.calibrated_through
    return d


def summarize(d):
    result=metrics(d)
    current=np.abs(d.actual-d.current_baseline)
    result['currentModelMae']=float(current.mean())
    result['deltaVersusCurrent']=float((np.abs(d.actual-d.prediction)-current).mean())
    result['currentModelMaeDelta95']=interval((np.abs(d.actual-d.prediction)-current).to_numpy(),d.day)
    q=d[~d.push];y=(q.actual>q.market_line).to_numpy(dtype=float)
    diff=(q.conditional.to_numpy()-y)**2-(q.market_probability.to_numpy()-y)**2
    result['brierDelta']=float(diff.mean());result['brierDelta95']=interval(diff,q.day)
    bins=np.minimum((np.clip(q.conditional.to_numpy(),0,1)*10).astype(int),9)
    result['calibration']=[]
    for i in range(10):
        mask=bins==i
        result['calibration'].append(dict(lo=i/10,hi=(i+1)/10,n=int(mask.sum()),
            predicted=float(q.conditional.to_numpy()[mask].mean()) if mask.any() else None,
            observed=float(y[mask].mean()) if mask.any() else None))
    return result


def evaluate(games,joined):
    features=lagged_features(games)
    d=joined.drop(columns=['neutral']).merge(features,on='game_id',validate='one_to_one')
    # A common sample has both lines because both are pregame inputs to the fixed candidate.
    d=d.replace([np.inf,-np.inf],np.nan).dropna(subset=['spread_line','total_line','ind_mean','stk_mean','baseline_total'])
    d['day']=d.start.dt.tz_convert('America/New_York').dt.strftime('%Y-%m-%d')
    results=[];fits=[]
    for market in ('spread','total'):
        f=d.copy();f['market_line']=-f.spread_line if market=='spread' else f.total_line
        f['actual']=f.home_score-f.away_score if market=='spread' else f.home_score+f.away_score
        f['current_baseline']=f.stk_mean if market=='spread' else f.baseline_total
        for season in sorted(s for s in f.season.unique() if 2021<=s<=2026):
            tr=f[f.season<season-1];cal=f[f.season==season-1];te=f[f.season==season]
            model=fit(tr,cal,market)
            if model is None:continue
            results.append(score(model,te,market,'rolling'))
            fits.append(dict(market=market,mode='rolling',testSeason=int(season),trainingGames=len(tr),calibrationGames=len(cal),
                coefficients={name:float(v) for name,v in zip(FEATURES,model.coefficients[:-1]/model.sd)}))
        tr=f[f.season<=2023];cal=f[f.season==2024];te=f[f.season.isin([2025,2026])]
        model=fit(tr,cal,market)
        if model is None or te.empty:raise ValueError('Insufficient strict quarantine sample')
        results.append(score(model,te,market,'strict-2025-2026'))
        fits.append(dict(market=market,mode='strict-2025-2026',trainingGames=len(tr),calibrationGames=len(cal),
            coefficients={name:float(v) for name,v in zip(FEATURES,model.coefficients[:-1]/model.sd)}))
    rows=pd.concat(results,ignore_index=True)
    reports=[]
    for (market,mode),group in rows.groupby(['market','mode']):
        reports.append(dict(market=market,mode=mode,**summarize(group),bySeason=[dict(season=int(s),**summarize(g)) for s,g in group.groupby('season')]))
    strict=[r for r in reports if r['mode']=='strict-2025-2026']
    qualifies=len(strict)==2 and all(r['maeDelta95'][1]<0 and r['brierDelta95'][1]<0 and all(y['maeDelta']<0 for y in r['bySeason']) for r in strict)
    return reports,rows,fits,qualifies


def run(box_cache,schedule_cache,predictions,player_cache,output,details,cutoff,audit_only=False):
    games,joined,audit=prepare(box_cache,schedule_cache,predictions,cutoff)
    audit['playerData']=player_audit(player_cache,games,cutoff)
    report=dict(generatedAt=datetime.now(timezone.utc).isoformat(),asOf=cutoff.isoformat(),protocol='docs/nba-possession-protocol.md',
        modelVersion='nba-possession-residual-v1',audit=audit,promoted=False)
    if not audit_only:
        comparisons,rows,fits,qualifies=evaluate(games,joined)
        report.update(comparisons=comparisons,fits=fits,decision='shadow-candidate' if qualifies else 'rejected',
            reason='Fixed strict MAE/Brier screen passed; forward exact-book proof still required.' if qualifies else 'The fixed strict two-market improvement screen did not pass. Do not tune this version on the same quarantine.')
        details.mkdir(parents=True,exist_ok=True)
        cols=['game_id','season','start','home','away','market','mode','actual','prediction','market_line','current_baseline','conditional','push_probability','select','price','has_price','won','push','trainedThrough','calibratedThrough']
        rows[cols].to_csv(details/'nba-possession-predictions.csv',index=False)
        for c in comparisons:print(c['market'],c['mode'],'n',c['games'],'MAE',round(c['mae'],4),'market',round(c['marketMae'],4),'delta95',c['maeDelta95'],'Brier delta95',c['brierDelta95'],flush=True)
    report['limitations']=['Previously inspected seasons: no untouched external validation.',
        'Historical publication times are unknown; 8-hour release lag is an assumption; later revisions may remain.',
        'Estimated possessions are a box-score proxy; not possession-by-possession event counts.',
        'Historical injuries, announced starters and expected target-game minutes are excluded; participation is not a pregame injury report.',
        'Historical consensus prices can mix books/lines. Paper returns cannot establish executable named-book ROI.',
        'Totals side prices unavailable: 50% probability reference and separate assumed -110 sensitivity.',
        'Marginal intervals do not correct for all past research trials. No production forecasts, cards, stakes or bets changed.']
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print('wrote',output,flush=True)
    return report
