"use client";

/**
 * PdpCtaRow — the PDP's Buy now / Add to bag button row. Rendered TWICE on
 * the page (directly below the price block, and again directly below the
 * size selector) — same component both times, not two separate
 * implementations, so the two instances can never drift out of sync.
 *
 * Neither instance is fixed/sticky — this scrolls away with the rest of
 * the page like everything else on the PDP (see ProductDetailPanel's own
 * doc comment for why the PDP has no fixed bottom chrome at all).
 *
 * Content-sized, not full-width edge-to-edge — matches the Myntra
 * reference's button proportions (generous padding, side by side, room
 * left over in the row) rather than two buttons stretched to fill it.
 */
import { Bell, ShoppingBag } from "lucide-react";

export function PdpCtaRow({
  isOffline,
  storeCanOrder,
  isClosed,
  onNotify,
  onBuyNow,
  onAddToBag,
  testIdSuffix = "",
}: {
  isOffline: boolean;
  storeCanOrder: boolean;
  isClosed: boolean;
  onNotify: () => void;
  onBuyNow: () => void;
  onAddToBag: () => void;
  /** Distinguishes the two instances' data-testids (e.g. "-below-size") so
   *  tests/screenshots can target either one specifically. */
  testIdSuffix?: string;
}) {
  if (isOffline) {
    return (
      <button
        onClick={onNotify}
        data-testid={`notify-me-btn${testIdSuffix}`}
        className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-ink-navy text-white text-sm font-bold whitespace-nowrap"
      >
        <Bell size={15} /> Notify Me
      </button>
    );
  }

  if (!storeCanOrder) {
    return (
      <div
        data-testid={`store-unavailable-btn${testIdSuffix}`}
        className="inline-flex items-center px-6 py-2.5 rounded-full bg-[#F4F1E9] text-[#94A3B8] text-sm font-bold"
      >
        Store Unavailable
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3" data-testid={`pdp-cta-row${testIdSuffix}`}>
      <button
        onClick={onBuyNow}
        data-testid={`buy-now${testIdSuffix}`}
        className="inline-flex items-center justify-center px-6 py-2.5 rounded-full border border-ink-navy text-ink-navy text-sm font-bold hover:bg-ink-navy/5 transition whitespace-nowrap"
      >
        Buy now
      </button>
      <button
        onClick={onAddToBag}
        data-testid={`add-to-bag${testIdSuffix}`}
        className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full bg-near-black text-white text-sm font-bold hover:bg-near-black/90 transition whitespace-nowrap"
      >
        <ShoppingBag size={16} /> {isClosed ? "Pre-order" : "Add to bag"}
      </button>
    </div>
  );
}
