#!/usr/bin/env python3
"""Fill absent MRP results/fields from reviewed parser snapshots; never settle bets.

Usage: python3 scripts/backfill_verified_mrp.py --database PATH --snapshots PATH [PATH ...] --report PATH [--apply]
Split features are separate races. Existing non-null values are preserved.
"""
import argparse
import json
import re
import sqlite3
from pathlib import Path


def norm(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--database', required=True)
    ap.add_argument('--snapshots', nargs='+', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    db = sqlite3.connect(args.database)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    report = []
    db.execute('BEGIN')
    try:
        for file in args.snapshots:
            for event in json.loads(Path(file).read_text()):
                race = db.execute('SELECT * FROM races WHERE id=?', (event['race']['id'],)).fetchone()
                note = {'raceId': race['id'], 'name': race['name'], 'date': race['race_date'], 'source': event.get('url'), 'features': []}
                report.append(note)
                if event.get('error'):
                    note['unresolved'] = event['error']; continue
                sessions = event['sessions']
                # Prefer explicit touring-series classes over support late models.
                valid = [s for s in sessions if not re.search(r'sportsman|rush|crate|limited|604|602|pro late',s['name'],re.I)]
                all_features = [s for s in valid if s['type']=='feature' and not re.search(r'dash|non.qualifier|non.qualifiers|shootout|\bb[- ]feature|\bb[- ]main', s['name'], re.I)]
                specific = [s for s in all_features if re.search(r'woo|world of outlaws|lolmds|lolmds|lucas oil', s['name'], re.I)]
                features = specific or [s for s in all_features if re.search(r'(dirt )?super late model', s['name'], re.I)]
                prefixes = [re.match(r'.*?Late Models?',f['name'],re.I).group(0) for f in features if re.match(r'.*?Late Models?',f['name'],re.I)]
                sessions = [s for s in valid if any(s['name'].lower().startswith(p.lower()) for p in prefixes)]
                if not features:
                    note['unresolved'] = 'No verified touring-series feature (may be cancelled or preliminary-only)'; continue
                existing = db.execute('SELECT d.name,e.finishing_position FROM race_entries e JOIN drivers d ON d.id=e.driver_id WHERE e.race_id=? AND e.finishing_position IS NOT NULL', (race['id'],)).fetchall()
                if existing:
                    signature = {(norm(r['name']), r['finishing_position']) for r in existing}
                    matches = [f for f in features if signature <= {(norm(e['driver_name']),e['position']) for e in f['entries']}]
                    if len(matches)!=1:
                        note['unresolved'] = 'Existing results conflict with source or feature is ambiguous'; continue
                    first = matches[0]
                    features = [first] + [f for f in features if f is not first]
                for index, feature in enumerate(features):
                    rows = feature['entries']
                    positions = [e['position'] for e in rows]
                    if len(rows)<10 or sorted(positions)!=list(range(1,len(rows)+1)) or len({norm(e['driver_name']) for e in rows})!=len(rows):
                        note.setdefault('rejected', []).append(feature['name']); continue
                    if index==0:
                        race_id=race['id']
                    else:
                        title = re.sub(r'\s*\([^)]*[Ff]eature\)\s*$', '', race['name']) + ' (' + feature['name'] + ')'
                        sibling=db.execute('SELECT id FROM races WHERE mrp_event_id=? AND name=? AND race_date=?',(race['mrp_event_id'],title,race['race_date'])).fetchone()
                        if not sibling:
                            source_signature={(norm(e['driver_name']),e['position']) for e in rows}
                            for candidate in db.execute('SELECT id FROM races WHERE mrp_event_id=? AND race_date=? AND id!=?',(race['mrp_event_id'],race['race_date'],race['id'])).fetchall():
                                stored={(norm(e['name']),e['finishing_position']) for e in db.execute('SELECT d.name,e.finishing_position FROM race_entries e JOIN drivers d ON d.id=e.driver_id WHERE e.race_id=? AND e.finishing_position IS NOT NULL',(candidate['id'],))}
                                if stored and stored <= source_signature:
                                    sibling=candidate; break
                        if sibling: race_id=sibling['id']
                        else:
                            race_id=db.execute("""INSERT INTO races(name,track_id,race_date,division,series_mode,mrp_event_id,status,betting_status)
                                VALUES(?,?,?,?,?,?,'complete','closed')""",(title,race['track_id'],race['race_date'],race['division'],race['series_mode'],race['mrp_event_id'])).lastrowid
                    fields=0; added=0
                    for entry in rows:
                        key=norm(entry['driver_name'])
                        drivers=[r for r in db.execute('SELECT id,name,notes FROM drivers') if norm(r['name'])==key]
                        if len(drivers)>1:
                            local=[r for r in drivers if db.execute('SELECT 1 FROM race_entries WHERE race_id=? AND driver_id=?',(race_id,r['id'])).fetchone()]
                            if len(local)==1: drivers=local
                            else:
                                established=[r for r in drivers if not (r['notes'] or '').startswith('Created from ')]
                                if len(established)==1: drivers=established
                                else: raise ValueError(f'Ambiguous driver {entry["driver_name"]}')
                        driver_id=drivers[0]['id'] if drivers else db.execute('INSERT INTO drivers(name,car_number,division,notes) VALUES(?,?,?,?)',(entry['driver_name'],entry.get('car_number'),race['division'],'Created from verified MRP gap backfill')).lastrowid
                        heat=[]; qualifying=[]
                        for session in sessions:
                            for row in session['entries']:
                                if norm(row['driver_name'])!=key: continue
                                if session['type']=='heat': heat.append(row['position'])
                                if session['type']=='qualifying' and row.get('time'): qualifying.append(row['time'])
                        values={'finishing_position':entry['position'],'starting_position':entry.get('starting_position'),'heat_position': min(heat) if heat else None,'qualifying_time':min(qualifying) if qualifying else None,'car_number':entry.get('car_number')}
                        old=db.execute('SELECT * FROM race_entries WHERE race_id=? AND driver_id=?',(race_id,driver_id)).fetchone()
                        if not old:
                            db.execute("INSERT INTO race_entries(race_id,driver_id,entry_series,entry_status) VALUES(?,?,?,'confirmed')",(race_id,driver_id,race['division'])); added+=1
                        for column,value in values.items():
                            if value is not None:
                                fields+=db.execute(f'UPDATE race_entries SET {column}=? WHERE race_id=? AND driver_id=? AND {column} IS NULL',(value,race_id,driver_id)).rowcount
                    if fields or added:
                        db.execute("UPDATE races SET status='complete',is_live=0,betting_status=CASE WHEN betting_status='settled' THEN betting_status ELSE 'closed' END,results_source=?,results_imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",(event['url'],race_id))
                    note['features'].append({'raceId':race_id,'session':feature['name'],'finishers':len(rows),'newEntries':added,'filledFields':fields})
        violations=db.execute('PRAGMA foreign_key_check').fetchall()
        if violations: raise ValueError(f'Foreign key violations: {violations[:5]}')
        if args.apply: db.commit()
        else: db.rollback()
    except BaseException:
        db.rollback(); raise
    finally: db.close()
    Path(args.report).write_text(json.dumps({'applied':args.apply,'events':report},indent=2)+'\n')
    print(json.dumps({'events':len(report),'features':sum(len(e['features']) for e in report),'filledFields':sum(f['filledFields'] for e in report for f in e['features']),'newEntries':sum(f['newEntries'] for e in report for f in e['features']),'unresolved':sum('unresolved' in e for e in report),'applied':args.apply}))

if __name__=='__main__': main()
