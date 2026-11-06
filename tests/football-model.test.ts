import test from 'node:test';
import assert from 'node:assert/strict';
import { columns, csv, defaults, demoGames, finalCheck, matchup, netProfit, parseCsv, readGames, runBacktest } from '../src/lib/football/model.ts';

test('same QB does not get a second penalty; a replacement adds only the change', () => {
  const same = matchup(3, 0, 1.5, -2, -2, 3.5);
  assert.equal(same.baseline, 4.5);
  assert.equal(same.naive, 2.5);
  assert.equal(same.adjusted, 4.5);
  assert.equal(same.edge, 1);
  assert.equal(matchup(3, 0, 1.5, -2, -5, 3.5).adjusted, 1.5);
});

test('American odds settle risk-one-unit wins, losses, and pushes', () => {
  assert.equal(netProfit(1, 150), 1.5);
  assert.equal(netProfit(1, -200), .5);
  assert.equal(netProfit(-1, 150), -1);
  assert.equal(netProfit(0, -110), 0);
});

test('CSV round trip preserves quotes, commas, multiline names and sign conventions', () => {
  const games = demoGames().slice(0, 2);
  games[0].home_team = 'Test, "Home"\nTeam';
  const loaded = readGames(csv(games, [...columns]));
  assert.equal(loaded[0].home_team, games[0].home_team);
  assert.equal(loaded[0].market_home_margin, games[0].market_home_margin);
  assert.throws(() => parseCsv('a,b\n"unfinished,b'), /Unclosed/);
});

test('imports reject duplicated games, nonfinite features, and postgame feature timestamps', () => {
  const [game] = demoGames();
  assert.throws(() => readGames(csv([game, game], [...columns])), /Duplicate game/);
  assert.throws(() => readGames(csv([{ ...game, qb_epa_diff: Infinity }], [...columns])), /invalid qb_epa_diff/);
  assert.throws(() => readGames(csv([{ ...game, feature_asof: game.kickoff }], [...columns])), /predate kickoff/);
  assert.throws(() => readGames(csv([{ ...game, kickoff: '2020-09-13' }], [...columns])), /timezone/);
});

test('future outcomes cannot affect earlier predictions and each training set predates frozen features', () => {
  const games = demoGames();
  const first = runBacktest(games, defaults);
  const before = first.predictions.filter(r => r.gameId === 'SYNTHETIC-80');
  assert.equal(before.length, 3);
  const modified = games.map((g, i) => i >= 80 ? { ...g, home_margin: 999 } : g);
  const after = runBacktest(modified, defaults).predictions.filter(r => r.gameId === 'SYNTHETIC-80');
  assert.deepEqual(after.map(r => r.predicted), before.map(r => r.predicted));
  for (const row of first.predictions) {
    const eligible = games.filter(g => Date.parse(g.completed_at) < Date.parse(row.cutoff));
    assert.equal(row.trainCount, eligible.length);
    assert(eligible.every(g => g.game_id !== row.gameId));
    assert(Number.isFinite(row.predicted));
  }
  assert(first.synthetic);
});

test('fitted model learns margin direction and keeps constant-column system stable', () => {
  const games = demoGames().map(g => ({ ...g, home_margin: 50 * g.off_epa_diff - 25 * g.def_epa_allowed_diff + 2 }));
  const result = runBacktest(games, { ...defaults, alpha: .00001 });
  assert(result.summary.find(s => s.model === 'Team EPA')!.mae < .001);
  assert(result.summary.find(s => s.model === 'Joint fit')!.mae < .001);
});

test('passes do not count as bets; zero bets produce no invented ROI or win rate', () => {
  const result = runBacktest(demoGames(), { ...defaults, threshold: 10000 });
  for (const summary of result.summary) {
    assert.equal(summary.bets, 0);
    assert.equal(summary.roi, null);
    assert.equal(summary.winRate, null);
    assert.equal(summary.units, 0);
  }
});

test('manual QB comparison adds exactly the stated assumption on identical held-out games', () => {
  const games = demoGames();
  const result = runBacktest(games, defaults);
  const base = result.predictions.find(r => r.gameId === 'SYNTHETIC-80' && r.model === 'Team EPA')!;
  const extra = result.predictions.find(r => r.gameId === base.gameId && r.model === 'Team EPA + manual QB')!;
  assert(Math.abs(extra.predicted - base.predicted - defaults.qbWeight * games[80].qb_epa_diff) < 1e-10);
  assert(result.summary.every(s => s.games === result.summary[0].games));
});

