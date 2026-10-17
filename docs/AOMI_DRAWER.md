# ACR Agent drawer

The masthead's **Ask ACR Agent** button opens the published Aomi widget beside
the dashboard. Desktop users can drag the panel edge or focus it and use arrow
keys. On screens up to 760px the panel fills the screen, traps keyboard focus,
and makes the underlying page inert. Escape or the close button returns focus
to the opener. Reduced-motion preferences disable the slide transition.

The shared root layout keeps the widget mounted after its first opening,
including across client-side page navigation. Closing it preserves the draft
and conversation. The widget also owns its app/account-scoped thread storage.
Page-specific question hints do not submit messages or send page data.

## Deployment

Merge and deploy with the existing Vercel setup: no new environment variable,
secret, backend, or contract deployment is required for this chat drawer. It
uses the author's existing public ACR application (`2938642`) by default.

`ACR_AOMI_APPLICATION_ID` is an optional server-side override for forks or a
replacement hosted ACR app. The public identifier is passed to both the widget's
application scope and its sole Direct routing target. Invalid explicit overrides
(including an empty string) show an unavailable state rather than silently
falling back. There is no Auto routing or URL-selected target.

The widget uses its official `https://chat.aomi.dev` service and browser-wallet
authentication. Private app permissions remain enforced by Aomi; embedding
does not grant access. Never place an owner's API credential or signing key in
this frontend. Opening the drawer does not request a signature or send a chat.
The site's MAINNET/TESTNET toggle controls the site's data, not wallet authority:
the widget's network selector and transaction review remain independent.

`@aomi-labs/widget` is pinned to 3.1.4. Its compiled stylesheet is scoped to the
widget root; ACR overrides its theme tokens. Generic swap/bridge starter chips
are hidden for this compute-specific entry point. The widget currently retains
its built-in composer wording and model/safety controls. The model selector's
“Auto” label selects a model, not app routing.

The local `.npmrc` uses legacy peer resolution because 3.1.4's optional Para and
Privy peer constraints conflict in npm's resolver. This integration uses neither
provider. The lockfile and production build cover the browser-wallet path.
Recheck this workaround when upgrading the widget.

## Verification

- Production Next build, TypeScript, targeted ESLint, and 395 frontend tests.
- Browser: drawer open/close, desktop resizing, draft preservation across close
  and navigation, mobile full-screen layout, focus handling, and invalid app configuration.
- Live read-only smoke used the original public ACR application (2938642), with the
  default configuration. It returned an ACR-specific explanation. This does not
  prove private-fork access.
- No wallet signatures or payments were made. Treasury payment acceptance and
  deployment of the private app remain separate from this frontend PR.

Screenshots in `docs/evidence/agent-drawer/` show the local production build.

## Safeguards added at merge (#67)

The widget is the vendor's npm code plus roughly 775 transitive wallet-SDK packages, running in this
origin rather than in an iframe. sessionStorage holds two credentials that must never share a JavaScript
context with it: `acr-ops-key` (the operator console on `/ops` and `/spend`) and `acr-reader-card` (an
owner's agent card on `/spend`). `lib/agentGuard.ts` enforces that:

- **No drawer on `/ops`, `/spend` or `/developers`.** There is no launcher there and the chat never mounts.
- **A tab already holding either credential never loads the widget.** The drawer says so instead.
- **If the widget loaded in this tab and the reader then enters one of those pages, the page reloads fully.**
  `AgentChat` marks itself loaded at module scope; `AgentDrawer` reloads in a layout effect. The vendor's code
  is therefore gone before a key can be typed.
- **On phones (≤640px) the launcher floats bottom right as the ✦ mark.** In the masthead it pushed the
  EXPERT | PLAIN toggle onto a third header row.

Two things are not restricted, and both are noted on the PR:

- **Networks.** The widget's "All networks" selector includes testnets, and its public props
  (`features`: settings, library, theme, activity) cannot hide it.
- **The `@aomi-labs` packages carry no license field.** This is accepted because the vendor authored the PR.

`.npmrc`'s `legacy-peer-deps` applies to every install in `apps/terminal`, not just the widget. Its comment
lists what it suppresses (measured: react-native 0.87 and @solana/kit 7 as wallet-SDK peers, and valtio's
React ≤18 peer). When adding or upgrading a dependency, read `npm ls` yourself.
