/* The /developers MCP playground: everything the browser needs to point a
 * visitor's OWN values at the hosted ACR MCP endpoint (app/api/mcp/route.ts),
 * and the setup text for the client they actually use.
 *
 * WHY. The section was copy-paste: one stdio config, two example wallets, a
 * fixed bill, a typed-in tool list. A team testing their agent could read it
 * but not use it. Now the same section takes their wallet and their bill, runs
 * every tool live against the URL they are about to paste, and writes the setup
 * for their client with their values in it.
 *
 * PURE AND CLIENT-SAFE. It never imports `acr-mcp` or the MCP SDK (both pull in
 * Node-only code); lib/mcpHosted.test.ts fails if it starts to. The browser
 * talks MCP to the hosted endpoint with plain JSON-RPC over `fetch`, which is
 * exactly what a remote MCP client sends, so every click on the page is an
 * end-to-end test of the URL.
 */

import { apiKey, type ChainKey } from "./chainChoice";
import { INDEX_FOR_UNIT, UNITS, isUnit, type Unit } from "./indices";
import { ADDRESS, parseParQuery, type ParQuery } from "./parQuery";
import type { MarketReceipt } from "./types";

/** The published package the hosted server runs. Pinned to package.json, to
 *  node_modules and to mcp/package.json by lib/mcpHosted.test.ts. */
export const ACR_MCP_VERSION = "0.3.3";

export const MCP_PATH = "/api/mcp";

/** What the hosted server lists, in the order the page offers them. */
export const HOSTED_TOOLS = [
  "check_spend",
  "wallet_tca",
  "reroute_suggestion",
  "payment_receipts",
  "seller_rating",
  "benchmark_price",
  "get_rate",
  "query_tape",
  "can_i_pay",
] as const;
export type HostedTool = (typeof HOSTED_TOOLS)[number];

/** The two tools a hosted server cannot honestly offer, and why. */
export const LOCAL_ONLY = {
  spend_report: "reads the spend ledger on the machine that ran check_spend",
  pay_and_read: "pays with a wallet key, which belongs on your machine, not ours",
} as const;

/** The MCP protocol revision the page speaks (SDK 1.30's latest). */
export const MCP_PROTOCOL = "2025-06-18";

/** The worked examples' subjects, per chain, each MEASURED on that chain's press.
 *
 *  Fallbacks now, not the page's content: `liveSubjects` takes the most recent
 *  payer and seller off the live receipts first. Testnet's pair: 0x784e… bought
 *  144 times and 0x8366… is the seller it paid (measured 2026-10-14, 90-day
 *  window); that activity is older than the plugin's 30-day default, so the
 *  testnet example names its window rather than inheriting one that would show
 *  nothing. */
export const EXAMPLES: Record<ChainKey, { payer: string; seller: string; window: string }> = {
  mainnet: {
    payer: "0xc2903b52a3ad365fd237b78389a2fde99e886999",
    seller: "0xefe0E4625AFf072c3FCff230b47f8150A17aDF19",
    window: "last month",
  },
  testnet: {
    payer: "0x784e6D2d4870174aD1aEa3d7446F2377D0c6A05d",
    seller: "0x8366968f84a343CF70941EBe858428643d825cb0",
    window: "in the last 90 days",
  },
};

/** The bill the page prices when the visitor has not typed one: 0.47 USDC for
 *  23 thousand tokens, the worked example the Aomi App and `npm run demo` ask. */
export const EXAMPLE_BILL: ParQuery = { unit: "$/1k tokens", billed: 0.47, quantity: 23, vendor: "" };

// ---------------------------------------------------------------------------
// URLs and setup text
// ---------------------------------------------------------------------------

/** The hosted endpoint for a chain. Always carries `?chain=`: a remote client
 *  sends no cookie, so the URL is the only place the chain can live. */
export function mcpUrl(origin: string, chain: ChainKey): string {
  return `${origin.replace(/\/+$/, "")}${apiKey(MCP_PATH, chain)}`;
}

/** The public origin of the request that rendered the page, or null.
 *  Derived per request rather than written down, so a preview deploy hands out
 *  its own URL and no host is hardcoded a fifth time. */
export function originFrom(proto: string | null, host: string | null): string | null {
  const h = (host ?? "").split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  const p = (proto ?? "").split(",")[0].trim().toLowerCase();
  const scheme = p === "http" || p === "https" ? p : h.startsWith("localhost") || h.startsWith("127.") ? "http" : "https";
  return `${scheme}://${h}`;
}

/** One server entry per chain, so a client can hold both at once. */
export function serverKey(chain: ChainKey): string {
  return chain === "mainnet" ? "acr-tca" : "acr-tca-testnet";
}

