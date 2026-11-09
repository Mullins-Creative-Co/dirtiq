import test from 'node:test';
import assert from 'node:assert/strict';
import trial from '../public/football/nfl-trial.json' with { type: 'json' };
import research from '../public/nba/research.json' with { type: 'json' };
import { adaptNflTrial, adaptNbaResearch, getBundledMatchups } from '../src/lib/matchups/catalog.ts';

test('bundled catalog has only frozen NFL and five primary NBA examples without outcomes', () => {
  const rows = getBundledMatchups();
  assert.equal(rows.length, 7);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.every(row => !('actual' in row) && !('grade' in row) && row.warnings.length > 0));
  assert.deepEqual(rows.map(row => row.sport), ['nfl', 'nfl', 'nba', 'nba', 'nba', 'nba', 'nba']);
});

test('NFL preserves frozen distribution and conditional quoted probability', () => {
  const row = adaptNflTrial(trial)[0];
  const forecast = trial.forecasts[0];
  assert.deepEqual(row.distribution, forecast.prediction.marginDistribution);
  const mean = Object.entries(forecast.prediction.marginDistribution).reduce((sum, [margin, mass]) => sum + Number(margin) * mass, 0);
  assert.equal(row.baselineHomeMargin, mean);
  assert.equal(row.homeCoverProbability, forecast.prediction.model.home.coverGivenNoPush);
  assert.equal(row.homeSpread, forecast.request.target.homeSpread);
  assert.equal(row.quoteObservedAt, forecast.request.target.observedAt);
});

test('most recent forecast wins independently of input order', () => {
  const original = trial.forecasts[0];
  const newer = { ...original, id: 'newer', recordedAt: '2026-11-09T00:00:00Z' };
  for (const forecasts of [[original, newer], [newer, original]]) {
    const rows = adaptNflTrial({ forecasts });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'nfl:newer');
  }
});

test('NBA uses primary efficiency predictions and correct handicap sign, never prices or probabilities', () => {
  const rows = adaptNbaResearch(research);
  const primary = research.reports.find(row => row.id === 'efficiency')!;
  assert.equal(rows.length, 5);
  rows.forEach((row, i) => {
    assert.equal(row.baselineHomeMargin, primary.examples[i].prediction);
    assert.equal(row.homeSpread, -primary.examples[i].market);
    assert.equal(row.homeOdds, null);
    assert.equal(row.awayOdds, null);
    assert.equal(row.startsAt, null);
    assert.equal(row.homeCoverProbability, null);
    assert.equal(row.quoteObservedAt, '');
    assert.equal(row.distribution, undefined);
  });
  assert.deepEqual(adaptNbaResearch({ ...research, reports: [] }), []);
});
