"""Replay NCAAB's current fold with its exact saved rolling-backtest hyperparameters.

No report, ledger or bets writes. This extends the test-season observation window
without changing the completed prior-season fits, thresholds or fitting procedure.
Refresh the public schedule separately if needed; --cache controls its location.
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from dirtiq_model.teams.adapters import ncaab
from dirtiq_model.teams.backtest import load_report, teams_in, training_artifacts
from dirtiq_model.teams.model import config_for, Scorer
from dirtiq_model.teams.ratings import Hyper, KalmanRatings, run_filter
from dirtiq_model.teams import stack

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    cfg=config_for('ncaab')
    games=ncaab.load_games(cache_dir=args.cache)
    completed=games[games.completed & (games.season >= cfg.warm_start)].sort_values(['start','game_id'])
    season=int(completed.season.max())
    saved=load_report('ncaab')['backtest']['latestFit']
    if saved['season'] != season:
        raise ValueError('Run the full backtest for the current season before this audit')
    train,test=completed[completed.season<season],completed[completed.season==season]
    kf=KalmanRatings(teams_in(games),Hyper.from_dict(saved['hyper']))
    train_pred,emp,anchor,anchor_emp=training_artifacts(kf,train,moneyline_market=cfg.moneyline_market)
    scorer=Scorer(cfg.threshold,emp,anchor,anchor_emp,ties=cfg.ties,moneyline_market=cfg.moneyline_market)
    pred=run_filter(kf,test)
    scored=scorer.score_frame(test,pred)
    _,stack_cols=stack.fit_fold(cfg,train,train_pred,test,pred)
    scored=scored.join(stack_cols)
    scored.to_csv(args.output,index=False)
    print('Audit only: saved hyperparameters',saved['hyper'])
    print('Wrote',len(scored),'current-season rows to',args.output)
