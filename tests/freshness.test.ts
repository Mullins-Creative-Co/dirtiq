import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactAge } from "../src/lib/freshness-core.ts";
const now = Date.parse("2026-11-12T15:00:00Z");
test("missing, invalid and future timestamps cannot report fresh", () => {
  for (const timestamp of [null, "invalid", "2026-11-12T16:00:00Z"]) {
    assert.deepEqual(artifactAge(timestamp, now), { timestamp, ageMinutes: null, stale: true, overdue: true });
  }
});
test("75-minute missed update and three-hour warning thresholds", () => {
  assert.equal(artifactAge("2026-11-12T14:00:00Z", now).overdue, false);
  assert.equal(artifactAge("2026-11-12T13:44:00Z", now).overdue, true);
  assert.equal(artifactAge("2026-11-12T11:59:00Z", now).stale, true);
});
