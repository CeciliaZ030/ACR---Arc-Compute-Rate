/* Where the Aomi agent drawer may load, and where it must not.
 *
 * The drawer embeds `@aomi-labs/widget` from npm: the vendor's code plus about
 * 775 transitive wallet-SDK packages, running in THIS origin, not in an iframe.
 * Same-origin code can read sessionStorage, and two things live there that must
 * never meet third-party code:
 *
 *   acr-ops-key       the operator console's bearer key (/ops, /spend)
 *   acr-reader-card   a business owner's agent card (/spend)
 *
 * So the rule is: the widget's code and those credentials never share a
 * JavaScript context.
 *  - On the pages that collect or use them (and /developers, where a visitor
 *    pastes their own agent card), there is no drawer at all.
 *  - A tab that already holds either credential does not load the widget; the
 *    reader is asked to open the agent in a fresh tab.
 *  - If the widget was loaded and the reader then navigates INTO one of those
 *    pages, the page reloads fully, so the vendor's modules are gone before a
 *    key can be typed (`AgentDrawer` does this).
 * sessionStorage is per tab, so a key entered in another tab is never visible
 * here in the first place.
 */

export const AGENT_EXCLUDED_PATHS = ["/ops", "/spend", "/developers"] as const;

/** The sessionStorage keys the widget must never share a tab with. */
export const CREDENTIAL_KEYS = ["acr-ops-key", "acr-reader-card"] as const;

export type AgentVerdict = "ok" | "excluded" | "credential";

/** True for the excluded pages and anything under them. */
export function excludedPath(path: string): boolean {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return AGENT_EXCLUDED_PATHS.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Whether the widget may load here, given the sessionStorage keys this tab holds. */
export function agentAllowed(path: string, heldKeys: Iterable<string>): AgentVerdict {
  if (excludedPath(path)) return "excluded";
  const held = new Set(heldKeys);
  return CREDENTIAL_KEYS.some((k) => held.has(k)) ? "credential" : "ok";
}

/** The credential keys present in this tab's sessionStorage (empty when unreadable). */
export function heldCredentialKeys(): string[] {
  try {
    return CREDENTIAL_KEYS.filter((k) => window.sessionStorage.getItem(k) !== null);
  } catch {
    return [];
  }
}

let widgetLoaded = false;

/** Called when the widget's code has loaded in this tab. */
export function markWidgetLoaded(): void {
  widgetLoaded = true;
}

/** Whether the widget's code has loaded in this tab since the last full page load. */
export function widgetWasLoaded(): boolean {
  return widgetLoaded;
}
