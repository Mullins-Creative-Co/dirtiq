"""``forecast``: current ratings + upcoming games into the report and the ledger.
``settle``: grade open ledger rows from the newest results."""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from ..ledger_core import Forecast, Ledger, now_iso
from .adapters.common import now_iso as _now
from .backtest import base_report, limitations, load_report, teams_in, training_artifacts, write_report
from .model import MODEL_VERSION, Scorer, SportConfig, initial_hyper, opt_int, round_or_none, settle_moneyline, settle_spread
from .ratings import Hyper, KalmanRatings, fit_hyper, run_filter
from . import stack

HORIZON_DAYS = 10
RESULTS_DIR = Path(__file__).resolve().parents[2] / "public" / "data" / "results"
RESULTS_DAYS = 120


# Sports whose schedule archive is republished about once a day: last night's finals are missing
# from it all morning, so the results file fills them from ESPN's scoreboard (same event ids).
LATE_FINAL_SPORTS = ("nba", "ncaab")
LATE_FINAL_MIN_AGE = pd.Timedelta(hours=2)
LATE_FINAL_MAX_AGE = pd.Timedelta(days=4)


def late_finals(cfg: SportConfig, games: pd.DataFrame, now: Optional[pd.Timestamp] = None,
                fetch: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None) -> List[Dict[str, Any]]:
    """Final scores ESPN already has for games the schedule archive still lists as unplayed.

    Only for sports keyed by ESPN event id. A scoreboard day that cannot be fetched is skipped;
    the archive supplies those games on a later run."""
    if cfg.sport not in LATE_FINAL_SPORTS or games.empty:
        return []
    from .adapters import espn_odds
    now = now or pd.Timestamp.now(tz="UTC")
    waiting = games[~games["completed"].astype(bool) & (games["start"] <= now - LATE_FINAL_MIN_AGE)
                    & (games["start"] >= now - LATE_FINAL_MAX_AGE)]
    if waiting.empty:
        return []
    fetch = fetch or espn_odds._get_json
    sp, lg = espn_odds.LEAGUES[cfg.sport]
    finals: Dict[str, Tuple[int, int]] = {}
    for day in sorted(set(espn_odds.local_date(waiting["start"]))):
        url = espn_odds.SCOREBOARD_URL.format(sport=sp, league=lg, date=day, extra=espn_odds.SCOREBOARD_EXTRA.get(cfg.sport, ""))
        try:
            payload = fetch(url) or {}
        except Exception as exc:
            print(f"{cfg.sport}: scoreboard {day} unavailable for late finals ({exc})")
            continue
        for ev in payload.get("events", []):
            status = ((ev.get("status") or {}).get("type") or {})
            if status.get("name") != "STATUS_FINAL" or not status.get("completed"):
                continue
            comp = (ev.get("competitions") or [{}])[0]
            sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
            try:
                finals[str(ev.get("id"))] = (int(sides["home"]["score"]), int(sides["away"]["score"]))
            except (KeyError, TypeError, ValueError):
                continue
    rows = []
    for r in waiting.sort_values(["start", "game_id"]).itertuples():
        score = finals.get(str(r.game_id))
        if score is None or score[0] + score[1] <= 0:
            continue
        rows.append({"eventId": f"{cfg.sport}:{r.game_id}", "gameId": str(r.game_id), "home": str(r.home), "away": str(r.away),
                     "startsAt": iso(r.start), "homeScore": score[0], "awayScore": score[1], "neutral": int(r.neutral),
                     "source": "espn-scoreboard"})
    return rows


def export_results(cfg: SportConfig, games: pd.DataFrame, days: int = RESULTS_DAYS, out_dir: Optional[Path] = None,
                   now: Optional[pd.Timestamp] = None, extra: Optional[List[Dict[str, Any]]] = None) -> Path:
    """Write ``public/data/results/<sport>.json``: final scores of every completed game in the
    last ``days`` days, keyed the way the ledger keys events, so the site can grade bets a
    person logs against the same results the ledger settles on."""
    now = now or pd.Timestamp.now(tz="UTC")
    recent = games[games["completed"] & (games["start"] >= now - pd.Timedelta(days=days))].sort_values(["start", "game_id"])
    rows = [{
        "eventId": f"{cfg.sport}:{r.game_id}", "gameId": str(r.game_id), "home": str(r.home), "away": str(r.away),
        "startsAt": iso(r.start), "homeScore": int(r.home_score), "awayScore": int(r.away_score), "neutral": int(r.neutral),
    } for r in recent.itertuples()]
    have = {row["eventId"] for row in rows}
    rows.extend(row for row in (extra or []) if row["eventId"] not in have)
    out_dir = out_dir or RESULTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{cfg.sport}.json"
    payload = {"sport": cfg.sport, "generatedAt": now_iso(), "days": days, "unit": cfg.unit, "games": rows}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)
    return path