export const CLIENTS = ["claude-ai", "claude-code", "cursor", "vscode", "npx", "aomi"] as const;
export type McpClient = (typeof CLIENTS)[number];
export type RemoteClient = "claude-ai" | "claude-code" | "cursor" | "vscode";

export const CLIENT_LABEL: Record<McpClient, string> = {
  "claude-ai": "Claude.ai",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  npx: "local package",
  aomi: "Aomi",
};

export function isRemoteClient(c: McpClient): c is RemoteClient {
  return c === "claude-ai" || c === "claude-code" || c === "cursor" || c === "vscode";
}

/** What to paste, for a client that adds an MCP server by URL. */
export function remoteSetup(client: RemoteClient, url: string, chain: ChainKey): string {
  const key = serverKey(chain);
  switch (client) {
    case "claude-code":
      // Quoted: an unquoted `?` is a glob in zsh and the command fails.
      return `claude mcp add --transport http ${key} "${url}"`;
    case "cursor":
      return JSON.stringify({ mcpServers: { [key]: { url } } }, null, 2);
    case "vscode":
      return JSON.stringify({ servers: { [key]: { type: "http", url } } }, null, 2);
    case "claude-ai":
      return [
        "Settings → Connectors → Add custom connector",
        `Name: ${key}`,
        `URL:  ${url}`,
      ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// The visitor's inputs
// ---------------------------------------------------------------------------

export interface PlaygroundInputs {
  wallet: string;
  billed: string;
  quantity: string;
  unit: Unit;
  vendor: string;
  client: McpClient;
}

export const PLAYGROUND_KEY = "acr-mcp-playground";

export const DEFAULT_INPUTS: PlaygroundInputs = {
  wallet: "",
  billed: "",
  quantity: "",
  unit: "$/1k tokens",
  vendor: "",
  client: "claude-code",
};

/** Saved inputs, or the defaults. Never throws: localStorage is the reader's,
 *  and anything can be in it. */
export function parseSaved(raw: unknown): PlaygroundInputs {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_INPUTS };
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_INPUTS };
  const o = v as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).slice(0, max) : "");
  const unit = str("unit", 20);
  const client = str("client", 20);
  return {
    wallet: str("wallet", 42),
    billed: str("billed", 24),
    quantity: str("quantity", 24),
    vendor: str("vendor", 42),
    unit: isUnit(unit) ? unit : DEFAULT_INPUTS.unit,
    client: (CLIENTS as readonly string[]).includes(client) ? (client as McpClient) : DEFAULT_INPUTS.client,
  };
}

export interface ReadInputs {
  /** The visitor's wallet when it is a valid address, else null. */
  wallet: string | null;
  /** The visitor's bill when every field parses, else null. */
  bill: ParQuery | null;
  walletError: string | null;
  billError: string | null;
}

/** What the page can use of what the visitor typed. An empty field is not an
 *  error, it is "use the example"; a malformed one is an error and is never
 *  sent. */
export function readInputs(i: PlaygroundInputs): ReadInputs {
  const w = i.wallet.trim();
  const walletError = w && !ADDRESS.test(w) ? "a wallet is 0x and 40 hex characters" : null;
  const anyBill = i.billed.trim() !== "" || i.quantity.trim() !== "" || i.vendor.trim() !== "";
  let bill: ParQuery | null = null;
  let billError: string | null = null;
  if (anyBill) {
    const r = parseParQuery((k) =>
      k === "unit" ? i.unit : k === "billed_usdc" ? i.billed : k === "quantity" ? i.quantity : k === "vendor" ? i.vendor : null,
    );
    if (r.ok) bill = r.q;
    else billError = r.error;
  }
  return { wallet: w && !walletError ? w : null, bill, walletError, billError };
}

// ---------------------------------------------------------------------------
// Example subjects: live first
// ---------------------------------------------------------------------------

export interface Subjects {
  payer: string;
  seller: string;
  window: string;
  days: number;
  source: "receipts" | "example";
}

/** Who to ask about when the visitor has not said: the newest real payer and
 *  seller on this chain's receipts, else the measured examples. A recent
 *  receipt is inside the plugin's 30-day window by construction. */
export function liveSubjects(chain: ChainKey, receipts?: MarketReceipt[] | null): Subjects {
  const ex = EXAMPLES[chain];
  const rows = [...(receipts ?? [])]
    .filter((r) => typeof r?.payer === "string" && ADDRESS.test(r.payer))
    .sort((a, b) => (b.settled_at ?? b.seq ?? 0) - (a.settled_at ?? a.seq ?? 0));
  const top = rows[0];
  if (top) {
    const seller = rows.find((r) => typeof r.seller === "string" && ADDRESS.test(r.seller))?.seller;
    return { payer: top.payer, seller: seller ?? ex.seller, window: "last month", days: 30, source: "receipts" };
  }
  return { ...ex, days: chain === "testnet" ? 90 : 30, source: "example" };
}

