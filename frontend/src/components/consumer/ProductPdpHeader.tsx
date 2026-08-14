"use client";

/**
 * ProductPdpHeader — the PDP's own sticky header, replacing the generic
 * ConsumerHeader on this route (see ConsumerHeader's own early-return).
 * Starts transparent, floating circular icon buttons directly over the
 * hero image (back = filled near-black circle, the rest = white circles) —
 * then crossfades to a solid cream bar with a hairline bottom border once
 * the page has scrolled past the hero, so it reads as a real nav bar from
 * that point on. Sticky the entire time, including once the user scrolls
 * into "More from this store" — it never disappears mid-scroll.
 *
 * Cart/search live here (not in ConsumerHeader, which is hidden on this
 * route) so those two entry points aren't lost on the PDP.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/stores";
import { useMounted } from "@/hooks/useMounted";

const SCROLL_THRESHOLD = 220;

export function ProductPdpHeader() {
  const router = useRouter();
  const mounted = useMounted();
  const cartCount = useCartStore((s) => s.getItemCount());
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const iconBtn = scrolled
    ? "w-10 h-10 flex items-center justify-center text-ink-navy transition-colors"
    : "w-10 h-10 rounded-full flex items-center justify-center bg-white/95 text-ink-navy shadow-sm transition-colors";

  return (
    <header
      data-testid="pdp-header"
      className={`sticky top-0 z-50 transition-colors duration-200 ${
        scrolled ? "bg-brand-bg border-b border-warm-gray-border" : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="px-3 py-2.5 flex items-center justify-between">
        <button
          type="button"
          aria-label="Back"
          data-testid="pdp-back-btn"
          onClick={() => router.back()}
          className={
            scrolled
              ? iconBtn
              : "w-10 h-10 rounded-full flex items-center justify-center bg-near-black text-white shadow-sm transition-colors"
          }
        >
          <ArrowLeft size={19} />
        </button>

        <div className="flex items-center gap-2">
          <Link href="/search" aria-label="Search" data-testid="pdp-search-btn" className={iconBtn}>
            <Search size={18} />
          </Link>
          <Link href="/cart" aria-label="Cart" data-testid="pdp-cart-btn" className={`${iconBtn} relative`}>
            <ShoppingBag size={18} />
            {mounted && cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
