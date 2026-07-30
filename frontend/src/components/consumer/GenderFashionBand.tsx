"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { FashionTile } from "@/components/consumer/FashionTile";
import { useCartStore } from "@/stores";
import type { ProductCard as ProductCardType } from "@/types";

const L1_ORDER = ["l1-women", "l1-men", "l1-footwear"] as const;

const L1_META: Record<(typeof L1_ORDER)[number], { label: string; shortLabel: string; slug: string }> = {
  "l1-women":    { label: "Women's",  shortLabel: "Women's",  slug: "women" },
  "l1-men":      { label: "Men's",    shortLabel: "Men's",    slug: "men" },
  "l1-footwear": { label: "Footwear", shortLabel: "Footwear", slug: "footwear" },
};

/**
 * "Find your fit" — Blinkit steal-deals visual language. Prefetches all
 * three L1 rails on mount (not lazy) and lets the shopper flip between
 * them via the filter-tile row. Collapses entirely if no L1 has products.
 */
export function GenderFashionBand() {
  const [productsByL1, setProductsByL1] = useState<Partial<Record<string, ProductCardType[]>>>({});
  const [activeL1, setActiveL1] = useState<string>("");
  const addItem = useCartStore((s) => s.addItem);

  useEffect(() => {
    L1_ORDER.forEach(async (l1Id) => {
      try {
        const r = await apiClient.get<{ products: ProductCardType[] }>(`/api/feed/gender-rail?l1=${l1Id}`);
        const products = r.data?.products ?? [];
        if (products.length > 0) {
          setProductsByL1((prev) => ({ ...prev, [l1Id]: products }));
        }
      } catch {
        // silent — band just omits this L1
      }
    });
  }, []);

  const availableL1s = L1_ORDER.filter((id) => (productsByL1[id]?.length ?? 0) > 0);

  useEffect(() => {
    if (!activeL1 && availableL1s.length > 0) {
      setActiveL1(availableL1s[0]!);
    }
  }, [availableL1s, activeL1]);

  if (availableL1s.length === 0) return null;

  const activeProducts = productsByL1[activeL1] ?? [];

  const handleAddToCart = (product: ProductCardType) => {
    const sizesArr = (product as { sizes?: string[] }).sizes ?? [];
    const r = addItem(product, sizesArr[0] ?? "");
    if (!r.success && r.conflict) {
      toast.error(
        `Your bag already has items from ${r.conflict.existing_store_names.join(" & ")}. Lokl allows up to ${r.conflict.max_stores} stores per order.`,
      );
      return;
    }
    toast.success(`${product.name} added`);
  };

  return (
    <section className="w-full bg-[#EEF1F7] rounded-t-[28px] pt-5 pb-6" data-testid="gender-fashion-band">
      {/* Header — centered eyebrow + title */}
      <div className="text-center mb-4 px-4">
        <p className="text-[10px] font-bold text-[#E68910] uppercase tracking-[0.15em] mb-1">Fashion</p>
        <h2 className="font-display font-bold text-[#0A1F5C] text-xl leading-tight">Find your fit</h2>
      </div>

      {/* Filter tiles row */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 mb-4">
        {availableL1s.map((id) => {
          const meta = L1_META[id];
          const tileImage = productsByL1[id]?.[0]?.image;
          return (
            <button
              key={id}
              type="button"
              data-testid={`fit-filter-${id}`}
              onClick={() => setActiveL1(id)}
              className="flex-shrink-0 flex flex-col items-center gap-1.5"
            >
              <div
                className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all bg-white ${
                  activeL1 === id ? "border-[#0A1F5C]" : "border-transparent"
                }`}
              >
                {tileImage ? (
                  <img src={tileImage} alt={meta.label} className="w-full h-full object-cover object-top" />
                ) : (
                  <div className="w-full h-full bg-[#E5E2DC]" />
                )}
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  activeL1 === id ? "text-[#0A1F5C]" : "text-[#595959]"
                }`}
              >
                {meta.shortLabel}
              </span>
              {activeL1 === id && <div className="w-4 h-0.5 bg-[#0A1F5C] rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Product cards */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 mb-4">
        {activeProducts.map((p) => (
          <FashionTile key={p.id} product={p} onAddToCart={handleAddToCart} />
        ))}
      </div>

      {/* See all pill */}
      <div className="flex justify-center">
        <Link
          href={`/c/${L1_META[activeL1 as (typeof L1_ORDER)[number]]?.slug ?? ""}`}
          className="px-6 py-2 rounded-full border border-[#F59E0B] text-[#F59E0B] text-sm font-semibold hover:bg-[#F59E0B] hover:text-white transition-colors"
        >
          See all
        </Link>
      </div>
    </section>
  );
}
