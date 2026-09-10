#!/bin/sh
set -eu
python3 - <<'PY'
import sys,sqlite3,shutil
sys.path.insert(0,'scripts')
from model_runtime import DB,DATA_DIR,MODEL_DIR,ROOT
DATA_DIR.mkdir(parents=True,exist_ok=True)
MODEL_DIR.mkdir(parents=True,exist_ok=True)
seed=ROOT/'public/data/dirtiq.seed.db'
def copy_seed():
    a=sqlite3.connect(f'file:{seed}?immutable=1',uri=True);b=sqlite3.connect(DB);a.backup(b);a.close();b.close()
if not DB.exists():
    copy_seed()
else:
    current=sqlite3.connect(DB)
    tables={row[0] for row in current.execute("select name from sqlite_master where type='table'")}
    race_count=current.execute('select count(*) from races').fetchone()[0] if 'races' in tables else 0
    if race_count == 0:
        preserved=[]
        columns=[]
        if 'bettors' in tables:
            columns=[row[1] for row in current.execute('pragma table_info(bettors)')]
            preserved=current.execute('select * from bettors').fetchall()
        current.close()
        backup=DB.with_name('dirtiq.before-seed.db')
        if not backup.exists(): shutil.copy2(DB,backup)
        temp=DB.with_suffix('.seed.tmp')
        if temp.exists(): temp.unlink()
        a=sqlite3.connect(f'file:{seed}?immutable=1',uri=True);b=sqlite3.connect(temp);a.backup(b);a.close();b.close()
        seeded=sqlite3.connect(temp)
        seed_columns=[row[1] for row in seeded.execute('pragma table_info(bettors)')]
        common=[name for name in columns if name in seed_columns]
        positions=[columns.index(name) for name in common]
        if common:
            placeholders=','.join('?' for _ in common)
            names=','.join(f'"{name}"' for name in common)
            for row in preserved:
                values=[row[i] for i in positions]
                try: seeded.execute(f'insert into bettors ({names}) values ({placeholders})',values)
                except sqlite3.IntegrityError:
                    # A matching seeded account is already present.
                    pass
        seeded.commit();seeded.close();temp.replace(DB)
    else:
        current.close()
for pattern in ('dirtiq_model_*.pkl','feature_params_*.json'):
    for p in (ROOT/'data').glob(pattern):
        if not (MODEL_DIR/p.name).exists():shutil.copy2(p,MODEL_DIR/p.name)
PY
python3 scripts/auto_refresh.py --loop &
worker_pid=$!
node server.js &
server_pid=$!
trap 'kill "$worker_pid" "$server_pid" 2>/dev/null || true' EXIT INT TERM
wait "$server_pid"
