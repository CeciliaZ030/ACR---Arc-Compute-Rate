/* A poll interval must keep its identity across renders.
 *
 * SWR 2 lists `refreshInterval` in its polling effect's dependencies
 * (node_modules/swr/dist/index/index.mjs, the effect that owns `timer`). An
 * inline arrow is a new function every render, so every render clears the
 * pending timer and starts a fresh one. On a page that re-renders faster than
 * its interval, the poll never fires. Measured 2026-10-14: /curve re-renders
 * every second (its `useNow()` clock), and the 4 s desk poll fired ONCE in 40 s
 * of a live testnet press, so the "live" desk was the first read, frozen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { attackRunPollMs, buyerRunPollMs, futuresPollMs, hedgerPollMs } from "./useLive";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

test("no refreshInterval is an inline function", () => {
  const inline = /refreshInterval:\s*(\(|async\b|function\b|[A-Za-z_$][\w$]*\s*=>)/;
  const found = ["app", "components", "lib"]
    .flatMap((d) => sources(join(ROOT, d)))
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => (inline.test(line) ? `${f.slice(ROOT.length + 1)}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
  assert.deepEqual(found, []);
});

test("the desk polls fast on a live press, slower off it", () => {
  assert.equal(futuresPollMs({ live: true, data: { source: "press" } } as never), 4_000);
  assert.equal(futuresPollMs({ live: true, data: { source: "chain" } } as never), 30_000);
  assert.equal(futuresPollMs({ live: false, data: { source: "bundle" } } as never), 15_000);
  assert.equal(futuresPollMs(undefined), 15_000);
});

test("the hedger, buyer and attack runs keep their cadences", () => {
  assert.deepEqual([hedgerPollMs({ live: true } as never), hedgerPollMs(undefined)], [15_000, 60_000]);
  assert.deepEqual([buyerRunPollMs({ data: { state: "running" } } as never), buyerRunPollMs(undefined)], [700, 0]);
  assert.deepEqual([attackRunPollMs({ data: { state: "running" } } as never), attackRunPollMs(undefined)], [700, 20_000]);
});
