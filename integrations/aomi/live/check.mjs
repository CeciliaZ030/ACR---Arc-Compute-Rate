// The live witness for ACR on Aomi: ask the production agent, pinned to this
// App, the two questions the README transcript shows, and fail unless ACR's
// tools actually ran and their numbers equal the press's in the same minute.
//
// Why it exists: every unit test in ../src runs on recorded responses, and a
// green suite said nothing about the four ways this App was in fact unreachable
// on Aomi (wrong default branch, a lockfile the platform could not find, a CLI
// deploy that skipped activation, chat Auto-routing past the App). Only a turn
// through Aomi's own runtime can refuse. The MCP plugin's `npm run smoke` is
// the same idea for the other channel.
//
// Manual on purpose (`make aomi-live`), not a cron: a guest session can stick
// at `session_busy`, and a flaky red schedule is exactly how a real alarm went
// unread for three days.

import { Aomi } from "@aomi-labs/client";

const APP_ID = Number(process.env.AOMI_APP_ID ?? 2938642);
const CHAT = process.env.AOMI_CHAT_URL ?? "https://chat.aomi.dev";
const PRESS = (process.env.ACR_API ?? "https://acr-probe-free.onrender.com").replace(/\/$/, "");
const TURN_TIMEOUT_MS = 150_000;

const aomi = new Aomi({ baseUrl: CHAT });
let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function press(path) {
  const r = await fetch(`${PRESS}${path}`, { headers: { "user-agent": "acr-aomi-live" } });
  if (!r.ok) throw new Error(`${PRESS}${path} answered ${r.status}`);
  return r.json();
}

/** One Direct-mode turn. Returns {tools: Map(name -> parsed result), reply}. */
async function ask(question) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const run = aomi.agent.run(question, { target: { mode: "direct", applicationId: APP_ID } });
      const result = await Promise.race([
        run,
        new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 150 s")), TURN_TIMEOUT_MS)),
      ]);
      const tools = new Map();
      let reply = "";
      for (const m of result?.messages ?? []) {
        if (Array.isArray(m.tool_result) && m.tool_result.length === 2) {
          try { tools.set(m.tool_result[0], JSON.parse(m.tool_result[1])); } catch { tools.set(m.tool_result[0], null); }
        }
        if (m.sender !== "user" && m.content) reply = String(m.content);
      }
      return { tools, reply };
    } catch (e) {
      // A guest session that is still finishing a previous turn answers 409.
      if (e?.code === "session_busy" && attempt === 1) {
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }
      throw new Error(`${e?.code ?? e?.name ?? "error"} (HTTP ${e?.status ?? "?"}): ${e?.message ?? e}`);
    }
  }
  throw new Error("session stayed busy");
}

const close = (a, b, tol) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

console.log(`ACR on Aomi · application ${APP_ID} via ${CHAT}, checked against ${PRESS}`);

// 1. The bill. acr_check_bill must run and agree with /par.
console.log("\nbill: 0.47 USDC for 23,000 tokens");
try {
  const { tools, reply } = await ask("My agent was billed 0.47 USDC for 23,000 tokens of inference. Should it pay?");
  const bill = tools.get("acr_check_bill");
  if (!bill) fail(`acr_check_bill did not run (tools: ${[...tools.keys()].join(", ") || "none"})`);
  else {
    ok("acr_check_bill ran inside Aomi");
    const par = await press("/par?billed_usdc=0.47&quantity=23&unit=%24%2F1k%20tokens");
    close(bill.over_going_rate_bp, par.over_rate_bp, 1)
      ? ok(`bp over the going rate: ${Math.round(bill.over_going_rate_bp)} = press`)
      : fail(`bp over: tool ${bill.over_going_rate_bp} vs press ${par.over_rate_bp}`);
    close(bill.cheapest?.price_usdc_per_unit, par.par?.best_usdc, 1e-9)
      ? ok(`cheapest: ${bill.cheapest.label} at ${bill.cheapest.price_usdc_per_unit} = press`)
      : fail(`cheapest: tool ${JSON.stringify(bill.cheapest)} vs press ${par.par?.best_seller}@${par.par?.best_usdc}`);
  }
  reply.trim() ? ok(`agent replied: ${reply.replace(/\s+/g, " ").slice(0, 110)}…`) : fail("agent gave no reply text");
} catch (e) { fail(`the turn failed: ${e.message}`); }

// 2. The index. acr_rate must run, agree with /onchain, and carry its scale.
console.log("\nindex: ACR-INF");
try {
  const { tools, reply } = await ask("Where is the ACR inference index, and is it fresh?");
  const rate = tools.get("acr_rate");
  if (!rate) fail(`acr_rate did not run (tools: ${[...tools.keys()].join(", ") || "none"})`);
  else {
    ok("acr_rate ran inside Aomi");
    const live = await press("/onchain/ACR-INF");
    if (live.posted_at > rate.posted_at) ok("a newer print landed between the turn and the check; value comparison skipped");
    else close(rate.value, live.value, 1e-12)
      ? ok(`value ${rate.value.toFixed(5)} = press, posted ${(rate.age_s / 60).toFixed(0)} min before the turn`)
      : fail(`value: tool ${rate.value} vs press ${live.value}`);
    String(rate.scale ?? "").includes("not a market price")
      ? ok("the answer carries its scale: not a market price")
      : fail("acr_rate lost its 'not a market price' scale");
  }
  reply.trim() ? ok(`agent replied: ${reply.replace(/\s+/g, " ").slice(0, 110)}…`) : fail("agent gave no reply text");
} catch (e) { fail(`the turn failed: ${e.message}`); }

console.log(failures ? `\nACR on Aomi: ${failures} check(s) FAILED` : "\nACR on Aomi: live, and it agrees with the press");
process.exit(failures ? 1 : 0);
