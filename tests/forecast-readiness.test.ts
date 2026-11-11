import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forecastReadiness, hasMarket, inputAge, isUpcomingGame, QUOTE_RECHECK_MS, validProbability } from "../src/lib/forecast-readiness.ts";
import { probability } from "../src/lib/format.ts";
import type { SportReport, SportUpcoming } from "../src/lib/model-reports.ts";

const now = Date.parse("2026-11-11T13:00:00Z");
const report: SportReport = {
  sport: "nba", label: "NBA", modelId: "nba-kalman", modelVersion: "1.0",
  generatedAt: "2026-11-11T12:00:00Z", dataThrough: "2026-11-09",
  sources: [{ url: "https://sports.core.api.espn.com/v2/events/{event}/odds?limit=50" }],
  ratings: [], upcoming: [], limitations: [], backtest: null,
};
const game: SportUpcoming = {
  gameId: "123", home: "SAS", away: "CHI", startsAt: "2026-11-12T01:00:00Z",
  projectedHomeMargin: 12.2, marginSd: 13, homeWinProb: .84,
  marketHomeSpread: -15.5, marketHomePrice: -110, marketAwayPrice: -108,
  marketHomeMl: -700, marketAwayMl: 450, book: "ESPN multi-book median", lineObservedAt: "2026-11-11T12:30:00Z",
  homeCoverProb: .40, awayCoverProb: .60, pushProb: 0,
  edgePts: -3.3, lean: "away", stackedMarketHomeWinProb: .81,
};

test("a recent source bundle never certifies a fresh per-game quote", () => {
  const result = forecastReadiness(report, game, now);
  assert.equal(result.quoteStatus, "unknown");
  assert.equal(result.label, "Check inputs");
  assert.match(result.quoteDetail, /Source bundle retrieved.*Per-game quote time unavailable/);
  assert.match(result.availabilityDetail, /not verified or included/);
  assert.equal(result.sourceUrl, "https://sports.core.api.espn.com/v2/events/123/odds?limit=50");
});

test("spread summary follows the covering side, not the outright favorite", () => {
  const result = forecastReadiness(report, game, now);
  assert.equal(result.spreadLean, "CHI +15.5");
  assert.equal(result.spreadCover, "60% model cover · saved -108");
  const home = forecastReadiness(report, { ...game, lean: "home" }, now);
  assert.equal(home.spreadLean, "SAS -15.5");
  assert.equal(home.spreadCover, "40% model cover · saved -110");
  assert.equal(forecastReadiness(report, { ...game, lean: "none" }, now).spreadCover, null);
});

test("missing markets and missing prices stay missing, not invented zeros", () => {
  const missing = { ...game, marketHomeSpread: null, marketHomeMl: null, marketAwayMl: null };
  assert.equal(hasMarket(missing), false);
  assert.equal(forecastReadiness(report, missing, now).label, "No priced market");
  assert.equal(forecastReadiness(report, missing, now).spreadCover, null);
  assert.equal(hasMarket({ ...missing, marketHomeSpread: NaN }), false);
  assert.equal(hasMarket({ ...missing, marketHomeMl: undefined }), false);
  assert.equal(hasMarket({ ...missing, marketHomeSpread: 0 }), true);
  assert.match(forecastReadiness(report, { ...game, marketAwayPrice: null }, now).spreadCover!, /price unavailable/);
});

test("explicit quote timestamps are rechecked at read time, never marked bet ready", () => {
  const timed = { ...game, lineTimestampKnown: true, lineUpdatedAt: "2026-11-11T12:00:00Z" };
  const recent = forecastReadiness(report, timed, now);
  assert.equal(recent.quoteStatus, "recent");
  assert.equal(recent.label, "Research only");
  assert.match(recent.reasons.join(" "), /not executable/);
  const stale = forecastReadiness(report, timed, now + QUOTE_RECHECK_MS);
  assert.equal(stale.quoteStatus, "stale");
  assert.equal(stale.label, "Check inputs");
  assert.equal(forecastReadiness(report, { ...timed, lineTimestampKnown: false }, now).quoteStatus, "unknown");
});

test("future, malformed, missing, and timezone-free timestamps cannot look current", () => {
  for (const stamp of [undefined, null, "", "bad-date", "2026-11-11T14:00:00Z", "2026-11-11T12:00:00", "2026-11-11"]) {
    assert.equal(inputAge(stamp, QUOTE_RECHECK_MS, now), "unknown", String(stamp));
  }
  assert.equal(inputAge("2026-11-11T07:00:00-05:00", QUOTE_RECHECK_MS, now), "recent");
});

test("forecast generation time takes precedence over report generation time", () => {
  const r = { ...report, forecastGeneratedAt: "2026-11-09T12:00:00Z" };
  assert.equal(forecastReadiness(r, game, now).forecastStatus, "stale");
  assert.match(forecastReadiness(r, game, now).reasons.join(" "), /24 hours/);
});

test("started, invalid, and out-of-window games never appear as upcoming", () => {
  assert.equal(isUpcomingGame(game, now), true);
  for (const startsAt of ["", "bad", "2026-11-11T13:00:00Z", "2026-11-11T12:59:59Z", "2026-11-12"]) {
    assert.equal(isUpcomingGame({ startsAt }, now), false);
  }
  assert.equal(isUpcomingGame(game, now, now + 60_000), false);
  assert.equal(isUpcomingGame(game, now, Date.parse(game.startsAt)), true);
});

test("source links accept only valid HTTPS and safely substitute the event", () => {
  for (const lineSourceUrl of ["javascript:alert(1)", "http://example.com", "not-a-url"]) {
    assert.equal(forecastReadiness(report, { ...game, lineSourceUrl }, now).sourceUrl, null);
  }
  assert.equal(forecastReadiness({ ...report, sources: [] }, game, now).sourceUrl, null);
  assert.equal(forecastReadiness({ ...report, sport: "nhl" }, game, now).sourceUrl, null);
});

test("forecast probabilities never round to zero or certainty", () => {
  assert.equal(probability(.997), ">99%");
  assert.equal(probability(.003), "<1%");
  assert.equal(probability(1), ">99%");
  assert.equal(probability(0), "<1%");
  assert.equal(probability(.9999, 1), ">99.9%");
  assert.equal(probability(.0001, 1), "<0.1%");
  assert.equal(probability(.84), "84%");
  for (const p of [null, undefined, NaN, Infinity, -1, 2]) assert.equal(probability(p), "—");
  for (const p of [null, undefined, NaN, Infinity, -1, 2]) assert.equal(validProbability(p), false);
});

test("all supported team reports keep absent injury and quote evidence explicit", () => {
  for (const sport of ["nfl", "nba", "ncaaf", "ncaab"]) {
    const r: SportReport = JSON.parse(readFileSync(new URL(`../public/sports/${sport}.json`, import.meta.url), "utf8"));
    for (const g of r.upcoming.slice(0, 5)) {
      const result = forecastReadiness(r, g, now);
      assert.match(result.availabilityDetail, /not verified or included/);
      assert.notEqual(result.label, "Research only");
      if (hasMarket(g)) assert.match(result.quoteDetail, /Per-game quote time unavailable/);
    }
  }
});
