import { NextResponse } from "next/server";
import { bundleSection, fetchLiveMeta } from "@/lib/api";
import { envelopeHeaders, requestChain } from "@/lib/envelope";
import { LastGood, SOLE_TIER_TIMEOUT_MS, pressIsSoleTier } from "@/lib/pressTier";
import type { Envelope, HedgerState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Room for the sole-tier press budget (lib/pressTier.ts) on testnet. */
export const maxDuration = 30;

/* The last standing each chain's press answered, on this instance. */
const lastGood = new LastGood<HedgerState>();

/* The autonomous hedger's standing — mandate, position, fills, spend.

   Two tiers, not three. The press derives this from the chain and the
   settlement ledger together, and there is no direct-viem tier because the
   spend half lives in the ledger rather than on-chain: a chain-only read would
   show the agent's trades while silently reporting its payments as zero, which
   is precisely the "absent looks like empty" failure this codebase keeps
   meeting. Better to fall straight to the archived snapshot, which is honestly
   labelled stale, than to serve a half-true live-looking answer. */
export async function GET(req: Request) {
  const chain = requestChain(req);
  /* 8s where an archive stands behind the press; longer where nothing does
     (testnet), because there a timeout fell to `configured: false` and the
     panel said the hedger did not exist — absent read as empty. */
  const budget = pressIsSoleTier(chain) ? SOLE_TIER_TIMEOUT_MS : 8_000;
  const { data, upstream } = await fetchLiveMeta<HedgerState>(chain, "/hedger", budget);
  if (data) {
    lastGood.remember(chain, data);
    const env: Envelope<HedgerState> = {
      live: true,
      data,
      fetchedAt: Date.now(), chain,
      upstream,
    };
    return NextResponse.json(env, {
      headers: envelopeHeaders("public, s-maxage=5, stale-while-revalidate=20", chain, env),
    });
  }

  /* The press's last answer, read minutes ago, before the archive or the
     "not configured" placeholder. `live: false` keeps it no-store and honest. */
  const kept = lastGood.recall(chain);
  if (kept) {
    const env: Envelope<HedgerState> = { live: false, data: kept.value, fetchedAt: kept.at, chain, upstream };
    return NextResponse.json(env, {
      headers: envelopeHeaders("public, s-maxage=30, stale-while-revalidate=120", chain, env),
    });
  }

  const archived = bundleSection(chain, "hedger") as HedgerState | undefined;
  const env: Envelope<HedgerState> = {
    live: false,
    data:
      archived ?? {
        configured: false,
        agent: null,
        payer: null,
        index_id: "ACR-INF",
        target_contracts: 0,
        venue: null,
        wallet_kind: "circle-agent-wallet",
        series_id: null,
        multiplier: null,
        mark: null,
        mark_block: null,
        position_contracts: null,
        gap_contracts: null,
        collateral_usdc: null,
        paid_queries: null,
        spent_usdc: null,
        fills: [],
        receipts: null,
      },
    fetchedAt: Date.now(), chain,
    upstream,
  };
  return NextResponse.json(env, {
    headers: envelopeHeaders("public, s-maxage=30, stale-while-revalidate=120", chain, env),
  });
}
