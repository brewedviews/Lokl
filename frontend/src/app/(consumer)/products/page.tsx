"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import type { ProductCard as ProductCardType } from "@/types";
import { ProductCard } from "@/components/consumer/ProductCard";
import { PlpHeader } from "@/components/consumer/sections/PlpHeader";

interface L1Cat { id: string; name: string; slug: string; image?: string; }

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price: Low–High" },
  { key: "price_desc", label: "Price: High–Low" },
  { key: "discount", label: "Best Discount" },
];

// Matches the exact `price=` values the homepage bentos send and the
// backend's /api/products/all if/elif chain checks — see HomeClient.tsx
// price-bento hrefs and server.py's all_products(). Overlapping "Under X"
// thresholds (redesign Phase A), not mutually-exclusive ranges.
const PRICE_LABELS: Record<string, string> = {
  "under-499": "Under ₹499",
  "under-999": "Under ₹999",
  "under-1499": "Under ₹1,499",
};

// Campaign-link primitive (see backend server.py's _discount_range_query).
// Each pill sets min_discount alone — "the main campaign primitive should
// be min_discount=N" — clearing any max_discount from a prior range link.
const DISCOUNT_THRESHOLDS = [10, 20, 30, 40, 50, 60];

/** Parses a URL query value as an int 0-100, or null for anything else —
 *  a shared campaign link's params are unvalidated user input by the time
 *  they reach here, so a malformed/tampered value degrades to "no filter"
 *  instead of ever being forwarded to the API as garbage. */
function parseDiscountParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

/** "50% OFF & Above" / "30–49% OFF" / "Up to 40% OFF" — the campaign title
 *  a shared discount link should surface, matching the exact copy shape
 *  product/marketing asked for. Null when neither bound is set. */
function discountCampaignLabel(minDiscount: number | null, maxDiscount: number | null): string | null {
  if (minDiscount != null && maxDiscount != null) return `${minDiscount}–${maxDiscount}% OFF`;
  if (minDiscount != null) return `${minDiscount}% OFF & Above`;
  if (maxDiscount != null) return `Up to ${maxDiscount}% OFF`;
  return null;
}

function pageTitle(cat: L1Cat | undefined, search: string, campaignLabel: string | null) {
  if (search) return `Results for "${search}"`;
  if (campaignLabel) return campaignLabel;
  if (cat) return cat.name;
  return "All Products in Bhilai";
}

function ProductsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts] = useState<ProductCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<L1Cat[]>([]);

  const categoryFilter = searchParams.get("l1") || "";
  const priceFilter = searchParams.get("price") || "";
  const sortFilter = searchParams.get("sort") || "newest";
  const searchFilter = searchParams.get("search") || "";
  const minDiscountFilter = parseDiscountParam(searchParams.get("min_discount"));
  const maxDiscountFilter = parseDiscountParam(searchParams.get("max_discount"));

  useEffect(() => {
    apiClient.get("/api/categories").then((r) => {
      const cats: L1Cat[] = r.data?.categories || r.data || [];
      setCategories(cats);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter) params.set("l1", categoryFilter);
    if (priceFilter) params.set("price", priceFilter);
    if (sortFilter && sortFilter !== "newest") params.set("sort", sortFilter);
    if (searchFilter) params.set("search", searchFilter);
    if (minDiscountFilter != null) params.set("min_discount", String(minDiscountFilter));
    if (maxDiscountFilter != null) params.set("max_discount", String(maxDiscountFilter));
    apiClient
      .get<{ products: ProductCardType[] }>(`/api/products/all?${params.toString()}`)
      .then((r) => setProducts(r.data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [categoryFilter, priceFilter, sortFilter, searchFilter, minDiscountFilter, maxDiscountFilter]);

  const setFilter = (key: string, val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set(key, val);
    else params.delete(key);
    router.push(`/products?${params.toString()}`);
  };

  /** Discount pills are single-threshold selectors (min_discount alone) —
   *  picking one always clears any max_discount a prior shared range-link
   *  may have set, so the pill row and the URL never disagree. */
  const setMinDiscountFilter = (threshold: number) => {
    const params = new URLSearchParams(searchParams.toString());
    const isActive = minDiscountFilter === threshold && maxDiscountFilter == null;
    params.delete("max_discount");
    if (isActive) params.delete("min_discount");
    else params.set("min_discount", String(threshold));
    router.push(`/products?${params.toString()}`);
  };

  const clearDiscountFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("min_discount");
    params.delete("max_discount");
    router.push(`/products?${params.toString()}`);
  };

  const campaignLabel = discountCampaignLabel(minDiscountFilter, maxDiscountFilter);
  const activeL1 = categories.find((c) => c.id === categoryFilter);

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      {/* Compact header — same shared bar the L2 PLP uses (G11 §3/§4),
          not a large "All Products in Bhilai" title block. */}
      <PlpHeader title={pageTitle(activeL1, searchFilter, campaignLabel)} count={loading ? undefined : products.length} />

      <div className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 pt-3 pb-8">
      {/* Category pills */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {categories.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-16 h-7 bg-[#E5E2DC] rounded-full animate-pulse" />
          ))
        ) : (
          <>
            <button
              onClick={() => setFilter("l1", "")}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                !categoryFilter
                  ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                  : "bg-white text-[#595959] border-[#E5E2DC]"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setFilter("l1", cat.id)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  categoryFilter === cat.id
                    ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                    : "bg-white text-[#595959] border-[#E5E2DC]"
                }`}
              >
                {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mt-1.5">
        {priceFilter && PRICE_LABELS[priceFilter] && (
          <button
            onClick={() => setFilter("price", "")}
            aria-label={`Remove ${PRICE_LABELS[priceFilter]} filter`}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors bg-[#0A1F5C] text-white border-[#0A1F5C]"
          >
            {PRICE_LABELS[priceFilter]}
            <span aria-hidden="true">✕</span>
          </button>
        )}
        {/* Campaign filter chip — the whole point of a shared
            ?min_discount=50 link: land here with the filter already
            applied AND visibly represented, removable in one tap. */}
        {campaignLabel && (
          <button
            data-testid="discount-campaign-chip"
            onClick={clearDiscountFilter}
            aria-label={`Remove ${campaignLabel} filter`}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors bg-[#E68910] text-white border-[#E68910]"
          >
            {campaignLabel}
            <span aria-hidden="true">✕</span>
          </button>
        )}
        {SORT_OPTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter("sort", s.key)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              sortFilter === s.key
                ? "bg-[#E68910] text-white border-[#E68910]"
                : "bg-white text-[#595959] border-[#E5E2DC]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Discount filter — single-threshold pills, the campaign primitive
          (min_discount=N). Kept as its own row rather than folded into
          sort/price so it stays scannable on a narrow screen. */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
        {DISCOUNT_THRESHOLDS.map((t) => {
          const active = minDiscountFilter === t && maxDiscountFilter == null;
          return (
            <button
              key={t}
              onClick={() => setMinDiscountFilter(t)}
              data-testid={`discount-filter-${t}`}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                active
                  ? "bg-[#E68910] text-white border-[#E68910]"
                  : "bg-white text-[#595959] border-[#E5E2DC]"
              }`}
            >
              {t}% OFF & above
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] bg-[#E5E2DC] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-[#9CA3AF]">
          <p className="text-4xl mb-3">🛍️</p>
          <p className="font-semibold">No products found</p>
          <p className="text-sm mt-1">Try a different filter</p>
        </div>
      ) : (
        <div data-testid="plp-product-grid" className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          {products.map((p) => (
            <ProductCard key={p.id} p={p} size="default" />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsInner />
    </Suspense>
  );
}
