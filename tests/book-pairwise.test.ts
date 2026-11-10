import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePairwise, pairwiseAheadProbability, pairwiseCovers } from '../src/lib/book/pairwise.ts';

const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-12, `${actual} should equal ${expected}`);
};

const full = normalizePairwise({
  driverIds: [10, 20, 30],
  probabilities: [
    [0.5, 0.7, 0.9],
    [0.3, 0.5, 0.65],
    [0.1, 0.35, 0.5],
  ],
});

test('normalizePairwise accepts a square numeric matrix and rejects malformed input', () => {
  assert.ok(full);
  assert.deepEqual(full!.driverIds, [10, 20, 30]);
  assert.equal(full!.probabilities.length, 3);

  assert.equal(normalizePairwise(undefined), null);
  assert.equal(normalizePairwise(null), null);
  assert.equal(normalizePairwise('nope'), null);
  assert.equal(normalizePairwise({}), null);
  assert.equal(normalizePairwise({ driverIds: [], probabilities: [] }), null);
  assert.equal(normalizePairwise({ driverIds: [1, 2], probabilities: [[0.5, 0.6]] }), null, 'row count mismatch');
  assert.equal(normalizePairwise({ driverIds: [1, 2], probabilities: [[0.5], [0.4]] }), null, 'column count mismatch');
  assert.equal(normalizePairwise({ driverIds: [1, '2'], probabilities: [[0.5, 0.6], [0.4, 0.5]] }), null, 'non-numeric id');
  assert.equal(normalizePairwise({ driverIds: [1, 1], probabilities: [[0.5, 0.6], [0.4, 0.5]] }), null, 'duplicate id');
});

test('normalizePairwise keeps missing cells as NaN instead of zero', () => {
  const half = normalizePairwise({ driverIds: [1, 2], probabilities: [[null, 0.6], [null, null]] });
  assert.ok(half);
  assert.ok(Number.isNaN(half!.probabilities[1][0]));
  assert.equal(half!.probabilities[0][1], 0.6);
});

test('pairwiseAheadProbability reads the direct cell for either ordering of a covered pair', () => {
  close(pairwiseAheadProbability(full, 10, 20), 0.7);
  close(pairwiseAheadProbability(full, 20, 10), 0.3);
  close(pairwiseAheadProbability(full, 30, 20), 0.35);
  assert.ok(pairwiseCovers(full, 10, 30));
});

test('pairwiseAheadProbability mirrors the cell when only one side is filled', () => {
  const upperOnly = normalizePairwise({
    driverIds: [1, 2],
    probabilities: [
      [null, 0.8],
      [null, null],
    ],
  });
  close(pairwiseAheadProbability(upperOnly, 1, 2), 0.8);
  close(pairwiseAheadProbability(upperOnly, 2, 1), 0.2);
});

test('pairwiseAheadProbability returns null for uncovered drivers, self pairs and empty matrices', () => {
  assert.equal(pairwiseAheadProbability(full, 10, 99), null);
  assert.equal(pairwiseAheadProbability(full, 99, 10), null);
  assert.equal(pairwiseAheadProbability(full, 10, 10), null);
  assert.equal(pairwiseAheadProbability(null, 10, 20), null);
  assert.equal(pairwiseAheadProbability(undefined, 10, 20), null);
  assert.equal(pairwiseCovers(full, 10, 99), false);

  const bothMissing = normalizePairwise({ driverIds: [1, 2], probabilities: [[null, null], [null, null]] });
  assert.equal(pairwiseAheadProbability(bothMissing, 1, 2), null);
});

test('pairwiseAheadProbability clamps out-of-range cells into [0, 1]', () => {
  const wild = normalizePairwise({ driverIds: [1, 2], probabilities: [[0.5, 1.4], [-0.2, 0.5]] });
  close(pairwiseAheadProbability(wild, 1, 2), 1);
  close(pairwiseAheadProbability(wild, 2, 1), 0);
});
