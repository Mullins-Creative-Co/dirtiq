/**
 * Which probability source the house book prices from.
 *
 * - "blend": the historical path. Elo/composite odds blended 40/60 with the ML
 *   layer, then run through trend, caveat and preliminary-governor adjustments.
 * - "model": the calibrated ML field probabilities straight from
 *   `data/ml-predictions/race_<id>.json`, with no blend or governor.
 *
 * Both paths run side by side on the forecast ledger for a while, so the
 * default stays "blend" until the flag is set explicitly.
 */
export type BookSource = "blend" | "model";

export const BOOK_SOURCE_ENV = "DIRTIQ_BOOK_SOURCE";

export function resolveBookSource(value: string | undefined | null): BookSource {
  return value?.trim().toLowerCase() === "model" ? "model" : "blend";
}

export function getBookSource(): BookSource {
  return resolveBookSource(process.env[BOOK_SOURCE_ENV]);
}
