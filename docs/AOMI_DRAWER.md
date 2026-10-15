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
