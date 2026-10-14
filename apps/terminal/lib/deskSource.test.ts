import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAYER_WINDOW_DAYS, desksFor } from "./deskSource";
import type { FuturesDeskRow, FuturesRoster } from "./types";

const desk = (index_id: string) => ({ index_id }) as unknown as FuturesDeskRow;
const feed = { "ACR-INF": desk("ACR-INF"), "ACR-GPU": desk("ACR-GPU"), "ACR-DATA": desk("ACR-DATA") };
const roster = (desks: Record<string, FuturesDeskRow>): FuturesRoster => ({ venue: "0x1", desks, trades: [] });

test("an unread, empty roster defers to the feed's desks", () => {
  /* Measured 2026-10-14: the first testnet desk reply after a deploy was 0
     desks (a cold instance, press timed out) while the feed held 3, and `??`
     kept the empty object because `{}` is not nullish. */
  assert.equal(desksFor(roster({}), false, feed), feed);
  assert.equal(desksFor(null, false, feed), feed);
});

test("a live roster is the truth, even when it is empty", () => {
  const live = roster({});
  assert.equal(desksFor(live, true, feed), live.desks, "a venue that really has no desks says so");
  const one = roster({ "ACR-INF": desk("ACR-INF") });
  assert.equal(desksFor(one, true, feed), one.desks);
});

test("a remembered (non-live) roster that has desks is shown, not replaced", () => {
  const kept = roster({ "ACR-INF": desk("ACR-INF") });
  assert.equal(desksFor(kept, false, feed), kept.desks);
});

test("a wallet lookup reads the MCP plugin's own window", () => {
  /* The developers page hands out a wallet with 3 purchases inside 30 days;
     /tape read 7 days and called it unseen while the MCP answered it. */
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "mcp", "src", "tools.ts"), "utf8");
  const mcp = Number(/export const DEFAULT_DAYS = (\d+);/.exec(src)?.[1]);
  assert.equal(PAYER_WINDOW_DAYS, mcp);
});
