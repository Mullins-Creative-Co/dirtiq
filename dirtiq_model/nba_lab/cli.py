from __future__ import annotations

import argparse
from pathlib import Path
from typing import List
import pandas as pd


def main(argv: List[str]) -> int:
    p=argparse.ArgumentParser(prog='dirtiq_model nba_lab')
    p.add_argument('command',choices=['audit','evaluate'])
    p.add_argument('--boxes',type=Path,required=True);p.add_argument('--schedules',type=Path,required=True)
    p.add_argument('--predictions',type=Path,required=True);p.add_argument('--players',type=Path,required=True)
    p.add_argument('--as-of',required=True);p.add_argument('--output',type=Path,default=Path('reports/nba-possession-study.json'))
    p.add_argument('--details',type=Path,default=Path('data/nba-possession-study'))
    args=p.parse_args(argv);cutoff=pd.Timestamp(args.as_of)
    cutoff=cutoff.tz_localize('America/New_York').tz_convert('UTC') if cutoff.tz is None else cutoff.tz_convert('UTC')
    from .evaluate import run
    run(args.boxes,args.schedules,args.predictions,args.players,args.output,args.details,cutoff,args.command=='audit')
    return 0
