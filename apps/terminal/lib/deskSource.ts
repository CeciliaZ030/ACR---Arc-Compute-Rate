/* Which desks /curve renders, and how far back a wallet lookup reads.
 *
 * DESKS. `/curve` used `roster?.desks ?? env.data.futures`. When the futures
 * route answered a NON-LIVE envelope with no desks — a cold serverless
 * instance whose press read timed out, before it had a last-good roster to
 * serve (lib/pressTier.ts) — `??` kept the empty object, because `{}` is not
 * nullish, and the desk rendered an empty venue even though the terminal feed
 * on the same page carried the desks. Measured 2026-10-14 on the testnet
 * /curve: the first desk reply after a deploy was 0 desks while
 * /api/terminal?chain=testnet held 3. A LIVE empty roster is still the truth
 * and is shown as such; only an unread one defers.
 *
 * WINDOW. The wallet lookup on /tape read `/tca/{payer}?days=7`, so the example
 * wallet a developer is given on /developers (3 purchases inside 30 days) read
 * "nothing to grade" there, while the MCP plugin, which reads 30 days, answered
 * it. The same wallet must not be seen by one surface and unseen by the other.
 */

import type { FuturesDeskRow, FuturesRoster } from "./types";

export function desksFor(
  roster: FuturesRoster | null,
  live: boolean,
  fallback: Record<string, FuturesDeskRow> | undefined,
): Record<string, FuturesDeskRow> | undefined {
  if (roster && (live || Object.keys(roster.desks ?? {}).length > 0)) return roster.desks;
  return fallback ?? roster?.desks;
}

/** The window a wallet lookup reads — the MCP plugin's own default (mcp/src/tools.ts). */
export const PAYER_WINDOW_DAYS = 30;
