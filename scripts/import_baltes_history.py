#!/usr/bin/env python3
"""Import reviewed Eldora Baltes Classic box scores, keeping twin features separate.

Reads saved official pages from --source-dir. Defaults to a rolled-back dry run.
"""
import argparse
import html
import json
import re
import sqlite3
from pathlib import Path
from import_eldora_box_score import parse_entry

EVENTS = [
    ('2021-09-05', '13th-baltes-classic'),
    ('2023-09-03', '2023-baltes-classic'),
    ('2024-09-01', '16th-baltes-classic'),
    ('2025-08-31', '17th-baltes-classic'),
    ('2026-09-06', '2026-baltes-classic'),
]


def normalize(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def parse_page(page):
    text = html.unescape(re.sub(r'<[^>]+>', '\n', page))
    text = text.split('Event Box Score', 1)[1]
    text = re.split(r'\bModifieds\b', text, maxsplit=1)[0]
    sections = []
    group = ''
    active = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        match = re.search(r'Late Models Group ([AB])', line)
        if match:
            group = match[1]
        if re.search(r'Qualifying|Hot Lap Qualify|^Heat|^A-Feature|^Feature [AB]|^B-Feature|^Last Chance', line):
            kind = ('qualifying' if re.search(r'Qualifying|Hot Lap Qualify', line)
                    else 'heat' if line.startswith('Heat')
                    else 'feature' if re.match(r'A-Feature|Feature [AB]', line)
                    else 'bmain')
            active = {'name': line, 'kind': kind, 'group': group, 'body': ''}
            sections.append(active)
        elif active and re.match(r'\d+\.', line):
            active['body'] += ' ' + line
    for section in sections:
        entries = []
        for value in section.pop('body').split(';'):
            value = value.strip()
            time = None
            if section['kind'] == 'qualifying':
                match = re.search(r',\s*(\d+\.\d+)(?:\[\d+\])?\s*$', value)
                if match:
                    time = float(match[1])
                    value = value[:match.start()]
                    if time >= 60:  # Official no-time placeholders include 99.991.
                        time = None
            row = parse_entry(value)
            if row:
                entries.append({'name': row.driver_name, 'car': row.car_number,
                                'position': row.position, 'start': row.start,
                                'dns': row.dns, 'time': time})
        section['entries'] = entries
    return sections


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    db = sqlite3.connect(args.database)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    track = db.execute("SELECT id FROM tracks WHERE name='Eldora Speedway'").fetchone()
    assert track, 'Eldora track must exist'
    report = []
    db.execute('BEGIN')
    try:
        for date, slug in EVENTS:
            sections = parse_page((Path(args.source_dir) / (slug + '.html')).read_text())
            features = [s for s in sections if s['kind'] == 'feature']
            assert len(features) == (2 if date[:4] in ('2025', '2026') else 1), (date, features)
            for index, feature in enumerate(features):
                rows = feature['entries']
                assert len(rows) >= 20 and [r['position'] for r in rows] == list(range(1, len(rows)+1)), date
                assert len({normalize(r['name']) for r in rows}) == len(rows)
                assert all(r['start'] for r in rows), date
                suffix = ' — Feature ' + chr(65+index) if len(features)>1 else ''
                name = date[:4] + ' Baltes Classic' + suffix
                url = 'https://www.eldoraspeedway.com/event_coverage/' + slug + '/'
                distance = 25 if len(features)>1 else 30
                race = db.execute('SELECT id FROM races WHERE track_id=? AND race_date=? AND name=?', (track['id'], date, name)).fetchone()
                race_id = race['id'] if race else db.execute("""INSERT INTO races(name,track_id,race_date,division,series_mode,distance,status,betting_status,results_source)
                    VALUES(?,?,?,'Crown Jewel / Combined','Crown Jewel / Combined',?,'complete','closed',?)""", (name,track['id'],date,distance,url)).lastrowid
                added = 0
                for row in rows:
                    key = normalize(row['name'])
                    candidates = [d for d in db.execute('SELECT id,name,notes FROM drivers') if normalize(d['name']) == key]
                    if len(candidates)>1:
                        established = [d for d in candidates if not (d['notes'] or '').startswith('Created from ')]
                        assert len(established)==1, row['name']
                        candidates = established
                    driver_id = candidates[0]['id'] if candidates else db.execute("INSERT INTO drivers(name,car_number,division,notes) VALUES(?,?,'Independent','Created from official Baltes Classic import')", (row['name'],row['car'])).lastrowid
                    heats = [e['position'] for s in sections if s['kind']=='heat' for e in s['entries'] if normalize(e['name'])==key and not e['dns']]
                    times = [e['time'] for s in sections if s['kind']=='qualifying' for e in s['entries'] if normalize(e['name'])==key and e['time'] is not None]
                    values = (row['car'],row['start'],row['position'],min(heats) if heats else None,min(times) if times else None)
                    old = db.execute('SELECT * FROM race_entries WHERE race_id=? AND driver_id=?', (race_id,driver_id)).fetchone()
                    if old:
                        columns = ('car_number','starting_position','finishing_position','heat_position','qualifying_time')
                        assert all(old[k] is None or old[k] == value for k,value in zip(columns,values))
                        for column,value in zip(columns,values):
                            if old[column] is None and value is not None:
                                db.execute(f'UPDATE race_entries SET {column}=? WHERE id=?', (value,old['id']))
                        continue
                    db.execute("""INSERT INTO race_entries(race_id,driver_id,car_number,starting_position,finishing_position,heat_position,qualifying_time,entry_series,entry_status)
                        VALUES(?,?,?,?,?,?,?,'Independent','confirmed')""", (race_id,driver_id,*values))
                    added += 1
                if added:
                    db.execute("UPDATE races SET results_imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", (race_id,))
                report.append({'raceId':race_id,'date':date,'name':name,'source':url,'finishers':len(rows),'newEntries':added,'winner':rows[0]['name']})
        cancel_url = 'https://www.eldoraspeedway.com/2022/09/04/baltes-classic-canceled/'
        if not db.execute("SELECT id FROM races WHERE track_id=? AND race_date='2022-09-04' AND name='2022 Baltes Classic'", (track['id'],)).fetchone():
            db.execute("""INSERT INTO races(name,track_id,race_date,division,series_mode,status,betting_status,results_source,weather_notes)
                VALUES('2022 Baltes Classic',?,'2022-09-04','Crown Jewel / Combined','Crown Jewel / Combined','cancelled','closed',?,'Cancelled due to rain; official Eldora notice.')""", (track['id'],cancel_url))
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        if args.apply:
            db.commit()
        else:
            db.rollback()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
    Path(args.report).write_text(json.dumps({'applied':args.apply,'races':report,'cancelled':{'date':'2022-09-04','source':cancel_url}},indent=2)+'\n')
    print(json.dumps({'features':len(report),'finishers':sum(r['finishers'] for r in report),'newEntries':sum(r['newEntries'] for r in report),'applied':args.apply}))


if __name__ == '__main__':
    main()
