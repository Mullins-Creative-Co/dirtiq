from __future__ import annotations
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
for sport in ("ncaab", "ncaaf"):
    d = pd.read_csv("data/sports/%s-backtest-predictions.csv" % sport, low_memory=False)
    d["start"] = pd.to_datetime(d["start"], utc=True); d = d.sort_values("start").reset_index(drop=True)
    d["model"] = d["stk_mean"].fillna(d["ind_mean"]); d["res"] = d.margin - d.model
    long = pd.concat([d[["game_id", "season", "start", "home", "res"]].rename(columns={"home": "team"}).assign(s=1), d[["game_id", "season", "start", "away", "res"]].rename(columns={"away": "team"}).assign(s=-1)]).sort_values("start")
    long["tres"] = long.res * long.s
    g = long.groupby(["team", "season"]); long["prev"] = g.tres.shift(1); long["prev2"] = g.tres.transform(lambda x: x.shift(1).rolling(2, min_periods=2).mean()); long["n"] = g.cumcount()
    h = long[long.s == 1].set_index("game_id"); a = long[long.s == -1].set_index("game_id")
    m = d[d.spread_line.notna() & d.margin.notna() & (d.home != "NON_D1") & (d.away != "NON_D1")].copy()
    m["mkt"] = -m.spread_line; m["gap"] = m.model - m.mkt; m["mres"] = m.margin - m.mkt
    m = m[(m.gap.abs() >= 3) & (m.gap.abs() < 12) & (m.mres != 0)]
    home_pick = m.gap > 0
    m["pprev"] = np.where(home_pick, m.game_id.map(h.prev), m.game_id.map(a.prev))
    m["pprev2"] = np.where(home_pick, m.game_id.map(h.prev2), m.game_id.map(a.prev2))
    m["pn"] = np.where(home_pick, m.game_id.map(h.n), m.game_id.map(a.n))
    m["win"] = (m.gap > 0) == (m.mres > 0)
    print("\n== %s: model picks by how the PICKED team did against the model last time out" % sport.upper())
    for nm, q in (("picked team missed model by 15+ last game", m[m.pprev <= -15]), ("missed by 8-15", m[(m.pprev > -15) & (m.pprev <= -8)]), ("within 8", m[m.pprev.abs() < 8]), ("beat model by 8+", m[m.pprev >= 8]),
                  ("avg of last two <= -12", m[m.pprev2 <= -12]), ("early (<6 gms) & missed by 15+ last game", m[(m.pprev <= -15) & (m.pn < 6)])):
        print("  %-46s n=%5d cover %.1f%% (+/-%.1f)" % (nm, len(q), 100 * q.win.mean(), 196 * (0.25 / max(len(q), 1)) ** .5))
