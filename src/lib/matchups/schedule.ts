import type { SportId } from './model.ts';
import type { MatchupGame } from './catalog.ts';

export const SCHEDULE_SOURCE = 'ESPN public scoreboard · schedule only';
const paths: Record<SportId, string> = {
  nfl: 'football/nfl', ncaaf: 'football/college-football',
  nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball',
};

export function validateScheduleQuery(sport: string | null, date: string | null): { sport: SportId; date: string } {
  if (!sport || !Object.prototype.hasOwnProperty.call(paths, sport)) throw new Error('Sport must be nfl, nba, ncaaf or ncaab.');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be a valid YYYY-MM-DD date.');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Date must be a valid YYYY-MM-DD date.');
  return { sport: sport as SportId, date };
}

export function getScoreboardUrl(sport: SportId, date: string): string {
  validateScheduleQuery(sport, date);
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/scoreboard`);
  url.searchParams.set('dates', date.replaceAll('-', ''));
  url.searchParams.set('limit', '1000');
  if (sport === 'ncaaf' || sport === 'ncaab') url.searchParams.set('groups', '80');
  return url.toString();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function label(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export function parseScoreboard(payload: unknown, sport: SportId): MatchupGame[] {
  const events = object(payload).events;
  if (!Array.isArray(events)) throw new Error('ESPN returned an invalid scoreboard response.');
  const games = new Map<string, MatchupGame>();
  for (const raw of events) {
    const event = object(raw);
    const eventId = label(event.id);
    if (!/^\d+$/.test(eventId)) continue;
    const competition = object(Array.isArray(event.competitions) ? event.competitions[0] : null);
    const competitors = Array.isArray(competition.competitors) ? competition.competitors.map(object) : [];
    const homeRows = competitors.filter(team => team.homeAway === 'home');
    const awayRows = competitors.filter(team => team.homeAway === 'away');
    if (homeRows.length !== 1 || awayRows.length !== 1) continue;
    const teamName = (team: Record<string, unknown>) => label(object(team.team).displayName) || label(object(team.team).name) || label(object(team.team).abbreviation);
    const home = teamName(homeRows[0]);
    const away = teamName(awayRows[0]);
    const date = label(event.date) || label(competition.date);
    if (!home || !away || home === away || !date || !Number.isFinite(Date.parse(date))) continue;
    const status = object(object(event.status ?? competition.status).type);
    const id = `${sport}:espn:${eventId}`;
    if (games.has(id)) continue;
    games.set(id, {
      id, sport, home, away, startsAt: new Date(date).toISOString(),
      status: label(status.shortDetail) || label(status.description) || label(status.name) || 'Schedule status unavailable',
      sourceLabel: SCHEDULE_SOURCE,
      sourceUrl: `https://www.espn.com/${sport === 'ncaaf' ? 'college-football' : sport === 'ncaab' ? 'mens-college-basketball' : sport}/game/_/gameId/${eventId}`,
      baselineHomeMargin: null, baselineSource: 'No model forecast supplied by schedule lookup',
      homeSpread: null, homeOdds: null, awayOdds: null, book: '', quoteObservedAt: '',
      homeCoverProbability: null, probabilitySource: 'No forecast probability supplied',
      warnings: [
        'Schedule only. Enter an independent pregame baseline and current timestamped book quotes to run a scenario.',
        'Public scoreboard coverage may be incomplete and start times or status may change. ESPN odds are not imported as executable offers.',
      ],
    });
  }
  return [...games.values()].sort((a, b) => a.startsAt!.localeCompare(b.startsAt!) || a.id.localeCompare(b.id));
}
