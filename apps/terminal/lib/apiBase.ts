/* Where the seller lives, when nothing says otherwise.
 *
 * Eight places used to spell `process.env.NEXT_PUBLIC_ACR_API ?? "http://127.0.0.1:8000"`,
 * and that default is wrong in the one place it actually gets used: a production
 * build on a server, where localhost:8000 is nothing at all. The live terminal
 * shipped pointing at a host that cannot exist, and the only thing hiding it was
 * an environment variable someone had to remember to set.
 *
 * So the fallback follows the build: a production bundle falls back to the
 * production seller, development keeps localhost. `NEXT_PUBLIC_ACR_API` still
 * wins over both, which is how a fork, a preview or a testnet deployment points
 * somewhere else — nothing here constrains them.
 *
 * Client-safe on purpose. Next inlines `NEXT_PUBLIC_*` and `NODE_ENV` into client
 * bundles and does NOT inline `ACR_API`, so that server-only variable is read in
 * `lib/api.ts` instead, where it can be. This module stays dependency-free for
 * the same reason `lib/rpcErrors.ts` does: `lib/api.ts` imports `fallback.json`
 * (141 KB) and must never be pulled into the browser.
 */

/** The deployed mainnet seller. A literal, because a build has no other way to
 *  learn it, and public — it is in the README and in every x402 receipt. */
export const MAINNET_SELLER = "https://acr-api-mainnet.onrender.com";

/** The deployed testnet seller, for the same reason and on the same terms.
 *
 *  ACR has partners who work on Arc testnet, so one deployment serves both and a
 *  visitor chooses (`lib/chainChoice.ts`). That makes this host a first-class
 *  part of the product rather than a leftover — which is the distinction
 *  `lib/mainnetOnly.test.ts` cares about. It stays addressable here, next to its
 *  mainnet twin, for the same reason `lib/chain.ts` keeps both profiles: moving
 *  the default must not delete the network this was proven on. */
export const TESTNET_SELLER = "https://acr-api-1fto.onrender.com";

/** The second Arc MAINNET press, and the reason the cushion below can work at all.
 *
 *  Same chain as `MAINNET_SELLER` (5042), so `chainMismatch` accepts either and
 *  `mainnetOnly.test.ts` has nothing to say about it. Measured 2026-10-11, which
 *  is why it is here rather than theoretical: `/terminal/data` — the one route
 *  the front page needs — answered **200 in 0.41s** with all seven sections while
 *  `MAINNET_SELLER` **timed out at 60s with zero bytes, twice**. It serves 50
 *  routes against that host's 44, including `/par` and all five `/operator/*`.
 *
 *  IT IS ON RENDER'S FREE PLAN AND IT DOES NOT SLEEP. That combination sounds
 *  wrong, so it is the one thing worth recording: free services spin down after
 *  ~15 idle minutes, but this one sets `ACR_SELF_URL`, so its own 60-second loop
 *  knocks on its public URL and Render counts that as traffic. After 17.5 minutes
 *  with zero external requests, `process_started_at` was unchanged to the second
 *  and `/health` answered in 1.34s. Read the restart field, not the latency — a
 *  fast answer could just mean it woke fast; a moved `process_started_at` is the
 *  only thing that distinguishes "never slept" from "slept and cold-booted". */
export const PROBE_SELLER = "https://acr-probe-free.onrender.com";

/** The local seller `make api` serves. */
export const LOCAL_SELLER = "http://127.0.0.1:8000";

/** The seller base for BROWSER-side code (wallet payments talk to it directly,
 *  so it must be a real host rather than a same-origin proxy path). */
export function sellerBase(): string {
  const explicit = process.env.NEXT_PUBLIC_ACR_API?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? MAINNET_SELLER : LOCAL_SELLER;
}

/** The seller THIS BUILD knows is right, consulting no environment variable.
 *
 *  Deliberately not `sellerBase()`. The cushion below exists for the case where
 *  a configured host is dead — and `ACR_API` and `NEXT_PUBLIC_ACR_API` were both
 *  set to the SAME suspended service, so deriving the cushion from either one
 *  collapsed the candidate list to a single dead host and the fallback could
 *  never fire. Measured on the live deployment: `fellBack: false` with `active`
 *  still naming the dead host. A cushion has to come from somewhere the broken
 *  configuration cannot reach.
 */
export function publishedSeller(): string {
  return process.env.NODE_ENV === "production" ? MAINNET_SELLER : LOCAL_SELLER;
}

/** Every mainnet press this build knows, in preference order.
 *
 *  WHY A LIST AND NOT JUST `MAINNET_SELLER`. The cushion below is deduped, and
 *  for most of this deployment's life `ACR_API` has named the SAME host as
 *  `MAINNET_SELLER` — so the candidate list collapsed to one entry and there was
 *  no cushion at all. Measured on the live site 2026-10-11: `/terminal/data`
 *  timed out at 60s twice on the configured host while this one answered 200 in
 *  0.41s, and the front page served the archived bundle to every visitor with
 *  `fellBack: false`, because there was nothing to fall back to.
 *
 *  A two-host list cannot collapse. Whichever one `ACR_API` names, the other is
 *  still a rung — which is the property the comment below always claimed and the
 *  single-literal version could not actually provide. Both are Arc mainnet
 *  (chain 5042), so `chainMismatch` accepts either and `mainnetOnly.test.ts`
 *  stays satisfied; `acr-probe-free`'s CORS was verified to name the live origin,
 *  which matters only if `NEXT_PUBLIC_ACR_API` ever points at it, since the
 *  browser path reads `sellerBase()` and never this ladder. */
