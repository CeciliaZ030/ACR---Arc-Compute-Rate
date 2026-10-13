/** An agent's spend, shown through the real MCP server — and checked while it is shown.
 *
 *   npm run demo
 *       Part 1: tokens the agent BOUGHT. Two inference bills priced against the
 *       open market, then the running total. Spends nothing, writes nothing that
 *       outlives the run.
 *
 *   ACR_DEMO_PAY=1 ACR_PAYER_PRIVATE_KEY=0x… npm run demo
 *       + Part 2: USDC the agent SPENT. One real metered query on Arc testnet
 *       ($0.0001 of test USDC from that key's Gateway balance), then the receipt
 *       and the wallet's history, read back through the same server.
 *
 * WHY THIS IS A TEST AND NOT A PRINTOUT. The first time this was run against the
 * published plugin (2026-10-13), the example `/developers` taught — "billed 0.47
 * USDC for 23k tokens by 0xefe0…" — came back "pay, unbenchmarked": the vendor
 * was ACR's own seller, which the press only ever prices against ACR's fleet, and
 * the fleet had no independent quote. The demo showed nothing, every probe said
 * "answered", and nothing was red. So every step here asserts the property that
 * makes it worth showing — priced against the MARKET, with cited quotes, a
 * running total that adds up — and any ✖ exits 1. A demo that quietly stops
 * demonstrating is the failure this file exists to catch.
 *
 * WHY IT SPAWNS THE SERVER instead of calling `callTool` like `smoke.ts` does:
 * this is the path a host takes — stdio JSON-RPC, `tools/list` deciding what is
 * offered, the env deciding which press answers — and the demo is only honest if
 * it travels the same road.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Part 2's press. Testnet on purpose: the money is test USDC. */
const PAY_API = (process.env.ACR_DEMO_PAY_API ?? "https://acr-api-1fto.onrender.com").replace(/\/$/, "");
const MAINNET_CHAIN_ID = 5042;
/** The ACR-operated seller `/developers` names in its seller_rating example. */
const ACR_SELLER = "0xefe0E4625AFf072c3FCff230b47f8150A17aDF19";

type Json = Record<string, any>;

// ───────────────────────────────────────────────────────────── a minimal MCP host

class Host {
  private child: ChildProcessWithoutNullStreams;
  private id = 0;
  private waiting = new Map<number, (m: Json) => void>();
  stderr = "";

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: MCP_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let m: Json;
      try {
        m = JSON.parse(line);
      } catch {
        return; // not a protocol line
      }
      const done = this.waiting.get(m.id);
      if (done) {
        this.waiting.delete(m.id);
        done(m);
      }
    });
    this.child.stderr.on("data", (d) => (this.stderr += String(d)));
  }

  request(method: string, params: Json, timeoutMs = 90_000): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.waiting.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async start(): Promise<{ name: string; version: string; tools: string[] }> {
    const init = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "acr-demo", version: "1" },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await this.request("tools/list", {});
    return {
      name: String(init.result?.serverInfo?.name ?? "?"),
      version: String(init.result?.serverInfo?.version ?? "?"),
      tools: ((list.result?.tools ?? []) as Json[]).map((t) => String(t.name)),
    };
  }

  /** One tool call, as a host makes it. The tool's JSON comes back parsed. */
  async tool(name: string, args: Json): Promise<Json> {
    const m = await this.request("tools/call", { name, arguments: args });
    const text = m.result?.content?.[0]?.text;
    if (typeof text !== "string") return { _protocol_error: m.error ?? m };
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

// ───────────────────────────────────────────────────────────── the transcript

let failures = 0;
/** Measured gaps that are real and are NOT this demo's to fix — printed, never counted as passes. */
const gaps: string[] = [];

function check(ok: boolean, label: string, why = ""): boolean {
  if (!ok) failures += 1;
  console.log(`         ${ok ? "✔" : "✖"} ${label}${ok || !why ? "" : ` — ${why}`}`);
  return ok;
}

function you(question: string, call: string): void {
  console.log(`\n  you  › ${question}`);
  console.log(`  tool › ${call}`);
}

function acr(line: string): void {
  console.log(`  acr  › ${line}`);
}

/** Rounded to the micro-USDC the way `spendLog.round6` does, so a bill's saving and the
 *  report's total print the same digits — `toFixed` rounds 0.4639625 DOWN (binary float)
 *  while the ledger rounds it up, and a reader would see a one-micro disagreement. */
const usdc = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 1e6) / 1e6} USDC` : "—";
const bp = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n)
    ? `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")} bp`
    : "—";

