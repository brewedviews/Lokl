"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { ProductCard } from "@/components/consumer/ProductCard";
import { CTA_LINK_CLASSNAME } from "@/components/ui/Button";

interface L1Cat { id: string; name: string; slug: string; image?: string; }
interface L2Cat { id: string; name: string; slug: string; }

function CategoriesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [l1Cats, setL1Cats] = useState<L1Cat[]>([]);
  const [l2Cats, setL2Cats] = useState<L2Cat[]>([]);
  const [loadingL2, setLoadingL2] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  // Starts true (not false): the bottom-nav "Categories" tab links to the
  // bare /categories (no ?l1=), so on first paint l1Cats/activeL1 are both
  // still empty and the products-fetch effect below hasn't run yet. With a
  // `false` default the empty-state branch below ("No products yet /
  // Coming soon") reads as confirmed-empty from the very first render,
  // before any fetch even started — same class of bug as CategoryClient's
  // isLoading, fixed the same way: default to the loading state, only flip
  // it once a real fetch has actually resolved.
  const [loadingProducts, setLoadingProducts] = useState(true);

  // No ?l1= in the URL -> fall back to the first category once it's
  // loaded. This used to be a router.replace("/categories?l1=" + slug)
  // inside the effect below, which meant a bare /categories load rendered
  // once with nothing, THEN client-navigated to the resolved default —
  // a second render/URL cycle plus the empty-state flash above. Resolving
  // the default inline here instead means the bare URL renders the right
  // category's content directly, in the same render l1Cats arrives in —
  // no redirect, no second load. The default itself is NOT hardcoded to
  // "women" — it's genuinely whichever category the backend returns first
  // (GET /api/categories, sorted by its admin-configurable `order` field),
  // exactly matching what the old redirect used to resolve to.
  const activeL1 = searchParams.get("l1") || l1Cats[0]?.slug || "";
  const activeL2 = searchParams.get("l2") || "";

  // Fetch L1 on mount
  useEffect(() => {
    apiClient.get("/api/categories").then(r => {
      const cats: L1Cat[] = r.data?.categories || r.data || [];
      setL1Cats(cats);
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
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">

      {/* L1 SELECTOR — three wide, intentional tiles now that Women/Men/Kids
          are the only active L1s (down from 9: Ethnic/Footwear/Lingerie/
          Accessories/Beauty/Sports are deactivated, not deleted — see
          migration 031_consolidate_l1_categories). A horizontal-scroll
          strip of 56px icon-tabs made sense at 9 categories; at 3 it just
          left most of the row empty, so this is a real grid of full-width,
          image-led tiles — the primary entry point into shopping, not a
          nav afterthought. */}
      <div className="sticky top-[56px] md:top-[64px] z-30 bg-white border-b border-[#E5E2DC] px-3 py-2.5">
        {l1Cats.length === 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-[#E5E2DC] animate-pulse h-16 md:h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {l1Cats.map(cat => {
              const isActive = activeL1 === cat.slug;
              return (
                <button
                  key={cat.id}
                  onClick={() => setL1(cat.slug)}
                  data-testid={`categories-l1-tile-${cat.slug}`}
                  className={`relative flex items-center gap-2.5 md:gap-3 rounded-xl overflow-hidden transition-all h-16 md:h-20 px-3 md:px-4 ${
                    isActive ? "bg-[#0A1F5C]" : "bg-[#FDFBF7] border border-[#E5E2DC] hover:border-[#0A1F5C]/40"
                  }`}
                >
                  {cat.image && (
                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-lg overflow-hidden bg-[#E5E2DC] shrink-0">
                      <img src={cat.image} alt={cat.name} className="w-full h-full object-cover object-top" />
                    </div>
                  )}
                  <span className={`text-sm md:text-base font-bold leading-tight text-left ${isActive ? "text-white" : "text-[#0A1F5C]"}`}>
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Split-pane: L2 nav stays visible, only the product listing scrolls.
          `position: sticky` was tried here first but this site sets
          `overflow-x: hidden` on <html>/<body> (globals.css, deliberate —
          clips horizontal touch-pan overflow at the document root), which
          breaks EVERY sticky element's containing-block on every page
          (confirmed: the global header's own `sticky top-0` scrolls away
          identically) — not something to fix inside one page. A local
          fixed-height split pane sidesteps it entirely: this section
          claims exactly the remaining viewport height once, the sidebar is
          a plain flex child (no sticky needed — it never had anywhere to
          scroll TO), and only the products column scrolls internally. That
          also satisfies "stop at the bottom of its own section" for free —
          there's no site footer below this page (confirmed) for it to
          float over.
          Mobile keeps the exact same two-column pattern (no bottom-nav tab
          bar competes for this space; StickyBottomNav's own reserved
          bottom-nav-safe padding lives on the page overall, so bottom nav
          height is subtracted here too). */}
      {/* `flex-1`/`min-h-0` deliberately NOT used here — this div sits
          inside a `flex-col` parent, where `flex-1` sets `flex-basis: 0%`
          and grows to fit CONTENT, silently overriding the explicit height
          below (confirmed: computed height came out as the full 16000px+
          content height, not the intended ~700-800px viewport slice, which
          is exactly why nothing had room to be "independently scrollable"
          in the first place). A plain, non-flex-grown fixed height is what
          actually caps this section. */}
      <div className="flex h-[calc(100vh-112px-96px)] md:h-[calc(100vh-120px)]">

        {/* LEFT — L2 nav, own independent scroll if it overflows */}
        {(loadingL2 || l2Cats.length > 0) && (
          <div className="w-24 flex-shrink-0 bg-white border-r border-[#E5E2DC] h-full overflow-y-auto">
            {loadingL2 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-3 py-3.5 border-b border-[#F0EFED]">
                  <div className="h-3 bg-[#E5E2DC] rounded animate-pulse w-14" />
                </div>
              ))
            ) : (
              <>
                {/* Selected-state wash — was bg-[#FFF8F0] (an untokenized,
                    off-spec near-white), now the actual orange-200 tint
                    token (redesign-plan 2.4: "for background washes behind
                    badges/selected chips" — exactly this case). Visibly a
                    touch more saturated than the old ad hoc value; that's
                    the intended, consistent tint, not a regression. */}
                <button
                  onClick={() => setL2("")}
                  className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] ${
                    !activeL2 ? "border-l-[3px] border-l-brand-accent bg-orange-200" : "border-l-[3px] border-l-transparent"
                  }`}
                >
                  <span className={`text-[12px] block leading-tight ${
                    !activeL2 ? "font-bold text-brand-accent" : "font-medium text-[#595959]"
                  }`}>All</span>
                </button>
                {l2Cats.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setL2(sub.slug)}
                    className={`w-full text-left px-3 py-3.5 border-b border-[#F0EFED] ${
                      activeL2 === sub.slug
                        ? "border-l-[3px] border-l-brand-accent bg-orange-200"
                        : "border-l-[3px] border-l-transparent"
                    }`}
                  >
                    <span className={`text-[12px] block leading-tight ${
                      activeL2 === sub.slug ? "font-bold text-brand-accent" : "font-medium text-[#595959]"
                    }`}>{sub.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* RIGHT — products, the only scrollable column in this section */}
        <div className="flex-1 h-full overflow-y-auto p-2">
          <div className="flex items-center gap-1 mb-2 px-1">
            <span className="text-[12px] font-semibold text-[#0A1F5C]">
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
              {products.map(p => <ProductCard key={p.id} p={p} size="compact" />)}
            </div>
          )}

          {!loadingProducts && products.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">🛍️</p>
              <p className="font-semibold text-[#0A1F5C] text-sm">No products yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">Coming soon</p>
              <Link href="/products" className={`mt-3 ${CTA_LINK_CLASSNAME}`}>
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
