import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePairwise } from '../src/lib/book/pairwise.ts';
import {
  H2H_VIG,
  TOP3_VIG,
  TOP5_VIG,
  blendTop3Probability,
  priceHeadToHeadMarket,
  priceTop3Market,
  priceTop5Market,
  propVig,
  toAmericanOdds,
} from '../src/lib/book/prop-pricing.ts';

const close = (actual: number, expected: number) => {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`);
};

// The exact formulas generateProps used before the pure module existed.
const legacyTop3 = (trueProb: number) => propVig(Math.min(0.92, 1 - Math.pow(1 - trueProb, 2.5)), 0.07);
const legacyH2H = (a: number, b: number) => {
  const pA = a / (a + b);
  return { a: propVig(pA, 0.05), b: propVig(1 - pA, 0.05) };
};

test('vig helper and odds formatting are unchanged', () => {
  close(propVig(0.5, 0.07), 0.535);
  assert.equal(propVig(0.97, 0.07), 0.95, 'caps at 95%');
  assert.equal(toAmericanOdds(0.5), '-100');
  assert.equal(toAmericanOdds(0.25), '+300');
  assert.equal(toAmericanOdds(0.8), '-400');
  assert.equal(toAmericanOdds(0), '+∞');
  assert.equal(toAmericanOdds(1), '-∞');
  assert.equal(TOP3_VIG, 0.07);
  assert.equal(TOP5_VIG, 0.07);
  assert.equal(H2H_VIG, 0.05);
});

test('top3 in blend mode reproduces the legacy heuristic and ignores ML fields', () => {
  for (const trueProb of [0.02, 0.1, 0.25, 0.45, 0.7]) {
    const withField = priceTop3Market({ source: 'blend', trueProb, top3Probability: 0.858 });
    const without = priceTop3Market({ source: 'blend', trueProb, top3Probability: null });
    close(withField.probability, legacyTop3(trueProb));
    close(without.probability, legacyTop3(trueProb));
    assert.equal(withField.pricedBy, 'blend');
    assert.equal(withField.americanOdds, toAmericanOdds(legacyTop3(trueProb)));
  }
  close(blendTop3Probability(0.9), 0.92);
});

test('top3 in model mode prices from top3Probability and falls back when absent', () => {
  const priced = priceTop3Market({ source: 'model', trueProb: 0.45, top3Probability: 0.858 });
  close(priced.probability, propVig(0.858, TOP3_VIG));
  assert.equal(priced.pricedBy, 'model');

  const absent = priceTop3Market({ source: 'model', trueProb: 0.45, top3Probability: null });
  close(absent.probability, legacyTop3(0.45));
  assert.equal(absent.pricedBy, 'blend');

  const nan = priceTop3Market({ source: 'model', trueProb: 0.45, top3Probability: Number.NaN });
  assert.equal(nan.pricedBy, 'blend');
});

test('top5 only exists on the model path with a probability', () => {
  assert.equal(priceTop5Market({ source: 'blend', top5Probability: 0.972 }), null);
  assert.equal(priceTop5Market({ source: 'model', top5Probability: null }), null);
  assert.equal(priceTop5Market({ source: 'model', top5Probability: undefined }), null);
  const priced = priceTop5Market({ source: 'model', top5Probability: 0.6 });
  assert.ok(priced);
  close(priced!.probability, propVig(0.6, TOP5_VIG));
  assert.equal(priced!.pricedBy, 'model');
});

const pairwise = normalizePairwise({
  driverIds: [1, 2, 3],
  probabilities: [
    [0.5, 0.64, null],
    [null, 0.5, 0.55],
    [null, null, 0.5],
  ],
});

test('h2h in blend mode reproduces the legacy ratio even when a matrix is present', () => {
  const priced = priceHeadToHeadMarket({
    source: 'blend',
    a: { driverId: 1, trueProb: 0.3 },
    b: { driverId: 2, trueProb: 0.2 },
    pairwise,
  });
  const legacy = legacyH2H(0.3, 0.2);
  close(priced.a.probability, legacy.a);
  close(priced.b.probability, legacy.b);
  assert.equal(priced.a.pricedBy, 'blend');
  assert.equal(priced.b.pricedBy, 'blend');
});

test('h2h in model mode uses the pairwise matrix, including the mirrored ordering', () => {
  const forward = priceHeadToHeadMarket({
    source: 'model',
    a: { driverId: 1, trueProb: 0.3 },
    b: { driverId: 2, trueProb: 0.2 },
    pairwise,
  });
  close(forward.a.probability, propVig(0.64, H2H_VIG));
  close(forward.b.probability, propVig(0.36, H2H_VIG));
  assert.equal(forward.a.pricedBy, 'model');

  // Only the [1][2] cell is filled; asking for (2, 1) must mirror it.
  const reversed = priceHeadToHeadMarket({
    source: 'model',
    a: { driverId: 2, trueProb: 0.2 },
    b: { driverId: 1, trueProb: 0.3 },
    pairwise,
  });
  close(reversed.a.probability, propVig(0.36, H2H_VIG));
  close(reversed.b.probability, propVig(0.64, H2H_VIG));
  assert.equal(reversed.a.pricedBy, 'model');
});

test('h2h in model mode falls back to the blend ratio for pairs the matrix does not cover', () => {
  const uncovered = priceHeadToHeadMarket({
    source: 'model',
    a: { driverId: 1, trueProb: 0.3 },
    b: { driverId: 9, trueProb: 0.1 },
    pairwise,
  });
  const legacy = legacyH2H(0.3, 0.1);
  close(uncovered.a.probability, legacy.a);
  close(uncovered.b.probability, legacy.b);
  assert.equal(uncovered.a.pricedBy, 'blend');

  const noMatrix = priceHeadToHeadMarket({
    source: 'model',
    a: { driverId: 1, trueProb: 0.3 },
    b: { driverId: 2, trueProb: 0.2 },
    pairwise: null,
  });
  close(noMatrix.a.probability, legacyH2H(0.3, 0.2).a);
  assert.equal(noMatrix.a.pricedBy, 'blend');
});
