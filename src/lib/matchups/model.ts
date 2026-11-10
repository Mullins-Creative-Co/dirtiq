/** Experimental shared forecast contract. Margins are home score minus away score;
 * spreads are the sportsbook's signed home handicap (home favorite = negative).
 * Cover probabilities and price comparisons are conditional on a non-push result.
 * This module has no clock, network access, trained coefficients, or staking logic.
 */
export type SportId = 'nfl' | 'nba' | 'ncaaf' | 'ncaab';
export const SPORT_LABELS: Record<SportId, string> = {
  nfl: 'NFL', nba: 'NBA', ncaaf: 'College football', ncaab: 'College basketball',
};
export type Adjustment = {
  id: string; label: string; status: 'unknown' | 'included' | 'new';
  points: number | null; reason: string;
};
export type MatchupInput = {
  sport: SportId; home: string; away: string;
  baselineHomeMargin: number | null; baselineSource: string; baselineKind?: 'automatic';
  adjustments: Adjustment[]; homeSpread: number | null;
  homeOdds: number | null; awayOdds: number | null;
  book: string; quoteObservedAt: string;
  homeCoverProbability: number | null; probabilitySource: string;
  /** Relative probability masses keyed by integer final home scoring margin. */
  distribution?: Record<string, number>;
};
export type RunResult = {
  projectedHomeMargin: number | null; projectedHomeSpread: number | null;
  gap: number | null; lean: 'home' | 'away' | 'even' | null;
  homeCoverProbability: number | null; awayCoverProbability: number | null;
  pushProbability: number | null; homeBreakEven: number | null;
  awayBreakEven: number | null; marketHomeProbability: number | null;
  warnings: string[]; reasons: string[]; errors: string[];
};

// Input guardrails, not assertions about the range of possible real-world scores.
const LIMITS: Record<SportId, number> = { nfl: 100, nba: 150, ncaaf: 150, ncaab: 150 };
const EPS = 1e-9;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const cleanZero = (value: number) => value === 0 ? 0 : value;
const implied = (odds: number | null) => odds === null ? null
  : odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);

