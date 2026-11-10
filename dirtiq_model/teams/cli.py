"""``python3 -m dirtiq_model teams backtest|forecast|settle --sport nfl [--refresh]``."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

from .adapters import SPORTS, get_adapter
from .model import config_for


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model teams")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--sport", required=True, choices=SPORTS)
        p.add_argument("--refresh", action="store_true", help="re-download the source files")
        p.add_argument("--cache", default=None, help="download cache directory for this sport (default: $DIRTIQ_SPORTS_CACHE/<sport> or ../sports-cache/<sport>)")

    bt = sub.add_parser("backtest", help="rolling-by-season backtest; writes public/sports/<sport>.json")
    common(bt)
    bt.add_argument("--maxiter", type=int, default=300, help="Nelder-Mead iterations per fold")
    bt.add_argument("--first-test", type=int, default=None, help="override the first test season")

    fc = sub.add_parser("forecast", help="rate teams, project upcoming games, record ledger rows")
    common(fc)
    fc.add_argument("--refit", action="store_true", help="refit hyperparameters even if a cached fit matches")
    fc.add_argument("--days", type=int, default=10, help="upcoming horizon in days")
    fc.add_argument("--maxiter", type=int, default=300)
    fc.add_argument("--no-ledger", action="store_true", help="do not write ledger rows")

    st = sub.add_parser("settle", help="grade open ledger rows from the newest results")
    common(st)

    args = parser.parse_args(argv)
    cfg = config_for(args.sport)
    adapter = get_adapter(args.sport)
    cache = Path(args.cache) if args.cache else None

    if args.command == "backtest":
        from .backtest import backtest_command
        games = adapter.load_games(cache_dir=cache, refresh=args.refresh)
        backtest_command(cfg, games, maxiter=args.maxiter, first_test=args.first_test)
    elif args.command == "forecast":
        from .forecast import forecast_command
        games = adapter.load_games(cache_dir=cache, refresh=args.refresh)
        forecast_command(cfg, games, refit=args.refit, maxiter=args.maxiter, horizon_days=args.days, record=not args.no_ledger)
    elif args.command == "settle":
        from .forecast import settle_command
        games = adapter.load_games(cache_dir=cache, refresh=args.refresh)
        settle_command(cfg, games)
    return 0
