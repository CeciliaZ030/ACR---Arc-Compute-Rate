import type { Metadata } from "next";
import { headers } from "next/headers";
import { baseState, loadTerminal } from "@/lib/api";
import { hostedTools } from "@/lib/mcpHosted";
import { originFrom } from "@/lib/mcpPlayground";
import { serverChain } from "@/lib/serverChain";
import { DevelopersView } from "./view";

export const metadata: Metadata = {
  title: "Developers · ACR",
  description: "Machines pay a sub-cent nanopayment per query for the rate, over x402 on Arc.",
};

export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const chain = await serverChain();
  const initial = await loadTerminal(chain);
  /* The host the page is ACTUALLY reading from, which is not always the one
     NEXT_PUBLIC_ACR_API names: `lib/api.ts` refuses a seller whose chain is not
     the build's, even when that seller is perfectly healthy, and climbs to the
     published host instead (`chainMismatch` in lib/apiBase.ts records why).

     Measured on the live deployment 2026-10-08: `/api/health` reported the
     configured seller REFUSED on chain identity and a different host active —
     while the copy-paste config two sections down was still handing visitors the
     refused one. A snippet naming a host the page itself will not call is worse
     than no snippet, because it looks checked.

     So the snippets name this, not `sellerBase()`. Server-only on purpose:
     `baseState()` reaches the 133 KB fallback bundle, which must never be pulled
     into the browser. (No literals here — lib/mainnetOnly.test.ts gates the
     shipping UI on exactly that, and it is right to.) */
  const activeApi = baseState(chain).active;
  /* The MCP section hands out THIS deployment's URL, derived from the request
     rather than written down: a preview deploy then offers its own endpoint,
     and no host is hardcoded again (tests/test_canonical_host.py counts them). */
  const h = await headers();
  const mcpOrigin = originFrom(h.get("x-forwarded-proto"), h.get("x-forwarded-host") ?? h.get("host"));
  /* Names and descriptions only: the same list the hosted server answers
     tools/list with, so the buttons cannot offer a tool it would refuse. */
  const tools = hostedTools().map(({ name, description }) => ({ name, description }));
  return (
    <DevelopersView initial={initial} activeApi={activeApi} chainKey={chain} mcpOrigin={mcpOrigin} hostedTools={tools} />
  );
}
