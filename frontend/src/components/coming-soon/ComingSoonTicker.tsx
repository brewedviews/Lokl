"use client";

/**
 * ComingSoonTicker — G17, from docs/design/coming-soon-v2.html.
 *
 * A count-up animation to a fixed target, NOT a live metric — this is a
 * deliberate, explicitly-approved deviation from G15/16's "no fake numbers"
 * rule (the user reviewed the reference file, which fabricates this exact
 * ticker, and chose to keep its claims as-is rather than have this page
 * re-derive them from real data). Kept as its own tiny component so this
 * intentional exception stays isolated and easy to find/reconsider later,
 * rather than buried inline in the page.
 */
import { useEffect, useState } from "react";

const TARGET = 12;

export function ComingSoonTicker() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCount((n) => {
        if (n >= TARGET) {
          clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, 70);
    return () => clearInterval(timer);
  }, []);

  return (
    <div data-testid="coming-soon-ticker" className="bg-brand-primary text-white/85 text-center py-2.5 px-5 text-[13px] font-medium">
      <strong className="text-brand-accent font-black text-[15px] mx-1">{count}</strong>
      stores joining before launch &nbsp;&middot;&nbsp; Be the first to shop from them
    </div>
  );
}
