#!/usr/bin/env python3
"""Refresh verified race gaps, registrations and models; usable as a scheduled worker.

python3 scripts/auto_refresh.py [--loop] [--skip-training]
The worker never settles bets. It uses the same persistent DB path as the app.
"""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from model_runtime import ROOT,DB,DATA_DIR,MODEL_DIR,EXCLUDED_IDS


def run(args,env=None,timeout=900):
    result=subprocess.run(args,cwd=ROOT,env=env,capture_output=True,text=True,timeout=timeout)
    if result.returncode: raise RuntimeError((result.stderr or result.stdout)[-2000:])
    return result.stdout


def refresh(skip_training=False):
    DATA_DIR.mkdir(parents=True,exist_ok=True)
    lock=(DATA_DIR/'automation.lock').open('w')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: return
    status={'lastRun':datetime.now(ZoneInfo('UTC')).isoformat(),'ok':False,'message':'Refresh started'}
    try:
        if not DB.exists() or DB.stat().st_size==0:
            source=sqlite3.connect(f'file:{ROOT / "public/data/dirtiq.seed.db"}?immutable=1',uri=True)
            target=sqlite3.connect(DB);source.backup(target);source.close();target.close()
        today=datetime.now(ZoneInfo('America/New_York')).date()
        if today<=datetime(2026,9,12).date():
            run([sys.executable,'scripts/sync_world100.py'],timeout=60)
            run([sys.executable,'scripts/sync_world100_results.py'],timeout=180)
        con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
        candidates=[dict(r) for r in con.execute("""SELECT r.* FROM races r LEFT JOIN race_entries e ON e.race_id=r.id
            WHERE r.mrp_event_id IS NOT NULL AND r.status!='cancelled' AND r.race_date BETWEEN ? AND ?
            AND r.division IN ('Lucas Oil LMDS','WoO Late Models','Crown Jewel / Combined','DIRTcar Summer Nationals')
            GROUP BY r.id HAVING count(e.finishing_position)=0 ORDER BY r.race_date DESC LIMIT 12""",(str(today-timedelta(days=45)),str(today))) if r['id'] not in EXCLUDED_IDS]
        con.close()
        with tempfile.TemporaryDirectory(prefix='dirtiq-refresh-') as work:
            work=Path(work);inp=work/'candidates.json';snap=work/'snapshots.json';report=work/'report.json'
            inp.write_text(json.dumps(candidates))
            if candidates:
                run(['node','scripts/fetch_mrp_gap_snapshots.mjs',str(inp),str(snap)],timeout=300)
                run([sys.executable,'scripts/backfill_verified_mrp.py','--database',str(DB),'--snapshots',str(snap),'--report',str(report),'--apply'],timeout=120)
                results=json.loads(report.read_text())
                unresolved=[e for e in results['events'] if e.get('unresolved')]
                status['unresolved']=len(unresolved)
                shutil.copy2(report,DATA_DIR/'latest-refresh-report.json')
            con=sqlite3.connect(DB)
            # Include all result fields used by the model, not merely row count.
            digest=hashlib.sha256(repr(con.execute('SELECT race_id,driver_id,finishing_position,starting_position,heat_position,qualifying_time FROM race_entries WHERE finishing_position IS NOT NULL ORDER BY race_id,driver_id').fetchall()).encode()+repr(sorted(EXCLUDED_IDS)).encode()).hexdigest()
            marker=DATA_DIR/'model-refresh-digest.txt'
            old=marker.read_text().strip() if marker.exists() else ''
            if not skip_training and (digest!=old or not (MODEL_DIR/'feature_params_woo_late_models.json').exists()):
                staged=work/'models';env=os.environ.copy();env.update({'DIRTIQ_MODEL_DIR':str(staged),'OMP_NUM_THREADS':'4','OPENBLAS_NUM_THREADS':'4'})
                for stage in ['early','race-night']:
                    run([sys.executable,'scripts/maintain_models.py','--train','all','--stage',stage],env=env)
                params=list(staged.glob('feature_params_*.json'))
                if len(params)!=8: raise RuntimeError('Expected eight trained model artifacts')
                for p in params:
                    m=json.loads(p.read_text())
                    if not 0<=m['test_auc']<=1 or not m.get('n_production'):raise RuntimeError('Model validation failed')
                MODEL_DIR.mkdir(parents=True,exist_ok=True)
                for p in staged.iterdir():
                    temp=MODEL_DIR/(p.name+'.tmp');shutil.copy2(p,temp);temp.replace(MODEL_DIR/p.name)
                marker.write_text(digest)
                status['retrained']=True
            upcoming=con.execute("SELECT r.id FROM races r JOIN race_entries e ON e.race_id=r.id WHERE r.status='upcoming' AND r.race_date BETWEEN ? AND ? GROUP BY r.id ORDER BY r.race_date LIMIT 20",(str(today),str(today+timedelta(days=14)))).fetchall()
            con.close()
            for (race_id,) in upcoming:
                run([sys.executable,'scripts/predict_model.py',str(race_id),'--cache'],timeout=120)
            status.update(ok=True,message=f'Checked {len(candidates)} scheduled result gaps; refreshed {len(upcoming)} prediction caches. {status.get("unresolved",0)} sources need review. Registered events only; missing schedule events still require discovery.')
    except Exception as error:
        status['message']=str(error)
    finally:
        temp=DATA_DIR/'automation-status.tmp';temp.write_text(json.dumps(status,indent=2)+'\n');temp.replace(DATA_DIR/'automation-status.json')
        fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
    print(json.dumps(status),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--loop',action='store_true');parser.add_argument('--skip-training',action='store_true');args=parser.parse_args()
    while True:
        refresh(args.skip_training)
        if not args.loop: break
        time.sleep(int(os.environ.get('DIRTIQ_REFRESH_SECONDS','900')))
