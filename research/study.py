"""Frozen, research-only spread study. See PROTOCOL.md; writes only ignored output."""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import sys
import subprocess
import unicodedata
import zipfile
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dirtiq_model.teams.adapters import get_adapter
from dirtiq_model.teams.adapters.espn_odds import consolidate
from dirtiq_model.teams.ratings import Hyper, KalmanRatings, run_filter

SPORTS = ("nfl", "ncaaf", "nba", "ncaab")
HOLDOUT = {"nfl": (2024, 2025), "ncaaf": (2024, 2025), "nba": (2025, 2026), "ncaab": (2025, 2026)}
THRESHOLD = {"nfl": 2., "ncaaf": 3., "nba": 3., "ncaab": 3.}
HEADLINE = {"nfl": "ind_mean", "ncaaf": "ind_mean", "nba": "stk_mean", "ncaab": "stk_mean"}
FEATURES = ["edge", "ind_sd", "home_rest", "away_rest", "home_b2b", "away_b2b", "neutral", "week", "home_travel", "away_travel", "home_travel_missing", "away_travel_missing"]


def wilson(wins, n):
    if not n:
        return [None, None]
    p, z = wins / n, 1.959963984540054
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [center - half, center + half]


def stats(frame, side, line=None):
    side = np.asarray(side, dtype=float)
    spread = frame.spread_line.to_numpy(float) if line is None else np.asarray(line, float)
    cover = (frame.margin.to_numpy(float) + spread) * side
    selected = np.isfinite(cover) & np.isfinite(side) & (side != 0)
    wins = int(np.sum(selected & (cover > 0)))
    losses = int(np.sum(selected & (cover < 0)))
    pushes = int(np.sum(selected & (cover == 0)))
    n = wins + losses
    rate = wins / n if n else None
    be = 11 / 21
    return {"n": n, "wins": wins, "losses": losses, "pushesExcluded": pushes,
            "cover": rate, "roi": (wins * 10 / 11 - losses) / n if n else None,
            "ci95": wilson(wins, n), "zVsBreakEven": (rate - be) / math.sqrt(be * (1 - be) / n) if n else None}


def by_season(frame, side, line=None):
    side = pd.Series(np.asarray(side), index=frame.index)
    lines = frame.spread_line if line is None else pd.Series(np.asarray(line), index=frame.index)
    return {str(int(season)): stats(g, side.loc[g.index], lines.loc[g.index]) for season, g in frame.groupby("season")}


def result(frame, side, line=None):
    out = stats(frame, side, line)
    out["bySeason"] = by_season(frame, side, line)
    return out


def cluster_ci(values, dates):
    temp = pd.DataFrame({"v": np.asarray(values), "date": np.asarray(dates)}).dropna()
    if temp.empty:
        return [None, None]
    grouped = temp.groupby("date").v.agg(["sum", "count"])
    sums, counts = grouped["sum"].to_numpy(), grouped["count"].to_numpy()
    rng = np.random.default_rng(20261113)
    estimates = []
    for _ in range(499):
        ids = rng.integers(0, len(sums), len(sums))
        estimates.append(sums[ids].sum() / counts[ids].sum())
    return np.quantile(estimates, [.025, .975]).tolist()


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFKD", str(text)).lower() if c.isalnum())


def city_lookup(inputs):
    path = inputs / "cities15000.zip"
    lookup = {}
    if not path.exists():
        return lookup
    with zipfile.ZipFile(path) as z:
        rows = io.TextIOWrapper(z.open("cities15000.txt"), encoding="utf-8")
        for row in rows:
            f = row.rstrip("\n").split("\t")
            if f[8] not in ("US", "CA"):
                continue
            coord = (float(f[4]), float(f[5]))
            for name in set([f[1], f[2]]):
                for key in [(normalize(name), f[10]), (normalize(name), "")]:
                    lookup.setdefault(key, set()).add(coord)
    return {k: list(v)[0] for k, v in lookup.items() if len(v) == 1}


def haversine(a, b, c, d):
    a, b, c, d = map(np.radians, (a, b, c, d))
    v = np.sin((c - a) / 2) ** 2 + np.cos(a) * np.cos(c) * np.sin((d - b) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.clip(v, 0, 1)))


