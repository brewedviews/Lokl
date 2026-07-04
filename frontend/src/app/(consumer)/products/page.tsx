"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import type { ProductCard as ProductCardType } from "@/types";
import { ProductCard } from "@/components/consumer/ProductCard";

interface L1Cat { id: string; name: string; slug: string; image?: string; }

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price: Low–High" },
  { key: "price_desc", label: "Price: High–Low" },
  { key: "discount", label: "Best Discount" },
];

function pageTitle(cat: L1Cat | undefined) {
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
    apiClient
      .get<{ products: ProductCardType[] }>(`/api/products/all?${params.toString()}`)
      .then((r) => setProducts(r.data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [categoryFilter, priceFilter, sortFilter]);

  const setFilter = (key: string, val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set(key, val);
    else params.delete(key);
    router.push(`/products?${params.toString()}`);
  };

  const activeL1 = categories.find((c) => c.id === categoryFilter);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4 pb-24">
      <h1 className="font-display text-lg font-bold text-[#0A1F5C] mb-2">
        {pageTitle(activeL1)}
        {!loading && (
          <span className="text-sm font-normal text-[#9CA3AF] ml-2">
            ({products.length} products)
          </span>
        )}
      </h1>

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
            <ProductCard key={p.id} p={p} size="default" />
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
