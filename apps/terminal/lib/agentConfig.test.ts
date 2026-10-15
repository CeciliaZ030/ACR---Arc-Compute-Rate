import assert from "node:assert/strict";
import { test } from "node:test";
import { agentApplicationId } from "./agentConfig";

test("the author’s ACR app works without deployment configuration", () => {
  assert.equal(agentApplicationId(), 2938642);
  assert.equal(agentApplicationId(undefined), 2938642);
});

test("only a positive safe integer can override the hosted app", () => {
  assert.equal(agentApplicationId("2938642"), 2938642);
  for (const value of [
    "",
    "<APPLICATION_ID>",
    "0",
    "-1",
    "1.2",
    "1e3",
    " 123 ",
    "9007199254740992",
  ]) {
    assert.equal(agentApplicationId(value), null, String(value));
  }
});
