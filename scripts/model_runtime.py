"""Shared deployment paths and audited race exclusions for training and scoring."""
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get('DIRTIQ_DATABASE_DIR') or ROOT / 'data')
if not DATA_DIR.is_absolute():
    DATA_DIR = ROOT / DATA_DIR
DB = DATA_DIR / 'dirtiq.db'
MODEL_DIR = Path(os.environ.get('DIRTIQ_MODEL_DIR', str(ROOT / 'data')))
QUALITY_PATH = ROOT / 'public/data/data-quality.json'
EXCLUDED_IDS = set(json.loads(QUALITY_PATH.read_text()).get('excludedRaceIds', [])) if QUALITY_PATH.exists() else set()


def connect():
    con = sqlite3.connect(DB)
    if EXCLUDED_IDS:
        ids = ','.join(str(int(i)) for i in sorted(EXCLUDED_IDS))
        con.execute(f'CREATE TEMP VIEW races AS SELECT * FROM main.races WHERE id NOT IN ({ids})')
    return con