test('two-year window excludes old outcomes even when a longer archive is loaded', () => {
  const games = demoGames();
  const old = games.map(g => ({ ...g, game_id: `OLD-${g.game_id}`,
    kickoff: g.kickoff.replace('2020', '2015').replace('2021', '2016'),
    feature_asof: g.feature_asof.replace('2020', '2015').replace('2021', '2016'),
    completed_at: g.completed_at.replace('2020', '2015').replace('2021', '2016'), home_margin: 1000 }));
  const plain = runBacktest(games, defaults);
  const archive = runBacktest([...old, ...games], defaults, { fromSeason: 2020 });
  assert.deepEqual(archive.predictions, plain.predictions);
  for (const row of archive.predictions) {
    const oldest = new Date(row.cutoff); oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
    assert(Date.parse(row.trainingFrom) >= oldest.getTime());
  }
});

test('recency weights learn the weighted training mean without leaking the target', () => {
  const games = demoGames().slice(0, 81).map((g, i) => ({ ...g, off_epa_diff: 0, def_epa_allowed_diff: 0, qb_epa_diff: 0, home_margin: i < 40 ? 0 : 10 }));
  const result = runBacktest(games, defaults);
  const row = result.predictions.find(p => p.model === 'Team EPA')!;
  const train = games.filter(g => Date.parse(g.completed_at) < Date.parse(row.cutoff));
  const weights = train.map(g => 2 ** (-(Date.parse(row.cutoff) - Date.parse(g.kickoff)) / 86400000 / defaults.halfLifeDays));
  const expected = train.reduce((sum, g, i) => sum + weights[i] * g.home_margin, 0) / weights.reduce((a, b) => a + b, 0);
  assert(Math.abs(row.predicted - expected) < 1e-10);
  assert(row.predicted > 5);
});

test('evaluation seasons are separate from training seasons and preserved in CSV', () => {
  const games = demoGames().map((g, i) => ({ ...g, season: i < 160 ? 2023 : 2024 }));
  const result = runBacktest(games, defaults, { fromSeason: 2024, throughSeason: 2024 });
  assert(result.predictions.every(p => p.season === 2024));
  assert.equal(result.predictions[0].trainCount, 160);
  assert(result.bySeason.every(s => s.season === 2024));
});

test('midseason final check freezes fitting and excludes second-half outcomes', () => {
  const games = demoGames().map((g, i) => ({ ...g, season: i < 160 ? 2024 : 2025, week: Math.floor((i < 160 ? i : i-160)/8)+1 }));
  const evaluation = finalCheck(games);
  const before = runBacktest(games, defaults, evaluation);
  assert(before.predictions.every(p => games.find(g => g.game_id === p.gameId)!.week >= 10));
  assert.equal(new Set(before.predictions.map(p => p.trainCount)).size, 1);
  assert.equal(new Set(before.predictions.map(p => p.cutoff)).size, 1);
  const changed = games.map(g => g.season === 2025 && g.week >= 10 ? { ...g, home_margin: 999 } : g);
  const after = runBacktest(changed, defaults, evaluation);
  assert.deepEqual(before.predictions.map(p => p.predicted), after.predictions.map(p => p.predicted));
  const development = runBacktest(games, defaults, { fromSeason: 2025, throughSeason: 2025, throughWeek: 9 });
  assert(development.predictions.every(p => games.find(g => g.game_id === p.gameId)!.week <= 9));
});

test('context variants require complete numeric context; residual fitting anchors to the quoted margin', () => {
  const plain = demoGames();
  assert.equal(runBacktest(plain, defaults).summary.length, 3);
  const games = plain.map(g => ({ ...g, adj_off_epa_diff: g.off_epa_diff, adj_def_epa_allowed_diff: 0,
    rest_diff: 0, pressure_allowed_diff: 0, pressure_forced_diff: 0, turnover_margin_diff: 0,
    pass_matchup: 0, rush_matchup: 0, home_margin: g.market_home_margin+5*g.off_epa_diff+1 }));
  const result = runBacktest(games, { ...defaults, alpha: .00001 });
  assert.equal(result.summary.length, 10);
  assert(result.summary.find(s => s.model === 'Market anchored')!.mae < .001);
  assert.throws(() => readGames(csv([{ ...games[0], pressure_allowed_diff: Infinity }])), /invalid pressure_allowed_diff/);
});
