import { pairwiseAheadProbability, type MlPairwise } from "./pairwise.ts";
import type { BookSource } from "./source.ts";

export const TOP3_VIG = 0.07;
export const TOP5_VIG = 0.07;
export const H2H_VIG = 0.05;

export type PropPrice = {
  /** Book probability after vig; this is what the ticket is priced from. */
  probability: number;
  americanOdds: string;
  /** Which source produced the pre-vig probability. */
  pricedBy: BookSource;
};

export function toAmericanOdds(p: number): string {
  if (p >= 1) return "-∞";
  if (p <= 0) return "+∞";
  const odds = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

/** The house's flat prop margin: scale up, cap at 95%. */
export function propVig(p: number, vig: number): number {
  return Math.min(0.95, p * (1 + vig));
}

function finiteProbability(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function price(preVig: number, vig: number, pricedBy: BookSource): PropPrice {
  const probability = propVig(preVig, vig);
  return { probability, americanOdds: toAmericanOdds(probability), pricedBy };
}

/** The blend path's top-3 heuristic: 1 - (1 - p)^2.5, capped at 92%. */
export function blendTop3Probability(trueProb: number): number {
  return Math.min(0.92, 1 - Math.pow(1 - trueProb, 2.5));
}

export function priceTop3Market(input: {
  source: BookSource;
  /** Field-normalised win probability from the card. */
  trueProb: number;
  top3Probability: number | null | undefined;
}): PropPrice {
  const modelP = input.source === "model" ? finiteProbability(input.top3Probability) : null;
  if (modelP !== null) return price(modelP, TOP3_VIG, "model");
  return price(blendTop3Probability(input.trueProb), TOP3_VIG, "blend");
}

/**
 * Top-5 has no blend heuristic today, so it is only offered when the model
 * supplies a probability. Returns null when there is nothing to price.
 */
export function priceTop5Market(input: {
  source: BookSource;
  top5Probability: number | null | undefined;
}): PropPrice | null {
  const modelP = input.source === "model" ? finiteProbability(input.top5Probability) : null;
  if (modelP === null) return null;
  return price(modelP, TOP5_VIG, "model");
}

export type HeadToHeadSide = { driverId: number; trueProb: number };

/**
 * Price both sides of a matchup. Model mode reads P(a ahead of b) from the
 * pairwise matrix when the pair is covered; anything else uses the blend
 * ratio a / (a + b). The B side is always the complement of A before vig, so
 * the two tickets stay consistent with each other.
 */
export function priceHeadToHeadMarket(input: {
  source: BookSource;
  a: HeadToHeadSide;
  b: HeadToHeadSide;
  pairwise: MlPairwise | null | undefined;
}): { a: PropPrice; b: PropPrice } {
  const modelPA =
    input.source === "model"
      ? pairwiseAheadProbability(input.pairwise, input.a.driverId, input.b.driverId)
      : null;
  const pricedBy: BookSource = modelPA !== null ? "model" : "blend";
  const pA = modelPA ?? input.a.trueProb / (input.a.trueProb + input.b.trueProb);
  const pB = 1 - pA;

  return { a: price(pA, H2H_VIG, pricedBy), b: price(pB, H2H_VIG, pricedBy) };
}
