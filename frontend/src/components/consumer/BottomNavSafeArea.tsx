"use client";

/**
 * Wraps ConsumerLayout's {children} with bottom-nav-safe padding — except
 * on /checkout WHILE THE BAG HAS ITEMS, where StickyBottomNav hides itself
 * (see that component's own doc comment on why: a second fixed price+CTA
 * bar stacked above the generic 5-tab nav is the "two competing
 * fixed-chrome models" this codebase already tried once on the PDP and
 * reverted). Reserving 6rem+ of padding for a nav that isn't actually
 * rendered there left a known, flagged gap of dead whitespace below
 * checkout's own sticky bar (redesign-plan Section 5) — this is that fix,
 * isolated to a small client component (rather than converting the whole
 * consumer layout to a client component) since only this one class needs
 * pathname (and now cart-count) awareness.
 *
 * G13 — mirrors StickyBottomNav's own condition exactly: an EMPTY bag on
 * /checkout has no sticky CTA bar and DOES show the bottom nav, so it also
 * needs the normal nav-safe padding restored in that state.
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCartStore } from "@/stores";

export function BottomNavSafeArea({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const cartCount = useCartStore((s) => s.getItemCount());
  const hideBottomNav = pathname?.startsWith("/checkout") && cartCount > 0;
  return (
    <div className={`flex-1 flex flex-col ${hideBottomNav ? "" : "bottom-nav-safe"}`}>
      {children}
    </div>
  );
}
