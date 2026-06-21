"use client";

/**
 * Home page client tree.
 *
 * Section order (desktop & mobile):
 *   1. Hero
 *   2. Price bentos (under_499)
 *   3. Category pills (with skeleton)
 *   4. Store rails — one per store, 8 products each
 *   5. New this week — only if ≥3 genuinely new products
 *   6. Best deals — only if ≥3 products with discount
 *   7. Offers for you
 *   8. Popular stores
 *   9. Loved by Bhilai shoppers
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroV2 } from "@/components/consumer/v2/HeroV2";
import { OffersStrip } from "@/components/consumer/v2/OffersStrip";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { Footer } from "@/components/consumer/Footer";
import { Skeleton, ProductCardSkeleton, StoreCardSkeleton } from "@/components/ui/Skeleton";
import { useLocationStore } from "@/stores";
import type { ProductCard, StoreCard, CategoryNode } from "@/types";

interface OfferDoc { id: string; title: string; subtitle?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface HomeStatsDoc { fastest_eta_min?: number }
interface HeroConfigDoc { image?: string; eyebrow?: string; title_line1?: string; title_line2?: string; subtitle?: string }
interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }

const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",           label: "Hero",                      enabled: true, rank: 1  },
  { id: "under_499",      label: "Under ₹499",                enabled: true, rank: 2  },
  { id: "category_pills", label: "Category pills",            enabled: true, rank: 3  },
  { id: "store_rail",     label: "From our stores",           enabled: true, rank: 10 },
  { id: "new_arrivals",   label: "New this week",             enabled: true, rank: 20 },
  { id: "best_deals",     label: "Best deals",                enabled: true, rank: 30 },
  { id: "offers",         label: "Offers for you",            enabled: true, rank: 40 },
  { id: "stores",         label: "Popular stores",            enabled: true, rank: 50 },
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: true, rank: 70 },
];

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [sellingFast, setSellingFast] = useState<ProductCard[]>([]);
  const [recent, setRecent] = useState<ProductCard[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [nearby, setNearby] = useState<StoreCard[]>([]);
  const [popularStores, setPopularStores] = useState<StoreCard[]>([]);
  const [storeRails, setStoreRails] = useState<{ store: StoreCard; products: ProductCard[] }[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const markLoaded = (key: string) =>
    setLoaded((prev) => { const next = new Set(prev); next.add(key); return next; });
  const markError = (key: string) =>
    setErrors((prev) => { const next = new Set(prev); next.add(key); return next; });

  useEffect(() => {
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[] };
      if (c.hero) setHero(c.hero);
      if (Array.isArray(c.sections) && c.sections.length > 0) setSections(c.sections);
      markLoaded("hero");
    }).catch(() => { markLoaded("hero"); });
    api.catalog.offers().then((r) => { setOffers(r as unknown as OfferDoc[]); markLoaded("offers"); }).catch(() => { markLoaded("offers"); markError("offers"); });
    api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
    api.catalog.categories().then((r) => setCategories(r)).catch(() => {});
    api.products.sellingFast(10).then((r) => { setSellingFast(r); markLoaded("sellingFast"); }).catch(() => { markLoaded("sellingFast"); markError("sellingFast"); });
    api.products.newArrivals(10).then((r) => { setRecent(r); markLoaded("recent"); }).catch(() => { markLoaded("recent"); markError("recent"); });
    api.stores.popular(10).then((r) => { setPopularStores(r); markLoaded("popularStores"); }).catch(() => { markLoaded("popularStores"); markError("popularStores"); });
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then((r) => { setNearby(r); markLoaded("nearby"); }).catch(() => { markLoaded("nearby"); });
    }
  }, [lat, lng]);

  // Fetch per-store product rails once we have the stores list.
  useEffect(() => {
    if (popularStores.length === 0) return;
    Promise.all(
      popularStores.slice(0, 3).map((s) =>
        apiClient
          .get<ProductCard[]>(`/api/products?store=${s.id}&limit=8`)
          .then((r) => ({ store: s, products: (Array.isArray(r.data) ? r.data : []).slice(0, 8) }))
          .catch(() => ({ store: s, products: [] as ProductCard[] }))
      )
    ).then((rails) => {
      setStoreRails(rails.filter((r) => r.products.length > 0));
      markLoaded("storeRails");
    });
  }, [popularStores]);

  const storesReady = loaded.has("nearby") || loaded.has("popularStores");
  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

  // Skeleton primitives
  const ProductRailSkeleton = ({ testid }: { testid: string }) => (
    <div key={testid} className="px-4 md:px-8 py-4 min-h-[320px]">
      <Skeleton className="h-5 w-36 rounded-full mb-1" />
      <Skeleton className="h-3 w-48 rounded-full mb-4" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    </div>
  );
  const StoreRailSkeleton = () => (
    <div key="stores-skeleton" className="px-4 md:px-8 py-4 min-h-[260px]">
      <Skeleton className="h-5 w-36 rounded-full mb-1" />
      <Skeleton className="h-3 w-48 rounded-full mb-4" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => <StoreCardSkeleton key={i} />)}
      </div>
    </div>
  );
  const OffersSkeleton = () => (
    <div className="px-4 md:px-8 py-4">
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
  const SectionError = ({ minHeight }: { minHeight: string }) => (
    <div className={`px-4 md:px-8 py-4 flex items-center justify-center ${minHeight}`}>
      <span className="text-sm text-[#94A3B8]">Could not load</span>
    </div>
  );

  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: <HeroV2 key="hero" stats={stats} hero={hero} />,

    under_499: (
      <div key="price-bentos" className="max-w-7xl mx-auto px-4 sm:px-8 mt-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/products?price=under-499", price: "Under ₹499", sub: "Budget picks" },
            { href: "/products?price=499-1099", price: "₹499–₹1,099", sub: "Most popular" },
            { href: "/products?price=above-1099", price: "₹1,099+", sub: "Premium" },
          ].map(({ href, price, sub }) => (
            <Link key={href} href={href}
              className="flex flex-col bg-white border border-[#E5E2DC] rounded-xl overflow-hidden hover:border-[#E68910] hover:shadow-sm transition-all active:scale-95">
              <div className="flex-1 flex items-center justify-center px-2 pt-3 pb-2">
                <span className="font-bold text-[#1A2B4C] text-[13px] text-center leading-tight">{price}</span>
              </div>
              <div className="bg-[#F5F4F0] px-2 py-1.5 text-center">
                <span className="text-[10px] text-[#595959] font-medium">{sub}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    ),

    // Category tiles — show skeletons while loading
    category_pills: (
      <div key="category-pills" className="max-w-7xl mx-auto px-4 sm:px-8 mt-3">
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
          {categories.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div className="w-16 h-16 rounded-2xl bg-[#E5E2DC] animate-pulse" />
                <div className="w-12 h-3 bg-[#E5E2DC] rounded animate-pulse" />
              </div>
            ))
          ) : (
            <>
              <Link href="/products" className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition">
                <div className="w-16 h-16 rounded-2xl bg-[#1A2B4C] flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-[#1A2B4C] text-center">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]">
                    {cat.image ? (
                      <img src={cat.image} alt={cat.name} className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="w-full h-full bg-[#E5E2DC] flex items-center justify-center">
                        <span className="text-2xl">👗</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-[#1A2B4C] text-center w-16 leading-tight line-clamp-2">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    ),

    // Store rails — one per active store, products fetched in parallel
    store_rail: loaded.has("storeRails") ? (
      storeRails.length > 0
        ? storeRails.map((r) => (
            <HCarousel
              key={`store-${r.store.id}`}
              title={`From ${r.store.name}`}
              subtitle="Shop local, delivered fast"
              testid={`store-rail-${r.store.id}`}
              link={`/store/${(r.store as any).slug}`}
              linkLabel="See all"
            >
              {r.products.map((p) => <ProductCardV2 key={p.id} p={p} />)}
            </HCarousel>
          ))
        : null
    ) : <StoreRailSkeleton key="store-rail-skeleton" />,

    // New arrivals — only render if ≥3 genuinely new products
    new_arrivals: errors.has("recent") ? null
      : loaded.has("recent") && recent.length >= 3 ? (
          <HCarousel key="new-arrivals" title="New this week" subtitle="Fresh drops from Bhilai stores" testid="home-new-arrivals" link="/products?sort=newest" linkLabel="See all">
            {recent.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("recent") ? <ProductRailSkeleton key="new-arrivals-skeleton" testid="home-new-arrivals-skeleton" /> : null,

    // Best deals — only render if ≥3 discounted products
    best_deals: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && sellingFast.length >= 3 ? (
          <HCarousel key="best-deals" title="Best deals" subtitle="Top discounts in Bhilai" testid="home-best-deals" link="/products?sort=discount" linkLabel="See all">
            {sellingFast.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("sellingFast") ? <ProductRailSkeleton key="best-deals-skeleton" testid="home-best-deals-skeleton" /> : null,

    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <OffersStrip key="offers" offers={offers} />
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,

    stores: errors.has("popularStores") && !storesRail.length ? (
      <SectionError key="stores-error" minHeight="min-h-[200px]" />
    ) : storesReady && storesRail.length > 0 ? (
      <section key="stores" className="pt-8" data-testid="home-stores">
        <div className="px-4 sm:px-8 flex items-end justify-between gap-3 mb-3 max-w-7xl mx-auto">
          <div>
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">{storesTitle}</h2>
            <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Trusted local merchants delivering today</p>
          </div>
          <a href="/stores" className="text-xs font-bold text-[#F59E0B] shrink-0 hover:underline">See all →</a>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 sm:px-8 max-w-7xl mx-auto pb-1">
          {storesRail.map((s) => (
            <Link key={s.id} href={`/store/${(s as any).slug}`}
              className="flex-shrink-0 w-36 bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-sm transition active:scale-95">
              <div className="relative h-20 bg-[#E5E2DC]">
                {((s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo) ? (
                  <img src={(s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo} alt={s.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="p-2.5">
                <div className="font-bold text-[#1A2B4C] text-[12px] truncate">{s.name}</div>
                <div className="text-[10px] text-[#9CA3AF] mt-0.5">⚡ {s.eta_min ?? 30} min</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    ) : !storesReady ? <StoreRailSkeleton key="stores-skeleton" /> : null,

    customer_love: <CustomerLove key="testimonials" items={testimonials} />,

    // Backward-compat aliases for CMS configs that still use old section IDs
    selling_fast: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && sellingFast.length >= 3 ? (
          <HCarousel key="selling-fast-compat" title="Best deals" subtitle="Top discounts in Bhilai" testid="home-selling-fast" link="/products?sort=discount" linkLabel="See all">
            {sellingFast.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("sellingFast") ? <ProductRailSkeleton key="selling-fast-skeleton" testid="home-selling-fast-skeleton" /> : null,
    recently_viewed: errors.has("recent") ? null
      : loaded.has("recent") && recent.length >= 3 ? (
          <HCarousel key="recently-viewed-compat" title="New this week" subtitle="Fresh drops from Bhilai stores" testid="home-recent" link="/products?sort=newest" linkLabel="See all">
            {recent.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("recent") ? <ProductRailSkeleton key="recent-skeleton" testid="home-recent-skeleton" /> : null,
    popular_in_city: null,
  };

  const orderedSections = [...sections]
    .filter((s) => s.enabled !== false)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((s) => sectionRenderers[s.id])
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1">
        {orderedSections}
      </main>
      <Footer />
    </div>
  );
}
