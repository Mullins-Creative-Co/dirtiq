import type { SportReport, SportUpcoming } from "./model-reports.ts";
import { american, dateTime, probability, relativeAge, spread } from "./format.ts";

// These are display/recheck policies, not claims that a saved quote is executable.
export const QUOTE_RECHECK_MS = 2 * 60 * 60 * 1000;
export const FORECAST_RECHECK_MS = 24 * 60 * 60 * 1000;

export type InputAge = "recent" | "stale" | "unknown";
export type ForecastReadiness = {
  label: "Research only" | "Check inputs" | "No priced market";
  quoteStatus: InputAge;
  forecastStatus: InputAge;
  quoteDetail: string;
  forecastDetail: string;
  availabilityDetail: string;
  sourceUrl: string | null;
  spreadLean: string;
  spreadCover: string | null;
  marketInformedWin: number | null;
  reasons: string[];
};

/** Require an explicit timezone. Invalid/future timestamps never look fresh. */
export function timestampMs(value: string | null | undefined): number {
  if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

export function inputAge(value: string | null | undefined, maxAge: number, now = Date.now()): InputAge {
  const elapsed = now - timestampMs(value);
  return !Number.isFinite(elapsed) || elapsed < 0 ? "unknown" : elapsed > maxAge ? "stale" : "recent";
}

export function isUpcomingGame(game: Pick<SportUpcoming, "startsAt">, now = Date.now(), until = Infinity): boolean {
  const startsAt = timestampMs(game.startsAt);
  return Number.isFinite(startsAt) && startsAt > now && startsAt <= until;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const validProbability = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
export const hasMarket = (game: SportUpcoming): boolean =>
  finite(game.marketHomeSpread) || finite(game.marketHomeMl) || finite(game.marketAwayMl);

function lineSource(report: SportReport, game: SportUpcoming): string | null {
  const source = typeof game.lineSourceUrl === "string" ? game.lineSourceUrl
    : report.sources.find((s) => s.url.includes("/odds"))?.url
      ?? (report.sport === "nfl" ? report.sources.find((s) => s.url.includes("nflverse"))?.url : null);
  if (!source) return null;
  // NHL/MLB game IDs are mapped to ESPN IDs inside the adapter; that mapping is
  // not in legacy reports. Do not invent a per-event URL with the wrong ID.
  if (source.includes("{event}") && !["nba", "ncaab", "ncaaf"].includes(report.sport)) return null;
  try {
    const url = new URL(source.replaceAll("{event}", encodeURIComponent(game.gameId)));
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function stampDetail(stamp: string | null | undefined, status: InputAge, now: number): string {
  return status === "unknown" ? "Timestamp missing or invalid" : `${dateTime(stamp)} · ${relativeAge(stamp, now)}`;
}

/** UI interpretation only. Never change probabilities or synthesize injury adjustments. */
export function forecastReadiness(report: SportReport, game: SportUpcoming, now = Date.now()): ForecastReadiness {
  const forecastAt = typeof report.forecastGeneratedAt === "string" ? report.forecastGeneratedAt : report.generatedAt;
  // Legacy lineObservedAt is the newest retrieval across the whole source bundle,
  // not a verified per-game quote timestamp. Never use it to certify freshness.
  const quoteAt = game.lineTimestampKnown === true && typeof game.lineUpdatedAt === "string" ? game.lineUpdatedAt : null;
  const quoteStatus = inputAge(quoteAt, QUOTE_RECHECK_MS, now);
  const sourceStatus = inputAge(game.lineObservedAt, QUOTE_RECHECK_MS, now);
  const forecastStatus = inputAge(forecastAt, FORECAST_RECHECK_MS, now);
  const priced = hasMarket(game);
  const reasons: string[] = [];
  if (forecastStatus !== "recent") reasons.push(forecastStatus === "stale" ? "Forecast is over 24 hours old." : "Forecast time cannot be verified.");
  if (!priced) reasons.push("No saved market to compare with this projection.");
  else if (quoteStatus !== "recent") reasons.push(quoteStatus === "stale" ? "Saved quote is over 2 hours old. Recheck the spread and price." : "Per-game quote time is unavailable. Recheck the spread and price.");
  // The current team forecast contract has no verified game-day injury/lineup input.
  const availabilityDetail = "Injuries and lineups are not verified or included in this forecast. Missing reports do not mean a healthy roster.";
  reasons.push("Verify player availability before using this projection.");
  if (priced) reasons.push("Consensus and source-file prices are reference snapshots, not executable sportsbook offers.");

  const lean = game.lean === "home" || game.lean === "away" ? game.lean : null;
  const home = lean === "home";
  const handicap = finite(game.marketHomeSpread) ? (home ? game.marketHomeSpread : -game.marketHomeSpread) : null;
  const cover = lean ? (home ? game.homeCoverProb : game.awayCoverProb) : null;
  const price = home ? game.marketHomePrice : game.marketAwayPrice;
  const spreadLean = !finite(game.marketHomeSpread) ? "No spread available"
    : lean ? `${home ? game.home : game.away} ${spread(handicap)}` : "No spread lean";
  const spreadCover = lean && finite(game.marketHomeSpread) && validProbability(cover)
    ? `${probability(cover)} model cover${finite(price) ? ` · saved ${american(price)}` : " · price unavailable"}` : null;
  const marketInformedWin = validProbability(game.stackedMarketHomeWinProb) ? game.stackedMarketHomeWinProb : null;
  return {
    label: !priced ? "No priced market" : forecastStatus !== "recent" || quoteStatus !== "recent" ? "Check inputs" : "Research only",
    quoteStatus, forecastStatus,
    quoteDetail: !priced ? "No saved line" : quoteStatus === "unknown"
      ? `Source bundle retrieved: ${stampDetail(game.lineObservedAt, sourceStatus, now)}. Per-game quote time unavailable.`
      : `Quote timestamp: ${stampDetail(quoteAt, quoteStatus, now)}`,
    forecastDetail: `${stampDetail(forecastAt, forecastStatus, now)} · results through ${report.dataThrough ?? "unknown"}`,
    availabilityDetail, sourceUrl: lineSource(report, game), spreadLean, spreadCover, marketInformedWin, reasons,
  };
}