def raw_metadata(inputs, sport):
    cache = inputs / "cache" / sport
    if sport == "ncaaf":
        parts = []
        for p in sorted(cache.glob("cfb_schedule_*.parquet")):
            raw = pd.read_parquet(p)
            r = pd.DataFrame({"game_id": raw.game_id.astype(str), "home_identity": raw.home_id.astype("string"), "away_identity": raw.away_id.astype("string")})
            for field in ("city", "state", "home_conference", "away_conference"):
                r[field] = np.nan
            parts.append(r)
        return pd.concat(parts, ignore_index=True).drop_duplicates("game_id", keep="last")
    if sport not in ("nba", "ncaab"):
        return pd.DataFrame(columns=["game_id", "home_conference", "away_conference", "lat", "lon"])
    prefix = "nba" if sport == "nba" else "mbb"
    parts = []
    for p in sorted(cache.glob(prefix + "_schedule_*.parquet")):
        raw = pd.read_parquet(p)
        r = pd.DataFrame({"game_id": raw["id"].astype(str), "city": raw["venue_address_city"],
                          "state": raw.get("venue_address_state", pd.Series(index=raw.index, dtype=str))})
        for side in ("home", "away"):
            field = side + "_conference_id"
            r[side + "_conference"] = raw[field].astype("string") if field in raw else "unknown"
        parts.append(r)
    return pd.concat(parts, ignore_index=True).drop_duplicates("game_id", keep="last")


def schedule_features(games, meta, cities):
    g = games.copy().reset_index(drop=True)
    if not meta.empty:
        g = g.merge(meta, on="game_id", how="left", validate="one_to_one")
    else:
        for c in ("city", "state", "home_conference", "away_conference"):
            g[c] = np.nan
    positions = [cities.get((normalize(city), str(state) if pd.notna(state) else ""), (np.nan, np.nan))
                 for city, state in zip(g.city, g.state)]
    g["lat"] = [p[0] for p in positions]
    g["lon"] = [p[1] for p in positions]
    parts = []
    for side in ("home", "away"):
        long = g[["game_id", "season", "start", "lat", "lon", side]].rename(columns={side: "team"}).copy()
        if side + "_identity" in g:
            long["team"] = g[side + "_identity"].fillna(g[side])
        long["side"] = side
        parts.append(long)
    long = pd.concat(parts, ignore_index=True).sort_values(["team", "season", "start", "game_id"])
    grouped = long.groupby(["team", "season"])
    prev = grouped.start.shift(1)
    local_day = long.start.dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
    previous_day = prev.dt.tz_convert("America/New_York").dt.tz_localize(None).dt.normalize()
    long["rest"] = (local_day - previous_day).dt.days.fillna(7).clip(lower=0, upper=7)
    long["b2b"] = (long.rest <= 1).astype(float)
    long["travel"] = np.log1p(haversine(grouped.lat.shift(1), grouped.lon.shift(1), long.lat, long.lon))
    for side in ("home", "away"):
        fields = long[long.side == side][["game_id", "rest", "b2b", "travel"]].rename(columns={c: side + "_" + c for c in ("rest", "b2b", "travel")})
        g = g.merge(fields, on="game_id", how="left", validate="one_to_one")
    return g