def _export_health(ledger: Ledger, health_path: Optional[Path]) -> None:
    if health_path is None:
        ledger.export_health()
    else:
        ledger.export_health(health_path)


def iso(ts: Any) -> Optional[str]:
    if ts is None or (isinstance(ts, float) and math.isnan(ts)) or pd.isna(ts):
        return None
    return pd.Timestamp(ts).tz_convert("UTC").isoformat(timespec="seconds").replace("+00:00", "Z")


def choose_hyper(cfg: SportConfig, train: pd.DataFrame, teams: List[str], existing: Dict[str, Any], refit: bool, maxiter: int) -> Dict[str, Any]:
    train_seasons = [int(s) for s in np.sort(train["season"].unique())]
    cached = existing.get("forecastFit") or {}
    if not refit and cached.get("trainSeasons") == train_seasons and cached.get("hyper"):
        return {"hyper": cached["hyper"], "trainSeasons": train_seasons, "fit": cached.get("fit"), "reused": True}
    init = Hyper.from_dict(cached["hyper"]) if cached.get("hyper") else initial_hyper(cfg, train)
    budget = min(maxiter, cfg.maxiter) if cfg.maxiter else maxiter
    hyper, info = fit_hyper(train, teams, init=init, maxiter=budget)
    return {"hyper": hyper.to_dict(), "trainSeasons": train_seasons,
            "fit": {k: info[k] for k in ("nllPerGame", "iterations", "converged")}, "reused": False}


def team_form(completed: pd.DataFrame, season: int, n: int = 5) -> Dict[str, Dict[str, Any]]:
    """Season record, average margin and the last ``n`` results per team from completed games."""
    games = completed[completed["season"] == season].sort_values(["start", "game_id"])
    rows: Dict[str, List[Dict[str, Any]]] = {}
    for g in games.itertuples():
        margin = float(g.home_score) - float(g.away_score)
        rows.setdefault(str(g.home), []).append({"date": iso(g.start), "opponent": str(g.away), "home": True, "margin": margin})
        rows.setdefault(str(g.away), []).append({"date": iso(g.start), "opponent": str(g.home), "home": False, "margin": -margin})
    out: Dict[str, Dict[str, Any]] = {}
    for team, results in rows.items():
        wins = sum(1 for r in results if r["margin"] > 0)
        losses = sum(1 for r in results if r["margin"] < 0)
        ties = len(results) - wins - losses
        last = results[-n:]
        out[team] = {
            "season": int(season), "games": len(results), "wins": wins, "losses": losses, "ties": ties,
            "avgMargin": round(sum(r["margin"] for r in results) / len(results), 2),
            "last": [{"date": r["date"], "opponent": r["opponent"], "home": r["home"], "margin": round(r["margin"], 1)} for r in last],
            "lastRecord": f"{sum(1 for r in last if r['margin'] > 0)}-{sum(1 for r in last if r['margin'] < 0)}",
        }
    return out


