"use client";

/**
 * Home page client tree.
 *
 * Section order (desktop & mobile):
 *   1. Hero
 *   2. Price bentos (under_499)
 *   3. Category pills
 *   4. Store rails — one per active store (from /api/feed/home-products)
 *   5. Trending now (from home-products)
 *   6. Best deals (from home-products)
 *   7. Offers for you
 *   8. Popular stores
 *   9. Loved by Bhilai shoppers
 *
 * API calls on mount (all parallel):
 *   • /api/feed/home-products  — store rails + trending + best deals (one request)
 *   • /api/categories
 *   • /api/site/homepage-config
 *   • /api/site/home-stats
 *   • /api/catalog/offers
 *   • /api/catalog/testimonials
 *   • /api/feed/popular-stores  — for the store cards section only
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
interface HomeProductsRail { store_id: string; store_name: string; store_slug: string; store_banner?: string; store_tagline?: string; products: ProductCard[] }
interface HomeProductsResponse { store_rails: HomeProductsRail[]; trending: ProductCard[]; best_deals: ProductCard[] }

const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",           label: "Hero",                      enabled: true, rank: 1  },
  { id: "under_499",      label: "Under ₹499",                enabled: true, rank: 2  },
  { id: "category_pills", label: "Category pills",            enabled: true, rank: 3  },
  { id: "store_rail",     label: "From our stores",           enabled: true, rank: 10 },
  { id: "new_arrivals",   label: "Trending now",              enabled: true, rank: 20 },
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
  const [trending, setTrending] = useState<ProductCard[]>([]);
  const [bestDeals, setBestDeals] = useState<ProductCard[]>([]);
  const [storeRails, setStoreRails] = useState<HomeProductsRail[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [nearby, setNearby] = useState<StoreCard[]>([]);
  const [popularStores, setPopularStores] = useState<StoreCard[]>([]);
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
    api.stores.popular(10).then((r) => { setPopularStores(r); markLoaded("popularStores"); }).catch(() => { markLoaded("popularStores"); markError("popularStores"); });

    // Single request for all product content — replaces N+1 store fetches
    apiClient.get<HomeProductsResponse>("/api/feed/home-products").then((r) => {
      const data = r.data || { store_rails: [], trending: [], best_deals: [] };
      const hasProducts = (data.trending?.length || 0) + (data.store_rails?.length || 0) > 0;

      if (hasProducts) {
        setStoreRails(data.store_rails || []);
        setTrending(data.trending || []);
        setBestDeals(data.best_deals || []);
      } else {
        // Direct fallback — fetch products without feed filtering
        apiClient.get("/api/products?limit=24&sort=newest").then((r2: any) => {
          const products: ProductCard[] = r2.data?.products || r2.data || [];
          if (products.length > 0) {
            setTrending(products.slice(0, 8));
            setBestDeals(products.slice(8, 16));
            const byStore: Record<string, ProductCard[]> = {};
            products.forEach((p: any) => {
              if (!p.store_id) return;
              const bucket = byStore[p.store_id] ?? (byStore[p.store_id] = []);
              if (bucket.length < 8) bucket.push(p);
            });
            const rails = Object.entries(byStore).map(([sid, prods]) => ({
              store_id: sid,
              store_name: (prods[0] as any)?.store_name || "Local Store",
              store_slug: (prods[0] as any)?.store_slug || sid,
              store_banner: (prods[0] as any)?.store_banner || "",
              store_tagline: "Shop local, delivered fast",
              products: prods,
            }));
            if (rails.length > 0) setStoreRails(rails);
          }
        }).catch(() => {});
      }

      markLoaded("storeRails");
      markLoaded("sellingFast");
      markLoaded("recent");
    }).catch(() => {
      // On total failure still try direct products
      apiClient.get("/api/products?limit=16").then((r2: any) => {
        const products: ProductCard[] = r2.data?.products || [];
        if (products.length > 0) {
          setTrending(products.slice(0, 8));
          setBestDeals(products.slice(8));
        }
      }).catch(() => {});
      markLoaded("storeRails");
      markLoaded("sellingFast");
      markLoaded("recent");
      markError("sellingFast");
      markError("recent");
    });
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then((r) => { setNearby(r); markLoaded("nearby"); }).catch(() => { markLoaded("nearby"); });
    }
  }, [lat, lng]);

  const storesReady = loaded.has("nearby") || loaded.has("popularStores");
  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

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

    // Store rails — one per active store, all from a single API call
    store_rail: loaded.has("storeRails") ? (
      storeRails.length > 0
        ? storeRails.map((r) => (
            <HCarousel
              key={`store-${r.store_id}`}
              title={`From ${r.store_name}`}
              subtitle={r.store_tagline || "Shop local, delivered fast"}
              testid={`store-rail-${r.store_id}`}
              link={`/store/${r.store_slug}`}
              linkLabel="See all"
            >
              {r.products.map((p) => <ProductCardV2 key={p.id} p={p} />)}
            </HCarousel>
          ))
        : null
    ) : <ProductRailSkeleton key="store-rail-skeleton" testid="home-store-rail-skeleton" />,

    // Trending products
    new_arrivals: errors.has("recent") ? null
      : loaded.has("recent") && trending.length >= 1 ? (
          <HCarousel key="new-arrivals" title="Trending now" subtitle="What everyone in Bhilai is buying" testid="home-new-arrivals" link="/products?sort=trending" linkLabel="See all">
            {trending.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("recent") ? <ProductRailSkeleton key="new-arrivals-skeleton" testid="home-new-arrivals-skeleton" /> : null,

    // Best deals
    best_deals: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && bestDeals.length >= 1 ? (
          <HCarousel key="best-deals" title="Best deals" subtitle="Top discounts in Bhilai" testid="home-best-deals" link="/products?sort=discount" linkLabel="See all">
            {bestDeals.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
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
            <Link key={s.id} href={`/store/${(s as any).slug || s.id}`}
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

    // Backward-compat aliases for CMS configs using old section IDs
    selling_fast: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && bestDeals.length >= 1 ? (
          <HCarousel key="selling-fast-compat" title="Best deals" subtitle="Top discounts in Bhilai" testid="home-selling-fast" link="/products?sort=discount" linkLabel="See all">
            {bestDeals.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )
      : !loaded.has("sellingFast") ? <ProductRailSkeleton key="selling-fast-skeleton" testid="home-selling-fast-skeleton" /> : null,
    recently_viewed: errors.has("recent") ? null
      : loaded.has("recent") && trending.length >= 1 ? (
          <HCarousel key="recently-viewed-compat" title="Trending now" subtitle="What everyone in Bhilai is buying" testid="home-recent" link="/products?sort=trending" linkLabel="See all">
            {trending.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
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
