import type { MatchupInput, RunResult } from './model.ts';

export function explainMatchup(input: MatchupInput, result: RunResult) {
  const pick = result.lean === 'home' ? input.home : result.lean === 'away' ? input.away : null;
  const p = result.lean === 'home' ? result.homeCoverProbability : result.lean === 'away' ? result.awayCoverProbability : null;
  const threshold = result.lean === 'home' ? result.homeBreakEven : result.lean === 'away' ? result.awayBreakEven : null;
  return {
    headline: result.errors.length ? 'Inputs need correction' : pick ? `${pick}: scenario lean, not a proven edge` : 'No supported directional lean',
    explanation: result.errors.length ? 'Correct the inputs before interpreting this scenario.' : pick
      ? `The supplied projection differs from this spread by ${Math.abs(result.gap!).toFixed(2)} points toward ${pick}. That compares a scoring-margin estimate with the handicap; it does not mean the team will cover.`
      : 'A sourced projection and the exact spread are needed. A schedule or injury headline alone cannot supply a cover probability.',
    priceCheck: p === null || threshold === null ? 'A supported cover estimate and the exact price are both needed to test value. No probability is inferred from a points gap.'
      : `Supplied conditional cover estimate ${(p * 100).toFixed(1)}%; price break-even ${(threshold * 100).toFixed(1)}%. Difference ${((p - threshold) * 100).toFixed(1)} percentage points. This is arithmetic on unvalidated inputs, not evidence of profitable betting.`,
    risks: input.adjustments.filter(a => a.status === 'unknown').map(a => `${a.label}: not reviewed; this could change the result.`),
    testStatus: 'Not validated for live betting. Test frozen, pregame forecasts on later games without tuning on their results; track calibration, market comparison, sample size and returns at recorded prices, including pushes. A win does not validate a model.',
  };
}

export type ExternalEstimate = { name: string; url: string; publishedAt: string; homeMargin: number | null; injuryAware: 'unknown' | 'yes' | 'no' };
export function compareEstimate(input: MatchupInput, result: RunResult, other: ExternalEstimate, runAt: string) {
  const errors: string[] = [];
  if (!other.name.trim()) errors.push('Name the external model and version.');
  try { if (new URL(other.url).protocol !== 'https:') throw new Error(); } catch { errors.push('Use an HTTPS source link.'); }
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(other.publishedAt) || !Number.isFinite(Date.parse(other.publishedAt))) errors.push('Supply a publication timestamp with timezone.');
  else if (Date.parse(other.publishedAt) > Date.parse(runAt)) errors.push('The external estimate was published after this run. Rerun with current inputs; it cannot support the earlier scenario.');
  if (other.homeMargin === null || !Number.isFinite(other.homeMargin) || Math.abs(other.homeMargin) > 150) errors.push('Enter a finite predicted home margin between -150 and 150.');
  const gap = errors.length || input.homeSpread === null ? null : other.homeMargin! + input.homeSpread;
  const direction = gap === null || Math.abs(gap) < 1e-9 ? null : gap > 0 ? 'home' : 'away';
  return { errors, gap, agreement: errors.length || !direction || !result.lean || result.lean === 'even' ? 'Not comparable' : direction === result.lean ? 'Same direction, not independent confirmation' : 'Models disagree at this spread' };
}
