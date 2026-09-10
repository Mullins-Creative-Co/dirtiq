#!/usr/bin/env python3
"""Refresh the official World 100 registration snapshot; registrations are not grids."""
import html
import json
import re
import subprocess
from datetime import datetime,timezone
from pathlib import Path
from model_runtime import ROOT,DB
import sqlite3

URL='https://www.eldoraspeedway.com/event/56th-world-100/'

def main():
    page=subprocess.check_output(['curl','-fsSL','--max-time','30',URL],text=True)
    table=next((t for t in re.findall(r'<table\b.*?</table>',page,re.S) if all(h in t for h in ['Hometown','Chassis','Engine'])),None)
    if table is None: raise ValueError('Official entry table unavailable; keeping previous snapshot')
    rows=[[html.unescape(re.sub('<[^>]*>','',cell)).strip() for cell in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',tr,re.S)] for tr in re.findall(r'<tr\b.*?</tr>',table,re.S)]
    entries=[{'car':r[1],'name':r[2]+' '+r[3],'hometown':r[4]+', '+r[5],'chassis':r[6],'engine':r[7]} for r in rows if len(r)==8 and r[0].isdigit()]
    if len(entries)<40: raise ValueError('Unexpected registration count; refusing partial update')
    con=sqlite3.connect(DB);con.row_factory=sqlite3.Row
    norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
    with con:
        track=con.execute("SELECT id FROM tracks WHERE name='Eldora Speedway'").fetchone()['id']
        name='56th World 100 | Prelim registration pool'
        race=con.execute('SELECT id FROM races WHERE name=? AND race_date=?',(name,'2026-09-10')).fetchone()
        race_id=race['id'] if race else con.execute("INSERT INTO races(name,track_id,race_date,division,series_mode,distance,status,betting_status) VALUES(?,?,'2026-09-10','Crown Jewel / Combined','Crown Jewel / Combined',25,'upcoming','closed')",(name,track)).lastrowid
        for entry in entries:
            drivers=[d for d in con.execute('SELECT id,name,notes FROM drivers') if norm(d['name'])==norm(entry['name'])]
            if len(drivers)>1:
                preferred=[d for d in drivers if not (d['notes'] or '').startswith('Created from ')]
                if len(preferred)==1: drivers=preferred
                else: raise ValueError('Ambiguous registration: '+entry['name'])
            driver=drivers[0]['id'] if drivers else con.execute("INSERT INTO drivers(name,car_number,division,notes) VALUES(?,?,'Independent','Created from official World 100 registration')",(entry['name'],entry['car'])).lastrowid
            entry['driverId']=driver
            con.execute("INSERT OR IGNORE INTO race_entries(race_id,driver_id,car_number,entry_status,entry_series) VALUES(?,?,?,'unconfirmed','Independent')",(race_id,driver,entry['car']))
    con.close()
    match=re.search(r'As of\s+(\d+/\d+/\d+)',html.unescape(re.sub('<[^>]+>',' ',page)))
    snapshot={'source':URL,'checkedAt':datetime.now(timezone.utc).isoformat(),'entryListAsOf':match[1] if match else None,'poolRaceId':race_id,'entries':entries,'dates':['2026-09-10','2026-09-11','2026-09-12'],'registrationOnly':True}
    dest=ROOT/'public/data/world100.json';tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(snapshot,indent=2)+'\n');tmp.replace(dest)
    print(json.dumps({'entries':len(entries),'poolRaceId':race_id,'asOf':snapshot['entryListAsOf']}))

if __name__=='__main__': main()
