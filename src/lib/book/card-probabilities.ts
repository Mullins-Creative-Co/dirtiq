import type { BookSource } from "./source.ts";

/** The per-driver fields the ML race file carries that the card consumes. */
export type ModelRowFields = {
  probability: number;
  top3Probability?: number | null;
  top5Probability?: number | null;
  expectedFinish?: number | null;
};

export type RowProbabilityInput = {
  source: BookSource;
  /** Whether an ML file exists for this race at all (not just for this driver). */
  hasModelFile: boolean;
  /** The ML row for this driver, or null when the file does not list them. */
  ml: ModelRowFields | null;
  /** What the blend path produced after trend, caveats and the prelim governor. */
  blendProbability: number;
  /** The Elo/composite implied probability before any ML blending. */
  impliedProbability: number;
};

export type RowProbabilityResult = {
  modelProbability: number;
  blendedProbability: number;
  top3Probability: number | null;
  top5Probability: number | null;
  expectedFinish: number | null;
  /** Which path actually produced `modelProbability` for this row. */
  pricedBy: BookSource;
};

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Decide the row's headline probability for a given book source.
 *
 * Blend mode is the historical behaviour: `modelProbability` is the governed
 * blend and `blendedProbability` is the raw Elo/composite number.
 *
 * Model mode uses the calibrated ML `probability` directly, no blend, no
 * governor, no caps, and parks the governed blend in `blendedProbability` so
 * the two can be compared on the ledger. A driver the ML file does not cover
 * (late entry, missing id) falls back to the blend for that row only.
 */
export function resolveRowProbabilities(input: RowProbabilityInput): RowProbabilityResult {
  const ml = input.ml;
  const mlProbability = finiteOrNull(ml?.probability);
  const useModel = input.source === "model" && input.hasModelFile && mlProbability !== null;

  return {
    modelProbability: useModel ? mlProbability : input.blendProbability,
    blendedProbability: useModel ? input.blendProbability : input.impliedProbability,
    top3Probability: finiteOrNull(ml?.top3Probability),
    top5Probability: finiteOrNull(ml?.top5Probability),
    expectedFinish: finiteOrNull(ml?.expectedFinish),
    pricedBy: useModel ? "model" : "blend",
  };
}
