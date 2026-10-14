import { NextResponse } from "next/server";
import { bundleSection, fetchLiveMeta } from "@/lib/api";
import { envelopeHeaders, requestChain } from "@/lib/envelope";
import { readFuturesDirect } from "@/lib/futuresOnchain";
import { LastGood, pressTimeoutMs } from "@/lib/pressTier";
import type { Envelope, FuturesRoster } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* The direct-chain tier is a paced sequential RPC crawl (~6s nominal, ~12s
   worst case at 350ms spacing) — give it headroom. */
export const maxDuration = 30;

/* The live futures venue — desks + the on-chain trade tape. Fast endpoint the
   /curve desk polls (a few seconds), decoupled from the heavy /terminal/data.
   Three tiers, mirroring the terminal's connection ladder:
     press  — FastAPI /futures (its FuturesReader caches keep RPC off the path)
     chain  — direct viem reads of ACRFutures when the press is unreachable
     bundle — the archived snapshot's desks + captured tape as the floor. */
/* The last roster each chain's press answered, on this instance. See lib/pressTier.ts. */
const lastGood = new LastGood<FuturesRoster>();

export async function GET(req: Request) {
  const chain = requestChain(req);
  /* 12s, not the 5s default: this endpoint's press tier can pay for an
     eth_getLogs on a throttled RPC, and giving up early falls through to the
     *slower* direct-chain crawl — or to the bundle, which reads as "the venue
     is archived" and hides the trading desk on a perfectly healthy site. */
  /* …and longer where the press is the chain's ONLY tier (testnet): there is
     nothing slower to fall through to, only an empty venue. */
  const { data, upstream } = await fetchLiveMeta<FuturesRoster>(chain, "/futures", pressTimeoutMs(chain));
  if (data) {
    lastGood.remember(chain, data);
    const env: Envelope<FuturesRoster> = {
      live: true,
      data: { ...data, source: "press" },
      fetchedAt: Date.now(), chain,
      upstream,
    };
    return NextResponse.json(env, {
      headers: envelopeHeaders("public, s-maxage=3, stale-while-revalidate=15", chain, env),
    });
  }

  let direct: FuturesRoster | null = null;
  try {
    direct = await readFuturesDirect(chain);
  } catch {
    /* fall through to the bundle */
  }
  if (direct) {
    // Honest live: real contract state ≤60s old, read while the press is down.
    const env: Envelope<FuturesRoster> = {
      live: true,
      data: direct,
      fetchedAt: Date.now(), chain,
      upstream,
    };
    return NextResponse.json(env, {
      headers: envelopeHeaders("public, s-maxage=30, stale-while-revalidate=120", chain, env),
    });
  }

  /* THE PRESS'S LAST ANSWER, BEFORE THE ARCHIVE. A roster read minutes ago is
     a better floor than the archived bundle, and on testnet there is no
     bundle at all — this was the empty venue /curve flickered to. Stamped
     with the time it was READ and `live: false`, which also makes it no-store
     (envelopeHeaders) and keeps the desk from trading on it (PublicDesk). */
  const kept = lastGood.recall(chain);
  if (kept) {
    const env: Envelope<FuturesRoster> = {
      live: false,
      data: { ...kept.value, source: "press" },
      fetchedAt: kept.at, chain,
      upstream,
    };
    return NextResponse.json(env, {
      headers: envelopeHeaders("public, s-maxage=3, stale-while-revalidate=15", chain, env),
    });
  }

  const bundled: FuturesRoster = {
    venue: bundleSection(chain, "chain")?.futures_address ?? null,
    desks: bundleSection(chain, "futures") ?? {},
    trades: bundleSection(chain, "futures_trades") ?? [],
    source: "bundle",
  };
  const env: Envelope<FuturesRoster> = {
    live: false,
    data: bundled,
    fetchedAt: Date.now(), chain,
    upstream,
  };
  return NextResponse.json(env, {
    headers: envelopeHeaders("public, s-maxage=3, stale-while-revalidate=15", chain, env),
  });
}