export function runMatchup(input: MatchupInput): RunResult {
  const result: RunResult = {
    projectedHomeMargin: null, projectedHomeSpread: null, gap: null, lean: null,
    homeCoverProbability: null, awayCoverProbability: null, pushProbability: null,
    homeBreakEven: null, awayBreakEven: null, marketHomeProbability: null,
    warnings: ['Experimental research estimates, not a validated predictive model. No betting or staking recommendation.'],
    reasons: [], errors: [],
  };
  const { errors, warnings, reasons } = result;
  if (!input || typeof input !== 'object') {
    errors.push('Matchup input must be an object.');
    return result;
  }
  const validSport = Object.prototype.hasOwnProperty.call(LIMITS, input.sport);
  if (!validSport) errors.push('Choose a supported sport: NFL, NBA, NCAAF, or NCAAB.');
  const limit = validSport ? LIMITS[input.sport] : 100;
  for (const side of ['home', 'away'] as const) {
    if (!nonempty(input[side]) || input[side].trim().length > 120 || /[\x00-\x1f\x7f]/.test(input[side])) {
      errors.push(`The ${side} team needs a name of 1–120 characters without control characters.`);
    }
  }
  if (nonempty(input.home) && nonempty(input.away)
    && input.home.trim().toLowerCase() === input.away.trim().toLowerCase()) {
    errors.push('Home and away teams must be different.');
  }
  const numberOrNull = (value: unknown, name: string, bound: number): value is number | null => {
    if (value === null) return true;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) {
      errors.push(`${name} must be null or a finite number within ±${bound}.`);
      return false;
    }
    return true;
  };
  numberOrNull(input.baselineHomeMargin, 'Baseline home margin', limit);
  numberOrNull(input.homeSpread, 'Home spread', limit);
  for (const key of ['homeOdds', 'awayOdds'] as const) {
    const price = input[key];
    if (price !== null && (typeof price !== 'number' || !Number.isSafeInteger(price) || Math.abs(price) < 100)) {
      errors.push(`${key} must be null or integer American odds with absolute value at least 100.`);
    }
  }
  if (input.homeCoverProbability !== null && (typeof input.homeCoverProbability !== 'number'
    || !Number.isFinite(input.homeCoverProbability) || input.homeCoverProbability < 0 || input.homeCoverProbability > 1)) {
    errors.push('Home cover probability must be null or a finite number from 0 to 1.');
  }
  if (input.homeCoverProbability !== null && input.homeSpread === null) {
    errors.push('A home spread is required for an explicit cover probability.');
  }
  if (input.homeCoverProbability !== null && !nonempty(input.probabilitySource)) {
    errors.push('An explicit cover probability needs a probability source.');
  }

  let newPoints = 0;
  let hasNewAdjustment = false;
  const seen = new Map<string, Adjustment>();
  if (!Array.isArray(input.adjustments)) errors.push('Adjustments must be an array.');
  else for (const adjustment of input.adjustments) {
    if (!adjustment || typeof adjustment !== 'object' || !nonempty(adjustment.id) || !nonempty(adjustment.label)) {
      errors.push('Each adjustment needs a nonempty unique id and label.');
      continue;
    }
    if (!['unknown', 'included', 'new'].includes(adjustment.status)) {
      errors.push(`${adjustment.label}: invalid adjustment status.`);
      continue;
    }
    numberOrNull(adjustment.points, `${adjustment.label} points`, limit);
    const id = adjustment.id.trim();
    const prior = seen.get(id);
    if (prior) {
      if (prior.status !== adjustment.status || prior.points !== adjustment.points || prior.reason !== adjustment.reason) {
        errors.push(`${adjustment.label}: conflicting duplicate adjustment id "${id}".`);
      } else warnings.push(`${adjustment.label}: duplicate id "${id}" ignored; counted once only.`);
      continue;
    }
    seen.set(id, adjustment);
    if (adjustment.status === 'included') {
      reasons.push(`${adjustment.label}: already included in the baseline; no additional points applied.`);
    } else if (adjustment.status === 'unknown') {
      warnings.push(`${adjustment.label}: impact is unknown; no points applied.`);
    } else {
      hasNewAdjustment = true;
      if (adjustment.points === null || !nonempty(adjustment.reason)) {
        errors.push(`${adjustment.label}: a new adjustment needs finite points and a reason.`);
      } else {
        newPoints += adjustment.points;
        reasons.push(`${adjustment.label}: ${adjustment.points > 0 ? '+' : ''}${adjustment.points} home-margin points. ${adjustment.reason.trim()}`);
      }
    }
  }

  let distribution: Array<[number, number]> | null = null;
  let baseline = input.baselineHomeMargin;
  if (input.distribution !== undefined) {
    if (!input.distribution || typeof input.distribution !== 'object' || Array.isArray(input.distribution)) {
      errors.push('Distribution must map integer home margins to nonnegative finite probability masses.');
    } else {
      const entries = Object.entries(input.distribution);
      const margins = new Set<number>();
      let total = 0;
      let valid = entries.length > 0;
      for (const [key, mass] of entries) {
        const margin = Number(key);
        if (!key.trim() || !Number.isInteger(margin) || Math.abs(margin) > limit || margins.has(margin)
          || typeof mass !== 'number' || !Number.isFinite(mass) || mass < 0) valid = false;
        margins.add(margin);
        total += mass;
      }
      if (!valid || !Number.isFinite(total) || total <= 0) {
        errors.push(`Distribution needs unique integer margins within ±${limit} and nonnegative finite masses with a positive finite total.`);
      } else {
        distribution = entries.map(([key, mass]) => [Number(key), mass / total]);
        const mean = distribution.reduce((sum, [margin, mass]) => sum + margin * mass, 0);
        if (baseline !== null && Number.isFinite(baseline) && Math.abs(baseline - mean) > EPS) {
          errors.push('Manual baseline disagrees with the distribution mean. Clear it or use the distribution mean.');
        }
        baseline = mean;
        reasons.push('Baseline derived from the supplied margin distribution; masses normalized to sum to one.');
        warnings.push('The supplied distribution is user/research data, not a verified calibrated forecast.');
      }
    }
  } else if (baseline !== null && !nonempty(input.baselineSource)) {
    errors.push('A manual baseline needs a baseline source.');
  } else if (baseline !== null) {
    reasons.push(`${input.baselineKind === 'automatic' ? 'Automatic experimental model' : 'Manual baseline'} source: ${input.baselineSource.trim()}.`);
  }

  if (input.homeSpread !== null || input.homeOdds !== null || input.awayOdds !== null) {
    if (!nonempty(input.book)) warnings.push('Sportsbook/source missing; quote provenance is unverified.');
    else warnings.push(`Quote attributed to ${input.book.trim()} by the input; not independently verified.`);
    if (!nonempty(input.quoteObservedAt)) warnings.push('Quote observation time missing; freshness is unknown.');
    else if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input.quoteObservedAt)
      || !Number.isFinite(Date.parse(input.quoteObservedAt))) {
      errors.push('Quote observation time must be an ISO timestamp with a timezone, or left empty.');
    } else warnings.push(`Quote observation time supplied: ${input.quoteObservedAt}. Freshness is not verified; confirm the current line and price.`);
  }
  if (errors.length) return result;
  if (baseline === null) {
    warnings.push('No baseline or margin distribution supplied. No point forecast, spread, gap, or lean can be produced.');
    if (hasNewAdjustment) warnings.push('New adjustments were not applied because the baseline is missing.');
  } else {
    const projection = baseline + newPoints;
    if (!Number.isFinite(projection) || Math.abs(projection) > limit) {
      errors.push(`Adjusted home margin exceeds the ±${limit} input guardrail.`);
      return result;
    }
    result.projectedHomeMargin = cleanZero(projection);
    result.projectedHomeSpread = cleanZero(-projection);
    if (input.homeSpread !== null) {
      result.gap = cleanZero(projection + input.homeSpread);
      result.lean = Math.abs(result.gap) < EPS ? 'even' : result.gap > 0 ? 'home' : 'away';
      reasons.push('Gap = projected home margin + signed home spread; it is a point difference, not a probability or expected return.');
    }
  }
  if (distribution && !hasNewAdjustment && input.homeSpread !== null) {
    let cover = 0;
    let awayCover = 0;
    let push = 0;
    for (const [margin, mass] of distribution) {
      const settlement = margin + input.homeSpread;
      if (settlement === 0) push += mass;
      else if (settlement > 0) cover += mass;
      else awayCover += mass;
    }
    const nonPush = cover + awayCover;
    result.pushProbability = push;
    if (nonPush > 0) {
      result.homeCoverProbability = cover / nonPush;
      result.awayCoverProbability = awayCover / nonPush;
    } else warnings.push('All supplied distribution mass pushes this spread; conditional cover probabilities are undefined.');
    if (input.homeCoverProbability !== null && (result.homeCoverProbability === null
      || Math.abs(input.homeCoverProbability - result.homeCoverProbability) > EPS)) {
      errors.push('Explicit cover probability disagrees with the supplied distribution at this spread.');
      return { ...result, projectedHomeMargin: null, projectedHomeSpread: null, gap: null, lean: null,
        homeCoverProbability: null, awayCoverProbability: null, pushProbability: null };
    }
    reasons.push('Cover and push probabilities derived at the exact supplied spread; cover probabilities exclude pushes.');
  } else {
    if (distribution && hasNewAdjustment) warnings.push('New point adjustments invalidate the supplied distribution for cover/push pricing. Only its baseline mean is used.');
    if (input.homeCoverProbability !== null) {
      result.homeCoverProbability = input.homeCoverProbability;
      result.awayCoverProbability = 1 - input.homeCoverProbability;
      reasons.push(`Explicit conditional-on-no-push probability source: ${input.probabilitySource.trim()}.`);
      warnings.push('Explicit cover probability must match this exact spread and all new adjustments. Push probability is unknown, not assumed zero.');
    } else warnings.push('No usable cover probability supplied. A margin or point gap is never converted into a cover probability.');
  }
  result.homeBreakEven = implied(input.homeOdds);
  result.awayBreakEven = implied(input.awayOdds);
  if (input.homeSpread !== null && result.homeBreakEven !== null && result.awayBreakEven !== null) {
    result.marketHomeProbability = result.homeBreakEven / (result.homeBreakEven + result.awayBreakEven);
    reasons.push('Market home probability removes the two-sided price overround proportionally; both prices must be for opposite sides of this same spread, book, and time.');
  }
  if (input.homeOdds !== null || input.awayOdds !== null) {
    warnings.push('Price break-even probabilities are conditional on no push. Quote matching is not independently verified.');
  }
  return result;
}
