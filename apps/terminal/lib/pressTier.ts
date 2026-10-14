/* When the press is a chain's ONLY tier, a slow answer must not become an
 * empty one.
 *
 * Mainnet has three tiers behind /api/futures — the press, a direct contract
 * read, the archived bundle. Testnet has one: `CHAINS.testnet` sets `bundle`
 * and `directReads` false on purpose (lib/chainChoice.ts — reading mainnet
 * contracts for a testnet visitor would be a lie). So when the testnet press
 * missed the 12s budget, the route had nothing behind it and answered an EMPTY
 * venue. Measured 2026-10-14: the testnet press's /futures took 2.5-26s under
 * Arc's eth_getLogs throttling, half of six reads through the terminal came
 * back `live:false, upstream:timeout, desks 0`, and because that is a 200 —
 * not an error — `keepPreviousData` did not hold the last desks: /curve
 * flickered between three desks and none.
 *
 * Two fixes, both here so they can be tested without a network:
 *   - a chain whose press is its only tier waits longer (the route allows 30s);
 *   - each server instance remembers the last roster its press answered, per
 *     chain, and serves it — `live: false`, stamped with the time it was READ —
 *     instead of an empty venue, for a bounded window.
 */

import { CHAINS, type ChainKey } from "./chainChoice";

/** The press budget when other tiers stand behind it. */
export const PRESS_TIMEOUT_MS = 12_000;
/** The press budget when nothing does. Under the route's 30s maxDuration. */
export const SOLE_TIER_TIMEOUT_MS = 25_000;
/** How long a remembered answer may stand in for the press. */
export const LAST_GOOD_MAX_AGE_MS = 10 * 60_000;

/** True when the press is the only tier this chain has. */
export function pressIsSoleTier(chain: ChainKey): boolean {
  return !CHAINS[chain].directReads && !CHAINS[chain].bundle;
}

export function pressTimeoutMs(chain: ChainKey): number {
  return pressIsSoleTier(chain) ? SOLE_TIER_TIMEOUT_MS : PRESS_TIMEOUT_MS;
}

/** The last answer per chain, and when it was read. Per server instance:
 *  a cold instance has nothing, which is no worse than before. */
export class LastGood<T> {
  private readonly kept = new Map<ChainKey, { value: T; at: number }>();

  remember(chain: ChainKey, value: T, now: number = Date.now()): void {
    this.kept.set(chain, { value, at: now });
  }

  /** The remembered answer if it is young enough to stand in, else null. */
  recall(chain: ChainKey, now: number = Date.now()): { value: T; at: number } | null {
    const k = this.kept.get(chain);
    if (!k || now - k.at > LAST_GOOD_MAX_AGE_MS) return null;
    return k;
  }
}