/** The quote's own label for a seller id, so a reader sees "GPT-4o mini", not a slug. */
function labelOf(par: Json, seller: unknown): string {
  const q = ((par?.quotes ?? []) as Json[]).find((x) => x.seller === seller);
  return q?.label ? `${q.label} (${String(seller)})` : String(seller || "—");
}

/** Say what a priced bill came to, in the terms an agent's operator would use. */
function narrateBill(bill: Json, out: Json): void {
  const perUnit = bill.billed_usdc / bill.quantity;
  const par = out.par ?? {};
  acr(`you paid ${perUnit.toPrecision(3)} USDC per 1k tokens; the going rate is ` +
      `${Number(par.par_usdc ?? NaN).toPrecision(3)} across ${par.sellers ?? "?"} published prices`);
  acr(`cheapest: ${labelOf(par, par.best_seller)} at ${Number(par.best_usdc ?? NaN).toPrecision(3)} per 1k`);
  acr(`verdict ${String(out.verdict?.verdict ?? "—")} (${bp(out.over_rate_bp)}) → the spend agent would ` +
      `${String(out.would?.intent ?? "—").toUpperCase()}`);
  if (typeof out.verdict?.saving_usdc === "number" && out.verdict.saving_usdc > 0) {
    acr(`${usdc(out.verdict.saving_usdc)} of this bill was avoidable at the cheapest published price`);
  }
}

/** The properties that make a priced bill worth showing. Shared by both bills. */
function assertMarketPriced(out: Json): void {
  check(out.benchmarked_against === "market", "priced against the open market, not ACR's fleet",
    `benchmarked_against=${JSON.stringify(out.benchmarked_against)}${out.hint ? ` · hint: ${out.hint}` : ""}`);
  check(out.verdict?.benchmarked === true, "an actual comparison was made",
    `verdict=${JSON.stringify(out.verdict?.verdict)} reason=${JSON.stringify(out.verdict?.reason)}`);
  const quotes = (out.par?.quotes ?? []) as Json[];
  const cited = quotes.filter((q) => q.url && q.cite);
  check(cited.length >= 2, `${cited.length} published prices, each with a source and a citation`,
    "fewer than two cited quotes is not a market");
  check(out.reference?.stale !== true, `the market basket is current (${String(out.reference?.age ?? "?")})`,
    `reference=${JSON.stringify(out.reference)}`);
}

// ───────────────────────────────────────────────────────────── Part 1