def upcoming_entry(row: pd.Series, book: Optional[str], observed_at: Optional[str], threshold: float) -> Dict[str, Any]:
    edge = row.get("ind_edge")
    pick = row.get("ind_pick") if isinstance(row.get("ind_pick"), str) else None
    mkt = row.get("market_margin")
    if mkt is None or (isinstance(mkt, float) and math.isnan(mkt)):
        note = "no market line in source; independent projection only"
    elif pick:
        side = row["home"] if pick == "home" else row["away"]
        note = f"model {row['ind_mean']:+.1f} vs market {mkt:+.1f}: leans {side} by {abs(edge):.1f} pts (threshold {threshold:.1f})"
    else:
        note = f"model {row['ind_mean']:+.1f} vs market {mkt:+.1f}: inside the {threshold:.1f}-pt threshold, no lean"
    return {
        "gameId": str(row["game_id"]), "home": row["home"], "away": row["away"], "startsAt": iso(row["start"]),
        "neutral": int(row["neutral"]), "week": int(row["week"]) if not pd.isna(row.get("week")) else None,
        "projectedHomeMargin": round_or_none(row["ind_mean"], 2), "marginSd": round_or_none(row["ind_sd"], 2),
        "homeWinProb": round_or_none(row["ind_home_win"]), "tieProb": round_or_none(row.get("ind_tie")),
        "marketHomeSpread": round_or_none(row.get("spread_line"), 2), "marketHomePrice": opt_int(row.get("spread_home_price")),
        "marketAwayPrice": opt_int(row.get("spread_away_price")),
        "marketHomeMl": opt_int(row.get("home_ml")), "marketAwayMl": opt_int(row.get("away_ml")),
        "marketTotal": round_or_none(row.get("total_line"), 2),
        "book": book, "lineObservedAt": observed_at,
        "homeCoverProb": round_or_none(row.get("ind_home_cover")), "awayCoverProb": round_or_none(row.get("ind_away_cover")),
        "pushProb": round_or_none(row.get("ind_push")), "edgePts": round_or_none(edge, 2),
        "lean": pick or "none", "note": note,
        "anchoredHomeMargin": round_or_none(row.get("anc_mean"), 2), "anchoredHomeCoverProb": round_or_none(row.get("anc_home_cover")),
        "marketHomeWinProb": round_or_none(row.get("mkt_home_win")),
        "independentHomeMargin": round_or_none(row.get("base_mean", row.get("ind_mean")), 2),
        "independentHomeWinProb": round_or_none(row.get("base_home_win", row.get("ind_home_win"))),
        "stackedHomeMargin": round_or_none(row.get("stk_mean"), 2), "stackedHomeWinProb": round_or_none(row.get("stk_home_win")),
        "stackedMarketHomeWinProb": round_or_none(row.get("stkm_home_win")), "stackedMarketHomeMargin": round_or_none(row.get("stkm_mean"), 2),
    }


VARIANT_KEYS = ("mean", "sd", "home_win", "tie", "home_cover", "away_cover", "push", "edge", "pick")


