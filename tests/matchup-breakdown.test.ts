import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatchup, type MatchupInput } from '../src/lib/matchups/model.ts';
import { explainMatchup, compareEstimate, type ExternalEstimate } from '../src/lib/matchups/breakdown.ts';
const input: MatchupInput = { sport: 'nfl', home: 'Home', away: 'Away', baselineHomeMargin: 4, baselineSource: 'Test only', adjustments: [], homeSpread: -3.5, homeOdds: -110, awayOdds: -110, book: 'Test', quoteObservedAt: '2026-11-10T12:00:00Z', homeCoverProbability: null, probabilitySource: '' };
const other: ExternalEstimate = { name: 'Test forecast', url: 'https://example.com/forecast', publishedAt: '2026-11-10T12:00:00Z', homeMargin: 5, injuryAware: 'unknown' };
const at = '2026-11-10T13:00:00Z';
test('a margin lean never invents a probability or proven edge', () => {
  const r = explainMatchup(input, runMatchup(input));
  assert.match(r.headline, /not a proven edge/);
  assert.match(r.priceCheck, /No probability is inferred/);
});
test('missing baseline and unknown injuries remain missing', () => {
  const i = { ...input, baselineHomeMargin: null, adjustments: [{ id: 'lineup', label: 'Lineup', status: 'unknown' as const, points: null, reason: '' }] };
  const r = explainMatchup(i, runMatchup(i));
  assert.equal(r.headline, 'No supported directional lean');
  assert.match(r.risks[0], /not reviewed/);
});
test('probability price check uses the direction-specific break-even', () => {
  const i = { ...input, baselineHomeMargin: 2, homeCoverProbability: .4, probabilitySource: 'Test' };
  assert.match(explainMatchup(i, runMatchup(i)).priceCheck, /60.0%; price break-even 52.4%/);
});
test('outside agreement is not labeled confirmation or probability', () => {
  const r = compareEstimate(input, runMatchup(input), other, at);
  assert.equal(r.gap, 1.5);
  assert.equal(r.agreement, 'Same direction, not independent confirmation');
  assert.equal(compareEstimate(input, runMatchup(input), { ...other, homeMargin: 2 }, at).agreement, 'Models disagree at this spread');
});
test('future published estimates cannot support an earlier run', () => {
  const r = compareEstimate(input, runMatchup(input), { ...other, publishedAt: '2026-11-11T12:00:00Z' }, at);
  assert.ok(r.errors.length);
  assert.equal(r.gap, null);
});
test('invalid source, missing timestamps and nonfinite predictions are rejected', () => {
  for (const patch of [{ url: 'javascript:alert(1)' }, { url: 'http://example.com' }, { publishedAt: '' }, { publishedAt: '2026-11-10T12:00:00' }, { homeMargin: NaN }, { homeMargin: null }, { name: '' }]) {
    assert.ok(compareEstimate(input, runMatchup(input), { ...other, ...patch }, at).errors.length);
  }
});
test('pickem and missing line never report agreement', () => {
  for (const homeSpread of [null, -5]) {
    const i = { ...input, homeSpread };
    assert.equal(compareEstimate(i, runMatchup(i), other, at).agreement, 'Not comparable');
  }
});
test('all sports preserve the same home-margin convention', () => {
  for (const sport of ['nfl', 'nba', 'ncaaf', 'ncaab'] as const) {
    const i = { ...input, sport, baselineHomeMargin: -6, homeSpread: 5 };
    assert.match(explainMatchup(i, runMatchup(i)).headline, /^Away:/);
  }
});
