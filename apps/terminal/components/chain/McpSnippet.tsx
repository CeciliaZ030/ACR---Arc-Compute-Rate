"use client";

import { useState } from "react";

import { Ed } from "@/components/Ed";

/* Ask the Tape from an MCP host — the config a developer pastes, and what to say.
 *
 * Sibling of AgentCardSnippet. That one writes the code an agent needs to present
 * a card; this one writes the config a Claude (or any MCP host) needs to call the
 * tape as eleven tools, and five questions worth asking it.
 *
 * WHAT CHANGED, AND WHY IT MATTERS HERE. The first version of this section said
 * "nothing spends", which was true and was also the problem: a developer who came
 * to find out whether their agent could pay for a metered query could not learn it
 * from any tool. `can_i_pay` answers that, and still spends nothing — it asks the
 * paywall for a price and declines to answer it. `pay_and_read` does spend, and is
 * not registered at all unless the host sets a payer key, which is why the paying
 * config is a separate tab rather than a line in the default one.
 *
 * The two example addresses have rows on the host this page names, at the
 * plugin's default 30-day window — measured, not assumed. Both reported ZERO at
 * the old 7-day default, so the page shipped a demo that demonstrated nothing.
 * `mcp/scripts/smoke.ts` probes the same two addresses, so a press that stops
 * answering for them fails there rather than quietly here.
 */

type Tab = "config" | "pay" | "ask";

export const TOOLS = [
  "check_spend",
  "spend_report",
  "can_i_pay",
  "pay_and_read",
  "payment_receipts",
  "wallet_tca",
  "reroute_suggestion",
  "seller_rating",
  "benchmark_price",
  "get_rate",
  "query_tape",
] as const;

/** The three snippets, built from the API this page is looking at. Pure, so a test can pin them.
 *
 *  `api` IS NULLABLE, AND THAT IS THE POINT. This pinned `ACR_API` to whatever
 *  host the page was looking at, and `baseState().active` is whichever host
 *  last answered — `/terminal/data`, usually, which `acr-api-mainnet` serves
 *  perfectly well while answering 404 for `/par` and all five `/operator/*`.
 *  So the paste-ready config OVERRODE the npm package's own correct default
 *  (`acr-probe-free`) with the one host where five of eleven tools cannot
 *  work. A config that pins the wrong host is worse than one that pins none.
 *
 *  Pass null and the `ACR_API` line is omitted, which is not a degradation:
 *  `acr-mcp` defaults to a mainnet press that serves every tool, so the
 *  package is right about this and the page was wrong. The caller decides by
 *  asking the host itself — `servesPath(served, "/par")` — rather than from a
 *  list of hostnames here that would go stale the moment an image is rebuilt.
 */
export function snippets(api: string | null): Record<Tab, string> {
  /* One line, or none. Kept as a string rather than a ternary inside the
     template so the trailing comma stays correct in both shapes — a config
     block a developer pastes has to be valid JSON, and "nearly valid" is a
     support question. */
  const apiLine = api ? `        "ACR_API": "${api}",\n` : "";
  return {
    config: `{
  "mcpServers": {
    "acr-tca": {
      "command": "npx",
      "args": ["-y", "acr-mcp"],
      "env": {
${apiLine}        "ACR_AGENT_PRIVATE_KEY": "0x<any 32-byte key: the card, not a wallet>",
        "ACR_HUMAN_AGENT_KEY": "0x<optional: a wallet in AgentBook, for wallet_tca(\\"me\\")>"
      }
    }
  }
}`,
    pay: `# Add these two and pay_and_read appears. Without them it is not registered at all.
# A metered query is $0.0001, so the cap is what stops a loop, not your attention.

{
  "mcpServers": {
    "acr-tca": {
      "command": "npx",
      "args": ["-y", "acr-mcp"],
      "env": {
${apiLine}        "ACR_PAYER_PRIVATE_KEY": "0x<a wallet YOU control, deposited into Circle Gateway>",
        "ACR_MAX_SPEND_USDC": "0.01"
      }
    }
  }
}

# A settlement spends the GATEWAY balance, not the wallet's USDC. can_i_pay says
# "deposit" rather than "ready" when the wallet is funded and the Gateway is not.`,
    ask: `# Five things to ask, once the server is in your host's config:

"I was billed 0.47 USDC for 23 thousand tokens by 0xefe0E4625AFf072c3FCff230b47f8150A17aDF19. Should I pay it?"
#   -> check_spend: the spend agent\u2019s own ten-rung ladder over YOUR invoice, with the published
#      prices it was judged against. No account, no key, no history with ACR needed.

"Can you pay for a metered ACR query right now? If not, what is in the way?"
#   -> can_i_pay: seven rungs — host, chain, card, paywall, challenge, payer key, Gateway funds.
#      Needs no key, and spends nothing: it asks for the 402 and does not answer it.

"Has my agent been overpaying its vendors this month?"
#   -> spend_report: every bill check_spend has priced on this machine, totalled. Over the going
#      rate in bp, and what was actually recoverable in USDC. Reads a local file; uploads nothing.

"What did 0xc2903b52a3ad365fd237b78389a2fde99e886999 overpay last month, and where should it buy instead?"
#   -> wallet_tca + reroute_suggestion: slippage vs the benchmark, the seller to leave, the saving
#      in bp. Only for a wallet that bought from ACR: one it has never seen answers seen:false

"Rate seller 0xefe0E4625AFf072c3FCff230b47f8150A17aDF19, and tell me how much of that grade is actually measured."
#   -> seller_rating: it answers Unrated on a thin tape and says so, rather than scoring the
#      missing components zero — which is the part worth seeing

"How many settlements landed on the tape in the last hour, and how many were human-backed?"
#   -> query_tape("settlements"): the subgraph's own rows, benchmarked in the mapping`,
  };
}

