import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { consolidateLiveLines, featuredLiveKeys, gameBetTerms, isFreshLiveLine, liveEdge, moneylineValue, LIVE_LINE_TTL_MS, nflEspnId, noVigHome } from "../src/lib/live-lines/core.ts";
import type { SportUpcoming } from "../src/lib/model-reports.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/live-lines.json", import.meta.url), "utf8"));
const observedAt = "2026-11-11T18:00:00Z";

test("ESPN fixture: home handicap, nested close overrides, real-book medians and paired moneylines", () => {
  assert.deepEqual(consolidateLiveLines(fixture, observedAt), {
    spread: -5.5, homeSpreadPrice: -110, awaySpreadPrice: -110,
    homeMl: -170, awayMl: 145, total: 221.5, books: 3, observedAt,
  });
});
test("home underdogs stay positive; decimal and EVEN prices follow Python's normalization", () => {
  const line = consolidateLiveLines({ items: [{ provider: { name: "Book" }, spread: -3, homeTeamOdds: { favorite: false, close: { spread: { american: "EVEN" }, moneyLine: { value: 1.9 } } }, awayTeamOdds: { moneyLine: 0, spreadOdds: -99 } }] }, observedAt)!;
  assert.equal(line.spread, 3);
  assert.equal(line.homeSpreadPrice, 100);
  assert.equal(line.awaySpreadPrice, -100);
  assert.equal(line.homeMl, null); // unpaired; zero is not a quote
});
test("price medians round ties to even, exactly like Python", () => {
  const items = [-110, -111].map((spreadOdds) => ({ provider: { name: "Book" }, spread: 0, homeTeamOdds: { spreadOdds } }));
  assert.equal(consolidateLiveLines({ items }, observedAt)?.homeSpreadPrice, -110);
});
test("empty, excluded and malformed payloads return null", () => {
  for (const payload of [null, {}, { items: [] }, { items: [null, "bad", { provider: { name: "Consensus" }, spread: 3 }] }]) assert.equal(consolidateLiveLines(payload, observedAt), null);
});
test("live edges use home handicap and the report threshold, including the boundary", () => {
  assert.deepEqual(liveEdge(7, -4, 3), { edgePts: 3, lean: "home" });
  assert.deepEqual(liveEdge(7, -10, 3), { edgePts: -3, lean: "away" });
  assert.deepEqual(liveEdge(7, -5, 3), { edgePts: 2, lean: "none" });
  assert.deepEqual(liveEdge(7, null, 3), { edgePts: null, lean: null });
  assert.deepEqual(liveEdge(7, -4, null), { edgePts: 3, lean: null });
});
const game = { home: "BOS", away: "NYK", homeWinProb: .7, homeCoverProb: .6, awayCoverProb: .4, marketHomeSpread: -3, marketHomePrice: -110, marketAwayPrice: -105, marketHomeMl: -150, marketAwayMl: 130 } as SportUpcoming;
test("bet prefill uses live spread prices, live no-vig ML probability, and saved prices on fallback", () => {
  const live = consolidateLiveLines(fixture, observedAt)!;
  const terms = gameBetTerms(game, live);
  assert.equal(terms.line, -5.5);
  assert.equal(terms.price, -110); // not the -170 moneyline
  assert.equal(terms.market, "spread");
  assert.equal(terms.modelProb, null); // saved cover probability isn't valid at a moved line
  assert.equal(terms.marketProb, noVigHome(-170, 145));
  assert.equal(gameBetTerms(game).line, -3);
  assert.equal(gameBetTerms(game).price, -110);
  assert.equal(gameBetTerms(game).modelProb, .6);
  const away = gameBetTerms({ ...game, homeWinProb: .3 }, live);
  assert.equal(away.line, 5.5);
  assert.equal(away.marketProb, 1 - noVigHome(-170, 145)!);
  assert.equal(gameBetTerms(game, { ...live, spread: null }).market, "moneyline");
  assert.equal(gameBetTerms(game, { ...live, spread: null }).price, -170);
  assert.equal(noVigHome(null, 140), null);
});
test("network slate is capped at six per focus sport today, excluding started and distant games", () => {
  const now = Date.parse(observedAt);
  const rows = ["nba", "ncaab", "ncaaf", "nfl", "nhl"].flatMap((sport) => Array.from({ length: 500 }, (_, i) => ({ key: `${sport}:${i}`, sport, startsAt: new Date(now + 1000).toISOString(), isToday: true })));
  rows.unshift({ key: "started", sport: "nba", startsAt: observedAt, isToday: true });
  rows.unshift({ key: "tomorrow", sport: "nba", startsAt: new Date(now + 86_401_000).toISOString(), isToday: false });
  const keys = featuredLiveKeys(rows, now);
  assert.equal(keys.size, 24);
  assert(!keys.has("started")); assert(!keys.has("tomorrow")); assert(!keys.has("ncaab:6"));
});
test("NFL ids require a unique date/team match and normalize WSH and LAR", () => {
  const event = { id: "401234567", date: observedAt, competitions: [{ date: observedAt, competitors: [{ homeAway: "home", team: { abbreviation: "WSH" } }, { homeAway: "away", team: { abbreviation: "LAR" } }] }] };
  assert.equal(nflEspnId({ events: [event] }, "WAS", "LA", observedAt), event.id);
  assert.equal(nflEspnId({ events: [event, event] }, "WAS", "LA", observedAt), null);
  assert.equal(nflEspnId({ events: [event] }, "LA", "WAS", observedAt), null);
  assert.equal(nflEspnId({ events: [event] }, "WAS", "LA", "2026-11-12T18:00:00Z"), null);
});