def load_sport(inputs, sport, cities):
    csv = pd.read_csv(inputs / "predictions" / (sport + ".csv"), dtype={"game_id": str})
    original_count = len(csv)
    duplicate_count = int(csv.game_id.duplicated(keep=False).sum())
    csv = csv.drop_duplicates("game_id", keep=False).copy()
    np.testing.assert_allclose(csv.margin, csv.home_score - csv.away_score, equal_nan=True)
    csv["start"] = pd.to_datetime(csv.start, utc=True)
    cache = inputs / "cache" / sport
    args = {"cache_dir": cache, "refresh": False}
    if sport != "nfl":
        args.update(last_season=max(HOLDOUT[sport]), lines=False)
    adapter = get_adapter(sport)
    def cached_only(url, dest, **kwargs):
        dest = Path(dest)
        if not dest.exists():
            raise FileNotFoundError("Missing frozen cache: " + str(dest))
        meta = dest.with_name(dest.name + ".meta.json")
        return json.loads(meta.read_text()) if meta.exists() else {"url": url, "path": str(dest)}
    with patch.object(adapter, "download", cached_only):
        games = adapter.load_games(**args)
    games["game_id"] = games.game_id.astype(str)
    games = games[games.completed & (games.season <= max(HOLDOUT[sport]))].copy().reset_index(drop=True)
    meta = raw_metadata(inputs, sport)
    sched = schedule_features(games, meta, cities)
    fields = ["game_id", "home_rest", "away_rest", "home_b2b", "away_b2b", "home_travel", "away_travel", "home_conference", "away_conference"]
    csv = csv.merge(sched[fields], on="game_id", how="left", validate="one_to_one")
    # Derive week from the full season schedule, including unpriced games.
    first = games.groupby("season").start.min()
    csv["week"] = ((csv.start - csv.season.map(first)).dt.total_seconds() // (86400 * 7) + 1).astype(float)
    csv["mu"] = csv[HEADLINE[sport]]
    csv["edge"] = csv.mu + csv.spread_line
    opens = {}
    if sport in ("nba", "ncaab"):
        for p in sorted((cache / "espn").glob("odds_*.jsonl")):
            for line in p.read_text().splitlines():
                row = json.loads(line)
                opens[str(row["id"])] = consolidate(row.get("books", []))["open_spread_line"]
    csv["open"] = pd.to_numeric(csv.game_id.map(opens), errors="coerce")
    complete = csv.season <= max(HOLDOUT[sport])
    excluded_minor = (csv.home == "NON_D1") | (csv.away == "NON_D1")
    bad_moves = csv.open.notna() & ((csv.open - csv.spread_line).abs() > 8)
    valid = complete & ~excluded_minor & ~bad_moves & csv.completed & csv.spread_line.notna() & csv.mu.notna() & csv.margin.notna()
    audit = {"inputRows": original_count, "duplicateRowsDropped": duplicate_count, "completeRows": int(complete.sum()), "droppedNON_D1": int((complete & excluded_minor).sum()),
             "droppedBadMovement": int((complete & ~excluded_minor & bad_moves).sum()), "eligible": int(valid.sum()),
             "openingCoverageEligible": int((valid & csv.open.notna()).sum()), "holdoutSeasons": list(HOLDOUT[sport]),
             "travelKnownEligible": {s: int((valid & csv[s + "_travel"].notna()).sum()) for s in ("home", "away")},
             "conferenceKnownEligible": {s: int((valid & csv[s + "_conference"].notna() & (csv[s + "_conference"] != "unknown")).sum()) for s in ("home", "away")}}
    for side in ("home", "away"):
        csv[side + "_travel_missing"] = csv[side + "_travel"].isna().astype(float)
    # Missing schedule rows must not silently become invented rest data.
    audit["missingScheduleEligible"] = int((valid & csv.home_rest.isna()).sum())
    return csv.loc[valid].reset_index(drop=True), games, audit


def baseline_side(frame, sport, mu=None):
    edge = (frame.mu if mu is None else np.asarray(mu)) + frame.spread_line
    return np.where(np.abs(edge) >= THRESHOLD[sport], np.sign(edge), 0.)


def anatomy(frame, sport):
    d = frame.copy()
    d["excess"] = (d.margin - d.mu).abs() - (d.margin + d.spread_line).abs()
    d["date"] = d.start.dt.tz_convert("America/New_York").dt.date.astype(str)
    d["rest_bucket"] = pd.cut(d[["home_rest", "away_rest"]].min(axis=1), [-np.inf, 1, 3, 6, np.inf], labels=["<=1", "1-3", "3-6", ">6"])
    d["b2b"] = ((d.home_b2b > 0) | (d.away_b2b > 0)).astype(str)
    d["spread_bucket"] = pd.cut(d.spread_line.abs(), [-np.inf, 3, 7, 14, np.inf], labels=["0-3", "3-7", "7-14", ">14"])
    groups = {"team": {t: (d.home == t) | (d.away == t) for t in sorted(set(d.home) | set(d.away))}}
    conferences = sorted(set(d.home_conference.dropna().astype(str)) | set(d.away_conference.dropna().astype(str)))
    groups["conference"] = {c: (d.home_conference.astype(str) == c) | (d.away_conference.astype(str) == c) for c in conferences if c not in ("unknown", "nan", "<NA>")}
    for key, col in [("week", "week"), ("rest", "rest_bucket"), ("back_to_back", "b2b"), ("spread_size", "spread_bucket")]:
        groups[key] = {str(v): d[col] == v for v in d[col].dropna().unique()}
    out = {"overallExcessMae": float(d.excess.mean()), "n": len(d), "rankings": {}}
    for dimension, masks in groups.items():
        minimum = 30 if dimension in ("team", "conference") else 100
        ranked = sorted([(float(d.loc[mask, "excess"].mean()), name, mask) for name, mask in masks.items() if int(mask.sum()) >= minimum], key=lambda r: (-r[0], r[1]))[:10]
        out["rankings"][dimension] = []
        for mean, name, mask in ranked:
            sub = d.loc[mask]
            out["rankings"][dimension].append({"group": name, "n": len(sub), "excessMae": mean,
                "ci95DateBootstrap": cluster_ci(sub.excess, sub.date), "picks": result(sub, baseline_side(sub, sport))})
    return out


def fixed_anatomy_holdout(frame, sport, rankings):
    d = frame.copy()
    d["excess"] = (d.margin-d.mu).abs()-(d.margin+d.spread_line).abs()
    d["date"] = d.start.dt.tz_convert("America/New_York").dt.date.astype(str)
    rest = pd.cut(d[["home_rest","away_rest"]].min(axis=1),[-np.inf,1,3,6,np.inf],labels=["<=1","1-3","3-6",">6"]).astype(str)
    spreads = pd.cut(d.spread_line.abs(),[-np.inf,3,7,14,np.inf],labels=["0-3","3-7","7-14",">14"]).astype(str)
    output = {}
    for dim, rows in rankings.items():
        output[dim] = []
        for row in rows:
            name = row["group"]
            if dim == "team":
                mask = (d.home==name)|(d.away==name)
            elif dim == "conference":
                mask = (d.home_conference.astype(str)==name)|(d.away_conference.astype(str)==name)
            elif dim == "week":
                mask = d.week==float(name)
            elif dim == "rest":
                mask = rest==name
            elif dim == "spread_size":
                mask = spreads==name
            else:
                mask = ((d.home_b2b>0)|(d.away_b2b>0)).astype(str)==name
            sub = d[mask]
            output[dim].append({"group":name,"n":len(sub),"excessMae":float(sub.excess.mean()),
                "ci95DateBootstrap":cluster_ci(sub.excess,sub.date),"picks":result(sub,baseline_side(sub,sport)),
                "excessBySeason":{str(int(season)):{"n":len(g),"excessMae":float(g.excess.mean())} for season,g in sub.groupby("season")}})
    return output


def carry_over(frame, games, report, sport, seasons):
    outputs = []
    for season in seasons:
        hyper_row = next(r for r in report["backtest"]["hyperparameters"] if int(r["season"]) == season)
        hyper = Hyper(**{k: v for k, v in hyper_row.items() if k != "season"})
        warm_start = int(report["backtest"]["warmStartSeason"])
        train = games[(games.season >= warm_start) & (games.season < season)].copy().reset_index(drop=True)
        year = season if sport == "ncaaf" else season - 1
        november_end = pd.Timestamp("%d-12-01" % year, tz="America/New_York")
        test = games[(games.season == season) & (games.start < november_end)].copy().reset_index(drop=True)
        if test.empty:
            continue
        teams = sorted(set(train.home) | set(train.away) | set(games.loc[games.season == season, "home"]) | set(games.loc[games.season == season, "away"]))
        original = KalmanRatings(teams, hyper)
        training_predictions = run_filter(original, train)
        if not np.isfinite(training_predictions.to_numpy()).all():
            raise ValueError("Nonfinite training filter predictions")
        changed = copy.deepcopy(original)
        changed.hyper = replace(hyper, season_reversion=min(hyper.season_reversion, .10))
        a, b = run_filter(original, test), run_filter(changed, test)
        if not np.isfinite(a.to_numpy()).all() or not np.isfinite(b.to_numpy()).all():
            raise ValueError("Nonfinite carry-over predictions")
        predictions = pd.DataFrame({"game_id": test.game_id, "base": a.pred_mean, "changed": b.pred_mean})
        sub = frame[(frame.season == season) & (frame.start.dt.tz_convert("America/New_York").dt.month == 11)].merge(predictions, on="game_id", how="inner", validate="one_to_one")
        delta = (sub.margin - sub.changed).abs() - (sub.margin - sub.base).abs()
        outputs.append({"season": season, "nGames": len(sub), "fittedReversion": hyper.season_reversion,
            "changedReversion": changed.hyper.season_reversion, "baselineMae": float((sub.margin - sub.base).abs().mean()),
            "changedMae": float((sub.margin - sub.changed).abs().mean()), "deltaMae": float(delta.mean()),
            "deltaMaeCI95": cluster_ci(delta, sub.start.dt.date.astype(str)),
            "baselinePicks": stats(sub, baseline_side(sub, sport, sub.base)), "changedPicks": stats(sub, baseline_side(sub, sport, sub.changed)),
            "baseCsvIndMae": float((sub.margin - sub.ind_mean).abs().mean()),
            "_rows": sub.assign(delta=delta)})
        print("carry %s %s complete (no results printed)" % (sport, season), flush=True)
    if not outputs:
        return {"status": "no November games"}
    all_rows = pd.concat([r.pop("_rows") for r in outputs], ignore_index=True)
    return {"status": "prior-only ablation; roster extension unavailable", "bySeason": outputs,
        "nGames": len(all_rows), "baselineMae": float((all_rows.margin - all_rows.base).abs().mean()),
        "changedMae": float((all_rows.margin - all_rows.changed).abs().mean()), "deltaMae": float(all_rows.delta.mean()),
        "deltaMaeCI95": cluster_ci(all_rows.delta, all_rows.start.dt.date.astype(str)),
        "baselinePicks": result(all_rows, baseline_side(all_rows, sport, all_rows.base)),
        "changedPicks": result(all_rows, baseline_side(all_rows, sport, all_rows.changed))}


def opening_rule(frame, sport):
    d = frame[frame.open.notna()].copy()
    if d.empty:
        return {"status": "no cached opening lines"}
    side = np.sign(d.mu + d.open)
    move = (d.open - d.spread_line) * side
    pick = np.where(((d.mu + d.open).abs() >= 1.5 * THRESHOLD[sport]) & (move <= .5), side, 0)
    chosen = pick != 0
    clv = move[chosen]
    return {"status": "open-price counterfactual has timing leakage; close-price screen only is executable conditional on game-day OOF inputs",
            "counterfactualOpen": result(d, pick, d.open), "nearClose": result(d, pick),
            "clvOpenMinusClose": {"n": int(chosen.sum()), "mean": float(clv.mean()) if chosen.any() else None,
                "positive": int((clv > 0).sum()), "zero": int((clv == 0).sum()), "negative": int((clv < 0).sum()),
                "ci95DateBootstrap": cluster_ci(clv, d.loc[chosen, "start"].dt.date.astype(str)),
                "bySeason": {str(int(s)): {"n": len(g), "mean": float(g["clv"].mean())} for s, g in d.loc[chosen].assign(clv=clv).groupby("season")}}}


def miss_model(frame, sport, seasons, strict=False):
    parts, fits = [], []
    for season in seasons:
        cutoff = min(HOLDOUT[sport]) if strict else season
        train = frame[(frame.season < cutoff) & ((frame.margin + frame.spread_line) != 0)]
        test = frame[(frame.season == season) & ((frame.margin + frame.spread_line) != 0)].copy()
        if train.season.nunique() < 2 or len(train) < 200 or test.empty:
            continue
        medians = train[FEATURES].median().fillna(0)
        scaler = StandardScaler()
        x = scaler.fit_transform(train[FEATURES].fillna(medians))
        if not np.isfinite(x).all():
            raise ValueError("Nonfinite standardized inputs")
        y = ((train.margin + train.spread_line) > 0).astype(int)
        model = LogisticRegression(C=1., max_iter=2000, solver="lbfgs", random_state=20261113).fit(x, y)
        prob = model.predict_proba(scaler.transform(test[FEATURES].fillna(medians)))[:, 1]
        if not np.isfinite(prob).all() or int(model.n_iter_[0]) >= 2000:
            raise ValueError("Nonfinite probabilities or unconverged optimizer")
        test["prob"] = prob
        test["side"] = np.where(prob >= .55, 1, np.where(prob <= .45, -1, 0))
        fits.append({"testSeason": season, "trainMaxSeason": int(train.season.max()), "trainGames": len(train),
                     "coefficientsStandardized": dict(zip(FEATURES, model.coef_[0].tolist()))})
        parts.append(test)
    if not parts:
        return {"status": "insufficient training seasons"}
    d = pd.concat(parts, ignore_index=True)
    y = ((d.margin + d.spread_line) > 0).to_numpy(float)
    p = np.clip(d.prob.to_numpy(), 1e-10, 1 - 1e-10)
    brier = (p - y) ** 2
    loss = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    return {"nGames": len(d), "brier": float(brier.mean()), "baselineBrier": .25,
        "brierDeltaCI95": cluster_ci(brier - .25, d.start.dt.date.astype(str)),
        "logLoss": float(loss.mean()), "baselineLogLoss": math.log(2), "picks": result(d, d.side),
        "bySeason": {str(int(s)): {"n": len(g), "brier": float(((g.prob - ((g.margin + g.spread_line) > 0)) ** 2).mean())} for s, g in d.groupby("season")},
        "fits": fits, "travelReduced": sport in ("nfl", "ncaaf"), "strictClassifierHoldout": strict}


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    return value


def check_manifest(output):
    manifest = json.loads((output / "manifest.json").read_text())
    changed = []
    for relative, digest in manifest.items():
        path = output / "inputs" / relative
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            changed.append(relative)
    if changed:
        raise ValueError("Frozen inputs changed: " + ", ".join(changed))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "research/output")
    parser.add_argument("--phase", choices=["development", "final"], required=True)
    args = parser.parse_args()
    target = args.output / ("development.json" if args.phase == "development" else "results.json")
    if target.exists():
        raise SystemExit("Refusing to overwrite evaluated results; preserve first-run evidence")
    check_manifest(args.output)
    inputs = args.output / "inputs"
    cities = city_lookup(inputs)
    out = {"codeCommit": subprocess.check_output(["git","rev-parse","HEAD"],cwd=str(ROOT),text=True).strip(),
           "manifestSha256": hashlib.sha256((args.output / "manifest.json").read_bytes()).hexdigest(), "phase": args.phase, "protocolSha256": hashlib.sha256((ROOT / "research/PROTOCOL.md").read_bytes()).hexdigest(), "sports": {}}
    for sport in SPORTS:
        frame, games, audit = load_sport(inputs, sport, cities)
        dev = frame[frame.season < min(HOLDOUT[sport])].copy()
        held = frame[frame.season.isin(HOLDOUT[sport])].copy()
        seasons = sorted(map(int, frame.season.unique()))
        dev_seasons = [s for s in seasons if s < min(HOLDOUT[sport])]
        report = json.loads((inputs / "reports" / (sport + ".json")).read_text())
        research = {"audit": audit, "developmentBaseline": result(dev, baseline_side(dev, sport)),
                    "anatomyDevelopmentOnly": anatomy(dev, sport),
                    "openingDevelopment": opening_rule(dev, sport),
                    "missDevelopment": miss_model(frame, sport, dev_seasons)}
        if sport in ("ncaab", "ncaaf"):
            research["carryDevelopment"] = carry_over(dev, games, report, sport, dev_seasons)
        if args.phase == "final":
            research["holdoutBaseline"] = result(held, baseline_side(held, sport))
            research["anatomyHoldoutFixedGroups"] = fixed_anatomy_holdout(held,sport,research["anatomyDevelopmentOnly"]["rankings"])
            research["openingHoldout"] = opening_rule(held, sport)
            research["missHoldoutRolling"] = miss_model(frame, sport, list(HOLDOUT[sport]))
            research["missHoldoutStrict"] = miss_model(frame, sport, list(HOLDOUT[sport]), strict=True)
            if sport in ("ncaab", "ncaaf"):
                research["carryHoldout"] = carry_over(held, games, report, sport, list(HOLDOUT[sport]))
        out["sports"][sport] = research
        print("%s %s evaluated" % (args.phase, sport), flush=True)
    check_manifest(args.output)
    target.write_text(json.dumps(clean(out), indent=2, allow_nan=False) + "\n")
    print("Wrote " + str(target), flush=True)

if __name__ == "__main__":
    main()
