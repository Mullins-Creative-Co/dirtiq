from __future__ import annotations
import argparse
from pathlib import Path
from typing import List
from .build import refresh, ROOT, OUTPUT


def main(argv: List[str]) -> int:
    parser=argparse.ArgumentParser(prog='dirtiq_model availability')
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('refresh',help='Collect current reports and experimental NBA minute scenarios; never writes bets/forecasts')
    p.add_argument('--cache',type=Path,default=ROOT.parent/'injury-cache')
    p.add_argument('--output',type=Path,default=OUTPUT)
    args=parser.parse_args(argv)
    report=refresh(args.cache,args.output)
    return int(bool(report['failures']))
