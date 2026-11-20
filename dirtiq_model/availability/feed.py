from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

LEAGUES = {'nba': ('basketball','nba'), 'nfl': ('football','nfl'),
           'ncaab': ('basketball','mens-college-basketball'), 'ncaaf': ('football','college-football')}
OUT = {'out','injured reserve','ir','suspension','suspended','pup','nfi','reserve/pup','reserve/nfi'}
UNCERTAIN = {'questionable','doubtful','probable','day-to-day','day to day','dtd'}
ALIASES = {'nba': {'NYK':'NY','GSW':'GS','NOP':'NO','SAS':'SA','UTA':'UTAH','PHX':'PHO'},
           'nfl': {'WSH':'WAS','LAR':'LA','STL':'LA','OAK':'LV','SD':'LAC'}}


def stamp(value: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return dt.astimezone(timezone.utc) if dt.tzinfo else None
    except (TypeError,ValueError):
        return None


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')


def team_code(sport: str, value: str) -> str:
    return ALIASES.get(sport,{}).get(value.upper(),value.upper())


def feed_url(sport: str) -> str:
    sp,lg=LEAGUES[sport]
    return 'https://site.api.espn.com/apis/site/v2/sports/%s/%s/injuries?limit=1000' % (sp,lg)


def athlete_id(athlete: Dict[str,Any]) -> Optional[str]:
    # Injury/news ids are NOT player ids. Only explicit athlete ids or athlete URLs.
    if str(athlete.get('id','')).isdigit():
        return str(athlete['id'])
    ids=set()
    for link in athlete.get('links') or []:
        match=re.search(r'/player/(?:[^?]*?/)?_?/id/(\d+)',str(link.get('href','')))
        if match: ids.add(match.group(1))
    return next(iter(ids)) if len(ids)==1 else None


def normalize(sport: str, payload: Dict[str,Any], now: datetime) -> Dict[str,Any]:
    source_time=stamp(payload.get('timestamp'))
    source_fresh=source_time is not None and timedelta(0) <= now-source_time <= timedelta(hours=6)
    teams=[]; recent=0; total=0
    for group in payload.get('injuries') or []:
        latest={}; code=None
        for row in group.get('injuries') or []:
            athlete=row.get('athlete') or {}; team=athlete.get('team') or {}
            if str(team.get('id')) != str(group.get('id')):
                continue  # Trade/stale-team conflict: never join by player name.
            code=team_code(sport,str(team.get('abbreviation') or '')) or code
            published=stamp(row.get('date'))
            if published is None or published > now: continue
            pid=athlete_id(athlete)
            key=pid or 'unmatched:'+str(row.get('id',''))
            status=str(row.get('status') or 'Unknown')
            category='out' if status.lower() in OUT else 'uncertain' if status.lower() in UNCERTAIN else 'available' if status.lower() in ('active','available','healthy') else 'unknown'
            player={'athleteId':pid,'name':athlete.get('displayName') or 'Unknown player',
                    'position':(athlete.get('position') or {}).get('abbreviation'),
                    'status':status,'category':category,'publishedAt':iso(published),
                    'stale':now-published>timedelta(days=7),
                    'note':' / '.join(str((row.get('details') or {}).get(k)) for k in ('side','type','detail') if (row.get('details') or {}).get(k)),
                    'sourceUrl':next((l.get('href') for l in athlete.get('links') or [] if 'playercard' in l.get('rel',[])),None)}
            previous=latest.get(key)
            if previous is None or player['publishedAt'] > previous['publishedAt']:
                latest[key]=player
            elif player['publishedAt']==previous['publishedAt'] and player['category'] != previous['category']:
                latest[key]=dict(player,category='unknown',status='Conflicting statuses')
        # Deduplicate before excluding Active, or an older Out item survives a return.
        listed=[p for p in latest.values() if p['category'] != 'available']
        recent+=sum(not p['stale'] for p in listed); total+=len(listed)
        teams.append({'teamId':str(group.get('id')), 'team':code,'name':group.get('displayName'),
                      'players':sorted(listed,key=lambda p:(p['category']!='out',p['name'])),
                      'coverage':'listed' if listed else 'no-listed-issues',
                      'qbFlag':sport in ('nfl','ncaaf') and any(p['position']=='QB' for p in listed)})
    usable=source_fresh and recent>0
    reason=None if usable else 'No current player reports in this feed; absence of entries does not mean healthy.' if not recent else 'Source timestamp missing, stale or invalid.'
    ending=now.year+1 if now.month>=10 else now.year
    return {'officialSourceUrl':('https://official.nba.com/nba-injury-report-%d-%02d-season/' % (ending-1,ending%100)) if sport=='nba' else None,
            'sport':sport,'sourceUrl':feed_url(sport),'sourcePublishedAt':iso(source_time) if source_time else None,
            'retrievedAt':iso(now),'coverage':'partial' if usable else 'unavailable',
            'reason':reason,'listedPlayers':total,'recentPlayers':recent,'teams':teams if usable else []}
