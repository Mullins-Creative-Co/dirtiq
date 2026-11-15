from __future__ import annotations
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
for sport, hl in (("nba", 15), ("ncaab", 10), ("nfl", 8), ("ncaaf", 6)):
    d = pd.read_csv("data/sports/%s-backtest-predictions.csv" % sport, low_memory=False)
    d["start"] = pd.to_datetime(d["start"], utc=True)
    d = d[d.home_score.notna() & (d.home != "NON_D1") & (d.away != "NON_D1")].sort_values("start").reset_index(drop=True)
    d["tot"] = d.home_score + d.away_score
    # walk-forward: each team's EWMA of game totals relative to league-season running mean, carried across seasons at half weight
    alpha = 1 - 0.5 ** (1.0 / hl)
    dev = {}; cnt = {}; lg = {}; pred = np.full(len(d), np.nan); ngm = np.zeros(len(d))
    last_season = {}
    for i, r in enumerate(d.itertuples(index=False)):
        s = r.season
        L = lg.get(s)
        base = (L[0] / L[1]) if L and L[1] >= 30 else (lg[s - 1][0] / lg[s - 1][1] if (s - 1) in lg else np.nan)
        for t in (r.home, r.away):
            if last_season.get(t) is not None and last_season[t] != s:
                dev[t] = dev.get(t, 0.0) * 0.5
            last_season[t] = s
        if not np.isnan(base):
            pred[i] = base + dev.get(r.home, 0.0) + dev.get(r.away, 0.0)
            ngm[i] = min(cnt.get((r.home, s), 0), cnt.get((r.away, s), 0))
            err = r.tot - pred[i]
            for t in (r.home, r.away):
                dev[t] = dev.get(t, 0.0) + alpha * err / 2
        a = lg.setdefault(s, [0.0, 0]); a[0] += r.tot; a[1] += 1
        for t in (r.home, r.away): cnt[(t, s)] = cnt.get((t, s), 0) + 1
    d["pred"] = pred; d["ngm"] = ngm
    m = d[d.total_line.notna() & d.pred.notna() & (d.season >= d.season.min() + 1)].copy()
    m["gap"] = m.pred - m.total_line; m["mres"] = m.tot - m.total_line
    X = np.column_stack([np.ones(len(m)), m.total_line, m.pred]); b = np.linalg.lstsq(X, m.tot, rcond=None)[0]
    print("\n== %s n=%d  MAE simple model %.2f  market %.2f | blend: %.2f*market + %.2f*model | overs hit %.1f%%" % (
        sport.upper(), len(m), (m.tot - m.pred).abs().mean(), m.mres.abs().mean(), b[1], b[2], 100 * (m.mres > 0).sum() / (m.mres != 0).sum()))
    for thr in (2, 4, 6, 8):
        p = m[(m.gap.abs() >= thr) & (m.mres != 0) & (m.ngm >= 4)]
        w = ((p.gap > 0) == (p.mres > 0))
        print("   |gap|>=%d: n=%5d  hit %.1f%%   over-picks %d (%.1f%%)  under-picks %d (%.1f%%)" % (thr, len(p), 100 * w.mean(), (p.gap > 0).sum(), 100 * w[p.gap > 0].mean(), (p.gap < 0).sum(), 100 * w[p.gap < 0].mean()))
