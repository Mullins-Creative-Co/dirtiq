"""Audit temporal coverage without inferring when untimestamped data was known."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import pandas as pd
from build_history import fetch, stamp

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', type=Path, default=Path('.football-cache'))
args = parser.parse_args()
reports = []
for year in [2024, 2025]:
    url = f'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{year}.parquet'
    try:
        path = args.cache/f'injuries_{year}.parquet'; source = fetch(url, path)
        frame = pd.read_parquet(path)
        timestamps = pd.to_datetime(frame['date_modified'], utc=True, errors='coerce') if 'date_modified' in frame else pd.Series(pd.NaT, index=frame.index)
        reports.append(dict(season=year, rows=len(frame), timestamped=int(timestamps.notna().sum()),
            status='Not enabled: source modification times still require point-in-time validation.' if timestamps.notna().any() else 'Blocked: no publication/modification timestamps.', source=source))
    except Exception as e:
        reports.append(dict(season=year, rows=0, timestamped=0, status=f'Unavailable: {e}', source=dict(url=url)))
data = dict(checkedAt=stamp(datetime.now(timezone.utc)), injuries=reports,
    enabled=['Lagged offensive/defensive EPA', 'Opponent-adjusted ratings', 'Previous-game QB proxy', 'Home/neutral site', 'Rest/bye differential', 'Sack-or-QB-hit protection proxies', 'Turnover rates', 'Pass/run matchup tendencies'],
    excluded=['Untimestamped injury and confirmed-starter inputs', 'Realized weather (not a pregame forecast)', 'Untimestamped odds movement'],
    nextRequirement='Timestamped injury/announced-starter and forecast snapshots linked to each prediction. Absence of verified data is never treated as a healthy roster.')
output = Path('public/football/readiness.json'); output.write_text(json.dumps(data, indent=2)+'\n')
print(json.dumps(reports, indent=2))
