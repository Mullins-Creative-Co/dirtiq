"""Offline fair-line study; requires existing rolling OOF prediction CSVs."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import List


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="dirtiq_model fair_lines")
    parser.add_argument("command", choices=["evaluate"])
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/data/fair-line-report.json"))
    parser.add_argument("--details", type=Path, default=Path("data/fair-lines"))
    parser.add_argument("--as-of", required=True, help="Research cutoff, ISO date in America/New_York or timestamp")
    args = parser.parse_args(argv)
    from .evaluate import run
    run(args.input_dir, args.output, args.details, args.as_of)
    return 0
