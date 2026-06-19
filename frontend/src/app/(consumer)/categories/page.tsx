"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";

interface L1Cat { id: string; name: string; slug: string; image?: string; }
interface L2Cat { id: string; name: string; slug: string; }

function CategoriesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [l1Cats, setL1Cats] = useState<L1Cat[]>([]);
  const [l2Cats, setL2Cats] = useState<L2Cat[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const activeL1 = searchParams.get("l1") || "";
  const activeL2 = searchParams.get("l2") || "";

  // Fetch L1 on mount
  useEffect(() => {
    apiClient.get("/api/categories").then(r => {
      const cats = r.data?.categories || r.data || [];
      setL1Cats(cats);
      if (!activeL1 && cats.length > 0) {
        router.replace(`/categories?l1=${cats[0].slug}`);
      }
    }).catch(() => {});
  }, []);

  // Fetch L2 when L1 changes
  useEffect(() => {
    if (!activeL1) return;
    setL2Cats([]);
    apiClient.get(`/api/categories/${activeL1}/subcategories`)
      .then(r => setL2Cats(r.data?.subcategories || []))
      .catch(() => setL2Cats([]));
  }, [activeL1]);

  // Fetch products when L1 or L2 changes
  useEffect(() => {
    if (!activeL1) return;
    setLoadingProducts(true);
    const url = activeL2
      ? `/api/c/${activeL1}/${activeL2}/products`
      : `/api/c/${activeL1}/products`;
    apiClient.get(url)
      .then(r => setProducts(r.data?.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [activeL1, activeL2]);

  const setL1 = (slug: string) => router.push(`/categories?l1=${slug}`);
  const setL2 = (slug: string) => {
    const p = new URLSearchParams();
    p.set("l1", activeL1);
    if (slug) p.set("l2", slug);
    router.push(`/categories?${p.toString()}`);
  };

  const activeL1Cat = l1Cats.find(c => c.slug === activeL1);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">

      {/* L1 TOP TABS — horizontal scroll with images */}
      <div className="sticky top-[56px] md:top-[64px] z-30 bg-white border-b border-[#E5E2DC]">
        <div className="flex overflow-x-auto no-scrollbar px-3 gap-2 py-2">
          {l1Cats.map(cat => {
            const isActive = activeL1 === cat.slug;
            return (
              <button
                key={cat.id}
                onClick={() => setL1(cat.slug)}
                className={`flex-shrink-0 flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all min-w-[56px] ${
                  isActive
                    ? "bg-[#1A2B4C]"
                    : "bg-[#FDFBF7] border border-[#E5E2DC]"
                }`}
              >
                {cat.image && (
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#E5E2DC]">
                    <img src={cat.image} alt={cat.name}
                      className="w-full h-full object-cover object-top" />
                  </div>
                )}
                <span className={`text-[10px] font-bold whitespace-nowrap leading-tight ${
                  isActive ? "text-white" : "text-[#1A2B4C]"
                }`}>
                  {cat.name.replace("Lingerie & Innerwear", "Lingerie").replace("Ethnic Wear", "Ethnic")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN BODY — L2 sidebar + product grid */}
      <div className="flex max-w-7xl mx-auto">

        {/* LEFT — L2 vertical list */}
        {l2Cats.length > 0 && (
          <div className="w-28 flex-shrink-0 bg-white border-r border-[#E5E2DC]">
            {/* All option */}
            <button
              onClick={() => setL2("")}
              className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] transition-all ${
                !activeL2
                  ? "border-l-[3px] border-l-[#1A2B4C] bg-[#FDFBF7]"
                  : "border-l-[3px] border-l-transparent"
              }`}
            >
              <span className={`text-[12px] leading-tight ${
                !activeL2 ? "font-bold text-[#1A2B4C]" : "font-medium text-[#595959]"
              }`}>All</span>
            </button>

            {l2Cats.map(sub => (
              <button
                key={sub.id}
                onClick={() => setL2(sub.slug)}
                className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] transition-all ${
                  activeL2 === sub.slug
                    ? "border-l-[3px] border-l-[#E68910] bg-[#FFF8F0]"
                    : "border-l-[3px] border-l-transparent"
                }`}
              >
                <span className={`text-[12px] leading-tight block ${
                  activeL2 === sub.slug
                    ? "font-bold text-[#E68910]"
                    : "font-medium text-[#595959]"
                }`}>
                  {sub.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* RIGHT — Product grid */}
        <div className="flex-1 p-3 pb-24">
          {/* Header */}
          <div className="mb-3">
            <span className="text-[13px] font-semibold text-[#1A2B4C]">
              {activeL1Cat?.name}{activeL2 ? ` › ${l2Cats.find(c=>c.slug===activeL2)?.name}` : ""}
            </span>
            {!loadingProducts && (
              <span className="text-[11px] text-[#9CA3AF] ml-2">({products.length})</span>
            )}
          </div>

          {/* Skeleton */}
          {loadingProducts && (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({length: 6}).map((_,i) => (
                <div key={i} className="aspect-[3/4] bg-[#E5E2DC] rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {/* Products */}
          {!loadingProducts && products.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {products.map(p => <ProductCardV2 key={p.id} p={p} />)}
            </div>
          )}

          {/* Empty */}
          {!loadingProducts && products.length === 0 && (
            <div className="text-center py-16">
              <p className="text-3xl mb-2">🛍️</p>
              <p className="font-semibold text-[#1A2B4C] text-sm">No products yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">Products coming soon</p>
              <Link href="/products"
                className="mt-4 inline-block px-5 py-2 bg-[#1A2B4C] text-white rounded-full text-sm font-semibold">
                Browse all →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FDFBF7]" />}>
      <CategoriesInner />
    </Suspense>
  );
}