export const MAINNET_PRESSES = [MAINNET_SELLER, PROBE_SELLER] as const;

/** Every testnet press this build knows. There is exactly one, and that is the
 *  honest state rather than an oversight.
 *
 *  `acr-api.onrender.com` — the name an older runbook still mentions — answers
 *  **404**: no service is bound to it. So testnet gets the same mechanism and the
 *  same gate as mainnet, and one rung, because a second rung would have to be a
 *  host that exists. `PROBE_SELLER` cannot stand in: it is chain 5042, and
 *  `chainMismatch` would refuse it for a testnet request — correctly, since that
 *  refusal is the guard that stopped a resumed testnet press serving its data
 *  under a mainnet UI.
 *
 *  When a second testnet press exists this becomes one more array entry and
 *  nothing else changes, which is the point of routing both chains through one
 *  list. Until then `chainCandidates("testnet", …)` returns a single candidate
 *  and the archived bundle is the only cushion — so the gate below asserts ≥2 for
 *  MAINNET only, rather than pretending this list is something it is not. */
export const TESTNET_PRESSES = [TESTNET_SELLER] as const;

/** Which seller bases to try, in order.
 *
 *  The configured override comes first and a working one is never overridden.
 *  The build's published seller follows it as a cushion, because an `ACR_API`
 *  naming a decommissioned host once demoted every route on the live terminal
 *  to the archived bundle for two days.
 *
 *  Deduped, and that dedupe is why `alternates` exists: with no override, or an
 *  override that already equals the published base, the first two arguments
 *  alone yield ONE candidate and no fallback behaviour — the exact failure
 *  described on `MAINNET_PRESSES`. Passing the known presses as `alternates`
 *  guarantees a second rung whichever host the environment names. It defaults to
 *  empty so a caller that genuinely has only one known host is unchanged.
 */
export function sellerCandidates(
  configured: string,
  published: string,
  alternates: readonly string[] = [],
): string[] {
  const norm = (s: string) => s.trim().replace(/\/$/, "");
  const out: string[] = [];
  for (const base of [norm(configured), norm(published), ...alternates.map(norm)]) {
    if (base && !out.includes(base)) out.push(base);
  }
  return out;
}

/** Whether a response means "this host is not serving" rather than "no".
 *
 *  5xx only. A 402 is the paywall working, a 404 is "no open series for this
 *  index" — both are the seller answering correctly, and trying a different
 *  host because of one would be a bug, not a cushion.
 */
export function isHostFailure(status: number): boolean {
  return status >= 500;
}

/** Does a host that serves `served` have a route for this concrete path?
 *
 *  WHY THIS EXISTS. A press that predates a feature answers **404** for its
 *  routes — a precise, healthy answer — and the terminal collapsed that into
 *  "the press did not answer". Measured on the live site: the mainnet press
 *  serves 44 routes and answers 404 for `/par` and all five `/operator/*`,
 *  while /spend and /traction told a visitor the service was not running. It
 *  was running. Saying so wrongly is worse than saying nothing, because a
 *  reader who believes the product is down does not try the thing that works.
 *
 *  A 404 ALONE CANNOT TELL YOU WHICH IT IS. `/operator/statement/nobody` is
 *  also a 404, and that one really is "no such business". So the question is
 *  put to the host's own `/openapi.json`: a 404 on a path it does not list is
 *  a deployment that predates the route; a 404 on a path it does list is an
 *  ordinary not-found. Reading the spec rather than pattern-matching a `detail`
 *  string is also what makes this self-maintaining — the message disappears on
 *  its own the moment the host is redeployed, with no code change.
 *
 *  Templated segments match anything: `/operator/statement/{business}` serves
 *  `/operator/statement/acr-fleet`. Query strings are not part of a path.
 */
export function servesPath(served: Iterable<string>, concrete: string): boolean {
  const want = concrete.split("?")[0].split("/").filter(Boolean);
  for (const template of served) {
    const got = template.split("/").filter(Boolean);
    if (got.length !== want.length) continue;
    if (got.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === want[i])) {
      return true;
    }
  }
  return false;
}

/** Whether a seller answering with `hostChainId` may serve a build made for
 *  `buildChainId` — and if not, why.
 *
 *  THE CASE THIS EXISTS FOR. `ACR_API` named the Arc testnet seller. While that
 *  host was suspended the fallback rung covered for it, and the terminal reached
 *  mainnet. Then the host was RESUMED, started answering 200 again, and because a
 *  working override is honoured the terminal went straight back to it — now
 *  serving live chain-5042002 data under a mainnet UI. That is worse than the
 *  archive, which at least labels itself ARCHIVED.
 *
 *  "A working override wins" was the right rule for a staging seller and the
 *  wrong one for a seller on another chain: a host can be perfectly healthy and
 *  still not be serving THIS product. So health is not the only test — identity
 *  is the other one.
 *
 *  Absence of evidence is not evidence: an unparseable or missing chain id
 *  returns null (allowed), exactly as an unreadable balance never stops a print.
 *  Only a chain id that is present, valid and DIFFERENT disqualifies a host.
 */
export function chainMismatch(buildChainId: number, hostChainId: unknown): string | null {
  if (!Number.isFinite(buildChainId) || buildChainId <= 0) return null;
  const got = Number(hostChainId);
  if (!Number.isFinite(got) || got <= 0) return null;
  if (got === buildChainId) return null;
  return (
    `seller is on chain ${got} but this build is for ${buildChainId} — ` +
    "healthy, but not serving this product"
  );
}
