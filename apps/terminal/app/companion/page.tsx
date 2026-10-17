import type { Metadata } from "next";
import Link from "next/link";
import { GLOSSARY_THEMES, PLAIN_GLOSSARY, PRIMER_BEATS } from "@/lib/plainGlossary";

export const metadata: Metadata = {
  title: "The Reader’s Companion · ACR",
  description:
    "Every term this paper uses, in one line each with an everyday analogy: the plain-English companion to the Arc Compute Rate.",
};

/* The Reader's Companion: the plain-language dictionary as an editorial page.
   Pure static content (no data fetch, no client state) — the one page whose
   voice is the same in both editions, because it IS the plain voice. Content
   is lib/plainGlossary.ts, distilled from docs/GLOSSARY.md (the CI-enforced
   canonical glossary). */
export default function CompanionPage() {
  return (
    <>
      <div className="page-head">
        {/* A plain string, not an <Ed> pair. This page is exempt from the
            edition swap by a decision recorded in the coverage ledger: it IS
            the plain voice, so it has one register. The words are its own
            metadata.title. */}
        <h1>The Reader’s Companion</h1>
        <p className="standfirst">
          Every term this paper uses, in one line each, with the everyday analogy that makes it
          stick. No prior knowledge assumed.
        </p>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="label">The whole thing in six beats</h2>
        </div>
        <div className="primer-rail">
          {PRIMER_BEATS.map((b) => (
            <div className="primer-beat" key={b.head}>
              <h3 className="primer-head">{b.head}</h3>
              <p className="primer-body">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {GLOSSARY_THEMES.map((theme) => (
        <section className="companion-theme" key={theme}>
          <div className="block-head">
            <h3 className="label">{theme}</h3>
          </div>
          <div className="companion-grid">
            {Object.entries(PLAIN_GLOSSARY)
              .filter(([, t]) => t.theme === theme)
              .map(([key, t]) => (
                <div className="companion-entry" key={key}>
                  <b>{t.term}</b>
                  <p>{t.gloss}</p>
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="section">
        <p className="muted" style={{ fontSize: "var(--t-4)", maxWidth: "var(--measure)" }}>
          The paper’s canonical glossary is <span className="mono">docs/GLOSSARY.md</span>. Flip
          the masthead to <b>plain</b> and every page gets this treatment, numbers identical.
        </p>
        {/* This page is the plain edition's "Start Here", and its only exit
            used to be back to the front page — a reader who had just learned
            the vocabulary was returned to where they started, with nothing to
            do. Send them to the two things they came to understand. */}
        <p style={{ marginTop: "var(--s-5)", display: "flex", gap: "var(--s-4)", flexWrap: "wrap" }}>
          <Link href="/attack" className="btn">
            Watch someone try to cheat it →
          </Link>
          <Link href="/curve#desk" className="btn">
            Place a real trade →
          </Link>
        </p>
        <p style={{ marginTop: "var(--s-5)" }}>
          <Link href="/" className="section-link">
            ← Back to the front page
          </Link>
        </p>
      </section>
    </>
  );
}