/** The arguments a tool is run with: the visitor's values where they gave
 *  them, the live example otherwise. `yours` says which, on the button. */
export function toolArgs(
  tool: HostedTool,
  r: ReadInputs,
  s: Subjects,
  unit: Unit = "$/1k tokens",
): { args: Record<string, unknown>; yours: boolean } {
  const bill = r.bill ?? EXAMPLE_BILL;
  switch (tool) {
    case "wallet_tca":
    case "reroute_suggestion":
      return r.wallet ? { args: { target: r.wallet, days: 30 }, yours: true } : { args: { target: s.payer, days: s.days }, yours: false };
    case "payment_receipts":
      return { args: { payer: r.wallet ?? s.payer, limit: 5 }, yours: Boolean(r.wallet) };
    case "seller_rating": {
      const mine = r.bill?.vendor;
      return mine ? { args: { seller: mine, days: 30 }, yours: true } : { args: { seller: s.seller, days: s.days }, yours: false };
    }
    case "check_spend":
      return {
        args: {
          billed_usdc: bill.billed,
          quantity: bill.quantity,
          unit: bill.unit,
          ...(r.bill?.vendor ? { vendor: r.bill.vendor } : {}),
        },
        yours: Boolean(r.bill),
      };
    case "benchmark_price":
      return { args: { price: bill.billed / bill.quantity, unit: bill.unit, quantity: bill.quantity }, yours: Boolean(r.bill) };
    case "get_rate":
      return { args: { index_id: INDEX_FOR_UNIT[r.bill?.unit ?? unit] }, yours: Boolean(r.bill) };
    case "query_tape":
      return { args: { operation: "settlements", variables: { first: 3 } }, yours: false };
    case "can_i_pay":
      return { args: {}, yours: false };
  }
}

// ---------------------------------------------------------------------------
// Talking MCP from the browser
// ---------------------------------------------------------------------------

export interface RpcResult {
  ok: boolean;
  status: number;
  ms: number;
  /** The JSON-RPC message, or null when the body was not JSON. */
  body: unknown;
  chain: string | null;
  press: string | null;
  error: string | null;
}

let rpcSeq = 0;

/** One JSON-RPC message to the hosted endpoint, exactly as a remote client
 *  sends it. A notification (no `id`) answers 202 with no body. */
