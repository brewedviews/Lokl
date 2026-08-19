"use client";

/**
 * Wraps ConsumerLayout's {children} with bottom-nav-safe padding — except
 * on /checkout, where StickyBottomNav hides itself (see that component's
 * own doc comment on why: a second fixed price+CTA bar stacked above the
 * generic 5-tab nav is the "two competing fixed-chrome models" this
 * codebase already tried once on the PDP and reverted). Reserving 6rem+ of
 * padding for a nav that isn't actually rendered there left a known,
 * flagged gap of dead whitespace below checkout's own sticky bar
 * (redesign-plan Section 5) — this is that fix, isolated to a small client
 * component (rather than converting the whole consumer layout to a client
 * component) since only this one class needs pathname awareness.
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function BottomNavSafeArea({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideBottomNav = pathname?.startsWith("/checkout");
  return (
    <div className={`flex-1 flex flex-col ${hideBottomNav ? "" : "bottom-nav-safe"}`}>
      {children}
    </div>
  );
}