async function partOne(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "acr-demo-"));
  const log = join(dir, "spend.jsonl");
  const env: NodeJS.ProcessEnv = { ...process.env, ACR_SPEND_LOG: log };
  delete env.ACR_PAYER_PRIVATE_KEY; // Part 1 can spend nothing, by construction
  const host = new Host(env);
  try {
    const info = await host.start();
    console.log(`\nPART 1 · tokens the agent bought · ${process.env.ACR_API ?? "the default press"}`);
    console.log(`         ${info.name} ${info.version} over stdio · ${info.tools.length} tools · spend log ${log}`);
    check(info.tools.includes("check_spend") && info.tools.includes("spend_report"),
      "the host is offered check_spend and spend_report");
    check(!info.tools.includes("pay_and_read"), "and is NOT offered pay_and_read, because no payer key is set");

    // Q1 — a fair bill.
    const fair = { billed_usdc: 0.2, quantity: 1000, unit: "$/1k tokens" };
    you('"My agent was billed 0.20 USDC for 1M tokens of inference. Should it pay?"',
      `check_spend ${JSON.stringify(fair)}`);
    const a = await host.tool("check_spend", fair);
    narrateBill(fair, a);
    assertMarketPriced(a);
    check(typeof a.over_rate_bp === "number" && a.over_rate_bp <= 0 && a.would?.intent === "pay",
      "a bill at or under the going rate is paid",
      `over_rate_bp=${a.over_rate_bp} intent=${a.would?.intent} — if the market moved, pick a new fair bill`);
    check(a.recorded_to === log, "recorded to this run's own spend log, and says so",
      `recorded_to=${JSON.stringify(a.recorded_to)}`);

    // Q2 — an overpriced bill.
    const pricey = { billed_usdc: 0.47, quantity: 23, unit: "$/1k tokens" };
    you('"Then it was billed 0.47 USDC for 23k tokens by its inference provider. Should it pay that?"',
      `check_spend ${JSON.stringify(pricey)}`);
    const b = await host.tool("check_spend", pricey);
    narrateBill(pricey, b);
    assertMarketPriced(b);
    check(b.verdict?.verdict === "over_par" && b.would?.intent !== "pay",
      "a bill far over the going rate is NOT waved through",
      `verdict=${b.verdict?.verdict} intent=${b.would?.intent}`);
    check(typeof b.verdict?.saving_usdc === "number" && b.verdict.saving_usdc > 0,
      "and it says how much was avoidable", `saving_usdc=${b.verdict?.saving_usdc}`);

    // Q3 — the running total.
    you('"Has my agent been overpaying for tokens?"', 'spend_report {"days":1}');
    const r = await host.tool("spend_report", { days: 1 });
    acr(`${r.bills_checked} bills checked · ${r.over_rate?.n} over the going rate · worst ${bp(r.over_rate?.worst_bp)}`);
    acr(`${usdc(r.actionable?.could_have_paid_usdc)} could have been paid instead (${r.actionable?.basis ?? ""})`);
    acr(`“${String(r.note ?? "")}”`);
    check(r.bills_checked === 2 && r.priced === 2, "both bills are in the total, and both were priced",
      `bills_checked=${r.bills_checked} priced=${r.priced}`);
    check(r.over_rate?.n === 1, "exactly one of them was over the rate", `over_rate.n=${r.over_rate?.n}`);
    check(Math.abs(Number(r.actionable?.could_have_paid_usdc) - Number(b.verdict?.saving_usdc)) < 1e-6,
      "the avoidable total is the second bill's saving, to the micro-USDC",
      `${r.actionable?.could_have_paid_usdc} vs ${b.verdict?.saving_usdc}`);

    // Epilogue — the trap the old example walked into, now explained to the agent.
    const own = { ...pricey, vendor: ACR_SELLER };
    you('"And if that bill had come from ACR\'s own seller?"', `check_spend ${JSON.stringify(own)}`);
    const c = await host.tool("check_spend", own);
    acr(`judged against ${String(c.benchmarked_against)} → ${String(c.verdict?.verdict ?? "—")}, ` +
        `${String(c.would?.intent ?? "—")}`);
    if (c.hint) acr(`hint: ${c.hint}`);
    check(c.benchmarked_against !== "fleet" || typeof c.hint === "string",
      "a fleet-judged answer tells the agent why, and how to get the market answer",
      "a fleet basis arrived with no hint — the agent cannot know a market answer exists");
  } catch (err) {
    check(false, "Part 1 completed", String(err));
    if (host.stderr) console.log(host.stderr.trim().split("\n").slice(-5).map((l) => `         ${l}`).join("\n"));
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────── Part 2

async function partTwo(): Promise<string> {
  const key = process.env.ACR_PAYER_PRIVATE_KEY ?? "";
  if (process.env.ACR_DEMO_PAY !== "1") {
    return "SKIPPED — set ACR_DEMO_PAY=1 and ACR_PAYER_PRIVATE_KEY to spend $0.0001 of testnet USDC";
  }
  if (!key) return "SKIPPED — ACR_DEMO_PAY=1 but ACR_PAYER_PRIVATE_KEY is not set";

  const host = new Host({
    ...process.env,
    ACR_API: PAY_API,
    ACR_PAYER_PRIVATE_KEY: key,
    ACR_MAX_SPEND_USDC: "0.001", // a hard ceiling far below anything a loop could matter at
    ACR_SPEND_LOG: "off",
  });
  try {
    const info = await host.start();
    console.log(`\nPART 2 · USDC the agent spent · ${PAY_API}`);
    check(info.tools.includes("pay_and_read"), "with a payer key, the host is offered pay_and_read");

    you('"Can you pay for a metered ACR query right now?"', "can_i_pay {}");
    const pre = await host.tool("can_i_pay", {});
    for (const r of (pre.rungs ?? []) as Json[]) {
      acr(`${r.ok ? "✓" : "✗"} ${String(r.rung).padEnd(9)} ${String(r.detail ?? "").slice(0, 92)}`);
    }
    if (pre.chain_id === MAINNET_CHAIN_ID && process.env.ACR_DEMO_PAY_MAINNET !== "1") {
      check(false, "Part 2 stays off mainnet", "this press is chain 5042; set ACR_DEMO_PAY_MAINNET=1 to spend real USDC");
      return "STOPPED — refused to spend real USDC";
    }
    if (!check(pre.can_pay === true, `every rung is green (payer ${String(pre.payer).slice(0, 10)}…)`,
      `blocked at ${pre.blocked_at}: ${pre.summary}`)) return "STOPPED at can_i_pay";

    you('"Buy one query of the latest prints."', 'pay_and_read {"endpoint":"/prints"}');
    const paid = await host.tool("pay_and_read", { endpoint: "/prints" });
    if (paid.paid) {
      acr(`paid ${usdc(paid.paid_usdc)} on ${String(paid.network)} → HTTP ${paid.status}`);
      acr(`settlement ${String(paid.settlement)} · session total ${usdc(paid.session_spend?.usdc)} of a ${usdc(paid.session_spend?.cap_usdc)} cap`);
    } else {
      acr(`did not pay: ${String(paid.reason ?? "no reason")}`);
    }
    if (!check(paid.paid === true && paid.status === 200, "a real settlement, and the data it bought",
      String(paid.reason ?? `status ${paid.status}`))) return "STOPPED at pay_and_read";
    check(typeof paid.settlement === "string" && paid.settlement.length > 0, "with a settlement reference");

    you('"Did that payment land?"', `payment_receipts {"payer":"${String(paid.payer)}","limit":500}`);
    let found = false;
    let rec: Json = {};
    for (let attempt = 0; attempt < 4 && !found; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 3000));
      // limit 500: the tool pages at 20, and a page size printed as a count is a wrong number.
      rec = await host.tool("payment_receipts", { payer: paid.payer, limit: 500 });
      const hay = JSON.stringify([rec.receipts ?? [], rec.revenue_counter?.mine_recent ?? []]).toLowerCase();
      found = hay.includes(String(paid.settlement).toLowerCase());
    }
    acr(`${(rec.receipts ?? []).length} receipt(s) on this press for the payer · counter: ` +
        `${rec.revenue_counter?.paid_queries ?? "?"} paid queries`);
    check(found, "the settlement just made is on the press's receipt tape",
      "not found after 4 reads — the press may have restarted, which loses in-memory receipts");

    you('"What has this wallet spent with ACR overall?"', `wallet_tca {"target":"${String(paid.payer)}"}`);
    const tca = await host.tool("wallet_tca", { target: paid.payer });
    if (tca.available === false) {
      acr(`the tape did not answer: ${String(tca.reason ?? "")}`);
    } else {
      acr(`seen=${String(tca.seen)} · ${String(tca.purchases ?? "?")} purchases · ` +
          `${usdc(tca.spent_usdc ?? tca.spent)} on the indexed tape`);
      /* TWO VIEWS OF ONE WALLET, AND THEY MUST BE COMPARED, NOT JUST PRINTED.
         The first version of this line said the newest purchase "may not be in
         this count yet", which implies minutes of lag. Measured on testnet
         2026-10-13 it was 20+ receipts against 1 indexed purchase, and the
         press's own keeper said why: the receipt mirror had FAILED with 77
         receipts past its window. That is an operator item (the poster key is
         not in the mirror's signer set), so it is reported as a gap with the
         press's own words — not hidden as lag, and not failed as if this demo
         could fix it. */
      const held = (rec.receipts ?? []).length;
      const indexed = Number(tca.purchases ?? 0);
      if (held > indexed + 1) {
        /* The keeper states a mirror verdict only on a run that FAILS and is
           null between runs — measured: "FAILED 1 · 77 past the mirror window —
           operator late-path needed" at one read, null on three reads a minute
           later. So a null verdict is reported as silence with its timestamp,
           never as "fine": the gap above is the evidence either way. */
        let why = "the press's keeper could not be read";
        try {
          const m = ((await (await fetch(`${PAY_API}/health`)).json()) as Json).keeper?.mirror ?? {};
          why = m.verdict
            ? String(m.verdict)
            : `its keeper reports no mirror verdict right now (last ran ${Math.round(Number(m.last_fire_age_s ?? NaN))}s ago); ` +
              "it states one only on a run that fails";
        } catch {
          /* a diagnostic read; its absence changes nothing above */
        }
        acr(`◌ the press holds ${held} receipts for this wallet but the chain shows ${indexed}: ` +
            "receipts are not reaching the on-chain mirror");
        acr(`  press keeper says: ${why}`);
        gaps.push(`testnet receipt mirror: ${held} receipts held, ${indexed} indexed — ${why}`);
      }
    }
    check(tca.available !== false, "the wallet's on-chain spend is readable",
      String(tca.reason ?? ""));
    return "ran";
  } catch (err) {
    check(false, "Part 2 completed", String(err));
    return "FAILED";
  } finally {
    host.close();
  }
}

// ───────────────────────────────────────────────────────────── run

console.log("acr-mcp demo · an agent's spend, through the real MCP server");
await partOne();
const two = await partTwo();
if (two !== "ran") console.log(`\nPART 2 · USDC the agent spent · ${two}`);
console.log(`\n${"─".repeat(72)}`);
console.log(failures === 0
  ? `  every check held${two === "ran" ? "" : " (Part 2 did not run — see above; that is not a pass for it)"}`
  : `  ${failures} check(s) failed — the demo is not demonstrating what it claims`);
for (const g of gaps) console.log(`  ◌ measured, not this demo's to fix: ${g}`);
process.exit(failures === 0 ? 0 : 1);
