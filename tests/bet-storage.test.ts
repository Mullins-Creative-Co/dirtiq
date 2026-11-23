import assert from "node:assert/strict";
import test from "node:test";
import { betStorageError } from "../src/lib/my-bets/storage.ts";

test("hosted saves reject ephemeral fallback while persistent and local saves remain available", () => {
  assert.match(betStorageError(true, false)!, /cannot be saved/);
  assert.match(betStorageError(true, false)!, /dirtiq-9h.vercel.app/);
  assert.equal(betStorageError(true, true), null);
  assert.equal(betStorageError(false, false), null);
  assert.equal(betStorageError(false, true), null);
});
