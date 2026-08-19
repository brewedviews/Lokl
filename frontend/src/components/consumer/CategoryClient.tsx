"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { ProductCard } from "@/components/consumer/ProductCard";
import { SellerCard } from "@/components/consumer/SellerCard";
import { HeroCarousel } from "@/components/consumer/HeroCarousel";
import { getL1HeroSlides } from "@/components/consumer/l1HeroConfig";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import type { ProductCard as ProductCardType, CategoryNode } from "@/types";

type L2 = { id: string; name: string; slug: string; image?: string };
type Cat = Omit<CategoryNode, "l2"> & { l2?: L2[] };

// GET /api/categories/{l1_id}/stores' response shape — see that endpoint's
// own doc comment in backend/server.py. A store doc's normal display
// fields plus the same availability/product-count fields
// GET /feed/popular-stores already stamps on, so SellerCard's
// openNow/closedLabel derivation (below) works identically either way.
interface CategoryStore {
  id: string; slug?: string; name: string;
  logo?: string; banner?: string; banners?: string[];
  area_label?: string; locality?: string; tagline?: string;
  product_count: number; availability_rank: number; next_open_label?: string;
}

type SortKey = "nearest" | "price_asc" | "price_desc";

function sortProducts(products: ProductCardType[], sort: SortKey): ProductCardType[] {
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

// Product-rail skeleton — same card slot width HCarousel's own children
// wrapper uses (w-[38vw] sm:w-[180px] md:w-[200px]) so the placeholder
// cards don't jump in size once real ProductCards replace them.
function RailSkeleton({ title }: { title: string }) {
  return (
    <section className="pt-8">
      <div className="max-w-7xl mx-auto px-4 md:px-8 mb-3">
        <div className="h-6 w-40 bg-[#E5E2DC] rounded animate-pulse" />
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 md:px-8 max-w-7xl mx-auto" aria-label={title}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[38vw] sm:w-[180px] md:w-[200px] aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
        ))}
      </div>
    </section>
  );
}

// Store-rail skeleton — same card slot SellerCard itself uses
// (w-32 sm:w-36 aspect-[3/4]).
function StoreRailSkeleton() {
  return (
    <section className="pt-8">
      <div className="max-w-7xl mx-auto px-4 md:px-8 mb-3">
        <div className="h-6 w-40 bg-[#E5E2DC] rounded animate-pulse" />
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 md:px-8 max-w-7xl mx-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="shrink-0 w-32 sm:w-36 aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
        ))}
      </div>
    </section>
  );
}

