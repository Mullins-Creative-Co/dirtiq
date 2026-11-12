"""``python3 -m dirtiq_model card build``."""
from __future__ import annotations

import argparse
from typing import List

from .build import build_command


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model card")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="grade past cards, then write today's public/data/daily-card.json")
    args = parser.parse_args(argv)
    if args.command == "build":
        build_command()
    return 0
