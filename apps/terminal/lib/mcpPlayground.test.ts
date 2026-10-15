/* The /developers playground's pure half (lib/mcpPlayground.ts): the URL it
 * hands out, what it does with what a visitor types, and the browser-side MCP
 * calls, run here against the real handler in-process. */
import assert from "node:assert/strict";
import test from "node:test";

import { requestChain } from "./envelope";
import { handleMcp } from "./mcpHosted";
import {
  DEFAULT_INPUTS,
  EXAMPLES,
  EXAMPLE_BILL,
  HOSTED_TOOLS,
  liveSubjects,
  mcpUrl,
  originFrom,
  parseSaved,
  readInputs,
  readingOf,
  remoteSetup,
  runTool,
  testConnection,
  toolArgs,
} from "./mcpPlayground";
import type { MarketReceipt } from "./types";

const WALLET = "0xc2903b52a3ad365fd237b78389a2fde99e886999";
const VENDOR = "0xefe0E4625AFf072c3FCff230b47f8150A17aDF19";

test("the URL carries its chain, and the URL beats a cookie", () => {
  const url = mcpUrl("https://acr.test/", "testnet");
  assert.equal(url, "https://acr.test/api/mcp?chain=testnet");
  const withCookie = new Request(url, { headers: { cookie: "acr-chain=mainnet" } });
  assert.equal(requestChain(withCookie), "testnet", "a remote client's URL must decide the chain");
  assert.equal(requestChain(new Request(mcpUrl("https://acr.test", "mainnet"))), "mainnet");
});

test("the origin comes from the request, and junk is refused", () => {
  assert.equal(originFrom("https", "arc-compute-rate.vercel.app"), "https://arc-compute-rate.vercel.app");
  assert.equal(originFrom(null, "localhost:3100"), "http://localhost:3100");
  assert.equal(originFrom("https,http", "a.test, b.test"), "https://a.test");
  assert.equal(originFrom("https", "evil.test/path"), null);
  assert.equal(originFrom("https", null), null);
});

test("each remote client gets a setup it can parse, with the URL quoted where a shell reads it", () => {
  const url = mcpUrl("https://acr.test", "testnet");
  const code = remoteSetup("claude-code", url, "testnet");
  assert.match(code, /^claude mcp add --transport http acr-tca-testnet "https:\/\/acr\.test\/api\/mcp\?chain=testnet"$/);
  const cursor = JSON.parse(remoteSetup("cursor", url, "testnet")) as { mcpServers: Record<string, { url: string }> };
  assert.equal(cursor.mcpServers["acr-tca-testnet"].url, url);
  const vscode = JSON.parse(remoteSetup("vscode", url, "testnet")) as { servers: Record<string, { type: string; url: string }> };
  assert.deepEqual(vscode.servers["acr-tca-testnet"], { type: "http", url });
  assert.match(remoteSetup("claude-ai", url, "testnet"), /Add custom connector[\s\S]*chain=testnet/);
  for (const c of ["claude-ai", "claude-code", "cursor", "vscode"] as const) {
    assert.ok(!/PRIVATE_KEY/.test(remoteSetup(c, url, "mainnet")), `${c} setup must carry no key`);
    assert.ok(!remoteSetup(c, mcpUrl("https://acr.test", "mainnet"), "mainnet").includes("chain=testnet"));
  }
});

test("saved inputs never throw, whatever is in storage", () => {
  assert.deepEqual(parseSaved(null), DEFAULT_INPUTS);
  assert.deepEqual(parseSaved("{nope"), DEFAULT_INPUTS);
  assert.deepEqual(parseSaved([1, 2]), DEFAULT_INPUTS);
  const back = parseSaved(JSON.stringify({ wallet: WALLET, unit: "$/MB", client: "cursor", billed: 5, extra: "x" }));
  assert.equal(back.wallet, WALLET);
  assert.equal(back.unit, "$/MB");
  assert.equal(back.client, "cursor");
  assert.equal(back.billed, "", "a non-string field is dropped, not coerced");
  assert.equal(parseSaved({ unit: "$/lb", client: "telnet" }).unit, DEFAULT_INPUTS.unit);
});

test("what a visitor types is used when valid, flagged when not, and never sent malformed", () => {
  assert.deepEqual(readInputs(DEFAULT_INPUTS), { wallet: null, bill: null, walletError: null, billError: null });
  const bad = readInputs({ ...DEFAULT_INPUTS, wallet: "0x12", billed: "-1", quantity: "3" });
  assert.equal(bad.wallet, null);
  assert.match(bad.walletError ?? "", /40 hex/);
  assert.equal(bad.bill, null);
  assert.match(bad.billError ?? "", /greater than zero/);
  const good = readInputs({ ...DEFAULT_INPUTS, wallet: WALLET, billed: "2", quantity: "100", unit: "$/GPU-sec", vendor: VENDOR });
  assert.equal(good.wallet, WALLET);
  assert.deepEqual(good.bill, { unit: "$/GPU-sec", billed: 2, quantity: 100, vendor: VENDOR });
});

