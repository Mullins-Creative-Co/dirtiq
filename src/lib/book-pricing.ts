import "server-only";

import type { PredictionCard, PredictionCardRow } from "@/lib/prediction-card";

export type PricingStage = "opening" | "confirmed" | "race-night";

export type BookLinePrice = {
  driverId: number;
  fairProbability: number;
  fairOdds: string;
  bookProbability: number;
  americanOdds: string;
  stage: PricingStage;
  hold: number;
  confidenceWeight: number;
  shade: number;
  rationale: string;
};

export type BookExposureInput = {
  totalHandle: number;
  totalStaked: number;
  payoutIfWin: number;
};

function probabilityToAmericanOdds(probability: number) {
  if (probability >= 1) return "-∞";
  if (probability <= 0) return "+∞";

  const odds =
    probability >= 0.5
      ? -(probability / (1 - probability)) * 100
      : ((1 - probability) / probability) * 100;

  return odds < 0 ? Math.round(odds).toString() : `+${Math.round(odds)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pricingStage(card: PredictionCard): PricingStage {
  const entries = Math.max(1, card.readiness.entries);
  const hasLineup = card.readiness.starts >= Math.ceil(entries * 0.5);
  const hasRaceNight = hasLineup || card.readiness.heats >= Math.ceil(entries * 0.5) || card.readiness.qualifying >= Math.ceil(entries * 0.5);
  const mostlyConfirmed =
    card.rows.filter((row) => row.entryStatus === "confirmed").length >= Math.ceil(entries * 0.5);

  if (hasRaceNight) return "race-night";
  if (mostlyConfirmed) return "confirmed";
  return "opening";
}

function stageSettings(stage: PricingStage) {
  if (stage === "race-night") return { hold: 0.12, confidenceWeight: 0.9 };
  if (stage === "confirmed") return { hold: 0.15, confidenceWeight: 0.72 };
  return { hold: 0.2, confidenceWeight: 0.6 };
}

function publicFavoriteShade(row: PredictionCardRow) {
  const name = row.driverName.toLowerCase();
  if (name === "nick hoffman" || name === "brandon overton") return 0.025;
  return 0;
}

function riskShade(
  row: PredictionCardRow,
  rank: number,
  stage: PricingStage,
  fairProbability: number,
  exposure?: BookExposureInput
) {
  let shade = publicFavoriteShade(row);

  if (rank === 0) shade += 0.018;
  if (row.confidence === "Low" && row.modelProbability >= 0.1) shade += 0.014;
  if (row.entryStatus === "expected" || row.entryStatus === "unconfirmed") shade += stage === "opening" ? 0.014 : 0.006;
  if (row.warnings.length > 0) shade += Math.min(0.018, row.warnings.length * 0.006);
  if (exposure && exposure.totalHandle > 0) {
    const stakeShare = exposure.totalStaked / exposure.totalHandle;
    const handlePressure = Math.max(0, stakeShare - fairProbability);
    const payoutPressure = Math.max(0, exposure.payoutIfWin - exposure.totalHandle) / exposure.totalHandle;
    shade += clamp(handlePressure * 0.12 + payoutPressure * 0.025, 0, 0.08);
  }

  return shade;
}

export function priceOutrightWinnerLines(
  card: PredictionCard,
  exposureByDriver = new Map<number, BookExposureInput>()
): BookLinePrice[] {
  const rows = card.rows.filter((row) => row.entryStatus !== "scratched");
  if (rows.length === 0) return [];

  const stage = pricingStage(card);
  const { hold, confidenceWeight } = stageSettings(stage);
  const baseline = 1 / rows.length;
  const modelTotal = rows.reduce((sum, row) => sum + row.modelProbability, 0) || 1;
  const fairProbabilities = rows.map((row) => clamp(row.modelProbability / modelTotal, 0.001, 0.85));
  const shrunkProbabilities = fairProbabilities.map((probability) =>
    confidenceWeight * probability + (1 - confidenceWeight) * baseline
  );
  const vigWeights = shrunkProbabilities.map((probability) => Math.pow(probability, 1.25));
  const vigTotal = vigWeights.reduce((sum, weight) => sum + weight, 0) || 1;

  return rows.map((row, index) => {
    const fairProbability = fairProbabilities[index];
    const exposure = exposureByDriver.get(row.driverId);
    const shade = riskShade(row, index, stage, fairProbability, exposure);
    const bookProbability = clamp(
      shrunkProbabilities[index] + hold * (vigWeights[index] / vigTotal) + shade,
      0.006,
      0.92
    );
    const stageLabel =
      stage === "race-night" ? "race-night line" : stage === "confirmed" ? "confirmed-entry line" : "opening line";

    return {
      driverId: row.driverId,
      fairProbability,
      fairOdds: probabilityToAmericanOdds(fairProbability),
      bookProbability,
      americanOdds: probabilityToAmericanOdds(bookProbability),
      stage,
      hold,
      confidenceWeight,
      shade,
      rationale: `${stageLabel}; ${Math.round(hold * 100)}% target hold; ${Math.round(confidenceWeight * 100)}% model confidence corridor; ${Math.round(shade * 1000) / 10}% underwriting shade${exposure && exposure.totalStaked > 0 ? ` on ${Math.round((exposure.totalStaked / exposure.totalHandle) * 100)}% handle share` : ""}; fair ${probabilityToAmericanOdds(fairProbability)}`,
    };
  });
}
