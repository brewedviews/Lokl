"use client";

/**
 * PdpCtaRow — the PDP's Buy now / Add to bag button row. Rendered once,
 * directly below the size selector (an earlier version repeated this below
 * the price block too; user testing called that a duplicate and it was
 * removed — this is the only CTA instance on the page now).
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
 * Notify Me and Add to bag are mutually exclusive states of the same
 * action slot (unavailable vs. available) — both render in the same
 * solid near-black (#16130F) fill via bg-near-black, so the button's color
 * never changes with availability state, only its label/icon/behavior.
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
import { Bell, Minus, Plus, ShoppingBag } from "lucide-react";
import { useCartStore, cartKeyFor } from "@/stores";
import { useMounted } from "@/hooks/useMounted";

export function PdpCtaRow({
  isOffline,
  storeCanOrder,
  isClosed,
  productId,
  size,
  onNotify,
  onBuyNow,
  onAddToBag,
}: {
  isOffline: boolean;
  storeCanOrder: boolean;
  isClosed: boolean;
  productId: string;
  size: string;
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
      <button
        onClick={onNotify}
        data-testid="notify-me-btn"
        className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-near-black text-white text-sm font-bold whitespace-nowrap"
      >
        <Bell size={15} /> Notify Me
      </button>
    );
  }

  if (!storeCanOrder) {
    return (
      <div
        data-testid="store-unavailable-btn"
        className="inline-flex items-center px-6 py-2.5 rounded-full bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold"
      >
        Store Unavailable
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3" data-testid="pdp-cta-row">
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
          className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-near-black text-white text-sm font-bold hover:bg-near-black/90 transition whitespace-nowrap"
        >
          <ShoppingBag size={16} /> {isClosed ? "Pre-order" : "Add to bag"}
        </button>
      ) : (
        <div
          className="flex items-center gap-3 px-1.5 py-1.5 rounded-full bg-near-black text-white"
          data-testid="pdp-qty-stepper"
        >
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => updateQty(productId, size, qty - 1)}
            data-testid="pdp-qty-dec"
            className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center active:scale-90 transition"
          >
            <Minus size={14} />
          </button>
          <span className="text-sm font-bold w-4 text-center" data-testid="pdp-qty-value">{qty}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => updateQty(productId, size, qty + 1)}
            data-testid="pdp-qty-inc"
            className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center active:scale-90 transition"
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
