"use client";

/**
 * Mobile-only sticky bottom navigation. Hidden on /merchant + /admin + /rider
 * routes (the rider PWA has its own minimal top-bar chrome, see
 * app/rider/layout.tsx — this check is redundant with /rider living outside
 * the (consumer) route group, but kept explicit for the same belt-and-braces
 * reason /merchant and /admin already are).
 *
 *   [ Home ] [ Categories ] [ All ] [ Stores ] [ Profile ]
 *
 * Wishlist moved into the account page (its own boxed section, matching
 * the address box) — the standalone /wishlist route still works, it's
 * just no longer the primary entry point. Search lives in the pinned bar
 * in ConsumerHeader (its own in-place top sheet), not here — cart already
 * lives top-right in the consumer header too, so neither doubles up.
 *
 * `/product/` routes ARE shown now (this used to be excluded, back when
 * the PDP had no fixed bottom chrome at all) — the PDP's own price+CTA bar
 * (see ProductDetailPanel's price-cta-row) sits fixed directly above this
 * nav, and needs a `showLabels=false` render of THIS SAME component rather
 * than a forked one, so the two bars' combined height stays small enough
 * to leave real scrollable room on short viewports (iPhone SE etc). The
 * icon row is a fixed h-14 in that mode specifically so the price+CTA bar
 * above it can position itself with a precise, non-guessed offset instead
 * of estimating this nav's intrinsic content height.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Grid3x3, Store, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackNavClick } from "@/lib/analytics";

const ITEMS = [
  { href: "/", testId: "nav-home", label: "Home", icon: Home, track: "home" },
  { href: "/categories", testId: "nav-categories", label: "Categories", icon: Grid3x3, track: "categories" },
  { href: "/products", testId: "nav-all-products", label: "All", icon: ShoppingBag, track: "all" },
  { href: "/stores", testId: "nav-stores", label: "Stores", icon: Store, track: "stores" },
  { href: "/account", testId: "nav-profile", label: "Profile", icon: User, track: "profile" },
] as const;

export function StickyBottomNav({ showLabels }: { showLabels?: boolean } = {}) {
  const pathname = usePathname();

  if (pathname.startsWith("/merchant") || pathname.startsWith("/admin") || pathname.startsWith("/rider")) return null;

  const withLabels = showLabels ?? !pathname.startsWith("/product/");
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      data-testid="sticky-bottom-nav"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-card-border shadow-[0_-2px_12px_rgba(10,31,92,0.06)]"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <ul className={cn("grid grid-cols-5 px-1", withLabels ? "pt-1" : "h-14 items-center")}>
        {ITEMS.map(({ href, testId, label, icon: Icon, track }) => (
          <li key={href} className="flex items-center justify-center">
            <Link
              href={href}
              data-testid={testId}
              onClick={() => { try { trackNavClick(track); } catch {} }}
              className={cn(
                "w-full flex items-center justify-center rounded-2xl transition",
                withLabels ? "flex-col gap-1 px-2 py-2" : "py-2",
                isActive(href) ? "text-brand-accent-alt" : "text-slate-600",
              )}
            >
              <Icon size={20} />
              {withLabels && <span className="text-[10px] font-medium">{label}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