export async function rpc(
  url: string,
  msg: { method: string; params?: unknown; notification?: boolean },
  f: typeof fetch = fetch,
): Promise<RpcResult> {
  const t0 = Date.now();
  const payload = msg.notification
    ? { jsonrpc: "2.0", method: msg.method, ...(msg.params ? { params: msg.params } : {}) }
    : { jsonrpc: "2.0", id: ++rpcSeq, method: msg.method, ...(msg.params ? { params: msg.params } : {}) };
  try {
    const res = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const rpcError = (body as { error?: { message?: string } } | null)?.error?.message ?? null;
    return {
      ok: res.ok && !rpcError,
      status: res.status,
      ms: Date.now() - t0,
      body,
      chain: res.headers.get("x-acr-chain"),
      press: res.headers.get("x-acr-press"),
      error: rpcError ?? (res.ok ? null : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: null, chain: null, press: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ToolRun {
  tool: string;
  ok: boolean;
  isError: boolean;
  status: number;
  ms: number;
  /** The tool's own answer (parsed from the text content), or the raw text. */
  payload: unknown;
  chain: string | null;
  press: string | null;
  error: string | null;
}

/** Call one tool on the hosted endpoint and unwrap its answer. */
export async function runTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<ToolRun> {
  const r = await rpc(url, { method: "tools/call", params: { name, arguments: args } }, f);
  const result = (r.body as { result?: { content?: { type?: string; text?: string }[]; isError?: boolean } } | null)?.result;
  const text = result?.content?.find((c) => c.type === "text")?.text ?? null;
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  const isError = Boolean(result?.isError);
  return {
    tool: name,
    ok: r.ok && Boolean(result) && !isError,
    isError,
    status: r.status,
    ms: r.ms,
    payload,
    chain: r.chain,
    press: r.press,
    error: r.error ?? (isError && typeof payload === "string" ? payload : null),
  };
}

export interface ConnectionReport {
  ok: boolean;
  /** The first step that failed, or null. */
  stoppedAt: "initialize" | "tools/list" | "get_rate" | null;
  error: string | null;
  server: { name: string; version: string } | null;
  tools: string[];
  rate: string | null;
  ms: number;
  chain: string | null;
  press: string | null;
}

/** What a remote client does on first contact, in order: initialize, say
 *  initialized, list tools, then one real call. Stops at the first failure and
 *  names it, so "it does not work" becomes "it stops at tools/list". */
export async function testConnection(url: string, f: typeof fetch = fetch): Promise<ConnectionReport> {
  const t0 = Date.now();
  const fail = (stoppedAt: ConnectionReport["stoppedAt"], error: string | null, partial: Partial<ConnectionReport> = {}): ConnectionReport => ({
    ok: false,
    stoppedAt,
    error,
    server: null,
    tools: [],
    rate: null,
    ms: Date.now() - t0,
    chain: null,
    press: null,
    ...partial,
  });

  const init = await rpc(
    url,
    {
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "acr-developers-page", version: ACR_MCP_VERSION } },
    },
    f,
  );
  const info = (init.body as { result?: { serverInfo?: { name?: string; version?: string } } } | null)?.result?.serverInfo;
  if (!init.ok || !info?.name) return fail("initialize", init.error ?? "no serverInfo in the answer");
  const server = { name: String(info.name), version: String(info.version ?? "") };
  await rpc(url, { method: "notifications/initialized", notification: true }, f);

  const list = await rpc(url, { method: "tools/list" }, f);
  const tools = ((list.body as { result?: { tools?: { name?: string }[] } } | null)?.result?.tools ?? [])
    .map((t) => String(t?.name ?? ""))
    .filter(Boolean);
  if (!list.ok || tools.length === 0) return fail("tools/list", list.error ?? "no tools listed", { server, chain: init.chain, press: init.press });

  const rate = await runTool(url, "get_rate", { index_id: "ACR-INF" }, f);
  if (!rate.ok) return fail("get_rate", rate.error ?? "get_rate did not answer", { server, tools, chain: rate.chain ?? init.chain, press: rate.press ?? init.press });

  return {
    ok: true,
    stoppedAt: null,
    error: null,
    server,
    tools,
    rate: readingOf("get_rate", rate.payload),
    ms: Date.now() - t0,
    chain: rate.chain ?? init.chain,
    press: rate.press ?? init.press,
  };
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number, d = 0) => Number(v.toFixed(d)).toLocaleString("en-US");

/** One line a person can read off a tool's answer, or null to show only JSON. */
export function readingOf(tool: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return typeof payload === "string" ? payload.slice(0, 160) : null;
  const o = payload as Record<string, unknown>;
  if (typeof o.error === "string") return `error: ${o.error}`;
  if (o.available === false) return `not available: ${String(o.reason ?? o.unrated_reason ?? "the press did not say why")}`;
  switch (tool) {
    case "get_rate": {
      const v = n(o.value);
      return v === null ? null : `${v.toPrecision(5)} · posted ${String(o.age ?? "…")}${o.stale ? " · stale" : ""}`;
    }
    case "check_spend":
    case "benchmark_price": {
      const v = (o.verdict ?? {}) as Record<string, unknown>;
      const would = (o.would ?? {}) as Record<string, unknown>;
      if (v.benchmarked === false) return `not benchmarked: ${String(v.reason || "no published price for this unit")}`;
      const bp = n(o.over_rate_bp);
      const best = typeof v.best_seller === "string" ? `, cheapest ${v.best_seller}` : "";
      const head = typeof would.intent === "string" ? `${would.intent}` : String(v.verdict ?? "priced");
      return `${head}${bp === null ? "" : ` · ${round(bp)} bp vs the going rate`}${best}`;
    }
    case "wallet_tca":
      return o.seen === false
        ? `never seen on this tape in ${String(o.window_days ?? "…")} days`
        : `${String(o.purchases ?? "…")} purchase(s) in ${String(o.window_days ?? "…")} days · ${String(o.spent_usdc ?? "…")} USDC`;
    case "reroute_suggestion":
      return o.reroute ? `reroute: ${JSON.stringify(o.reroute).slice(0, 120)}` : String(o.reason ?? "no reroute");
    case "seller_rating":
      return `grade ${String(o.grade ?? "…")} · ${String(o.n ?? 0)} rated fill(s)${o.unrated_reason ? ` · ${String(o.unrated_reason)}` : ""}`;
    case "payment_receipts": {
      const rows = Array.isArray(o.receipts) ? o.receipts.length : 0;
      const total = n((o.revenue_counter as Record<string, unknown> | undefined)?.paid_queries);
      return `${rows} receipt(s)${total === null ? "" : ` · ${total} paid queries on this press`}`;
    }
    case "query_tape": {
      const d = o.data as Record<string, unknown> | undefined;
      const first = d && Object.values(d).find(Array.isArray);
      return `${String(o.operation ?? "query")} · ${Array.isArray(first) ? first.length : 0} row(s)`;
    }
    case "can_i_pay":
      return o.can_pay ? "can pay" : `stops at ${String(o.blocked_at ?? "…")} · ${String(o.next_step ?? "").slice(0, 120)}`;
    default:
      return null;
  }
}

export { UNITS };
