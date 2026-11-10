"""``python3 -m dirtiq_model ledger <summary|export|settle>``."""
from __future__ import annotations

import argparse
import json
from typing import List

from ..ledger_core import HEALTH_PATH, Ledger


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model ledger")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("summary", help="print per-model scores")
    export = sub.add_parser("export", help="write public/data/model-health.json")
    export.add_argument("--out", default=str(HEALTH_PATH))
    settle = sub.add_parser("settle", help="settle one selection by hand")
    for name in ("sport", "event_id", "market", "selection", "outcome"):
        settle.add_argument(name)
    settle.add_argument("--result-value", type=float)
    settle.add_argument("--close-line", type=float)
    settle.add_argument("--close-price", type=int)
    args = parser.parse_args(argv)

    with Ledger() as ledger:
        if args.command == "summary":
            print(json.dumps(ledger.summarize(), indent=1))
        elif args.command == "export":
            from pathlib import Path
            path = ledger.export_health(Path(args.out))
            print(f"wrote {path}")
        elif args.command == "settle":
            n = ledger.settle(args.sport, args.event_id, args.market, args.selection, args.outcome,
                              result_value=args.result_value, close_line=args.close_line, close_price=args.close_price)
            print(f"settled {n} row(s)")
    return 0