// Node's test runner has no React server compiler; only neutralize the server-only marker.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { getLiveLines } = await import("../src/lib/live-lines.ts");
test("fetching caps parallelism at 12, deduplicates ids/cache hits, preserves observed time and refetches after TTL", async (t) => {
  let calls = 0, active = 0, peak = 0, clock = Date.parse(observedAt);
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return new Response(JSON.stringify(fixture), { status: 200 });
  });
  const ids = Array.from({ length: 26 }, (_, i) => String(900000000 + i));
  const first = await getLiveLines("nba", [...ids, ids[0]]);
  assert.equal(calls, 26); assert.equal(peak, 12);
  const again = await getLiveLines("nba", ids);
  assert.equal(calls, 26); assert.equal(again.get(ids[0])?.observedAt, first.get(ids[0])?.observedAt);
  clock += LIVE_LINE_TTL_MS + 1;
  await getLiveLines("nba", [ids[0]]);
  assert.equal(calls, 27);
});
test("network/HTTP/invalid JSON failures become null; invalid ids never fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return calls === 2 ? new Response("down", { status: 503 }) : new Response("not json");
  });
  const result = await getLiveLines("nfl", ["910000001", "910000002", "910000003", "../../bad"]);
  assert.equal(calls, 3);
  assert([...result.values()].every((v) => v === null));
});
test("a hung ESPN request is aborted within five seconds", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }));
  // Keep the test process alive: AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const start = performance.now();
    assert.equal((await getLiveLines("ncaab", ["920000001"])).get("920000001"), null);
    assert(performance.now() - start < 5500);
  } finally { clearInterval(keepAlive); }
});

test("expired or invalid quotes are never presented or logged as live", () => {
  const now = Date.parse(observedAt);
  assert(isFreshLiveLine(observedAt, now + LIVE_LINE_TTL_MS - 1));
  assert(!isFreshLiveLine(observedAt, now + LIVE_LINE_TTL_MS));
  assert(!isFreshLiveLine("invalid", now));
  assert(!isFreshLiveLine(null, now));
  assert(!isFreshLiveLine(observedAt, now - 1));
});

test("a moneyline is flagged for price, not for being the favorite", () => {
  // 70% favorite at -150 needs 60%: +16.7% expected value, flagged as a favorite.
  const fav = moneylineValue(game)!;
  assert.deepEqual([fav.team, fav.price, fav.underdog], ["BOS", -150, false]);
  // The same favorite at -260 needs 72%: no flag, and the 30% underdog at +210 is short too.
  assert.equal(moneylineValue({ ...game, marketHomeMl: -260, marketAwayMl: 210 }), null);
  // Model makes the +130 underdog 50%: flagged as an underdog.
  const dog = moneylineValue({ ...game, homeWinProb: .5 })!;
  assert.deepEqual([dog.team, dog.price, dog.underdog], ["NYK", 130, true]);
  // Long shots are never flagged, however large the model's number.
  assert.equal(moneylineValue({ ...game, homeWinProb: .6, marketHomeMl: -900, marketAwayMl: 600 }), null);
  // A fresh live pair replaces the saved prices.
  const live = consolidateLiveLines(fixture, observedAt)!;
  assert.equal(moneylineValue(game, live)?.price ?? null, moneylineValue({ ...game, marketHomeMl: live.homeMl, marketAwayMl: live.awayMl })?.price ?? null);
  // 92% on a +164 underdog is a rating error, not a bargain.
  assert.equal(moneylineValue({ ...game, homeWinProb: .08, marketHomeMl: -200, marketAwayMl: 164 }), null);
  assert.equal(moneylineValue({ ...game, homeWinProb: null }), null);
});