export function CategoryClient() {
  // L2 deep-link: /c/{l1-slug}/{l2-slug} (route segment) OR /c/{l1-slug}?l2={l2-slug}
  // (query param) both pre-select the L2 filter on load — used by the
  // homepage For Her / For Him bento tiles to land pre-filtered.
  const params = useParams<{ slug: string; l2slug?: string[] }>();
  const searchParams = useSearchParams();
  const slug = params.slug;
  const l2FromUrl = params.l2slug?.[0] || searchParams.get("l2") || "";

  const [sort, setSort] = useState<SortKey>("nearest");
  const [l2Filter, setL2Filter] = useState(""); // slug
  useEffect(() => { setL2Filter(l2FromUrl); }, [slug, l2FromUrl]);

  // Every fetch below is now a useQuery, keyed so that switching L1 (or
  // L2 filter, or sort) is a query-KEY change, not a value mutated in
  // place — React Query scopes `data` to its own key automatically, so
  // there's no more "previous category's data paints under the new
  // heading for a frame" risk to guard against by hand (an earlier
  // version of this file had a whole "reset state during render" block
  // for exactly that, now unnecessary and removed) — and switching BACK
  // to an L1 visited earlier in the session serves its still-fresh
  // cached data instantly instead of re-fetching, which is the real
  // navigation-speed win here, not just parallelizing the first visit.
  //
  // ["categories"] is the SAME key CategoryTileRow's own useQuery uses
  // (see that component's doc comment) — one shared cached request for
  // data that "only admin uploads change" (per the earlier structural
  // audit), not two independent fetches of it.
  const { data: cats = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories() as Promise<Cat[]>,
    staleTime: 5 * 60_000,
  });

  const l1 = useMemo(() => cats.find((c) => c.slug === slug), [cats, slug]);

  const { data: subcategories = [] } = useQuery({
    queryKey: ["category-l2", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get(`/api/categories/${l1!.id}/l2`);
      const subs = Array.isArray(r.data) ? r.data : (r.data?.subcategories || []);
      return (subs.length > 0 ? subs : (l1!.l2 ?? [])) as L2[];
    },
    enabled: !!l1,
  });

  // l2FilterId — converts slug to DB id for the products API
  const l2FilterId = useMemo(() => {
    if (!l2Filter) return "";
    const sub = subcategories.find(s => s.slug === l2Filter) ?? (l1?.l2 ?? []).find(s => s.slug === l2Filter);
    return sub?.id ?? "";
  }, [l2Filter, subcategories, l1]);

  const { data: allProducts = [], isPending: isLoading } = useQuery({
    queryKey: ["category-products", l1?.id, l2FilterId, sort],
    queryFn: async () => {
      const p = new URLSearchParams({ l1: l1!.id });
      if (l2FilterId) p.set("l2", l2FilterId);
      if (sort === "price_asc") p.set("sort", "price_asc");
      if (sort === "price_desc") p.set("sort", "price_desc");
      const r = await apiClient.get<ProductCardType[]>(`/api/products?${p.toString()}`);
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  // Curated rails, scoped to the whole L1 (never the L2 filter — these are
  // meant to showcase the category broadly, same "editorial pick" role
  // Home's Best deals / Premium picks rails play there). Both sort keys
  // (rating, price_desc) are ones GET /api/products already supports (see
  // the structural audit) — there is no created_at/"newest" sort on this
  // endpoint today, so a "New in {L1}" rail was deliberately NOT built
  // rather than mislabeling a sort this endpoint can't actually guarantee.
  // "Premium picks" mirrors the exact sort Home's own Premium picks rail
  // uses; "Bestsellers" uses rating as the closest available quality
  // signal to Home's Best deals rail (which sorts by discount % — not
  // exposed as a query param here). All of these, plus the stores rail
  // and the main product grid above, are independent useQuery calls with
  // no dependency on each other's results, so React Query fires all of
  // them concurrently the moment `l1` resolves — no explicit Promise.all
  // needed, that's just how independent useQuery hooks behave.
  const { data: bestsellers = [], isPending: bestsellersLoading } = useQuery({
    queryKey: ["category-rail-bestsellers", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get<ProductCardType[]>(`/api/products?l1=${l1!.id}&sort=rating&limit=8`);
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  const { data: premiumPicks = [], isPending: premiumLoading } = useQuery({
    queryKey: ["category-rail-premium", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get<ProductCardType[]>(`/api/products?l1=${l1!.id}&sort=price_desc&limit=8`);
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  // Stores rail — GET /api/categories/{l1_id}/stores (new backend
  // aggregation, see server.py's own doc comment): stores with at least
  // one visible product in this L1, already sorted availability-first
  // then by product count. Separate request from the curated product
  // rails above since it's a genuinely different resource (stores, not
  // products) off a different endpoint. The endpoint itself now carries
  // a short server-side TTL cache too (see its own comment) — this
  // client-side query cache and that server-side one solve different
  // halves of the same problem: this one skips the network round-trip
  // entirely on a cached revisit; that one keeps the round-trip cheap
  // for everyone else hitting an L1 this client hasn't cached yet.
  const { data: l1Stores = [], isPending: storesLoading } = useQuery({
    queryKey: ["category-stores", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get<CategoryStore[]>(`/api/categories/${l1!.id}/stores`);
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  const products = useMemo(() => sortProducts(allProducts, sort), [allProducts, sort]);

  const l2List = subcategories.length > 0 ? subcategories : (l1?.l2 ?? []);

  // Cold load: `cats` (the L1 fetch) hasn't resolved yet, so `l1` can't be
  // found at all — same SkeletonGrid the products fetch uses below, not a
  // bare unstyled "Loading…" div, so a fresh visit to /c/[slug] shows a
  // skeleton immediately instead of two different loading treatments back
  // to back. No tab-strip chrome to render here anymore — CategoryTileRow
  // lives in (consumer)/(shop)/layout.tsx now (mounted once for both Home
  // and every /c/[slug] page, never remounted by this component's own
  // loading/navigation state) — see that file's and CategoryTileRow's own
  // doc comments.
  if (!l1) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]">
        <main className="flex-1">
          <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
            <div className="h-8 w-40 bg-[#E5E2DC] rounded-lg animate-pulse mb-3" />
            <SkeletonGrid />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <main className="flex-1">
        {/* 1. L1-scoped hero — a single-slide HeroCarousel (renders static,
            no autoplay/dots, since HeroCarousel no-ops both once
            slides.length <= 1) driven by l1HeroConfig's per-L1 copy. Falls
            back to a generic-but-honest hero for any L1 not yet in that
            config — see getL1HeroSlides. `compact` shrinks it to ~45% of
            Home's hero height, sized for l1HeroConfig's shorter
            eyebrow + one-line copy — see both components' own comments. */}
        <HeroCarousel slides={getL1HeroSlides(slug, l1.name)} compact />

        {/* 2. "Bestsellers in {L1}" — reuses HCarousel + ProductCard exactly
            as Home's own rails do, no new card component. */}
        {bestsellersLoading ? (
          <RailSkeleton title={`Bestsellers in ${l1.name}`} />
        ) : bestsellers.length > 0 ? (
          <HCarousel title={`Bestsellers in ${l1.name}`} testid="cat-rail-bestsellers">
            {bestsellers.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
          </HCarousel>
        ) : null}

        {/* 3. "Stores in {L1}" — GET /api/categories/{l1_id}/stores (new
            backend aggregation), rendered with SellerCard, the same store-
            rail card Home's "Meet your sellers" rail uses (now a shared
            component — see SellerCard's own doc comment). openNow/
            closedLabel derive from availability_rank/next_open_label the
            same way MeetSellersSection does on Home. */}
        {storesLoading ? (
          <StoreRailSkeleton />
        ) : l1Stores.length > 0 ? (
          <section className="pt-8" data-testid="cat-rail-stores">
            <div className="max-w-7xl mx-auto px-4 md:px-8 mb-3">
              <h2 className="text-lg sm:text-xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">
                Stores in {l1.name}
              </h2>
            </div>
            <div className="max-w-7xl mx-auto px-4 md:px-8">
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                {l1Stores.map((s) => {
                  const isOpen = s.availability_rank === 1;
                  const closedLabel = isOpen ? undefined : (s.next_open_label || "Closed");
                  return <SellerCard key={s.id} s={s} source="category_stores" openNow={isOpen} closedLabel={closedLabel} />;
                })}
              </div>
            </div>
          </section>
        ) : null}

        {/* 4. "Shop by category" — L2 circle grid, same w-16 h-16
            rounded-full + label-below treatment the homepage's gender
            bento tiles use. Tapping a tile sets l2Filter directly (same
            state the Browse-all grid further down reads) rather than
            navigating — this REPLACES the old horizontal L2 pill row that
            used to sit just above that grid; keeping both would have been
            two filter UIs for the same l2Filter state. No "All" tile here
            (removed) — "no filter selected" is still the resting default,
            it just doesn't need its own visible tile; the sort row +
            product count in the Browse-all section already make the
            unfiltered state legible. */}
        {l2List.length > 0 && (
          <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6" data-testid="cat-l2-grid">
            <h2 className="text-lg sm:text-xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">
              Shop by category
            </h2>
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {l2List.map((sub) => {
                const isActive = l2Filter === sub.slug;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setL2Filter(isActive ? "" : sub.slug)}
                    data-testid={`l2-tile-${sub.slug}`}
                    className="flex flex-col items-center gap-1.5 active:scale-95 transition"
                  >
                    <div className={`relative w-16 h-16 rounded-full overflow-hidden bg-[#FDFBF7] border-2 ${
                      isActive ? "border-[#0A1F5C]" : "border-[#E5E2DC]"
                    }`}>
                      {sub.image ? (
                        <img src={sub.image} alt="" loading="lazy" className="w-full h-full object-cover object-top" />
                      ) : (
                        <div className="w-full h-full bg-[#E5E2DC]" />
                      )}
                    </div>
                    <span className={`text-[11px] font-semibold text-center leading-tight line-clamp-2 w-16 ${
                      isActive ? "text-[#0A1F5C]" : "text-[#595959]"
                    }`}>
                      {sub.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. "Premium picks in {L1}" */}
        {premiumLoading ? (
          <RailSkeleton title={`Premium picks in ${l1.name}`} />
        ) : premiumPicks.length > 0 ? (
          <HCarousel title={`Premium picks in ${l1.name}`} testid="cat-rail-premium">
            {premiumPicks.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
          </HCarousel>
        ) : null}

        {/* 6. Browse all {L1} — the original title/sort/grid section,
            unchanged in behavior (still reads sort + l2Filter, same
            /api/products fetch). Only the redundant L2 pill row that used
            to sit directly above this grid is gone — see the L2 circle
            grid above, which now owns that job. */}
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#E68910] mb-1">Browse all</div>
          <h1 data-testid="cat-title" className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">
            {l1.name}
            {!isLoading && (
              <span className="text-sm font-normal text-[#595959] ml-2">({products.length})</span>
            )}
          </h1>

          {/* Sort options */}
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
                    ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                    : "bg-white text-[#595959] border-[#E5E2DC]"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Products */}
          {isLoading ? (
            <SkeletonGrid />
          ) : products.length === 0 ? (
            <div className="mt-6 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <h3 className="font-display text-xl md:text-2xl font-bold text-[#0A1F5C]">Coming soon to {l1.name} in Bhilai</h3>
              <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We&apos;re onboarding local sellers right now — fresh drops will land here shortly.</p>
            </div>
          ) : (
            <div data-testid="cat-product-grid" className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
