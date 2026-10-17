/* The Aomi drawer never shares a tab with an operator credential (lib/agentGuard.ts). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AGENT_EXCLUDED_PATHS, CREDENTIAL_KEYS, agentAllowed, excludedPath } from "./agentGuard";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("no drawer where credentials are collected or used", () => {
  for (const p of ["/ops", "/ops/", "/spend", "/spend?business=acr-fleet", "/developers", "/developers#mcp", "/ops/anything"]) {
    assert.equal(excludedPath(p), true, p);
    assert.equal(agentAllowed(p, []), "excluded", p);
  }
  for (const p of ["/", "/curve", "/check", "/tape", "/opsx", "/spender", "/developer"]) {
    assert.equal(excludedPath(p), false, p);
  }
});

test("a tab holding an operator key or a reader card never loads the widget", () => {
  assert.equal(agentAllowed("/", []), "ok");
  assert.equal(agentAllowed("/", ["acr-ops-key"]), "credential");
  assert.equal(agentAllowed("/curve", ["acr-reader-card"]), "credential");
  assert.equal(agentAllowed("/curve", ["acr-mcp-playground"]), "ok", "only credentials count");
});

test("the guarded keys are the ones the pages actually store", () => {
  // Read the source of truth rather than a second copy of the names.
  const ops = readFileSync(join(ROOT, "components/chain/OperatorConsole.tsx"), "utf8");
  const spend = readFileSync(join(ROOT, "components/spend/EscalationActions.tsx"), "utf8");
  const reader = readFileSync(join(ROOT, "lib/readerCard.ts"), "utf8");
  assert.match(ops, /KEY_STORE = "acr-ops-key"/);
  assert.match(spend, /KEY_STORE = "acr-ops-key"/);
  assert.match(reader, /"acr-reader-card"/);
  assert.deepEqual([...CREDENTIAL_KEYS].sort(), ["acr-ops-key", "acr-reader-card"]);
  assert.ok(AGENT_EXCLUDED_PATHS.includes("/ops") && AGENT_EXCLUDED_PATHS.includes("/spend"));
});

test("the drawer consults the guard and the chat marks itself loaded", () => {
  const drawer = readFileSync(join(ROOT, "components/AgentDrawer.tsx"), "utf8");
  const chat = readFileSync(join(ROOT, "components/AgentChat.tsx"), "utf8");
  assert.match(drawer, /agentAllowed\(/, "the drawer must ask the guard before mounting the widget");
  assert.match(drawer, /widgetWasLoaded\(\)/, "and reload when entering an excluded page after the widget loaded");
  assert.match(chat, /markWidgetLoaded\(\)/);
});
