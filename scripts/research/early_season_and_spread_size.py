from __future__ import annotations
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
def rep(name, p):
    p = p[p.mres != 0]
    if len(p) < 30: print("  %-44s n=%5d" % (name, len(p))); return
    w = ((p.gap > 0) == (p.mres > 0)).mean(); se = (0.25 / len(p)) ** .5
    print("  %-44s n=%5d  cover %.1f%% (+/-%.1f)  avg |model miss| %.1f  market %.1f" % (name, len(p), 100 * w, 196 * se, (p.margin - p.model).abs().mean(), p.mres.abs().mean()))
for sport, thr in (("ncaab", 3.0), ("ncaaf", 3.0)):
    d = pd.read_csv("data/sports/%s-backtest-predictions.csv" % sport, low_memory=False)
    d["start"] = pd.to_datetime(d["start"], utc=True); d = d.sort_values("start").reset_index(drop=True)
    d["model"] = d["stk_mean"].fillna(d["ind_mean"])
    long = pd.concat([d[["game_id", "season", "start", "home"]].rename(columns={"home": "team"}), d[["game_id", "season", "start", "away"]].rename(columns={"away": "team"})]).sort_values("start")
    long["n"] = long.groupby(["team", "season"]).cumcount()
    mn = long.groupby("game_id")["n"].min()
    d["ngm"] = d["game_id"].map(mn)
    m = d[d.spread_line.notna() & d.margin.notna() & (d.home != "NON_D1") & (d.away != "NON_D1")].copy()
    m["mkt"] = -m.spread_line; m["gap"] = m.model - m.mkt; m["mres"] = m.margin - m.mkt
    m["ratio"] = m.gap.abs() / thr
    m["dogpick"] = np.sign(m.gap) != np.sign(m.mkt)      # model side is the underdog
    m["sp"] = m.mkt.abs()
    p = m[(m.ratio >= 1) & (m.ratio < 4)]
    print("\n=== %s model picks (edge 1-4x threshold), all seasons" % sport.upper())
    rep("all", p)
    for lo, hi, nm in ((0, 3, "teams' games 0-2"), (3, 6, "3-5"), (6, 10, "6-9"), (10, 99, "10+")):
        rep("min games this season " + nm, p[(p.ngm >= lo) & (p.ngm < hi)])
    e = p[p.ngm < 6]; l = p[p.ngm >= 6]
    for nm, q in (("EARLY (<6 games)", e), ("LATER (6+ games)", l)):
        print(" ", nm)
        rep("  ratio 1-2", q[q.ratio < 2]); rep("  ratio 2-4", q[q.ratio >= 2])
        rep("  pick is dog, spread 15+", q[q.dogpick & (q.sp >= 15)]); rep("  pick is dog, spread 7.5-14.5", q[q.dogpick & (q.sp >= 7.5) & (q.sp < 15)]); rep("  pick is dog, spread <7.5", q[q.dogpick & (q.sp < 7.5)])
        rep("  pick is fav, spread 10+", q[~q.dogpick & (q.sp >= 10)]); rep("  pick is fav, spread <10", q[~q.dogpick & (q.sp < 10)])
    # blowout rate: pick loses by 15+ against the spread
    for nm, q in (("early", e), ("later", l)):
        ats = np.where(q.gap > 0, q.mres, -q.mres)
        print("  %s: picks beaten by 15+ pts against the spread: %.1f%%   won by 15+: %.1f%%" % (nm, 100 * (ats <= -15).mean(), 100 * (ats >= 15).mean()))
    # all priced games: is there any drift early (dogs of 15+ cover?) market-wide regardless of model
    for nm, q in (("early", m[m.ngm < 6]), ("later", m[m.ngm >= 6])):
        big = q[(q.sp >= 15) & (q.mres != 0)]
        dogcov = (np.sign(big.mres) != np.sign(big.mkt)).mean()
        print("  market-wide %s: dogs of 15+ cover %.1f%% (n=%d)" % (nm, 100 * dogcov, len(big)))
