from __future__ import annotations
import sys, numpy as np, pandas as pd
pd.set_option("display.width", 200)

def ols(X, y):
    X = np.column_stack([np.ones(len(X)), X])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return b

for sport in ["nba", "ncaab", "nfl", "ncaaf"]:
    d = pd.read_csv("data/sports/%s-backtest-predictions.csv" % sport, low_memory=False)
    d["start"] = pd.to_datetime(d["start"], utc=True)
    d = d.sort_values("start").reset_index(drop=True)
    d["model"] = d["stk_mean"].fillna(d["ind_mean"])
    d["res"] = d["margin"] - d["model"]          # model miss (home view)
    # per-team rolling features from prior games only
    long = pd.concat([
        d[["game_id", "start", "season", "home", "res"]].rename(columns={"home": "team"}).assign(sign=1),
        d[["game_id", "start", "season", "away", "res"]].rename(columns={"away": "team"}).assign(sign=-1),
    ]).sort_values("start")
    long["tres"] = long["res"] * long["sign"]     # + = team beat the model
    g = long.groupby(["team", "season"])
    long["form3"] = g["tres"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    long["form10"] = g["tres"].transform(lambda s: s.shift(1).rolling(10, min_periods=3).mean())
    long["last1"] = g["tres"].shift(1)
    long["rest"] = g["start"].diff().dt.total_seconds() / 86400
    long["n"] = g.cumcount()
    for side, sg in (("home", 1), ("away", -1)):
        part = long[long["sign"] == sg][["game_id", "form3", "form10", "last1", "rest", "n"]]
        d = d.merge(part.add_prefix(side[0] + "_").rename(columns={side[0] + "_game_id": "game_id"}), on="game_id", how="left")
    d["form3"] = d["h_form3"].fillna(0) - d["a_form3"].fillna(0)
    d["form10"] = d["h_form10"].fillna(0) - d["a_form10"].fillna(0)
    d["last1"] = d["h_last1"].fillna(0) - d["a_last1"].fillna(0)
    d["restd"] = (d["h_rest"].clip(upper=10).fillna(5) - d["a_rest"].clip(upper=10).fillna(5))
    d["b2b"] = (d["a_rest"] < 1.6).astype(float) - (d["h_rest"] < 1.6).astype(float)
    d["early"] = (np.minimum(d["h_n"], d["a_n"]) < 5).astype(float)
    m = d[d["spread_line"].notna() & d["margin"].notna() & (d["home"] != "NON_D1") & (d["away"] != "NON_D1")].copy()
    m["mkt"] = -m["spread_line"]
    m["gap"] = m["model"] - m["mkt"]
    m = m[m["gap"].abs() < 25]
    m["mkt_res"] = m["margin"] - m["mkt"]
    print("\n=========== %s  n=%d  seasons %s-%s" % (sport.upper(), len(m), m.season.min(), m.season.max()))
    print("MAE  model %.2f   market %.2f   (gap sd %.2f pts)" % (m.res.abs().mean(), m.mkt_res.abs().mean(), m.gap.std()))
    b = ols(m[["mkt", "model"]].values, m["margin"].values)
    print("best blend: margin = %.2f + %.2f*market + %.2f*model" % tuple(b))
    b = ols(m[["gap"]].values, m["mkt_res"].values)
    print("when model disagrees by 1 pt, truth moves %.3f pt toward the model" % b[1])
    # what does the market see? explain gap
    feats = ["form3", "form10", "last1", "restd", "b2b", "early", "neutral", "mkt"]
    X = m[feats].astype(float).values
    Xs = (X - X.mean(0)) / (X.std(0) + 1e-9)
    bg = ols(Xs, m["gap"].values); br = ols(Xs, m["res"].values)
    r2g = 1 - ((m["gap"].values - np.column_stack([np.ones(len(Xs)), Xs]) @ bg) ** 2).sum() / ((m["gap"] - m["gap"].mean()) ** 2).sum()
    print("feature         gap(model-mkt)/sd   model miss/sd     [R2 of gap %.3f]" % r2g)
    for f, a, c in zip(feats, bg[1:], br[1:]):
        print("  %-10s %+8.2f          %+8.2f" % (f, a, c))
    # out-of-sample: fit correction on first 70% of time, test last 30%
    k = int(len(m) * 0.7); tr, te = m.iloc[:k], m.iloc[k:]
    mu, sd = tr[feats].astype(float).values.mean(0), tr[feats].astype(float).values.std(0) + 1e-9
    f = lambda x: (x[feats].astype(float).values - mu) / sd
    bb = ols(f(tr), tr["res"].values)
    corr = te["model"].values + np.column_stack([np.ones(len(te)), f(te)]) @ bb
    te = te.assign(corr=corr)
    print("holdout (last 30%%, n=%d): MAE model %.3f -> corrected %.3f   market %.3f" % (len(te), te.res.abs().mean(), (te.margin - te["corr"]).abs().mean(), te.mkt_res.abs().mean()))
    for name, col in (("model", "model"), ("corrected", "corr")):
        e = te[col] - te["mkt"]
        for thr in (2.0, 4.0):
            p = te[(e.abs() >= thr) & (te.mkt_res != 0)]
            ee = (p[col] - p["mkt"])
            w = ((ee > 0) == (p.mkt_res > 0)).mean()
            print("   %-9s picks |edge|>=%.0f: n=%5d  cover %.1f%%" % (name, thr, len(p), 100 * w))
    # where are misses concentrated
    m["absgap"] = m["gap"].abs()
    m["fav"] = pd.cut(m["mkt"].abs(), [-.1, 3, 7, 12, 60], labels=["0-3", "3.5-7", "7.5-12", "12+"])
    print(m.groupby("fav", observed=True).apply(lambda x: pd.Series({"n": len(x), "model_mae": x.res.abs().mean(), "mkt_mae": x.mkt_res.abs().mean(), "model_on_fav_side%": 100 * ((x.gap * np.sign(x.mkt)) > 0).mean(), "fav_cover%": 100 * ((x.mkt_res * np.sign(x.mkt)) > 0).sum() / max(1, (x.mkt_res != 0).sum())})).round(2).to_string())
    print(m.groupby("early").apply(lambda x: pd.Series({"n": len(x), "model_mae": x.res.abs().mean(), "mkt_mae": x.mkt_res.abs().mean(), "gap_sd": x.gap.std()})).round(2).to_string())
