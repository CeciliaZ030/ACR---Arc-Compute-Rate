"use client";

import { useEffect, useRef, useState } from "react";

/* Live numerals with zero layout shift: tabular mono + fixed decimal places.
   `roll` (hero variant) plays a per-digit vertical roll on changed characters;
   both variants flash a fading gold underline on update ("newswire update").
   prefers-reduced-motion disables both via CSS. */

function Digit({ ch }: { ch: string }) {
  return (
    <span className="digit">
      {/* remount on change so the roll-in animation replays for this digit only */}
      <span key={ch} className="digit-in">
        {ch}
      </span>
    </span>
  );
}

export function TickerNumber({
  text,
  roll = false,
  quiet = false,
  className = "",
}: {
  text: string;
  roll?: boolean;
  /** No newswire flash on change. The flash means "this just updated", and a
   *  reader scrubbing the hero through its history is changing the text
   *  themselves, many times a second: the digits still roll, the underline
   *  stays dark. */
  quiet?: boolean;
  className?: string;
}) {
  const prev = useRef(text);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1300);
      return () => clearTimeout(t);
    }
  }, [text]);

  // `quiet` is applied at render, not in the effect: the effect is the one
  // the compiler lint already tolerates as written, and a quiet ticker simply
  // never wears the class.
  const cls = `tick${flash && !quiet ? " tick-flash" : ""}${className ? ` ${className}` : ""}`;
  if (!roll) return <span className={cls}>{text}</span>;
  /* The per-digit split is decoration for the roll, and a screen reader read it
     literally: the home index card announced its rate as "0 . 4 9 7 7 3". So the
     value is spoken once from an .sr-only copy and the digits are hidden from the
     accessibility tree. Both spans are inline, and `.tick`/`.digit` are plain
     inline-block with no child combinators, so the geometry is unchanged. */
  return (
    <span className={cls}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split("").map((ch, i) => (
          <Digit key={i} ch={ch} />
        ))}
      </span>
    </span>
  );
}
