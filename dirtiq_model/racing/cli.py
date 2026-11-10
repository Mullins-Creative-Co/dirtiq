"""``python3 -m dirtiq_model racing train|backtest|score|settle``."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Optional

from .data import SERIES_KEYS


def _series_arg(value: Optional[str]) -> Optional[List[str]]:
    if not value or value == "all":
        return None
    return [SERIES_KEYS[v] if v in SERIES_KEYS else v for v in value.split(",")]


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model racing")
    sub = parser.add_subparsers(dest="command", required=True)

    bt = sub.add_parser("backtest", help="rolling-origin backtest; writes public/data/racing-model-report.json")
    bt.add_argument("--series", default="all", help="all | lucas,woo,summer,crown")
    bt.add_argument("--stage", choices=["early", "race-night", "all"], default="all")
    bt.add_argument("--out", default=None)
    bt.add_argument("--quiet", action="store_true")

    tr = sub.add_parser("train", help="fit production artifacts per series and stage")
    tr.add_argument("--series", default="all")
    tr.add_argument("--stage", choices=["early", "race-night", "all"], default="all")
    tr.add_argument("--variant", choices=["auto", "cl", "boosted"], default="auto")

    sc = sub.add_parser("score", help="score one race id or all upcoming races")
    sc.add_argument("race_id", nargs="?", type=int)
    sc.add_argument("--upcoming", action="store_true")
    sc.add_argument("--limit", type=int, default=None)
    sc.add_argument("--model", choices=["auto", "crown", "lucas", "woo", "summer"], default="auto")
    sc.add_argument("--no-ledger", action="store_true", help="write JSON only, do not record forecasts")

    st = sub.add_parser("settle", help="settle open ledger rows for completed races and export health")
    st.add_argument("--no-export", action="store_true")

    args = parser.parse_args(argv)
    stages = ["early", "race-night"] if getattr(args, "stage", "all") == "all" else [args.stage]

    if args.command == "backtest":
        from .backtest import REPORT_PATH, format_table, run_backtest
        report = run_backtest(series_list=_series_arg(args.series), stages=stages,
                              out_path=Path(args.out) if args.out else REPORT_PATH, verbose=not args.quiet)
        print(format_table(report))
        return 0
    if args.command == "train":
        from .train import train_all
        train_all(series_list=_series_arg(args.series), stages=stages, variant=args.variant)
        return 0
    if args.command == "score":
        from .score import score_races, score_upcoming
        override = None if args.model == "auto" else SERIES_KEYS[args.model]
        if args.upcoming:
            score_upcoming(limit=args.limit, record=not args.no_ledger, override=override)
        elif args.race_id is not None:
            payloads = score_races([args.race_id], record=not args.no_ledger, override=override, verbose=False)
            print(json.dumps(payloads[0], separators=(",", ":")))
        else:
            parser.error("score needs a race_id or --upcoming")
        return 0
    if args.command == "settle":
        from .settle import run
        counts = run(export=not args.no_export)
        print(json.dumps(counts))
        return 0
    return 2
