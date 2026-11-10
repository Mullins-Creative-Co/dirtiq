import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRowProbabilities } from '../src/lib/book/card-probabilities.ts';

// A row as the blend path would see it: the governor shaved the ML-heavy
// blend down, and the Elo/composite implied number sits underneath.
const sampleRow = {
  blendProbability: 0.115,
  impliedProbability: 0.062,
  ml: { probability: 0.458, top3Probability: 0.858, top5Probability: 0.972, expectedFinish: 2.081 },
};

test('blend mode leaves the sample row exactly as the blend produced it', () => {
  const withMl = resolveRowProbabilities({ source: 'blend', hasModelFile: true, ...sampleRow });
  assert.equal(withMl.modelProbability, sampleRow.blendProbability);
  assert.equal(withMl.blendedProbability, sampleRow.impliedProbability);
  assert.equal(withMl.pricedBy, 'blend');
  // The extra fields are carried as data without affecting pricing.
  assert.equal(withMl.top3Probability, 0.858);
  assert.equal(withMl.top5Probability, 0.972);
  assert.equal(withMl.expectedFinish, 2.081);

  const withoutMl = resolveRowProbabilities({ source: 'blend', hasModelFile: false, ...sampleRow, ml: null });
  assert.equal(withoutMl.modelProbability, sampleRow.blendProbability);
  assert.equal(withoutMl.blendedProbability, sampleRow.impliedProbability);
  assert.equal(withoutMl.pricedBy, 'blend');
  assert.equal(withoutMl.top3Probability, null);
  assert.equal(withoutMl.top5Probability, null);
  assert.equal(withoutMl.expectedFinish, null);
});

test('model mode prices from the raw ML probability and parks the blend for comparison', () => {
  const resolved = resolveRowProbabilities({ source: 'model', hasModelFile: true, ...sampleRow });
  assert.equal(resolved.modelProbability, 0.458, 'no governor cap, no clamp');
  assert.equal(resolved.blendedProbability, sampleRow.blendProbability);
  assert.equal(resolved.pricedBy, 'model');
  assert.equal(resolved.top3Probability, 0.858);
  assert.equal(resolved.expectedFinish, 2.081);
});

test('model mode falls back to the blend when the file or the driver row is missing', () => {
  const noFile = resolveRowProbabilities({ source: 'model', hasModelFile: false, ...sampleRow, ml: null });
  assert.equal(noFile.modelProbability, sampleRow.blendProbability);
  assert.equal(noFile.blendedProbability, sampleRow.impliedProbability);
  assert.equal(noFile.pricedBy, 'blend');

  const lateEntry = resolveRowProbabilities({ source: 'model', hasModelFile: true, ...sampleRow, ml: null });
  assert.equal(lateEntry.modelProbability, sampleRow.blendProbability);
  assert.equal(lateEntry.blendedProbability, sampleRow.impliedProbability);
  assert.equal(lateEntry.pricedBy, 'blend');

  const badProbability = resolveRowProbabilities({
    source: 'model',
    hasModelFile: true,
    ...sampleRow,
    ml: { probability: Number.NaN },
  });
  assert.equal(badProbability.modelProbability, sampleRow.blendProbability);
  assert.equal(badProbability.pricedBy, 'blend');
});

test('optional ML fields are null when absent or non-finite', () => {
  const partial = resolveRowProbabilities({
    source: 'model',
    hasModelFile: true,
    ...sampleRow,
    ml: { probability: 0.2, top3Probability: null, top5Probability: Number.POSITIVE_INFINITY },
  });
  assert.equal(partial.modelProbability, 0.2);
  assert.equal(partial.top3Probability, null);
  assert.equal(partial.top5Probability, null);
  assert.equal(partial.expectedFinish, null);
});