def promote_variant(scored: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """Publish ``prefix`` as the headline: its columns replace ``ind_*`` wherever present,
    and the filter's own values move to ``base_*`` so the entry can still show them."""
    out = scored.copy()
    for k in VARIANT_KEYS:
        base = out[f"ind_{k}"]
        out[f"base_{k}"] = base
        src = out[f"{prefix}_{k}"]
        if k != "pick":
            src = pd.to_numeric(src, errors="coerce")
            base = pd.to_numeric(base, errors="coerce")
        # ``where`` keeps the column's dtype where it can and upcasts otherwise; a positional
        # ``loc`` write of object-typed floats into a float column is rejected by newer pandas
        out[f"ind_{k}"] = base.where(src.isna(), src)
    return out


def ledger_rows(cfg: SportConfig, row: pd.Series, book: Optional[str], observed_at: Optional[str], forecast_at: str) -> List[Forecast]:
    out: List[Forecast] = []
    event_id = f"{cfg.sport}:{row['game_id']}"
    label = f"{row['away']} at {row['home']}"
    start = iso(row["start"])
    common = dict(sport=cfg.sport, event_id=event_id, event_label=label, event_start=start, model_id=cfg.model_id,
                  model_version=MODEL_VERSION, forecast_at=forecast_at, book=book, line_observed_at=observed_at,
                  value=float(row["ind_mean"]), value_sd=float(row["ind_sd"]))
    spread = row.get("spread_line")
    if spread is not None and not pd.isna(spread) and row.get("ind_home_cover") is not None and not pd.isna(row.get("ind_home_cover")):
        meta = {"edgePts": round_or_none(row.get("ind_edge"), 2), "marketHomeMargin": round_or_none(row.get("market_margin"), 3),
                "pushProb": round(float(row["ind_push"]), 4), "lean": row.get("ind_pick") or "none"}
        for side, team, line, price, prob in (
            ("home", row["home"], float(spread), opt_int(row.get("spread_home_price")), row["ind_home_cover"]),
            ("away", row["away"], -float(spread), opt_int(row.get("spread_away_price")), row["ind_away_cover"]),
        ):
            out.append(Forecast(market="spread", selection=str(team), selection_label=f"{team} {line:+g}", prob=float(prob),
                                line=line, price=price, meta=dict(meta, side=side), **common))
    if row.get("home_ml") is not None and not pd.isna(row.get("home_ml")) and not pd.isna(row.get("away_ml")):
        hw = float(row["ind_home_win"])
        for side, team, price, prob in (("home", row["home"], opt_int(row["home_ml"]), hw), ("away", row["away"], opt_int(row["away_ml"]), 1.0 - hw)):
            out.append(Forecast(market="moneyline", selection=str(team), selection_label=f"{team} ML", prob=prob, line=None, price=price,
                                meta={"side": side, "marketHomeWinProb": round_or_none(row.get("mkt_home_win"))}, **common))
    return out


def forecast_command(cfg: SportConfig, games: pd.DataFrame, refit: bool = False, maxiter: int = 300, horizon_days: int = HORIZON_DAYS,
                     db_path: Optional[Path] = None, now: Optional[pd.Timestamp] = None, record: bool = True,
                     health_path: Optional[Path] = None) -> Dict[str, Any]:
    now = now or pd.Timestamp.now(tz="UTC")
    completed = games[games["completed"] & (games["season"] >= cfg.warm_start)].sort_values(["start", "game_id"])
    if completed.empty:
        raise ValueError("no completed games to rate")
    current = int(completed["season"].max())
    train = completed[completed["season"] < current]
    if train.empty:
        train = completed
    teams = teams_in(games)
    existing = load_report(cfg.sport)
    fit = choose_hyper(cfg, train, teams, existing, refit, maxiter)
    hyper = Hyper.from_dict(fit["hyper"])
    kf = KalmanRatings(teams, hyper)
    train_pred, emp, anchor, anchor_emp = training_artifacts(kf, train, moneyline_market=cfg.moneyline_market)
    scorer = Scorer(cfg.threshold, emp, anchor, anchor_emp, ties=cfg.ties, moneyline_market=cfg.moneyline_market)
    this_season = completed[completed["season"] == current]
    completed_pred = train_pred
    if not this_season.empty and not train.equals(completed):
        season_pred = run_filter(kf, this_season)
        completed_pred = pd.concat([train_pred, season_pred])
    snapshot = kf.snapshot()
    updated_at = iso(kf.updated_at) if kf.updated_at is not None else None
    form = team_form(completed, current)
    rating_of = {str(r.team): {"rating": round(float(r.rating), 2), "sd": round(float(r.sd), 2), "rank": int(r.rank)} for r in snapshot.itertuples()}
    ratings = [{"team": r.team, "rating": round(float(r.rating), 2), "sd": round(float(r.sd), 2), "rank": int(r.rank),
                "games": int(r.games), "updatedAt": updated_at, "form": form.get(str(r.team))} for r in snapshot.itertuples()]

    horizon = now + pd.Timedelta(days=horizon_days)
    upcoming = games[(~games["completed"]) & (games["start"] >= now) & (games["start"] <= horizon)].sort_values(["start", "game_id"])
    book = games.attrs.get("book")
    sources = games.attrs.get("sources", [])
    observed_at = max((s["retrievedAt"] for s in sources), default=None) if book else None
    entries: List[Dict[str, Any]] = []
    forecasts: List[Forecast] = []
    forecast_at = now_iso()
    headline = ((existing.get("backtest") or {}).get("headline")) or "independent"
    stack_fits: Dict[str, Any] = {}
    if not upcoming.empty:
        pred = run_filter(copy.deepcopy(kf), upcoming, update=False)
        scored = scorer.score_frame(upcoming, pred)
        fits, stack_cols = stack.fit_fold(cfg, completed, completed_pred, upcoming, pred)
        stack_fits = {k: (f.to_dict() if f else None) for k, f in fits.items()}
        scored = scored.join(stack_cols)
        if headline == "stacked" and fits.get("stk") is not None:
            scored = promote_variant(scored, "stk")
        else:
            headline = "independent"
        for _, row in scored.iterrows():
            entry = upcoming_entry(row, book, observed_at, cfg.threshold)
            entry["headline"] = headline
            entry["homeRating"] = rating_of.get(str(row["home"]))
            entry["awayRating"] = rating_of.get(str(row["away"]))
            entry["homeForm"] = form.get(str(row["home"]))
            entry["awayForm"] = form.get(str(row["away"]))
            entry["homeAdvantage"] = round(float(hyper.hfa), 2) if hasattr(hyper, "hfa") else None
            entries.append(entry)
            if book:
                forecasts.extend(ledger_rows(cfg, row, book, observed_at, forecast_at))
    recorded = 0
    if record and forecasts:
        with Ledger(db_path) as ledger:
            recorded = ledger.record(forecasts, replace_open=True)
            _export_health(ledger, health_path)

    report = existing
    report.update(base_report(cfg, games))
    report["ratings"] = ratings
    report["upcoming"] = entries
    report["forecastFit"] = {"hyper": fit["hyper"], "trainSeasons": fit["trainSeasons"], "fit": fit["fit"], "reused": fit["reused"],
                             "currentSeason": current, "anchor": anchor.to_dict() if anchor else None,
                             "stack": stack_fits, "headline": headline,
                             "empiricalResiduals": int(len(emp.z)), "empiricalMargin": bool(emp.empirical)}
    report["forecastGeneratedAt"] = forecast_at
    report["ledgerRecorded"] = recorded
    report.setdefault("backtest", None)
    report["limitations"] = limitations(cfg, games, report.get("backtest"))
    path = write_report(cfg.sport, report)
    print(f"{cfg.sport}: rated {len(ratings)} teams through {report['dataThrough']}, {len(entries)} upcoming in {horizon_days} days, {recorded} ledger rows; wrote {path}")
    return report


def settle_command(cfg: SportConfig, games: pd.DataFrame, db_path: Optional[Path] = None, health_path: Optional[Path] = None) -> Dict[str, int]:
    by_id = games.set_index(games["game_id"].astype(str))
    counts = {"events": 0, "settled": 0, "pending": 0, "missing": 0}
    with Ledger(db_path) as ledger:
        for event_id in ledger.open_events(cfg.sport):
            counts["events"] += 1
            game_id = event_id.split(":", 1)[1]
            if game_id not in by_id.index:
                counts["missing"] += 1
                continue
            row = by_id.loc[game_id]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[-1]
            if not bool(row["completed"]):
                counts["pending"] += 1
                continue
            margin = float(row["home_score"] - row["away_score"])
            open_rows = ledger.con.execute(
                "SELECT market, selection, line FROM forecast_ledger WHERE sport=? AND event_id=? AND outcome IS NULL",
                (cfg.sport, event_id)).fetchall()
            for r in open_rows:
                is_home = r["selection"] == row["home"]
                sel_margin = margin if is_home else -margin
                if r["market"] == "spread":
                    archived = row.get("spread_line")
                    close_line = None if pd.isna(archived) else (float(archived) if is_home else -float(archived))
                    line = close_line if close_line is not None else r["line"]
                    if line is None:
                        continue
                    outcome = settle_spread(sel_margin, float(line))
                    close_price = opt_int(row.get("spread_home_price") if is_home else row.get("spread_away_price"))
                elif r["market"] == "moneyline":
                    outcome = settle_moneyline(sel_margin)
                    close_line = None
                    close_price = opt_int(row.get("home_ml") if is_home else row.get("away_ml"))
                else:
                    continue
                counts["settled"] += ledger.settle(cfg.sport, event_id, r["market"], r["selection"], outcome,
                                                   result_value=margin, close_line=close_line, close_price=close_price)
        _export_health(ledger, health_path)
    if db_path is None:  # the real run, not a test with a scratch ledger
        export_results(cfg, games, extra=late_finals(cfg, games))
    print(f"{cfg.sport}: settled {counts['settled']} rows across {counts['events']} open events ({counts['pending']} pending, {counts['missing']} not in source)")
    return counts
