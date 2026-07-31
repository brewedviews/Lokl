"use client";

/**
 * Home page client tree.
 *
 * Section order (desktop & mobile):
 *   1. Category pills
 *   2. Hero
 *   3. Just In (JustInSection — self-fetches newest arrivals + store chips)
 *   4. Popular stores
 *   5. Best deals (from home-products)
 *   6. Price bentos (under_499)
 *   7. Offers for you
 *   8. Open a store (merchant CTA)
 *   9. Loved by Bhilai shoppers
 *
 * Trending now is disabled pre-launch — with no order history yet it shows
 * duplicate/fake data. Code kept in place, just `enabled: false`.
 *
 * API calls on mount — critical (immediate):
 *   • /api/feed/home-products  — trending + best deals
 *   • /api/categories
 *   • /api/site/homepage-config
 *   • /api/site/home-stats
 * Deferred 800 ms (non-critical):
 *   • /api/catalog/offers
 *   • /api/catalog/testimonials
 *   • /api/feed/popular-stores
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroV2 } from "@/components/consumer/v2/HeroV2";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { JustInSection } from "@/components/consumer/JustInSection";
import { Footer } from "@/components/consumer/Footer";
import { Skeleton } from "@/components/ui/Skeleton";
import { useLocationStore } from "@/stores";
import type { ProductCard as ProductCardType, StoreCard, CategoryNode } from "@/types";
import {
  trackSectionImpression, trackCategoryTileClick, trackCategoryTileImpression,
  trackPriceFilterClick, trackProductClick, trackStoreClick,
  trackOfferClick, trackMerchantCTAClick, observeImpression,
} from "@/lib/analytics";

interface OfferDoc { id: string; title: string; subtitle?: string; description?: string; code?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface HomeStatsDoc { fastest_eta_min?: number }
interface HeroConfigDoc { image?: string; eyebrow?: string; title_line1?: string; title_line2?: string; subtitle?: string }
interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }
interface HomeProductsRail { store_id: string; store_name: string; store_slug: string; store_banner?: string; store_tagline?: string; products: ProductCardType[] }
interface HomeProductsResponse { store_rails: HomeProductsRail[]; trending: ProductCardType[]; best_deals: ProductCardType[] }

const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "category_pills", label: "Category pills",            enabled: true,  rank: 10 },
  { id: "hero",           label: "Hero",                      enabled: true,  rank: 20 },
  { id: "just_in",        label: "Just In",                   enabled: true,  rank: 50 },
  { id: "stores",         label: "Popular stores",            enabled: true,  rank: 80 },
  { id: "best_deals",     label: "Best deals",                enabled: true,  rank: 60 },
  { id: "under_499",      label: "Under ₹499",                enabled: true,  rank: 30 },
  { id: "offers",         label: "Offers for you",            enabled: true,  rank: 70 },
  { id: "merchant_cta",   label: "Open a store",              enabled: true,  rank: 90 },
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: true,  rank: 100 },
  { id: "trending",       label: "Trending now",              enabled: true, rank: 40 },
];

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [bestDeals, setBestDeals] = useState<ProductCardType[]>([]);
  const [_storeRails, setStoreRails] = useState<HomeProductsRail[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [nearby, setNearby] = useState<StoreCard[]>([]);
  const [popularStores, setPopularStores] = useState<StoreCard[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const offersScrollRef = useRef<HTMLDivElement>(null);

  const markLoaded = (key: string) =>
    setLoaded((prev) => { const next = new Set(prev); next.add(key); return next; });
  const markError = (key: string) =>
    setErrors((prev) => { const next = new Set(prev); next.add(key); return next; });

  useEffect(() => {
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[] };
      if (c.hero) setHero(c.hero);
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        // Merge: server config toggles enabled/disabled, but LOCAL rank always wins
        // so newly added DEFAULT_SECTIONS entries always appear in the right order.
        const defaultMap = new Map(DEFAULT_SECTIONS.map((s) => [s.id, s]));
        const serverIds = new Set(c.sections.map((s: SectionDoc) => s.id));
        const extra = DEFAULT_SECTIONS.filter((s) => !serverIds.has(s.id));
        const merged = [
          ...c.sections.map((s: SectionDoc) => ({ ...s, rank: defaultMap.get(s.id)?.rank ?? s.rank })),
          ...extra,
        ];
        const seen = new Set<string>();
        setSections(merged.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; }));
      }
      markLoaded("hero");
    }).catch(() => { markLoaded("hero"); });
    api.catalog.categories().then((r) => setCategories(r)).catch(() => {});

    const _deferTimer = setTimeout(() => {
      api.catalog.offers().then((r) => { setOffers(r as unknown as OfferDoc[]); markLoaded("offers"); }).catch(() => { markLoaded("offers"); markError("offers"); });
      api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
      api.stores.popular(10).then((r) => { setPopularStores(r); markLoaded("popularStores"); }).catch(() => { markLoaded("popularStores"); markError("popularStores"); });
    }, 800);

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
          const products: ProductCardType[] = r2.data?.products || r2.data || [];
          if (products.length > 0) {
            setTrending(products.slice(0, 8));
            setBestDeals(products.slice(8, 16));
            const byStore: Record<string, ProductCardType[]> = {};
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
        const products: ProductCardType[] = r2.data?.products || [];
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

    return () => clearTimeout(_deferTimer);
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then((r) => { setNearby(r); markLoaded("nearby"); }).catch(() => { markLoaded("nearby"); });
    }
  }, [lat, lng]);

  useEffect(() => {
    const el = offersScrollRef.current;
    if (!el || offers.length <= 1) return;

    let animId: number;
    let paused = false;

    const tick = () => {
      if (!paused && el) {
        el.scrollLeft += 0.6;
        if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) {
          el.scrollLeft = 0;
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const pause = () => { paused = true; };
    const resume = () => { paused = false; };

    el.addEventListener("mouseenter", pause);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("mouseleave", resume);
    el.addEventListener("touchend", resume);

    return () => {
      cancelAnimationFrame(animId);
      el.removeEventListener("mouseenter", pause);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("mouseleave", resume);
      el.removeEventListener("touchend", resume);
    };
  }, [offers]);

  const storesReady = loaded.has("nearby") || loaded.has("popularStores");
  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

  const ProductRailSkeleton = ({ testid }: { testid: string }) => (
    <div data-testid={testid} className="pt-4 px-4 sm:px-6">
      <Skeleton className="h-7 w-44 rounded-full mb-1" />
      <Skeleton className="h-4 w-56 rounded-full mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">
            <Skeleton className="w-full aspect-[3/4] rounded-2xl mb-2" />
            <Skeleton className="h-3 w-3/4 rounded mb-1.5" />
            <Skeleton className="h-3 w-1/2 rounded mb-1.5" />
            <Skeleton className="h-6 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
  const StoreRailSkeleton = () => (
    <div className="pt-4 px-4 sm:px-6">
      <Skeleton className="h-7 w-44 rounded-full mb-1" />
      <Skeleton className="h-4 w-56 rounded-full mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shrink-0 w-36 rounded-2xl overflow-hidden bg-white">
            <Skeleton className="w-full h-20 rounded-none" />
            <div className="p-2.5 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
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
    hero: (
      <div key="hero" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("hero")); } catch {} } }}>
        <HeroV2 stats={stats} hero={hero} />
      </div>
    ),

    under_499: (
      <div key="price-bentos" className="max-w-7xl mx-auto px-4 sm:px-6 pt-8" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("under_499")); } catch {} } }}>
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/products?price=under-499", price: "Under ₹499", sub: "Budget picks", filter: "under_499" as const },
            { href: "/products?price=499-1099", price: "₹499–₹1,099", sub: "Most popular", filter: "499_999" as const },
            { href: "/products?price=above-1099", price: "₹1,099+", sub: "Premium", filter: "premium" as const },
          ].map(({ href, price, sub, filter }) => (
            <Link key={href} href={href} onClick={() => { try { trackPriceFilterClick(filter); } catch {} }}
              className="flex flex-col bg-white border border-[#E5E2DC] rounded-xl overflow-hidden hover:border-[#E68910] hover:shadow-sm transition-all active:scale-95">
              <div className="flex-1 flex items-center justify-center px-2 pt-3 pb-2">
                <span className="font-bold text-[#0A1F5C] text-[13px] text-center leading-tight">{price}</span>
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
      <div key="category-pills" className="max-w-7xl mx-auto px-4 sm:px-6 pt-3">
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
                <div className="w-16 h-16 rounded-2xl bg-[#0A1F5C] flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-[#0A1F5C] text-center">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat, catIdx) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
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
                  <span className="text-[11px] font-semibold text-[#0A1F5C] text-center w-16 leading-tight line-clamp-2">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    ),

    // Trending products
    trending: errors.has("recent") ? null
      : loaded.has("recent") && trending.length >= 1 ? (
          <HCarousel key="trending" title="Trending now" testid="home-new-arrivals" link="/products?sort=trending" linkLabel="See all">
            {trending.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "trending", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : !loaded.has("recent") ? <ProductRailSkeleton key="trending-skeleton" testid="home-new-arrivals-skeleton" /> : null,

    // Best deals
    best_deals: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && bestDeals.length >= 1 ? (
          <HCarousel key="best-deals" title="Best deals" testid="home-best-deals" link="/products?sort=discount" linkLabel="See all">
            {bestDeals.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "best_deals", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : !loaded.has("sellingFast") ? <ProductRailSkeleton key="best-deals-skeleton" testid="home-best-deals-skeleton" /> : null,

    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <section key="offers" className="pt-8" data-testid="offers-strip" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offers")); } catch {} } }}>
        <div className="px-4 sm:px-6 mb-3 max-w-7xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">Offers for you</h2>
        </div>
        <div
          ref={offersScrollRef}
          className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 px-4 sm:px-6 max-w-7xl mx-auto"
        >
          {offers.slice(0, 6).map((offer) => {
            const href = offer.cta_link || "/categories";
            const cardStyle = { background: offer.background || "#0A1F5C" };
            const inner = (
              <div className="aspect-[16/9] relative">
                {offer.image && (
                  <img src={offer.image} alt={offer.title} className="absolute inset-0 w-full h-full object-cover opacity-70" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
                <div className="absolute inset-0 p-5 flex flex-col justify-center text-white">
                  <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">Limited time</div>
                  <div className="text-xl font-display font-bold mt-1 leading-tight">{offer.title}</div>
                  {offer.subtitle && <div className="text-sm opacity-95 mt-1">{offer.subtitle}</div>}
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold">
                    {offer.cta_label || "Shop now"} →
                  </div>
                </div>
              </div>
            );
            return (
              <Link
                key={offer.id}
                href={href}
                data-testid={`offer-${offer.id}`}
                onClick={() => { try { trackOfferClick(offer.id, offer.code || ""); } catch {} }}
                className="snap-start shrink-0 w-[78vw] sm:w-[340px] rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]"
                style={cardStyle}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </section>
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,

    // JustInSection self-fetches newest arrivals + the store-chip list and
    // collapses to null if no store has any visible products.
    just_in: <JustInSection key="just-in" />,

    stores: errors.has("popularStores") && !storesRail.length ? (
      <SectionError key="stores-error" minHeight="min-h-[200px]" />
    ) : storesReady && storesRail.length > 0 ? (
      <section key="stores" className="pt-8" data-testid="home-stores">
        <div className="px-4 sm:px-6 flex items-end justify-between gap-3 mb-3 max-w-7xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">{storesTitle}</h2>
          <a href="/stores" className="text-xs font-bold text-[#F59E0B] shrink-0 hover:underline">See all →</a>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 max-w-7xl mx-auto pb-1">
          {storesRail.map((s) => (
            <Link key={s.id} href={`/store/${(s as any).slug || s.id}`}
              onClick={() => { try { trackStoreClick(s.id, s.name, "homepage_stores"); } catch {} }}
              className="flex-shrink-0 w-36 bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-sm transition active:scale-95">
              <div className="relative h-20 bg-[#E5E2DC]">
                {((s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo) ? (
                  <img src={(s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo} alt={s.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="p-2.5">
                <div className="font-bold text-[#0A1F5C] text-[12px] truncate">{s.name}</div>
                <div className="text-[10px] text-[#9CA3AF] mt-0.5">⚡ {s.eta_min ?? 30} min</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    ) : !storesReady ? <StoreRailSkeleton key="stores-skeleton" /> : null,

    merchant_cta: (
      <a
        key="merchant-cta"
        href="https://lokl.up.railway.app/merchant/register"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => { try { trackMerchantCTAClick("homepage"); } catch {} }}
        className="block mx-4 md:mx-6 mt-8 mb-10"
      >
        <div className="bg-[#0A1F5C] rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight">
              Own a store in Bhilai?
            </p>
            <p className="text-white/60 text-xs mt-0.5">
              Join Lokl — list your products for free
            </p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2 bg-[#E68910] text-white text-xs font-bold px-3 py-2 rounded-xl">
            <span>Join free</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </a>
    ),

    customer_love: <CustomerLove key="testimonials" items={testimonials} />,

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
      <Footer topGap={testimonials.length > 0} />
    </div>
  );
}
