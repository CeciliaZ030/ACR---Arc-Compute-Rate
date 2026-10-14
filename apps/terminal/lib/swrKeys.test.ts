/* Revalidation must name the key the hooks actually use.
 *
 * Every chain-scoped hook keys SWR on `apiKey(path, chain)`, which appends
 * `?chain=`. A `mutate("/api/...")` with a bare path names a key nothing reads,
 * so it revalidates nothing and raises no error: the shop floor's eight calls
 * after a sale did exactly that, and a fresh receipt waited for the next poll.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { apiKey } from "./chainChoice";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

test("no mutate names a bare /api path", () => {
  const bare = /mutate\(\s*["'`]\/api\//;
  const found = ["app", "components", "lib"]
    .flatMap((d) => sources(join(ROOT, d)))
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => (bare.test(line) ? `${f.slice(ROOT.length + 1)}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
  assert.deepEqual(found, []);
});

test("a bare path is not the key a hook reads", () => {
  assert.notEqual(apiKey("/api/revenue", "mainnet"), "/api/revenue");
});
