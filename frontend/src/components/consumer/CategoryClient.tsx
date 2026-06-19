"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { Footer } from "@/components/consumer/Footer";
import type { ProductCard, CategoryNode } from "@/types";

type L2 = { id: string; name: string; slug: string; image?: string };
type Cat = Omit<CategoryNode, "l2"> & { l2?: L2[] };

type SortKey = "nearest" | "price_asc" | "price_desc";

function genderFromL1Slug(slug: string | undefined): string {
  switch (slug) {
    case "women": return "women";
    case "men": return "men";
    case "kids": return "kids";
    default: return "";
  }
}

function sortProducts(products: ProductCard[], sort: SortKey): ProductCard[] {
  const copy = [...products];
  if (sort === "price_asc") return copy.sort((a, b) => a.price - b.price);
  if (sort === "price_desc") return copy.sort((a, b) => b.price - a.price);
  return copy.sort((a, b) => {
    const aRank = a.store_availability_rank ?? 1;
    const bRank = b.store_availability_rank ?? 1;
    if (aRank !== bRank) return aRank - bRank;
    const aDist = a.store_distance_km ?? 999;
    const bDist = b.store_distance_km ?? 999;
    return aDist - bDist;
  });
}

function SkeletonGrid() {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden bg-white border border-[#E5E2DC] animate-pulse">
          <div className="aspect-[3/4] bg-[#E5E2DC]" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-[#E5E2DC] rounded w-2/3" />
            <div className="h-3 bg-[#E5E2DC] rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CategoryClient() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [cats, setCats] = useState<Cat[]>([]);
  const [subcategories, setSubcategories] = useState<L2[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("nearest");
  const [l2Filter, setL2Filter] = useState(""); // slug
  const [gender, setGender] = useState(genderFromL1Slug(slug));

  const l1 = useMemo(() => cats.find((c) => c.slug === slug), [cats, slug]);
  const isFootwear = slug === "footwear";

  useEffect(() => { setGender(genderFromL1Slug(slug)); setL2Filter(""); }, [slug]);

  useEffect(() => {
    api.catalog.categories().then((r) => setCats(r as Cat[])).catch(() => {});
  }, []);

  // Fetch L2 subcategories for this L1 — backend returns array directly from /l2
  useEffect(() => {
    if (!l1) return;
    apiClient.get(`/api/categories/${l1.id}/l2`)
      .then(r => {
        const subs = Array.isArray(r.data) ? r.data : (r.data?.subcategories || []);
        setSubcategories(subs.length > 0 ? subs : (l1.l2 ?? []));
      })
      .catch(() => setSubcategories(l1.l2 ?? []));
  }, [l1?.id]);

  // l2FilterId — converts slug to DB id for the products API
  const l2FilterId = useMemo(() => {
    if (!l2Filter) return "";
    const sub = subcategories.find(s => s.slug === l2Filter) ?? (l1?.l2 ?? []).find(s => s.slug === l2Filter);
    return sub?.id ?? "";
  }, [l2Filter, subcategories, l1]);

  useEffect(() => {
    if (!l1) return;
    setIsLoading(true);
    const p = new URLSearchParams({ l1: l1.id });
    if (l2FilterId) p.set("l2", l2FilterId);
    if (gender) p.set("gender", gender);
    if (sort === "price_asc") p.set("sort", "price_asc");
    if (sort === "price_desc") p.set("sort", "price_desc");
    apiClient
      .get<ProductCard[]>(`/api/products?${p.toString()}`)
      .then((r) => { setAllProducts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => setAllProducts([]))
      .finally(() => setIsLoading(false));
  }, [l1, l2FilterId, gender, sort]);

  const products = useMemo(() => sortProducts(allProducts, sort), [allProducts, sort]);

  if (!l1) return <div className="p-10 text-center text-[#595959]">Loading…</div>;

  const l2List = subcategories.length > 0 ? subcategories : (l1.l2 ?? []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
          {/* Header */}
          <h1 data-testid="cat-title" className="font-display text-lg font-bold text-[#1A2B4C]">
            {l1.name}
            {!isLoading && (
              <span className="text-sm font-normal text-[#595959] ml-2">({products.length})</span>
            )}
          </h1>

          {/* ROW 1 — Sort options */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mt-3">
            {([
              { key: "nearest", label: "Nearest" },
              { key: "price_asc", label: "Price: Low–High" },
              { key: "price_desc", label: "Price: High–Low" },
            ] as Array<{ key: SortKey; label: string }>).map(opt => (
              <button key={opt.key}
                onClick={() => setSort(opt.key)}
                data-testid={`sort-${opt.key}`}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                  sort === opt.key
                    ? "bg-[#1A2B4C] text-white border-[#1A2B4C]"
                    : "bg-white text-[#595959] border-[#E5E2DC]"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* ROW 2 — L2 subcategory filters or gender for footwear */}
          {(isFootwear || l2List.length > 0) && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mt-2">
              {isFootwear ? (
                ([["", "All"], ["women", "Women"], ["men", "Men"]] as const).map(([g, label]) => (
                  <button key={g || "all"}
                    onClick={() => setGender(g)}
                    data-testid={`gender-${g || "all"}`}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                      gender === g
                        ? "bg-[#E68910] text-white border-[#E68910]"
                        : "bg-white text-[#595959] border-[#E5E2DC]"
                    }`}>
                    {label}
                  </button>
                ))
              ) : (
                <>
                  <button
                    onClick={() => setL2Filter("")}
                    data-testid="l2-filter-all"
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                      !l2Filter ? "bg-[#E68910] text-white border-[#E68910]" : "bg-white text-[#595959] border-[#E5E2DC]"
                    }`}>
                    All
                  </button>
                  {l2List.map(sub => (
                    <button key={sub.id}
                      onClick={() => setL2Filter(l2Filter === sub.slug ? "" : sub.slug)}
                      data-testid={`l2-filter-${sub.slug}`}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                        l2Filter === sub.slug
                          ? "bg-[#E68910] text-white border-[#E68910]"
                          : "bg-white text-[#595959] border-[#E5E2DC]"
                      }`}>
                      {sub.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Products */}
          {isLoading ? (
            <SkeletonGrid />
          ) : products.length === 0 ? (
            <div className="mt-6 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <h3 className="font-display text-xl md:text-2xl font-bold text-[#1A2B4C]">Coming soon to {l1.name} in Bhilai</h3>
              <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We&apos;re onboarding local sellers right now — fresh drops will land here shortly.</p>
            </div>
          ) : (
            <div data-testid="cat-product-grid" className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {products.map((p) => <ProductCardV2 key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
