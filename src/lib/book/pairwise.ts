/**
 * Pairwise finish-order matrix from the ML race file.
 *
 * `probabilities[i][j]` is P(driverIds[i] finishes ahead of driverIds[j]).
 * The file only covers the top drivers (currently 12), and the producer is
 * still being wired up, so everything here treats the matrix as optional and
 * partially filled.
 */
export type MlPairwise = {
  driverIds: number[];
  probabilities: number[][];
};

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Validate and copy a raw `pairwise` object from JSON. Returns null for
 * anything that is not a square matrix keyed by a numeric driver id list.
 * Missing or non-numeric cells are kept as NaN so lookups can fall back to the
 * mirrored cell.
 */
export function normalizePairwise(raw: unknown): MlPairwise | null {
  if (!raw || typeof raw !== "object") return null;
  const { driverIds, probabilities } = raw as { driverIds?: unknown; probabilities?: unknown };
  if (!Array.isArray(driverIds) || !Array.isArray(probabilities)) return null;
  if (driverIds.length === 0 || probabilities.length !== driverIds.length) return null;

  const ids: number[] = [];
  for (const id of driverIds) {
    const parsed = asFiniteNumber(id);
    if (parsed === null) return null;
    ids.push(parsed);
  }
  if (new Set(ids).size !== ids.length) return null;

  const matrix: number[][] = [];
  for (const row of probabilities) {
    if (!Array.isArray(row) || row.length !== ids.length) return null;
    matrix.push(row.map((cell) => asFiniteNumber(cell) ?? Number.NaN));
  }

  return { driverIds: ids, probabilities: matrix };
}

/**
 * P(driver `aId` finishes ahead of driver `bId`), or null when the pair is not
 * covered. Uses the direct cell when present and the mirrored cell (1 - P(b, a))
 * otherwise, so a half-filled matrix still prices both sides.
 */
export function pairwiseAheadProbability(
  pairwise: MlPairwise | null | undefined,
  aId: number,
  bId: number
): number | null {
  if (!pairwise || aId === bId) return null;
  const i = pairwise.driverIds.indexOf(aId);
  const j = pairwise.driverIds.indexOf(bId);
  if (i < 0 || j < 0) return null;

  const direct = asFiniteNumber(pairwise.probabilities[i]?.[j]);
  if (direct !== null) return Math.min(1, Math.max(0, direct));

  const mirrored = asFiniteNumber(pairwise.probabilities[j]?.[i]);
  if (mirrored !== null) return 1 - Math.min(1, Math.max(0, mirrored));

  return null;
}

export function pairwiseCovers(pairwise: MlPairwise | null | undefined, aId: number, bId: number) {
  return pairwiseAheadProbability(pairwise, aId, bId) !== null;
}
