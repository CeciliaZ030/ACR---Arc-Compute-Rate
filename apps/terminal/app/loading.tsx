/* Streams instantly while the front page awaits the live payload. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="setting type">
      <div className="skel-caption" />
      <div className="hero" style={{ marginTop: "var(--s-3)" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel-card">
            <div className="skel skel-line" style={{ maxWidth: 120 }} />
            <div className="skel skel-num" style={{ marginTop: "var(--s-4)" }} />
            <div className="skel skel-line" style={{ maxWidth: 180, marginTop: "var(--s-4)" }} />
            <div className="skel" style={{ height: 36, marginTop: "var(--s-4)" }} />
          </div>
        ))}
      </div>
      <div className="skel skel-line skel-gap" style={{ maxWidth: 68 * 8 }} />
      <div className="skel skel-line" style={{ maxWidth: 68 * 6 }} />
      <div className="skel-gap">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel skel-row" />
        ))}
      </div>
    </div>
  );
}
