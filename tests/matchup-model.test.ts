import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runMatchup, SPORT_LABELS } from '../src/lib/matchups/model.ts';
import type { MatchupInput, Adjustment, SportId } from '../src/lib/matchups/model.ts';

const base = (changes: Partial<MatchupInput> = {}): MatchupInput => ({
  sport: 'nfl', home: 'Home Team', away: 'Away Team',
  baselineHomeMargin: 4, baselineSource: 'Manual research baseline', adjustments: [],
  homeSpread: -3, homeOdds: -110, awayOdds: -110, book: 'Example book',
  quoteObservedAt: '2026-11-09T10:00:00Z', homeCoverProbability: null, probabilitySource: '',
  ...changes,
});
const effect = (changes: Partial<Adjustment> = {}): Adjustment => ({
  id: 'roster', label: 'Roster change', status: 'new', points: -2,
  reason: 'Change since the baseline was recorded', ...changes,
});
const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-10, `${actual} should equal ${expected}`);
};

test('all four sports use the same signed margin and spread contract', () => {
  for (const sport of Object.keys(SPORT_LABELS) as SportId[]) {
    const result = runMatchup(base({ sport }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.projectedHomeMargin, 4);
    assert.equal(result.projectedHomeSpread, -4);
    assert.equal(result.gap, 1);
    assert.equal(result.lean, 'home');
    assert.equal(result.homeCoverProbability, null);
  }
});

test('negative home margins and positive handicaps retain their signs', () => {
  const result = runMatchup(base({ baselineHomeMargin: -7, homeSpread: 5.5 }));
  assert.equal(result.projectedHomeSpread, 7);
  assert.equal(result.gap, -1.5);
  assert.equal(result.lean, 'away');
});

test('an even point gap does not imply a 50 percent cover probability', () => {
  const result = runMatchup(base({ homeSpread: -4 }));
  assert.equal(result.gap, 0);
  assert.equal(result.lean, 'even');
  assert.equal(result.homeCoverProbability, null);
});

test('included and unknown adjustments never count as new effects', () => {
  const result = runMatchup(base({ adjustments: [
    effect({ id: 'included', status: 'included', points: -10 }),
    effect({ id: 'unknown', status: 'unknown', points: -30 }), effect(),
  ] }));
  assert.equal(result.projectedHomeMargin, 2);
  assert.match(result.reasons.join(' '), /already included/);
  assert.match(result.warnings.join(' '), /impact is unknown/);
});

test('duplicate adjustment IDs count once; contradictory duplicates are errors', () => {
  const duplicate = runMatchup(base({ adjustments: [effect(), effect({ id: ' roster ' })] }));
  assert.equal(duplicate.projectedHomeMargin, 2);
  assert.match(duplicate.warnings.join(' '), /counted once/);
  const conflict = runMatchup(base({ adjustments: [effect(), effect({ points: 2 })] }));
  assert.match(conflict.errors.join(' '), /conflicting duplicate/);
  assert.equal(conflict.projectedHomeMargin, null);
});

test('new effects require finite points and a reason, including zero-valued effects', () => {
  for (const adjustment of [effect({ points: null }), effect({ points: NaN }), effect({ reason: ' ' }), effect({ points: 0, reason: '' })]) {
    const result = runMatchup(base({ adjustments: [adjustment] }));
    assert.ok(result.errors.length);
    assert.equal(result.projectedHomeMargin, null);
  }
  assert.equal(runMatchup(base({ adjustments: [effect({ points: 0 })] })).projectedHomeMargin, 4);
});

test('missing baseline never becomes a fabricated zero-margin model', () => {
  const result = runMatchup(base({ baselineHomeMargin: null, baselineSource: '', adjustments: [effect()] }));
  assert.equal(result.projectedHomeMargin, null);
  assert.equal(result.projectedHomeSpread, null);
  assert.equal(result.gap, null);
  assert.equal(result.lean, null);
  assert.match(result.warnings.join(' '), /No baseline/);
});

test('missing spread retains the point forecast without a comparison', () => {
  const result = runMatchup(base({ homeSpread: null }));
  assert.equal(result.projectedHomeMargin, 4);
  assert.equal(result.gap, null);
  assert.equal(result.lean, null);
  assert.equal(result.marketHomeProbability, null);
  close(result.homeBreakEven, 110 / 210);
  close(result.awayBreakEven, 110 / 210);
});

test('bundled NFL distribution agrees with its manual mean and recorded conditional probability', () => {
  const data = JSON.parse(readFileSync(new URL('../public/football/nfl-trial.json', import.meta.url), 'utf8'));
  assert.ok(data.forecasts.length > 0);
  for (const row of data.forecasts) {
    const distribution = row.prediction.marginDistribution as Record<string, number>;
    const baselineHomeMargin = Object.entries(distribution).reduce((sum, [margin, mass]) => sum + Number(margin) * mass, 0);
    const quote = row.request.target;
    const result = runMatchup(base({ home: row.home, away: row.away, baselineHomeMargin, distribution,
      homeSpread: quote.homeSpread, homeOdds: quote.homeOdds, awayOdds: quote.awayOdds,
      book: quote.book, quoteObservedAt: quote.observedAt,
      homeCoverProbability: row.prediction.model.home.coverGivenNoPush,
      probabilitySource: 'Frozen NFL trial probability, conditional on no push' }));
    assert.deepEqual(result.errors, [], row.id);
    close(result.projectedHomeMargin, baselineHomeMargin);
    close(result.homeCoverProbability, row.prediction.model.home.coverGivenNoPush);
    assert.notEqual(result.pushProbability, null);
  }
});

test('manual cover probabilities need source and spread; push remains unknown', () => {
  const result = runMatchup(base({ homeCoverProbability: 0.6, probabilitySource: 'External research' }));
  assert.deepEqual(result.errors, []);
  close(result.homeCoverProbability, 0.6);
  close(result.awayCoverProbability, 0.4);
  assert.equal(result.pushProbability, null);
  assert.match(result.warnings.join(' '), /Push probability is unknown/);
  assert.ok(runMatchup(base({ homeCoverProbability: 0.6 })).errors.length);
  assert.ok(runMatchup(base({ homeCoverProbability: 0.6, probabilitySource: 'Research', homeSpread: null })).errors.length);
});

test('American price break-evens and proportional no-vig market probability', () => {
  const result = runMatchup(base({ homeOdds: -150, awayOdds: 130 }));
  close(result.homeBreakEven, 0.6);
  close(result.awayBreakEven, 100 / 230);
  close(result.marketHomeProbability, 0.6 / (0.6 + 100 / 230));
  assert.equal(runMatchup(base({ awayOdds: null })).marketHomeProbability, null);
  assert.equal(runMatchup(base({ homeOdds: null })).homeBreakEven, null);
});

test('distribution is normalized, supplies its mean, and accounts for integer pushes', () => {
  const result = runMatchup(base({ baselineHomeMargin: null, baselineSource: '', homeSpread: -3,
    distribution: { '0': 2, '3': 3, '7': 5 } }));
  assert.deepEqual(result.errors, []);
  close(result.projectedHomeMargin, 4.4);
  close(result.pushProbability, 0.3);
  close(result.homeCoverProbability, 5 / 7);
  close(result.awayCoverProbability, 2 / 7);
});

test('distribution evaluates the exact selected spread, including half points and pick-em', () => {
  const distribution = { '-1': 1, '0': 2, '1': 1 };
  const even = runMatchup(base({ baselineHomeMargin: null, distribution, homeSpread: 0 }));
  close(even.pushProbability, 0.5);
  close(even.homeCoverProbability, 0.5);
  close(even.awayCoverProbability, 0.5);
  assert.equal(even.projectedHomeSpread, 0);
  const half = runMatchup(base({ baselineHomeMargin: null, distribution, homeSpread: 0.5 }));
  close(half.pushProbability, 0);
  close(half.homeCoverProbability, 0.75);
});

test('all-push distributions have no conditional cover probability', () => {
  const result = runMatchup(base({ baselineHomeMargin: null, distribution: { '3': 1 } }));
  assert.equal(result.pushProbability, 1);
  assert.equal(result.homeCoverProbability, null);
  assert.equal(result.awayCoverProbability, null);
  assert.match(result.warnings.join(' '), /conditional cover probabilities are undefined/);
});

test('distribution and manual estimates must agree, never silently override', () => {
  const distribution = { '0': 1, '4': 1 };
  assert.match(runMatchup(base({ distribution })).errors.join(' '), /baseline disagrees/);
  assert.deepEqual(runMatchup(base({ baselineHomeMargin: 2, distribution })).errors, []);
  const conflict = runMatchup(base({ baselineHomeMargin: 2, distribution,
    homeCoverProbability: 0.8, probabilitySource: 'Research' }));
  assert.match(conflict.errors.join(' '), /probability disagrees/);
  assert.equal(conflict.homeCoverProbability, null);
  assert.equal(conflict.projectedHomeMargin, null);
});

test('new adjustments change distribution mean, never pretend to recalibrate its probabilities', () => {
  const result = runMatchup(base({ baselineHomeMargin: null, distribution: { '0': 1, '4': 1 }, adjustments: [effect()] }));
  assert.equal(result.projectedHomeMargin, 0);
  assert.equal(result.homeCoverProbability, null);
  assert.equal(result.pushProbability, null);
  assert.match(result.warnings.join(' '), /invalidate/);
  const explicit = runMatchup(base({ baselineHomeMargin: null, distribution: { '0': 1, '4': 1 },
    adjustments: [effect()], homeCoverProbability: 0.3, probabilitySource: 'Updated distribution research' }));
  assert.equal(explicit.homeCoverProbability, 0.3);
  assert.equal(explicit.pushProbability, null);
});

test('included adjustments preserve usable distribution probabilities', () => {
  const result = runMatchup(base({ baselineHomeMargin: null, distribution: { '0': 1, '4': 1 },
    adjustments: [effect({ status: 'included' })] }));
  assert.equal(result.projectedHomeMargin, 2);
  assert.equal(result.homeCoverProbability, 0.5);
});

test('bad distributions fail closed', () => {
  const invalid: Record<string, number>[] = [{}, { '0': 0 }, { '0': -1 }, { '0': NaN }, { '0': Infinity },
    { '0.5': 1 }, { '101': 1 }, { '': 1 }, { '1': 1, '01': 1 }, { 'nope': 1 }];
  for (const distribution of invalid) {
    const result = runMatchup(base({ baselineHomeMargin: null, distribution }));
    assert.ok(result.errors.length, JSON.stringify(distribution));
    assert.equal(result.projectedHomeMargin, null);
    assert.equal(result.homeCoverProbability, null);
  }
});

test('invalid sport, names, finite numbers, bounds and malformed runtime input fail closed', () => {
  const invalid = [
    { sport: 'mlb' }, { sport: 'toString' }, { home: ' ' }, { away: ' HOME TEAM ' }, { home: 'x\ny' },
    { baselineHomeMargin: NaN }, { baselineHomeMargin: Infinity }, { baselineHomeMargin: 101 },
    { homeSpread: undefined }, { baselineHomeMargin: 4, baselineSource: '' },
    { adjustments: null }, { adjustments: [null] }, { homeCoverProbability: 1.1 },
    { homeCoverProbability: -0.01 }, { homeCoverProbability: NaN },
    { homeOdds: 99 }, { awayOdds: -99 }, { homeOdds: 110.5 }, { homeOdds: Infinity },
  ];
  for (const changes of invalid) {
    const result = runMatchup(base(changes as Partial<MatchupInput>));
    assert.ok(result.errors.length, JSON.stringify(changes));
    assert.equal(result.projectedHomeMargin, null);
    assert.equal(result.homeBreakEven, null);
  }
  assert.ok(runMatchup(null as unknown as MatchupInput).errors.length);
});

test('combined effects outside sport guardrails fail closed', () => {
  const result = runMatchup(base({ baselineHomeMargin: 99, adjustments: [effect({ points: 2 })] }));
  assert.ok(result.errors.length);
  assert.equal(result.projectedHomeMargin, null);
});

test('missing quote metadata is transparent; invalid timestamps are rejected', () => {
  const result = runMatchup(base({ book: '', quoteObservedAt: '' }));
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(' '), /provenance is unverified/);
  assert.match(result.warnings.join(' '), /freshness is unknown/);
  for (const quoteObservedAt of ['yesterday', '2026-11-09T10:00:00']) {
    assert.ok(runMatchup(base({ quoteObservedAt })).errors.length);
  }
  assert.match(runMatchup(base()).warnings.join(' '), /Freshness is not verified/);
});

test('the engine is deterministic and never mutates caller input', () => {
  const adjustment = Object.freeze(effect());
  const input = Object.freeze(base({ adjustments: Object.freeze([adjustment]) as unknown as Adjustment[] }));
  assert.deepEqual(runMatchup(input), runMatchup(input));
  assert.equal(input.baselineHomeMargin, 4);
  assert.equal(input.adjustments.length, 1);
});
