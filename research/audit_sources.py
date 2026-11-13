"""Record source availability/schema; no player data enters the study."""
from __future__ import annotations
import json
import platform
import urllib.error
import urllib.request
from pathlib import Path
import numpy
import pandas
import scipy
import sklearn

OUT = Path(__file__).resolve().parent / 'output'
URLS = [
 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/2024/teams/150/athletes?limit=1000',
 'https://api.collegefootballdata.com/player/returning?year=2024',
]

def main():
    rows = []
    for url in URLS:
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'dirtiq-research/1.0'})
            with urllib.request.urlopen(req, timeout=25) as response:
                data = json.load(response)
                rows.append({'url':url,'status':response.status,'topLevelFields':list(data) if isinstance(data,dict) else 'list',
                             'count':data.get('count') if isinstance(data,dict) else len(data)})
        except Exception as exc:
            rows.append({'url':url,'error':str(exc)})
    report = {'probes':rows,
      'rosterConclusion':'No verified preseason as-of continuity panel obtained. A historical season roster is not proof of preseason availability; current/season-final membership is excluded. CFBD requires bearer authentication. Stop roster extension.',
      'rosterDocs':['https://hoopr.sportsdataverse.org/articles/espn-endpoints.html','https://api.collegefootballdata.com/data-availability','https://api.collegefootballdata.com/authentication'],
      'conferenceConclusion':'NCAAB conference IDs joined from game-season schedule records. NFL/NBA/NCAAF cached schedule inputs do not include historical memberships; conference rankings unavailable for those sports, not backfilled from current alignment.',
      'travelConclusion':'City-centroid straight-line displacement between successive same-season game venues; US/Canada GeoNames matches only. First appearances/unmatched cities are missing. Football venue coordinates unavailable; reduced model only.',
      'openingConclusion':'No opener-time forecast snapshots or intermediate timestamped prices. At-open filtered results are counterfactual and cannot validate an executable rule.',
      'runtime':{'python':platform.python_version(),'numpy':numpy.__version__,'pandas':pandas.__version__,'scipy':scipy.__version__,'sklearn':sklearn.__version__},
      'numericWarningReference':'https://github.com/numpy/numpy/issues/28687'}
    (OUT/'source-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()
