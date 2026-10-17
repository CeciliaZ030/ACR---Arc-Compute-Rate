"use client";

import { MAX_SETTLE_AGE_S } from "@/lib/chain";
import { Ed } from "@/components/Ed";
import { useEdition } from "@/lib/useEdition";
import { useNow } from "@/lib/useNow";
import type { OnchainPrint } from "@/lib/types";

/* Settlement freshness, ticking: `posted 42s ago · finality <1s`. Uses the
   on-chain print's posted_at (block time, epoch seconds). Turns clay when the
   print is stale (older than ~2 refresh cycles). Sim mode renders the static
   finality fact instead of a fake age. All instances share one 1 Hz clock
   (lib/useNow) instead of running an interval each. */
export function FinalityBadge({
  onchain,
  live = true,
  staleAfterS = MAX_SETTLE_AGE_S,
  micro = false,
}: {
  onchain?: OnchainPrint | null;
  live?: boolean;
  staleAfterS?: number;
  micro?: boolean;
}) {
  const now = useNow();
  const plain = useEdition() === "plain";

  /* The micro variant sat at 9.5px against `.chip`'s own 10px: half a pixel
     under its base, which is not a size anyone chose. It is --t-1 now, the same
     step .chip already resolves to. Worth saying how it survived the sweep that
     put every other inline number on the scale: this style object lives behind
     a ternary, and both that sweep and the guard in lib/coverage.test.ts matched
     the literal `style={{`. Three chips rendered off-scale for it, and the
     census reported them as coming from nowhere. The guard reads any `style=`
     prop now. */

  // Archived snapshot: the posted_at is frozen — don't tick a fake live age.
  if (onchain?.posted_at && !live) {
    return (
      <span
        className="chip chip-sim"
        style={micro ? { fontSize: "var(--t-1)", padding: "var(--s-1) var(--s-3)" } : undefined}
        title={
          plain
            ? "the last recorded rate from the saved copy: start the live server for real-time freshness"
            : "last on-chain print from the bundled snapshot: start the live API for real-time freshness"
        }
      >
        <Ed x="on-chain · archived" p="on the blockchain · saved copy" />
      </span>
    );
  }

  if (!onchain?.posted_at || now === 0) {
    return (
      <span
        className="chip chip-sky"
        title={
          plain
            ? "payments here confirm for good in under a second: no take-backs"
            : "Malachite BFT · deterministic sub-second finality"
        }
      >
        <Ed x={<>finality &lt;1s</>} p={<>final in &lt;1s</>} />
      </span>
    );
  }

  const age = Math.max(0, Math.floor(now - onchain.posted_at));
  const stale = age > staleAfterS;
  const label =
    age < 90 ? `${age}s` : age < 5400 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
  return (
    <span
      className={`chip ${stale ? "chip-breach" : "chip-teal"}`}
      style={micro ? { fontSize: "var(--t-1)", padding: "var(--s-1) var(--s-3)" } : undefined}
      title={
        stale
          ? plain
            ? "the latest official rate is old; money should not settle against it"
            : "the latest on-chain print is stale; settlement consumers should reject it"
          : plain
            ? "how old the official rate on the public scoreboard is · confirmed for good in under a second"
            : "age of the settlement-grade print on ACROracle · finality is deterministic and sub-second"
      }
    >
      posted {label} ago
      {micro ? "" : <Ed x=" · finality <1s" p=" · final in <1s" />}
    </span>
  );
}
