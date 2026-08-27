"use client";

/**
 * StoreCatalogueSection — G21 P1-10. The Store page's "Full product
 * catalogue" module, with an optional compact text-led category filter
 * ("All / Running / Casual / Formal / Sandals") ahead of it — not a giant
 * tile grid, just a row of pill buttons, since the task explicitly calls
 * for text-led nav here, not more cards. `chips` is computed server-side
 * from this store's own already-fetched product list (real L2 categories
 * actually present, by count) — no new backend endpoint. Client component
 * only because the chip filter needs interactive state; the product list
 * itself is a prop, not a re-fetch.
 */
import { useMemo, useState } from "react";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType } from "@/types";

export interface StoreCategoryChip { id: string; label: string }

export function StoreCatalogueSection({
  products, storeName, chips, heading,
}: {
  products: ProductCardType[];
  storeName: string;
  chips: StoreCategoryChip[];
  heading: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  const filtered = useMemo(
    () => active ? products.filter((p) => p.l2_id === active) : products,
    [products, active],
  );

  return (
    <div data-testid="store-catalogue">
      <div className="flex items-center justify-between mb-3 sm:mb-6">
        <h2 className="font-display text-xl sm:text-2xl font-medium text-[#0A1F5C]">{heading}</h2>
        <span className="text-xs text-[#94A3B8]">{filtered.length} {filtered.length === 1 ? "item" : "items"}</span>
      </div>

      {chips.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 -mt-1">
          <button
            type="button"
            onClick={() => setActive(null)}
            data-testid="store-category-chip-all"
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition ${
              active === null ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#0A1F5C] border-[#E5E2DC]"
            }`}
          >
            All
          </button>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              data-testid={`store-category-chip-${c.id}`}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition ${
                active === c.id ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#0A1F5C] border-[#E5E2DC]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-[#595959] py-8 text-center">No products in this category right now.</p>
      ) : (
        // Store-page redesign — same dense `size="compact"` grid the
        // Categories browse page already uses (grid-cols-2/gap-2), not
        // the larger PDP-ish `size="default"` card this used to render:
        // this is the store's shelf, meant to be scanned quickly, not a
        // page of mini product-detail pages.
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} p={{ ...p, store_name: storeName }} size="compact" />
          ))}
        </div>
      )}
    </div>
  );
}
