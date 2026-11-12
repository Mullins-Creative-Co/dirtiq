import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "./worker.mjs";
test("dispatches both fixed workflows on main without forcing paid snapshots", async () => {
  const calls = [];
  await dispatch({ GITHUB_DISPATCH_TOKEN: "test-only" }, async (url, options) => {
    calls.push({ url, options });
    return { status: 204 };
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /sports-refresh.yml\/dispatches$/);
  assert.match(calls[1].url, /world100-refresh.yml\/dispatches$/);
  for (const { options } of calls) assert.deepEqual(JSON.parse(options.body), { ref: "main" });
});
test("attempts the other workflow and reports rejected dispatches", async () => {
  let calls = 0;
  await assert.rejects(dispatch({ GITHUB_DISPATCH_TOKEN: "test-only" }, async () => ({ status: ++calls === 1 ? 403 : 204 })), /HTTP 403/);
  assert.equal(calls, 2);
});
test("missing secret does not make requests", async () => {
  await assert.rejects(dispatch({}, () => assert.fail("unexpected request")), /Missing/);
});
