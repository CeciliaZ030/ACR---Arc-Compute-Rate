import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_GOOD_MAX_AGE_MS,
  LastGood,
  PRESS_TIMEOUT_MS,
  SOLE_TIER_TIMEOUT_MS,
  pressIsSoleTier,
  pressTimeoutMs,
} from "./pressTier";

test("testnet's press is its only tier, so it gets the longer budget", () => {
  /* Measured 2026-10-14: the testnet press answered /futures in 2.5-26s, and
     the 12s budget turned half the reads into an empty venue. */
  assert.equal(pressIsSoleTier("testnet"), true);
  assert.equal(pressIsSoleTier("mainnet"), false, "mainnet has a direct read and a bundle behind it");
  assert.equal(pressTimeoutMs("testnet"), SOLE_TIER_TIMEOUT_MS);
  assert.equal(pressTimeoutMs("mainnet"), PRESS_TIMEOUT_MS);
  assert.ok(SOLE_TIER_TIMEOUT_MS < 30_000, "must fit inside the route's 30s maxDuration");
});

test("a remembered answer stands in for a bounded window, per chain", () => {
  const kept = new LastGood<{ desks: number }>();
  assert.equal(kept.recall("testnet", 0), null, "nothing remembered is nothing served");
  kept.remember("testnet", { desks: 3 }, 1_000);
  assert.deepEqual(kept.recall("testnet", 1_000 + 60_000)?.value, { desks: 3 });
  assert.equal(kept.recall("testnet", 1_000 + 60_000)?.at, 1_000, "stamped with when it was READ");
  assert.equal(kept.recall("testnet", 1_000 + LAST_GOOD_MAX_AGE_MS + 1), null, "too old to stand in");
  assert.equal(kept.recall("mainnet", 1_000), null, "never another chain's answer");
});
