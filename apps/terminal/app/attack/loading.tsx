/* Streams instantly while the attack lab awaits the live payload. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="setting type">
      <div className="skel-caption" />
      <div className="skel skel-line" style={{ maxWidth: 68 * 7, marginTop: "var(--s-3)" }} />
      <div className="lab skel-gap">
        <div>
          <div className="skel skel-line" style={{ maxWidth: 140 }} />
          <div className="skel" style={{ height: 40, maxWidth: 280, marginTop: "var(--s-4)" }} />
          <div className="skel" style={{ height: 44, maxWidth: 220, marginTop: "var(--s-6)" }} />
          <div className="skel skel-line" style={{ marginTop: "var(--s-6)" }} />
          <div className="skel skel-line" />
        </div>
        <div>
          <div className="skel skel-chart" style={{ height: 280 }} />
        </div>
      </div>
    </div>
  );
}
