"""Regenerate reporting fields from saved out-of-fold predictions; never fit a model.

Older CSVs lack opening lines. Recover them by event id from the same external odds
cache used by the backtest. Missing files/quotes remain missing, never synthesized.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
from dirtiq_model.teams.adapters.common import cache_dir_for
from dirtiq_model.teams.adapters.espn_odds import load_odds_cache, consolidate
from dirtiq_model.teams.backtest import load_report, write_report, PRED_DIR
from dirtiq_model.teams.evidence import backtest_evidence, backtest_clv, empirical_cover


def refresh(sport: str) -> None:
    scored = pd.read_csv(PRED_DIR / (sport + "-backtest-predictions.csv"), dtype={"game_id": str})
    if "open_spread_line" not in scored:
        quotes = {}
        for season in scored.season.unique():
            quotes.update({eid: consolidate(row.get("books") or []).get("open_spread_line")
                           for eid, row in load_odds_cache(cache_dir_for(sport), int(season)).items()})
        scored["open_spread_line"] = scored.game_id.map(quotes)
    report = load_report(sport)
    bt = report["backtest"]
    bt["predictionThrough"] = pd.to_datetime(scored["start"], utc=True).max().isoformat()
    threshold, headline = bt["selectionThreshold"], bt.get("headline", "independent")
    bt["spreadEvidence"] = backtest_evidence(scored, threshold, headline)
    bt["clvByVariant"] = {p: backtest_clv(scored, threshold, p) for p in ("ind", "stk")}
    bt["clv"] = bt["clvByVariant"]["stk" if headline == "stacked" else "ind"]
    bt["clvNote"] = "Pregame margins selected against opening lines; descriptive only, not timestamped opener-time forecasts. Market-input variants excluded: saved predictions use closing lines. Missing open/close pairs excluded."
    for game in report.get("upcoming") or []:
        game["empiricalCover"] = empirical_cover(bt["spreadEvidence"], game.get("edgePts"), threshold)
        for side in ("Home", "Away"):
            old = side.lower()+"CoverProb"
            if old in game:
                game["uncalibrated"+side+"CoverProb"] = game.pop(old)
    write_report(sport, report)
    print(sport, bt["spreadEvidence"]["selections"], bt["clv"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", choices=("nfl", "ncaaf", "nba", "ncaab"))
    args = parser.parse_args()
    for sport in [args.sport] if args.sport else ("nfl", "ncaaf", "nba", "ncaab"):
        refresh(sport)
