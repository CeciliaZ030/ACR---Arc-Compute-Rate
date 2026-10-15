import assert from "node:assert/strict";
import { test } from "node:test";
import { agentApplicationId } from "./agentConfig";

test("only an explicit positive safe integer can select a hosted app", () => {
  assert.equal(agentApplicationId("2938642"), 2938642);
  for (const value of [
    undefined,
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
