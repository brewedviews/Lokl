"use client";

/**
 * Warn-and-clear confirm shown when adding an item conflicts with the store
 * already in the bag (one store per bag). Paired with useStoreConflict so
 * ProductCard and ProductDetailPanel render this identically.
 *
 * P0-1 — rebuilt as a proper bottom sheet, same shell as AddressSheet.tsx /
 * ConsumerHeader.tsx's LocationSheet: portal to document.body, backdrop +
 * sheet at z-[60]/z-[61] (clears StickyBottomNav's z-50), rounded-t-3xl on
 * mobile only (sm:rounded-3xl + centered/width-capped on tablet/desktop),
 * the existing search-sheet-backdrop-in/location-sheet-in animations, and a
 * body-scroll lock while open — replacing the old bare `fixed inset-0
 * items-end md:items-center` div (bulky, no portal, no scroll-lock, could
 * clip behind the bottom nav).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { CartConflict } from "@/types";

interface Props {
  conflict: CartConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StoreConflictDialog({ conflict, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!conflict) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [conflict]);

  if (!conflict) return null;

  return createPortal(
    <>
      <div
        data-testid="store-conflict-backdrop"
        onClick={onCancel}
        className="fixed inset-0 z-[60] bg-[#0A1F5C]/45 search-sheet-backdrop-in"
      />
      <div
        data-testid="store-conflict-dialog"
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-8 sm:w-full sm:max-w-md z-[61] bg-white rounded-t-3xl sm:rounded-3xl shadow-[0_-16px_40px_rgba(10,31,92,0.18)] overflow-hidden location-sheet-in"
      >
        <div className="shrink-0 flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-[#E5E2DC] rounded-full" />
        </div>
        <div className="px-5 pt-2 sm:pt-6 pb-1">
          <h3 className="font-display text-lg sm:text-xl font-bold text-[#0A1F5C]">Start a new bag?</h3>
          <p className="text-sm text-[#595959] mt-2">
            Your bag has items from{" "}
            <span className="font-semibold text-[#0A1F5C]">{conflict.existing_store_name}</span>.
            Start a new bag with{" "}
            <span className="font-semibold text-[#0A1F5C]">{conflict.new_store_name}</span>?
          </p>
        </div>
        <div
          className="flex gap-2 px-5 pt-4"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={onCancel}
            data-testid="conflict-cancel"
            className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC] font-semibold text-[#0A1F5C]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="conflict-clear-add"
            className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold"
          >
            Clear bag &amp; add
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
