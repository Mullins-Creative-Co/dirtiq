import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardBetInputs } from "../src/lib/my-bets/card.ts";
import type { DailyCard } from "../src/lib/model-reports.ts";

test("bulk logging uses locked terms and card stakes, including completed picks", () => {
  const card = JSON.parse(readFileSync(new URL("../public/data/cards/2026-11-12.json",import.meta.url),"utf8")) as DailyCard;
  const before=JSON.stringify(card);
  const names=JSON.parse(readFileSync(new URL("../public/data/team-names.json",import.meta.url),"utf8")).teams;
  const inputs=cardBetInputs(card,names,new Date("2026-11-15T22:00:00Z"));
  assert.equal(inputs.length,card.picks.length);
  for(let i=0;i<inputs.length;i++) {
    assert.equal(inputs[i].line,card.picks[i].line);
    assert.equal(inputs[i].price,card.picks[i].price);
    assert.equal(inputs[i].stake,card.picks[i].stakeUnits);
    assert.equal(inputs[i].selection,card.picks[i].pick);
    assert.equal(inputs[i].eventId,card.picks[i].id);
    assert.equal(inputs[i].placedAt,"2026-11-15T22:00:00.000Z");
  }
  assert.ok(inputs.some(input=>input.eventLabel.includes("High Point Panthers")));
  assert.equal(JSON.stringify(card),before);
});
