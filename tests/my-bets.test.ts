import assert from "node:assert/strict";
import { test } from "node:test";

import { gradeGameBet, gradeRaceBet, impliedProbability, parsePrice, profit, summarize, type MyBet } from "../src/lib/my-bets/grade.ts";

const result = { eventId: "nba:1", home: "BOS", away: "NYK", homeScore: 110, awayScore: 104, startsAt: null };

function bet(over: Partial<MyBet>): MyBet {
  return {
    id: 1, sport: "nba", eventId: "nba:1", eventLabel: "NYK at BOS", eventStart: null, market: "moneyline", selection: "BOS",
    selectionLabel: "BOS ML", line: null, price: -150, stake: 100, book: null, note: null, modelProb: null, marketProb: null,
    placedAt: "2026-11-10T00:00:00Z", status: "open", resultValue: null, settledAt: null, manual: false, ...over,
  };
}

test("spread grading uses the selection's own line, with pushes", () => {
  assert.deepEqual(gradeGameBet({ market: "spread", selection: "BOS", line: -5.5 }, result), { status: "won", resultValue: 6 });
  assert.deepEqual(gradeGameBet({ market: "spread", selection: "BOS", line: -6 }, result), { status: "push", resultValue: 6 });
  assert.deepEqual(gradeGameBet({ market: "spread", selection: "NYK", line: 5.5 }, result), { status: "lost", resultValue: 6 });
  assert.deepEqual(gradeGameBet({ market: "spread", selection: "NYK", line: 6.5 }, result), { status: "won", resultValue: 6 });
  assert.equal(gradeGameBet({ market: "spread", selection: "BOS", line: null }, result), null);
});

test("moneyline and total grading", () => {
  assert.deepEqual(gradeGameBet({ market: "moneyline", selection: "nyk", line: null }, result), { status: "lost", resultValue: 6 });
  assert.deepEqual(gradeGameBet({ market: "total", selection: "over", line: 213.5 }, result), { status: "won", resultValue: 214 });
  assert.deepEqual(gradeGameBet({ market: "total", selection: "under", line: 214 }, result), { status: "push", resultValue: 214 });
  assert.equal(gradeGameBet({ market: "moneyline", selection: "LAL", line: null }, result), null);
});

test("race grading reads the settled ledger row for the same market and selection", () => {
  const rows = [{ market: "win", selection: "driver:1", outcome: "win" }, { market: "top3", selection: "driver:2", outcome: "loss" }, { market: "win", selection: "driver:3", outcome: null }];
  assert.deepEqual(gradeRaceBet({ market: "win", selection: "driver:1" }, rows), { status: "won" });
  assert.deepEqual(gradeRaceBet({ market: "top3", selection: "driver:2" }, rows), { status: "lost" });
  assert.equal(gradeRaceBet({ market: "win", selection: "driver:3" }, rows), null);
});

test("profit follows American prices and the summary adds up", () => {
  assert.equal(profit({ stake: 100, price: -150, status: "won" }), 66.67);
  assert.equal(profit({ stake: 50, price: 120, status: "won" }), 60);
  assert.equal(profit({ stake: 50, price: 120, status: "lost" }), -50);
  assert.equal(profit({ stake: 50, price: 120, status: "push" }), 0);
  const s = summarize([
    bet({ id: 1, status: "won", price: -110, stake: 110, settledAt: "2026-11-10T03:00:00Z", modelProb: 0.6, marketProb: 0.52 }),
    bet({ id: 2, status: "lost", price: -110, stake: 110, settledAt: "2026-11-11T03:00:00Z" }),
    bet({ id: 3, status: "open", stake: 25 }),
    bet({ id: 4, sport: "nhl", status: "push", stake: 40, settledAt: "2026-11-11T04:00:00Z" }),
  ]);
  assert.equal(s.bets, 4); assert.equal(s.open, 1); assert.equal(s.wins, 1); assert.equal(s.losses, 1); assert.equal(s.pushes, 1);
  assert.equal(s.staked, 220); assert.equal(s.openStake, 25); assert.equal(s.profit, -10); assert.equal(s.roi, -0.0455);
  assert.equal(s.winRate, 0.5); assert.equal(s.modelEdgeBets, 1); assert.equal(s.modelEdgeProfit, 100);
  assert.deepEqual(s.series.map((p) => p.cumulative), [100, -10, -10]);
  assert.equal(s.bySport[0].sport, "nba");
});

test("price parsing and implied probability", () => {
  assert.equal(parsePrice("+150"), 150); assert.equal(parsePrice("-110"), -110); assert.equal(parsePrice("EV"), 100);
  assert.equal(parsePrice("50"), null); assert.equal(parsePrice(""), null);
  assert.equal(Math.round((impliedProbability(-150) ?? 0) * 1000), 600);
  assert.equal(Math.round((impliedProbability(150) ?? 0) * 1000), 400);
});