export function McpSnippet({ api }: { api: string | null }) {
  const [tab, setTab] = useState<Tab>("config");
  const [copied, setCopied] = useState(false);
  const code = snippets(api)[tab];

  async function copy() {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  }

  return (
    <section>
      <div className="block-head">
        <Ed x="Ask the Tape" p="Ask the receipts" className="label" />
      </div>
      <Ed
        as="p"
        className="muted"
        style={{ fontSize: "var(--t-4)", maxWidth: "var(--measure)", marginTop: 0 }}
        x="Eleven tools any MCP host can call. Ten are reads: check_spend runs the spend agent\u2019s own ladder over any vendor\u2019s invoice, and spend_report totals every bill it has priced. One spends, and only when you set a payer key."
        p="Eleven questions an AI assistant can ask, including whether a bill is fair and whether your agent has been overpaying."
      />
      {api === null ? (
        /* OUTSIDE THE CODE BLOCK, because the config tab is pasted into a JSON
           file and JSON has no comments: a `#` note prepended to it would make
           the one snippet that must parse, not parse. */
        <Ed
          as="p"
          className="muted"
          style={{ fontSize: "var(--t-4)", maxWidth: "var(--measure)", marginTop: 0 }}
          x="No ACR_API line below, on purpose. The press this page is reading does not carry /par, and the package already defaults to one where every tool answers."
          p="The config has no address in it on purpose. The tool already knows where to look."
        />
      ) : null}
      <div className="register-row" style={{ fontSize: "var(--t-4)" }}>
        <span className="muted" style={{ minWidth: 132 }}>
          <Ed x="tools" p="questions" />
        </span>
        <span className="mono">{TOOLS.join(" · ")}</span>
      </div>
      <div className="register-row" style={{ fontSize: "var(--t-4)" }}>
        <span className="muted" style={{ minWidth: 132 }}>
          <Ed x="install" p="install" />
        </span>
        <span className="mono">npx -y acr-mcp</span>
        {/* THIS ROW CARRIED A CLAUSE FOR ONE DAY, and the clause is gone because
            the thing it explained is fixed. On 2026-10-10 `npm view acr-mcp`
            was a 404 — the package had never been published — while this row,
            both configs above and two READMEs all told a reader to run it. So
            the clause said "Not on npm yet, so a 404 here is expected" and
            pointed at the clone route.
            `acr-mcp@0.3.0` published that evening and `npx -y acr-mcp` now
            answers `tools/list` from a clean cache, so the sentence became
            false and came out the same hour. Recorded here rather than silently
            deleted, because the mistake worth not repeating is the FORM: I
            wrote the README's version as a conditional ("if that 404s…") which
            survives publishing untouched, and this one as a flat assertion,
            which publishing made wrong. `mcpsnippet.test.ts` now holds the
            inverse — that this page does not claim the package is unpublished.
            The clone route is still documented in mcp/README.md, for pinning a
            fork. */}
      </div>

      <div style={{ marginTop: "var(--s-4)", display: "flex", gap: "var(--s-2)", alignItems: "center", flexWrap: "wrap" }}>
        <Ed x="Paste, then ask" p="Set it up, then ask" className="label" />
        {(["config", "pay", "ask"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`mini-btn${tab === t ? " green" : ""}`}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
          >
            {t === "config" ? (
              <Ed x="host config" p="setup" />
            ) : t === "pay" ? (
              <Ed x="let it pay" p="let it pay" />
            ) : (
              <Ed x="what to ask" p="questions" />
            )}
          </button>
        ))}
      </div>
      <div className="specimen" style={{ marginTop: "var(--s-3)" }}>
        <button type="button" className="copy-btn" onClick={copy}>
          {copied ? <Ed x="copied" p="copied" /> : <Ed x="copy" p="copy" />}
        </button>
        <pre style={{ maxHeight: 360, overflow: "auto", paddingRight: "var(--s-8)" }}>{code}</pre>
      </div>
      <Ed
        as="p"
        className="muted"
        style={{ fontSize: "var(--t-3)", marginTop: "var(--s-3)" }}
        x="The same answers the buyer agent acts on and this page renders, handed to a model as tools. The repo's mcp/README.md is the long form."
        p="The same answers the buying robot uses, given to an AI assistant as tools it can call."
      />
    </section>
  );
}
