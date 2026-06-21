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
  const [loadingL2, setLoadingL2] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const activeL1 = searchParams.get("l1") || "";
  const activeL2 = searchParams.get("l2") || "";

  // Fetch L1 on mount
  useEffect(() => {
    apiClient.get("/api/categories").then(r => {
      const cats: L1Cat[] = r.data?.categories || r.data || [];
      setL1Cats(cats);
      if (!activeL1 && cats.length > 0) {
        if (cats[0]) router.replace(`/categories?l1=${cats[0].slug}`);
      }
    }).catch(() => {});
  }, []);

  // FIX 1: Fetch L2 using l1Cat.id (e.g. "l1-women"), NOT the slug ("women")
  useEffect(() => {
    if (!activeL1 || l1Cats.length === 0) return;
    const l1Cat = l1Cats.find(c => c.slug === activeL1);
    if (!l1Cat) return;
    setL2Cats([]);
    setLoadingL2(true);
    apiClient.get(`/api/categories/${l1Cat.id}/l2`)
      .then(r => {
        const subs: L2Cat[] = r.data?.subcategories || r.data?.l2 || (Array.isArray(r.data) ? r.data : []);
        setL2Cats(subs);
      })
      .catch(() => setL2Cats([]))
      .finally(() => setLoadingL2(false));
  }, [activeL1, l1Cats]);

  // FIX 2: Product fetch using /api/products?l1={id}&l2={id} — /api/c/ does not exist
  useEffect(() => {
    if (!activeL1 || l1Cats.length === 0) return;
    const l1Cat = l1Cats.find(c => c.slug === activeL1);
    if (!l1Cat) return;
    setLoadingProducts(true);
    const params = new URLSearchParams();
    params.set("l1", l1Cat.id);
    if (activeL2 && l2Cats.length > 0) {
      const l2Cat = l2Cats.find(c => c.slug === activeL2);
      if (l2Cat) params.set("l2", l2Cat.id);
    }
    apiClient.get(`/api/products?${params.toString()}`)
      .then(r => setProducts(Array.isArray(r.data) ? r.data : (r.data?.products || [])))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [activeL1, activeL2, l1Cats, l2Cats]);

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
          {l1Cats.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#E5E2DC] animate-pulse min-w-[56px] h-14" />
            ))
          ) : (
            l1Cats.map(cat => {
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
            })
          )}
        </div>
      </div>

      <div className="flex relative" style={{minHeight: 'calc(100vh - 112px)'}}>

        {/* LEFT — L2 sidebar with skeleton while loading */}
        {(loadingL2 || l2Cats.length > 0) && (
          <div className="w-24 flex-shrink-0 bg-white border-r border-[#E5E2DC] sticky top-[112px] md:top-[120px] self-start overflow-y-auto" style={{maxHeight: 'calc(100vh - 112px)'}}>
            {loadingL2 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-3 py-3.5 border-b border-[#F0EFED]">
                  <div className="h-3 bg-[#E5E2DC] rounded animate-pulse w-14" />
                </div>
              ))
            ) : (
              <>
                <button
                  onClick={() => setL2("")}
                  className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] ${
                    !activeL2 ? "border-l-[3px] border-l-[#E68910] bg-[#FFF8F0]" : "border-l-[3px] border-l-transparent"
                  }`}
                >
                  <span className={`text-[12px] block leading-tight ${
                    !activeL2 ? "font-bold text-[#E68910]" : "font-medium text-[#595959]"
                  }`}>All</span>
                </button>
                {l2Cats.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setL2(sub.slug)}
                    className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] ${
                      activeL2 === sub.slug
                        ? "border-l-[3px] border-l-[#E68910] bg-[#FFF8F0]"
                        : "border-l-[3px] border-l-transparent"
                    }`}
                  >
                    <span className={`text-[12px] block leading-tight ${
                      activeL2 === sub.slug ? "font-bold text-[#E68910]" : "font-medium text-[#595959]"
                    }`}>{sub.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* RIGHT — products */}
        <div className="flex-1 p-2 pb-24">
          <div className="flex items-center gap-1 mb-2 px-1">
            <span className="text-[12px] font-semibold text-[#1A2B4C]">
              {activeL1Cat?.name}{activeL2 ? ` › ${l2Cats.find(c => c.slug === activeL2)?.name}` : ""}
            </span>
            {!loadingProducts && (
              <span className="text-[10px] text-[#9CA3AF]">({products.length})</span>
            )}
          </div>

          {loadingProducts && (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({length: 6}).map((_, i) => (
                <div key={i} className="aspect-[3/4] bg-[#E5E2DC] rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loadingProducts && products.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {products.map(p => <ProductCardV2 key={p.id} p={p} />)}
            </div>
          )}

          {!loadingProducts && products.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">🛍️</p>
              <p className="font-semibold text-[#1A2B4C] text-sm">No products yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">Coming soon</p>
              <Link href="/products" className="mt-3 inline-block px-5 py-2 bg-[#1A2B4C] text-white rounded-full text-sm font-semibold">
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
