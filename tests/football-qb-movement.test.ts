import assert from 'node:assert/strict';
import test from 'node:test';
import { movementDemo, parseEvents, studyEvent, summarizeMovement, type QbEvent } from '../src/lib/football/qb-movement.ts';

const fresh = (): QbEvent => structuredClone({ ...movementDemo, id: 'event1', gameId: '2024_01_B_A' });

test('four-point downgrade versus six-point market move produces two points of home value', () => {
  const r = studyEvent(fresh());
  assert.equal(r.marketMove, -6); assert.equal(r.qbMovementGap, 2); assert.equal(r.afterEdge, 2);
  assert.equal(r.selectedSide, 'home'); assert.equal(r.marketError, null); assert.equal(r.units, null);
});

test('movement gap alone cannot erase a larger unfavorable pre-news edge', () => {
  const e = fresh(); e.modelBefore = -2;
  const r = studyEvent(e);
  assert.equal(r.baselineEdge, -5); assert.equal(r.qbMovementGap, 2); assert.equal(r.afterEdge, -3);
  assert.equal(r.selectedSide, 'away');
});

test('away QB downgrade moves home margin positively; other changes stay explicit', () => {
  const e = fresh(); e.changedSide = 'away'; e.qbDeltaHomeMargin = 4; e.after.homeMargin = 9; e.otherDeltaHomeMargin = 1;
  const r = studyEvent(e);
  assert.equal(r.qbMovementGap, -2); assert.equal(r.totalMovementGap, -1); assert.equal(r.afterEdge, -1);
  assert.equal(r.selectedSide, null);
});

test('timing rejects post-news baselines, stale or mixed-book quotes, and late estimates', () => {
  const cases: ((e: QbEvent) => void)[] = [
    e => { e.baselineAsOf = e.announcedAt; },
    e => { e.modelFrozenAt = e.announcedAt; },
    e => { e.before.snapshotAt = e.announcedAt; },
    e => { e.before.updatedAt = '2024-09-06T14:00:00Z'; },
    e => { e.after.bookmaker = 'Different book'; },
    e => { e.after.updatedAt = '2024-09-06T15:59:00Z'; },
    e => { e.after.snapshotAt = '2024-09-06T16:40:00Z'; },
    e => { e.estimateAsOf = '2024-09-06T16:40:00Z'; },
    e => { e.announcedAt = '2024-09-06T16:00:00'; },
  ];
  for (const mutate of cases) { const e = fresh(); mutate(e); assert.throws(() => studyEvent(e)); }
});

test('unreviewed other news prevents selection; missing outcomes never count as wins', () => {
  const e = fresh(); e.otherNewsReviewed = false;
  assert.equal(studyEvent(e).selectedSide, null);
  const s = summarizeMovement([studyEvent(fresh())]);
  assert.equal(s.pending, 1); assert.equal(s.settled, 0); assert.equal(s.coverRate, null); assert.equal(s.roi, null);
});

test('results settle at post-news price with juice and do not change prediction or selection', () => {
  const e = fresh(); const before = studyEvent(e);
  e.actualHomeMargin = 0; e.resultAvailableAt = '2024-09-09T00:00:00Z';
  const after = studyEvent(e);
  assert.equal(after.afterEdge, before.afterEdge); assert.equal(after.selectedSide, before.selectedSide);
  assert.equal(after.units, 100/110);
  e.actualHomeMargin = -3;
  assert.equal(studyEvent(e).units, 0);
  e.actualHomeMargin = -4;
  assert.equal(studyEvent(e).units, -1);
  e.resultAvailableAt = e.kickoff;
  assert.throws(() => studyEvent(e));
});

test('import excludes final holdout before using quote values, duplicate games, and fictional records', () => {
  const e = fresh(); e.season = 2025; e.week = 10; e.after = null as unknown as QbEvent['after'];
  assert.throws(() => parseEvents(JSON.stringify([e])), /development study excludes/);
  assert.throws(() => parseEvents(JSON.stringify([fresh(), { ...fresh(), id: 'event2' }])), /one event per game/);
  assert.throws(() => parseEvents(JSON.stringify([movementDemo])), /fictional/);
  assert.equal(parseEvents(JSON.stringify([fresh()])).length, 1);
});
