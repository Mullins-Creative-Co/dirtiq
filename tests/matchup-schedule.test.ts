import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScheduleQuery, getScoreboardUrl, parseScoreboard } from '../src/lib/matchups/schedule.ts';

const event = (id = '1234') => ({
  id, date: '2026-11-09T20:00Z', status: { type: { description: 'Scheduled' } },
  competitions: [{ competitors: [
    { homeAway: 'away', team: { displayName: 'Road Team' }, score: '72' },
    { homeAway: 'home', team: { displayName: 'Home Team' }, score: '91' },
  ], odds: [{ details: 'HOME -10.5', overUnder: 221 }] }],
});

test('query rejects missing, unknown, injection and impossible dates', () => {
  for (const sport of [null, '', 'mlb', 'NFL', '__proto__', 'constructor', '../nba']) assert.throws(() => validateScheduleQuery(sport, '2026-11-09'));
  for (const date of [null, '', '2026-2-03', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-11-09&limit=1', 'not-a-date']) assert.throws(() => validateScheduleQuery('nba', date));
  assert.deepEqual(validateScheduleQuery('ncaab', '2024-02-29'), { sport: 'ncaab', date: '2024-02-29' });
});

test('scoreboard URLs use fixed allowlisted sport paths and college groups', () => {
  for (const [sport, path] of [['nfl', 'football/nfl'], ['nba', 'basketball/nba'], ['ncaaf', 'football/college-football'], ['ncaab', 'basketball/mens-college-basketball']] as const) {
    const url = new URL(getScoreboardUrl(sport, '2026-11-09'));
    assert.equal(url.origin, 'https://site.api.espn.com');
    assert.equal(url.pathname, `/apis/site/v2/sports/${path}/scoreboard`);
    assert.equal(url.searchParams.get('dates'), '20261109');
    assert.equal(url.searchParams.get('groups'), sport.startsWith('ncaa') ? '80' : null);
  }
});

test('schedule normalizes teams, deduplicates and never imports scores, odds or forecasts', () => {
  const games = parseScoreboard({ events: [event(), event()] }, 'nba');
  assert.equal(games.length, 1);
  const game = games[0];
  assert.equal(game.id, 'nba:espn:1234');
  assert.equal(game.home, 'Home Team');
  assert.equal(game.away, 'Road Team');
  assert.equal(game.startsAt, '2026-11-09T20:00:00.000Z');
  assert.equal(game.status, 'Scheduled');
  assert.equal(game.sourceUrl, 'https://www.espn.com/nba/game/_/gameId/1234');
  for (const key of ['homeSpread', 'homeOdds', 'awayOdds', 'baselineHomeMargin', 'homeCoverProbability'] as const) assert.equal(game[key], null);
  assert.ok(!('score' in game));
  assert.ok(!('actual' in game));
});

test('malformed events excluded, empty schedules distinguished from invalid responses', () => {
  assert.deepEqual(parseScoreboard({ events: [null, {}, { ...event(), id: 'bad/id' }, { ...event(), date: 'invalid' }, { ...event(), competitions: [] }] }, 'nfl'), []);
  assert.deepEqual(parseScoreboard({ events: [] }, 'ncaaf'), []);
  for (const payload of [null, {}, { events: {} }, { error: 'unavailable' }]) assert.throws(() => parseScoreboard(payload, 'nba'));
});
