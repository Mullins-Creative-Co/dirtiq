import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildResearch, pairedInterval, qbSegments } from '../src/lib/football/research.ts';
import { defaults, demoGames, runBacktest } from '../src/lib/football/model.ts';

test('paired intervals are reproducible and zero for identical predictions', () => {
  const rows = runBacktest(demoGames(), defaults).predictions.filter(p => p.model === 'Team EPA');
  assert.deepEqual(pairedInterval(rows, rows), { low: 0, high: 0 });
  const shifted = rows.map(p => ({ ...p, predicted: p.predicted+1 }));
  assert.deepEqual(pairedInterval(shifted, rows), pairedInterval(shifted, rows));
  assert.throws(() => pairedInterval(rows, rows.slice(1)), /identical test games/);
});

test('real development report is unaffected by final-half outcomes and reports every comparator', () => {
  const dataset = JSON.parse(fs.readFileSync('public/football/history.json', 'utf8'));
  const before = buildResearch(dataset.games, dataset.metadata, 'test-sha');
  const changed = dataset.games.map(g => g.season === 2025 && g.week >= 10 ? { ...g, home_margin: 99999 } : g);
  const after = buildResearch(changed, dataset.metadata, 'test-sha');
  assert.deepEqual(before.rows, after.rows);
  assert.deepEqual(before.byPeriod, after.byPeriod);
  assert.deepEqual(before.segments, after.segments);
  assert.equal(before.rows.length, 10);
  assert.equal(before.holdout.evaluated, false);
  assert(before.byPeriod.find(p => p.period.startsWith('2025'))!.period.includes('1–9'));
  assert(before.rows.every(r => r.games === before.games));
});

test('QB segment grouping uses pregame ratings and earlier median, not current or future QB values', () => {
  const games = demoGames().map((g, i) => ({ ...g, season: i < 160 ? 2024 : 2025, week: Math.floor((i < 160 ? i : i-160)/8)+1,
    home_qb_epa: -.1, away_qb_epa: .1, home_adj_net: .1, away_adj_net: -.1 }));
  const before = qbSegments(games);
  const changed = games.map(g => g.season === 2025 && g.week >= 10 ? { ...g, home_qb_epa: 9999, away_qb_epa: 9999, home_margin: 9999 } : g);
  assert.deepEqual(before, qbSegments(changed));
  assert(before[0].sides > 0);
  assert.equal(before[0].sides, before[3].sides);
  assert.equal(before[1].sides, 0);
  assert.equal(before[2].sides, 0);
});
