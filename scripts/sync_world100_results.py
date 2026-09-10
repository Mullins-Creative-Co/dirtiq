#!/usr/bin/env python3
"""Discover posted World 100 box scores from Eldora's official 2026 archive.

Only imports explicitly dated Sep 10–12 coverage with complete, contiguous
feature result lists. Unknown HTML/formats remain pending, never invented.
"""
import html
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime,timezone
from model_runtime import ROOT,DB,DATA_DIR
from import_baltes_history import parse_page


def fetch(url):
    return subprocess.check_output(['curl','-fsSL','--max-time','25',url],text=True)


def main():
    archive=fetch('https://www.eldoraspeedway.com/events/?event_year=2026')
    targets={}
    for m in re.finditer(r'href="(https://www\.eldoraspeedway\.com/event_coverage/[^\"]+)"',archive):
        if not re.search(r'world[-_]?100',m[1],re.I): continue
        context=html.unescape(re.sub('<[^>]*>',' ',archive[max(0,m.start()-900):m.start()]))
        dates=re.findall(r'(?:Thursday|Friday|Saturday),\s*Sep\s*(10|11|12)\b',context)
        if dates: targets[m[1]]='2026-09-'+dates[-1]
    output=[]
    folder=DATA_DIR/'world100-results';folder.mkdir(parents=True,exist_ok=True)
    for url,date in targets.items():
        try:
            page=fetch(url);sections=parse_page(page)
            features=[s for s in sections if s['kind']=='feature']
            if not features: raise ValueError('No supported final feature box score found')
            if len(features)!=(1 if date.endswith('12') else 2): raise ValueError('Expected one final or two prelim features')
            for f in features:
                rows=f['entries']
                if len(rows)<20 or [e['position'] for e in rows]!=list(range(1,len(rows)+1)) or not all(e['start'] for e in rows):
                    raise ValueError('Incomplete feature result list')
            con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
            snapshots=[]
            with con:
                track=con.execute("SELECT id FROM tracks WHERE name='Eldora Speedway'").fetchone()['id']
                for index,f in enumerate(features):
                    name=f'56th World 100 | {date} '+('Final' if len(features)==1 else 'Prelim '+chr(65+index))
                    r=con.execute('SELECT * FROM races WHERE race_date=? AND name=?',(date,name)).fetchone()
                    if r is None:
                        rid=con.execute("INSERT INTO races(name,race_date,track_id,distance,division,series_mode,status,betting_status) VALUES(?,?,?,?,'Crown Jewel / Combined','Crown Jewel / Combined','upcoming','closed')",(name,date,track,100 if len(features)==1 else 25)).lastrowid
                        r=con.execute('SELECT * FROM races WHERE id=?',(rid,)).fetchone()
                    sessions=[]
                    for s in [f]+[s for s in sections if s['kind'] in ('heat','qualifying')]:
                        sessions.append({'name':'Super Late Models '+s['name'],'type':s['kind'],'entries':[{'driver_name':e['name'],'car_number':e['car'],'position':e['position'],'starting_position':e['start'],'time':e['time'],'dnf':e['dns']} for e in s['entries']]})
                    snapshots.append({'race':dict(r),'url':url,'sessions':sessions})
            con.close()
            snapshot=folder/(date+'.json');snapshot.write_text(json.dumps(snapshots,indent=2))
            (folder/(date+'.html')).write_text(page)
            result=subprocess.run([sys.executable,'scripts/backfill_verified_mrp.py','--database',str(DB),'--snapshots',str(snapshot),'--report',str(folder/(date+'-report.json')),'--apply'],cwd=ROOT,capture_output=True,text=True,check=True)
            output.append({'date':date,'source':url,'result':json.loads(result.stdout)})
        except Exception as error:
            output.append({'date':date,'source':url,'error':str(error)})
    status={'checkedAt':datetime.now(timezone.utc).isoformat(),'sources':len(targets),'results':output,'message':'Waiting for official dated World 100 coverage.' if not targets else 'Checked posted official coverage.'}
    tmp=DATA_DIR/'world100-results-status.tmp';tmp.write_text(json.dumps(status,indent=2));tmp.replace(DATA_DIR/'world100-results-status.json')
    print(json.dumps(status))


if __name__=='__main__': main()
