"use client";

/**
 * PdpCtaRow — the PDP's Buy now / Add to bag button row, plus the
 * icon-only Save (wishlist) / Share pair. Rendered once, directly below
 * the size selector (an earlier version repeated the CTA below the price
 * block too; user testing called that a duplicate and it was removed —
 * this is the only CTA instance on the page now). Save/Share used to live
 * as a labeled text+icon row above the store name, up near the gallery —
 * moved here, icon-only, so they sit beside the action they're most
 * related to instead of competing with the store-name row for space.
 *
 * Not fixed/sticky — this scrolls away with the rest of the page like
 * everything else on the PDP (see ProductDetailPanel's own doc comment for
 * why the PDP has no fixed CTA bar; StickyBottomNav is the only persistent
 * chrome here).
 *
 * Content-sized, not full-width edge-to-edge — matches the Myntra
 * reference's button proportions (generous padding, side by side, room
 * left over in the row) rather than two buttons stretched to fill it.
 *
 * Notify Me, Add to bag, and the qty stepper it becomes are all states of
 * the very same action slot (unavailable / available-not-added /
 * available-added) — all three render in the same solid brand-orange fill
 * (bg-brand-accent) so the slot's color never changes as its state does,
 * only its label/icon/behavior. Buy now stays the outline style
 * (border-ink-navy, no fill) throughout — it's a separate, secondary
 * action, not a state of this slot.
 *
 * Add to bag reads LIVE cart state for this exact product+size (via
 * cartKeyFor, the same key useCartStore.addItem uses internally — see its
 * own comment) rather than tracking its own local "was it added" flag.
 * Once qty > 0, the button transforms in place into a −/qty/+ stepper;
 * decrementing to 0 removes the line and the button reverts. This reuses
 * useCartStore directly for +/- (no conflict possible when adjusting an
 * item already in the bag — the store-conflict dialog only fires on a
 * genuinely NEW store's first item, which is why the initial add still
 * goes through the parent's onAddToBag handler instead of calling
 * addItem here directly).
 */
import { useEffect, useState } from "react";
import { Bell, Heart, Minus, Plus, Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useWishlistStore, cartKeyFor } from "@/stores";
import { useMounted } from "@/hooks/useMounted";
import type { Product } from "@/types";

function SaveShareIcons({ product }: { product: Product }) {
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);

  const handleWishlist = () => {
    const next = toggleWishlist(product);
    const justAdded = next.some((x) => x.id === product.id);
    setWished(justAdded);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
        return;
      }
    } catch {
      return; // user cancelled the native share sheet — not an error
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <div className="flex items-center gap-2 ml-auto">
      <button
        type="button"
        aria-label="Wishlist"
        aria-pressed={wished}
        data-testid="wishlist-btn"
        onClick={handleWishlist}
        className="w-10 h-10 rounded-full border border-ink-navy/15 flex items-center justify-center active:scale-95 transition shrink-0"
      >
        <Heart size={17} className={wished ? "text-brand-accent" : "text-ink-navy"} fill={wished ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label="Share"
        data-testid="share-btn"
        onClick={() => void handleShare()}
        className="w-10 h-10 rounded-full border border-ink-navy/15 flex items-center justify-center active:scale-95 transition shrink-0"
      >
        <Share2 size={16} className="text-ink-navy" />
      </button>
    </div>
  );
}

export function PdpCtaRow({
  isOffline,
  storeCanOrder,
  isClosed,
  productId,
  size,
  product,
  onNotify,
  onBuyNow,
  onAddToBag,
}: {
  isOffline: boolean;
  storeCanOrder: boolean;
  isClosed: boolean;
  productId: string;
  size: string;
  product: Product;
  onNotify: () => void;
  onBuyNow: () => void;
  onAddToBag: () => void;
}) {
  // Gated on mounted (not the cart store's own _hasHydrated) — same
  // pattern ProductCard already uses for its own cart-aware button, so an
  // SSR'd/first-paint render never briefly claims qty=0 based on an
  // as-yet-unhydrated empty items array.
  const mounted = useMounted();
  const items = useCartStore((s) => s.items);
  const updateQty = useCartStore((s) => s.updateQty);
  const key = cartKeyFor(productId, size);
  const qty = mounted ? items.find((i) => i.key === key)?.qty ?? 0 : 0;

  if (isOffline) {
    return (
      <div className="flex items-center gap-3" data-testid="pdp-cta-row">
        <button
          onClick={onNotify}
          data-testid="notify-me-btn"
          className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-brand-accent text-white text-sm font-bold whitespace-nowrap"
        >
          <Bell size={15} /> Notify Me
        </button>
        <SaveShareIcons product={product} />
      </div>
    );
  }

  if (!storeCanOrder) {
    return (
      <div className="flex items-center gap-3" data-testid="pdp-cta-row">
        <div
          data-testid="store-unavailable-btn"
          className="inline-flex items-center px-6 py-2.5 rounded-full bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold"
        >
          Store Unavailable
        </div>
        <SaveShareIcons product={product} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="pdp-cta-row">
      <button
        onClick={onBuyNow}
        data-testid="buy-now"
        className="inline-flex items-center justify-center px-6 py-2.5 rounded-full border border-ink-navy text-ink-navy text-sm font-bold hover:bg-ink-navy/5 transition whitespace-nowrap"
      >
        Buy now
      </button>

      {qty === 0 ? (
        <button
          onClick={onAddToBag}
          data-testid="add-to-bag"
          className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-brand-accent text-white text-sm font-bold hover:bg-brand-accent/90 transition whitespace-nowrap"
        >
          <ShoppingBag size={16} /> {isClosed ? "Pre-order" : "Add to bag"}
        </button>
      ) : (
        <div
          className="flex items-center gap-3 px-1.5 py-1.5 rounded-full bg-brand-accent text-white"
          data-testid="pdp-qty-stepper"
        >
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => updateQty(productId, size, qty - 1)}
            data-testid="pdp-qty-dec"
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 transition"
          >
            <Minus size={14} />
          </button>
          <span className="text-sm font-bold w-4 text-center" data-testid="pdp-qty-value">{qty}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => updateQty(productId, size, qty + 1)}
            data-testid="pdp-qty-inc"
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 transition"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      <SaveShareIcons product={product} />
    </div>
  );
}
