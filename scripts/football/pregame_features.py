"""Current NFL team-EPA features. Never target-game results or sportsbook prices."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
from build_history import aggregate_season, fetch, prepare_games, rating, stamp, SCHEDULE_URL


def build_features(schedule, team_rows, defense_rows, now, days=8):
    completed = [g for g in prepare_games(schedule) if g['available_at'] < now]
    offense = {(r['game_id'], r['posteam']): r for r in team_rows}
    defense = {(r['game_id'], r['defteam']): r for r in defense_rows}
    histories, defenses, expected = {}, {}, {}
    for game in completed:
        for team in [game['home_team'], game['away_team']]:
            expected[team] = game['game_id']
            for source, target in [(offense, histories), (defense, defenses)]:
                row = source.get((game['game_id'], team))
                if row:
                    target.setdefault(team, []).append({**row, 'available_at': game['available_at']})
    games, blocked = [], []
    for row in schedule.to_dict('records'):
        if pd.isna(row['gametime']): continue
        kickoff = datetime.fromisoformat(f"{row['gameday']}T{row['gametime']}").replace(tzinfo=ZoneInfo('America/New_York')).astimezone(timezone.utc)
        if not now < kickoff <= now + timedelta(days=days): continue
        home, away = row['home_team'], row['away_team']
        errors, features = [], {}
        for team in [home, away]:
            recent = [r for r in histories.get(team, []) if r['available_at'] >= now-timedelta(days=730)]
            recent_def = [r for r in defenses.get(team, []) if r['available_at'] >= now-timedelta(days=730)]
            if len(recent) < 3 or len(recent_def) < 3:
                errors.append(f'{team}: insufficient prior play-by-play')
            elif recent[-1]['game_id'] != expected.get(team) or recent_def[-1]['game_id'] != expected.get(team):
                errors.append(f'{team}: play-by-play missing for latest eligible completed game')
            elif now - recent[-1]['available_at'] > timedelta(days=21):
                errors.append(f'{team}: latest team input is over 21 days old')
            else:
                features[team] = (rating(recent, now)[0], rating(recent_def, now)[0], recent[-1]['game_id'], stamp(recent[-1]['available_at']), len(recent))
        espn = row.get('espn')
        if pd.isna(espn): errors.append('Missing ESPN event identity')
        if errors:
            blocked.append({'gameId': row['game_id'], 'reasons': errors}); continue
        h, a = features[home], features[away]
        games.append(dict(id=f"nfl:espn:{int(espn)}", gameId=row['game_id'], home=home, away=away,
            startsAt=stamp(kickoff), featureAsOf=stamp(now), off_epa_diff=h[0]-a[0],
            def_epa_allowed_diff=h[1]-a[1], home_field=0 if row['location']=='Neutral' else 1,
            homeLatestGame=h[2], awayLatestGame=a[2], homeLatestAvailableAt=h[3], awayLatestAvailableAt=a[3],
            homeHistoryGames=h[4], awayHistoryGames=a[4]))
    return games, blocked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/dirtiq-pregame-cache'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    started = datetime.now(timezone.utc)
    path = args.cache/'games.csv'
    sources = [{**fetch(SCHEDULE_URL, path, True), 'retrievedAt': stamp(datetime.fromtimestamp(path.stat().st_mtime, timezone.utc))}]
    schedule = pd.read_csv(path)
    season = started.year if started.month >= 3 else started.year-1
    schedule = schedule[schedule.season.between(season-2, season)]
    teams, defenses = [], []
    for year in range(season-2, season+1):
        t, d, _, source = aggregate_season(year, args.cache, refresh=year==season)
        cache_file = args.cache/f'play_by_play_{year}.parquet'
        source['retrievedAt'] = stamp(datetime.fromtimestamp(cache_file.stat().st_mtime, timezone.utc))
        sources.append(source)
        teams.extend(t.to_dict('records')); defenses.extend(d.to_dict('records'))
    games, blocked = build_features(schedule, teams, defenses, started)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(generatedAt=stamp(started), games=games, blocked=blocked, sources=sources), allow_nan=False)+'\n')
    print(json.dumps({'eligible':len(games),'blocked':len(blocked)}))

if __name__ == '__main__': main()