test("the examples come from live receipts first, the measured pair only as a fallback", () => {
  const rows: MarketReceipt[] = [
    { seq: 1, payer: "0x1111111111111111111111111111111111111111", amount_usdc: 0.0001, tx_ref: "a", network: "n", scheme: "exact", settled_at: 100 },
    { seq: 2, payer: "0x2222222222222222222222222222222222222222", amount_usdc: 0.0001, tx_ref: "b", network: "n", scheme: "exact", settled_at: 200, seller: VENDOR },
    { seq: 3, payer: "not-an-address", amount_usdc: 0.0001, tx_ref: "c", network: "n", scheme: "exact", settled_at: 300 },
  ];
  const live = liveSubjects("testnet", rows);
  assert.deepEqual(live, { payer: "0x2222222222222222222222222222222222222222", seller: VENDOR, window: "last month", days: 30, source: "receipts" });
  const fallback = liveSubjects("testnet", []);
  assert.equal(fallback.payer, EXAMPLES.testnet.payer);
  assert.equal(fallback.days, 90, "the testnet example's activity is older than 30 days");
  assert.equal(liveSubjects("mainnet", null).days, 30);
});

test("every tool runs with the visitor's values when they gave them, the example otherwise", () => {
  const s = liveSubjects("mainnet", null);
  const none = readInputs(DEFAULT_INPUTS);
  const mine = readInputs({ ...DEFAULT_INPUTS, wallet: WALLET, billed: "1", quantity: "10", vendor: VENDOR });
  for (const tool of HOSTED_TOOLS) assert.ok(toolArgs(tool, none, s).args, `${tool} has arguments`);

  assert.deepEqual(toolArgs("wallet_tca", mine, s), { args: { target: WALLET, days: 30 }, yours: true });
  assert.deepEqual(toolArgs("wallet_tca", none, s), { args: { target: s.payer, days: 30 }, yours: false });
  assert.deepEqual(toolArgs("seller_rating", mine, s).args, { seller: VENDOR, days: 30 });
  assert.deepEqual(toolArgs("check_spend", mine, s).args, { billed_usdc: 1, quantity: 10, unit: "$/1k tokens", vendor: VENDOR });
  assert.deepEqual(toolArgs("check_spend", none, s), {
    args: { billed_usdc: EXAMPLE_BILL.billed, quantity: EXAMPLE_BILL.quantity, unit: EXAMPLE_BILL.unit },
    yours: false,
  });
  assert.equal(toolArgs("benchmark_price", mine, s).args.price, 0.1);
  assert.equal(toolArgs("get_rate", none, s, "$/MB").args.index_id, "ACR-DATA");
  assert.equal(toolArgs("payment_receipts", mine, s).args.payer, WALLET);
});

test("a reading names what a person needs from each answer", () => {
  assert.match(readingOf("get_rate", { value: 0.49773, age: "23 min ago" }) ?? "", /0\.49773 · posted 23 min ago/);
  assert.match(
    readingOf("check_spend", { over_rate_bp: 500869.6, verdict: { benchmarked: true, best_seller: "openai/gpt-4o-mini" }, would: { intent: "escalate" } }) ?? "",
    /^escalate · 500,870 bp vs the going rate, cheapest openai\/gpt-4o-mini$/,
  );
  assert.match(readingOf("wallet_tca", { seen: false, window_days: 30 }) ?? "", /never seen/);
  assert.match(readingOf("can_i_pay", { can_pay: false, blocked_at: "payer", next_step: "x" }) ?? "", /stops at payer/);
  assert.match(readingOf("get_rate", { error: "HTTP 404" }) ?? "", /error: HTTP 404/);
});

/** The page's fetch, routed into the real handler with a stub press. */
function inProcess(): typeof fetch {
  const now = Math.floor(Date.now() / 1000);
  const press = (async (input: string | URL | Request) => {
    const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
    if (path === "/onchain/ACR-INF") {
      return new Response(JSON.stringify({ index_id: "ACR-INF", value: 0.4977, posted_at: now - 60 }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
  }) as typeof fetch;
  return ((input: string | URL | Request, init?: RequestInit) =>
    handleMcp(input instanceof Request ? input : new Request(String(input), init), {
      chain: "testnet",
      press: async () => "https://press.test",
      fetchImpl: press as never,
      retryDelayMs: 0,
    })) as typeof fetch;
}

test("the connection test walks what a client does and reports each step", async () => {
  const r = await testConnection("https://acr.test/api/mcp?chain=testnet", inProcess());
  assert.equal(r.ok, true, r.error ?? "");
  assert.deepEqual(r.server, { name: "acr-tca", version: "0.3.3" });
  assert.equal(r.tools.length, HOSTED_TOOLS.length);
  assert.equal(r.chain, "testnet");
  assert.equal(r.press, "press.test");
  assert.match(r.rate ?? "", /^0\.4977/);
});

test("the connection test names the step that failed", async () => {
  const down = (async () => new Response("Bad Gateway", { status: 502 })) as typeof fetch;
  const r = await testConnection("https://acr.test/api/mcp?chain=testnet", down);
  assert.equal(r.ok, false);
  assert.equal(r.stoppedAt, "initialize");
  const refused = await runTool("https://acr.test/api/mcp?chain=testnet", "pay_and_read", { endpoint: "/prints" }, inProcess());
  assert.equal(refused.isError, true);
  assert.match(String(refused.payload), /local package/);
});
