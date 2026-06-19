"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import type { ProductCard } from "@/types";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";

const PRICE_FILTERS = [
  { key: "", label: "All" },
  { key: "under-499", label: "Under ₹499" },
  { key: "499-1099", label: "₹499 – ₹1,099" },
  { key: "above-1099", label: "Above ₹1,099" },
];

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price: Low–High" },
  { key: "price_desc", label: "Price: High–Low" },
  { key: "discount", label: "Best Discount" },
];

function pageTitle(price: string) {
  if (price === "under-499") return "Under ₹499";
  if (price === "499-1099") return "₹499 – ₹1,099";
  if (price === "above-1099") return "Premium Picks";
  return "All Products in Bhilai";
}

function ProductsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [loading, setLoading] = useState(true);
  const priceFilter = searchParams.get("price") || "";
  const sortFilter = searchParams.get("sort") || "newest";

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (priceFilter) params.set("price", priceFilter);
    if (sortFilter && sortFilter !== "newest") params.set("sort", sortFilter);
    apiClient
      .get<{ products: ProductCard[] }>(`/api/products/all?${params.toString()}`)
      .then((r) => setProducts(r.data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [priceFilter, sortFilter]);

  const setFilter = (key: string, val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set(key, val);
    else params.delete(key);
    router.push(`/products?${params.toString()}`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4 pb-24">
      <h1 className="font-display text-lg font-bold text-[#1A2B4C] mb-2">
        {pageTitle(priceFilter)}
        {!loading && (
          <span className="text-sm font-normal text-[#9CA3AF] ml-2">
            ({products.length} products)
          </span>
        )}
      </h1>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {PRICE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter("price", f.key)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              priceFilter === f.key
                ? "bg-[#1A2B4C] text-white border-[#1A2B4C]"
                : "bg-white text-[#595959] border-[#E5E2DC]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mt-1.5">
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

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {products.map((p) => (
            <ProductCardV2 key={p.id} p={p} />
          ))}
        </div>
      )}
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
