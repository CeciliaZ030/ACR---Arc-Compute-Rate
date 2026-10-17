import assert from "node:assert/strict";
import test from "node:test";
import { CardShelf } from "./cardShelf";

test("a card minted for one chain is never handed to the other", () => {
  /* Measured 2026-10-14: the testnet /loop screen answered 401 while testnet's
     Model Armor worked, because the instance's one cached card was mainnet's. */
  const shelf = new CardShelf();
  shelf.put("mainnet", { header: "card-for-5042", expiresAt: 1_000 });
  assert.equal(shelf.fresh("testnet", 100, 60), null, "testnet must mint its own");
  assert.equal(shelf.fresh("mainnet", 100, 60), "card-for-5042");
  shelf.put("testnet", { header: "card-for-5042002", expiresAt: 1_000 });
  assert.equal(shelf.fresh("testnet", 100, 60), "card-for-5042002");
  assert.equal(shelf.fresh("mainnet", 100, 60), "card-for-5042", "and mainnet keeps its own");
});

test("a card near its expiry is re-minted, not reused", () => {
  const shelf = new CardShelf();
  shelf.put("testnet", { header: "c", expiresAt: 1_000 });
  assert.equal(shelf.fresh("testnet", 1_000 - 61, 60), "c");
  assert.equal(shelf.fresh("testnet", 1_000 - 59, 60), null);
});
