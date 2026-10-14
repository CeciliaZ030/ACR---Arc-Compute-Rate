/* The first render's chain is the request's, not the default (lib/useChain.ts).
 *
 * React renders `useSyncExternalStore`'s SERVER snapshot on the server and again
 * during hydration, so this is the value every chain-keyed SWR hook first keys
 * on. A constant default here sent a testnet page's first desk read to mainnet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ChainProvider, useChain } from "./useChain";
import { DEFAULT_CHAIN } from "./chainChoice";

function Probe() {
  return createElement("i", null, useChain());
}

test("a testnet request renders testnet on its first render", () => {
  const html = renderToString(createElement(ChainProvider, { chain: "testnet" }, createElement(Probe)));
  assert.equal(html, "<i>testnet</i>");
});

test("two requests on one module do not share a chain", () => {
  const a = renderToString(createElement(ChainProvider, { chain: "testnet" }, createElement(Probe)));
  const b = renderToString(createElement(ChainProvider, { chain: "mainnet" }, createElement(Probe)));
  assert.deepEqual([a, b], ["<i>testnet</i>", "<i>mainnet</i>"]);
});

test("outside the provider the default stands", () => {
  assert.equal(renderToString(createElement(Probe)), `<i>${DEFAULT_CHAIN}</i>`);
});
