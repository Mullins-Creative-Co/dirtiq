"""``python3 -m dirtiq_model odds snapshot --sport nfl [--regions us]``."""
from __future__ import annotations

import argparse
from typing import List

from .snapshot import snapshot_command
from .teams import SPORT_KEYS


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model odds")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot", help="fetch current lines and update the ledger")
    snap.add_argument("--sport", required=True, choices=sorted(SPORT_KEYS))
    snap.add_argument("--regions", default="us")
    args = parser.parse_args(argv)
    if args.command == "snapshot":
        snapshot_command(args.sport, regions=args.regions)
    return 0
