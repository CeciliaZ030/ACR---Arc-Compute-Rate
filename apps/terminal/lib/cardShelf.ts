/* One cached agent card PER CHAIN.
 *
 * /api/screen held a single module-level card for the whole instance. A card is
 * signed for one chain — the chain id sits in its EIP-712 domain — so whichever
 * chain's visitor minted it first, the other chain reused it for up to fifteen
 * minutes and that chain's gate refused it. Measured 2026-10-14 on production:
 * the testnet /loop screen answered 401 "unavailable" while testnet's Model
 * Armor had screened 24 requests, because the card it carried was mainnet's.
 * The MCP plugin met the same failure earlier (four of five tools 401'd).
 */

import type { ChainKey } from "./chainChoice";

export interface HeldCard {
  header: string;
  /** Unix seconds. */
  expiresAt: number;
}

export class CardShelf {
  private readonly shelf = new Map<ChainKey, HeldCard>();

  /** This chain's card if it outlives `marginS`, else null (mint a new one). */
  fresh(chain: ChainKey, nowS: number, marginS: number): string | null {
    const c = this.shelf.get(chain);
    return c && c.expiresAt - nowS > marginS ? c.header : null;
  }

  put(chain: ChainKey, card: HeldCard): void {
    this.shelf.set(chain, card);
  }
}
