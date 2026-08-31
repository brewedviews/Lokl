"use client";

/**
 * PdpCtaRow — the PDP's unified action group: Save (wishlist) + Share on
 * their own row, directly above Buy now / Add to bag (or the qty-stepper
 * it becomes once added). Rendered once, directly below the size selector
 * (an earlier version repeated the CTA below the price block too; user
 * testing called that a duplicate and it was removed — this is the only
 * CTA instance on the page now).
 *
 * Availability SOP — Buy now/Add to bag are UNCONDITIONAL now: no store
 * state (LIVE/Away/Closed/Store Offline) swaps this row out anymore.
 * `isOffline` only controls a small secondary "Notify me" link below the
 * row (see the bottom of this component) — store availability gates
 * checkout, not this action.
 *
 * G11 §13 — previously Save/Share sat in the SAME `flex-wrap` row as
 * Buy now/Add to bag, pushed right via `ml-auto`; on mobile widths they
 * routinely wrapped onto their own line, leaving a stray icon pair
 * floating below the buttons with dead space above it (confirmed via a
 * fresh screenshot, not assumed). Restructured into two explicit rows in
 * ONE shared container (`space-y-2.5`) instead of relying on incidental
 * wrap — same spacing/alignment scale as the purchase-action row below
 * it, so Save/Share reads as part of the same action group, not a
 * detached control. `SaveShareIcons` now renders exactly ONCE (was
 * duplicated 3x across the isOffline/!storeCanOrder/happy-path branches)
 * — the branching only decides what the PURCHASE row shows.
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
 * Add to bag and the qty stepper it becomes are two states of the same
 * action slot (not-added / added) — both render in the same solid
 * brand-orange fill (bg-brand-accent) so the slot's color never changes,
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
import { Button } from "@/components/ui/Button";
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
    <div className="flex items-center gap-2">
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
  productId,
  size,
  colorVariantId,
  product,
  onNotify,
  onBuyNow,
  onAddToBag,
}: {
  isOffline: boolean;
  productId: string;
  size: string;
  /** Selected color variant id (see ColorVariant) — undefined for a plain
   *  product, keeping the cart key/behavior identical to before this
   *  existed. */
  colorVariantId?: string;
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
  const key = cartKeyFor(productId, size, colorVariantId);
  const qty = mounted ? items.find((i) => i.key === key)?.qty ?? 0 : 0;

  // Availability SOP — store availability controls ORDERABILITY, not
  // product discovery. Closed/Away already didn't block this row; Store
  // Offline no longer does either now — Buy now/Add to bag are ALWAYS
  // the purchase row, for every store state. Checkout is the one place
  // that validates real orderability before payment. "Notify Me" (the
  // WhatsApp-when-back-online signup below the CTA row) stays reachable
  // for Store Offline as a secondary link, not by replacing the CTA.
  const purchaseRow = (
    <>
      <button
        onClick={onBuyNow}
        data-testid="buy-now"
        className="inline-flex items-center justify-center px-6 py-2.5 rounded-full border border-ink-navy text-ink-navy text-sm font-bold hover:bg-ink-navy/5 transition whitespace-nowrap"
      >
        Buy now
      </button>

      {qty === 0 ? (
        <Button
          variant="cta"
          onClick={onAddToBag}
          data-testid="add-to-bag"
          className="gap-1.5 text-sm whitespace-nowrap"
        >
          <ShoppingBag size={16} /> Add to bag
        </Button>
      ) : (
        <div
          className="flex items-center gap-3 px-1.5 py-1.5 rounded-full bg-brand-accent text-white"
          data-testid="pdp-qty-stepper"
        >
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => updateQty(productId, size, qty - 1, colorVariantId)}
            data-testid="pdp-qty-dec"
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 transition"
          >
            <Minus size={14} />
          </button>
          <span className="text-sm font-bold w-4 text-center" data-testid="pdp-qty-value">{qty}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => updateQty(productId, size, qty + 1, colorVariantId)}
            data-testid="pdp-qty-inc"
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center active:scale-90 transition"
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </>
  );

  // One shared action group, two rows, same left alignment/spacing scale
  // — Save/Share is never a detached floating control (G11 §13). The
  // purchase row is now unconditional; `isOffline` only adds the small
  // Notify Me link below it.
  return (
    <div className="space-y-2.5" data-testid="pdp-cta-row">
      <SaveShareIcons product={product} />
      <div className="flex items-center gap-3 flex-wrap">{purchaseRow}</div>
      {isOffline && (
        <button
          type="button"
          onClick={onNotify}
          data-testid="notify-me-btn"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-navy underline underline-offset-2"
        >
          <Bell size={12} /> Notify me when this store is back
        </button>
      )}
    </div>
  );
}
