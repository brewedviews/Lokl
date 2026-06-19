"use client";

/**
 * Home page client tree.
 *
 * Feb-26 home-reorder spec — section order on BOTH desktop & mobile:
 *   1. Hero
 *   2. Trending Now
 *   3. Shop by Category
 *   4. Selling Fast
 *   5. Offers For You
 *   6. Recently Added
 *   7. Popular Stores in Bhilai
 *   8. Testimonials (conditional — only when at least one approved review)
 *   9. Footer
 *
 * Mobile vs desktop differences live INSIDE each section component (HCarousel
 * scrolls horizontally on mobile and snaps to fixed-width cards on desktop;
 * ShopByCategory swaps from a 3×2 grid to a 1×6 row at the md breakpoint).
 * This file is the pure orchestrator.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
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

// Iter-26 — Default section order used if the CMS config endpoint fails.
// IDs MUST match the keys in `sectionRenderers` below AND the backend's
// `DEFAULT_HOMEPAGE_SECTIONS` in server.py (hero, popular_in_city, categories,
// selling_fast, offers, recently_viewed, stores, customer_love).
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",            label: "Hero",                       enabled: true, rank: 1  },
  { id: "under_499",       label: "Under ₹499",                 enabled: true, rank: 2  },
  { id: "category_pills",  label: "Category pills",             enabled: true, rank: 3  },
  { id: "popular_in_city", label: "Trending now",               enabled: true, rank: 10 },
  { id: "stores",          label: "Popular stores",             enabled: true, rank: 20 },
  { id: "offers",          label: "Offers for you",             enabled: true, rank: 30 },
  { id: "selling_fast",    label: "Selling fast",               enabled: true, rank: 40 },
  { id: "recently_viewed", label: "Recently added",             enabled: true, rank: 50 },
  { id: "customer_love",   label: "Loved by Bhilai shoppers",   enabled: true, rank: 70 },
];

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCard[]>([]);
  const [sellingFast, setSellingFast] = useState<ProductCard[]>([]);
  const [recent, setRecent] = useState<ProductCard[]>([]);
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
    // Categories are static — mark loaded immediately.
    markLoaded("categories");
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[] };
      if (c.hero) setHero(c.hero);
      if (Array.isArray(c.sections) && c.sections.length > 0) setSections(c.sections);
      markLoaded("hero");
    }).catch(() => { markLoaded("hero"); /* fall back to DEFAULT_SECTIONS */ });
    api.catalog.offers().then((r) => { setOffers(r as unknown as OfferDoc[]); markLoaded("offers"); }).catch(() => { markLoaded("offers"); markError("offers"); });
    api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
    api.catalog.categories().then((r) => setCategories(r)).catch(() => {});
    api.products.popularInCity(10).then((r) => { setTrending(r); markLoaded("trending"); }).catch(() => { markLoaded("trending"); markError("trending"); });
    api.products.sellingFast(10).then((r) => { setSellingFast(r); markLoaded("sellingFast"); }).catch(() => { markLoaded("sellingFast"); markError("sellingFast"); });
    api.products.newArrivals(10).then((r) => { setRecent(r); markLoaded("recent"); }).catch(() => { markLoaded("recent"); markError("recent"); });
    api.stores.popular(10).then((r) => { setPopularStores(r); markLoaded("popularStores"); }).catch(() => { markLoaded("popularStores"); markError("popularStores"); });
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then((r) => { setNearby(r); markLoaded("nearby"); }).catch(() => { markLoaded("nearby"); });
    }
  }, [lat, lng]);

  const storesReady = loaded.has("nearby") || loaded.has("popularStores");
  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

  // Skeleton primitives — no borders, no white backgrounds; blend into #FDFBF7.
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
  const CategorySkeleton = () => (
    <div className="px-4 md:px-8 py-6">
      <Skeleton className="h-5 w-32 rounded-full mb-4" />
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <Skeleton className="h-3 w-16 rounded-full" />
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

  // Iter-26 — Section registry. Each section shows its own skeleton while its
  // data is in-flight, then renders the real content as soon as it arrives.
  // Keys MUST match the section IDs the CMS publishes from
  // `site_config.sections[].id`.
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
    category_pills: categories.length > 0 ? (
      <div key="category-pills" className="max-w-7xl mx-auto px-4 sm:px-8 mt-3">
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
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
        </div>
      </div>
    ) : null,
    popular_in_city: errors.has("trending") ? (
      <SectionError key="trending-error" minHeight="min-h-[320px]" />
    ) : loaded.has("trending") && trending.length > 0 ? (
      <HCarousel key="trending" title="Trending now" subtitle="Most ordered products nearby this week" testid="home-trending" link="/products" linkLabel="See all">
        {trending.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("trending") ? <ProductRailSkeleton key="trending-skeleton" testid="home-trending-skeleton" /> : null,
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
            <Link key={s.id} href={`/store/${s.slug}`}
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
    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <OffersStrip key="offers" offers={offers} />
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,
    selling_fast: errors.has("sellingFast") ? (
      <SectionError key="selling-fast-error" minHeight="min-h-[320px]" />
    ) : loaded.has("sellingFast") && sellingFast.length > 0 ? (
      <HCarousel key="selling_fast" title="Selling fast" subtitle="Don't miss out — limited stock" testid="home-selling-fast" link="/products?sort=discount" linkLabel="See all">
        {sellingFast.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("sellingFast") ? <ProductRailSkeleton key="selling-fast-skeleton" testid="home-selling-fast-skeleton" /> : null,
    recently_viewed: errors.has("recent") ? (
      <SectionError key="recent-error" minHeight="min-h-[320px]" />
    ) : loaded.has("recent") && recent.length > 0 ? (
      <HCarousel key="recent" title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="home-recent" link="/products?sort=newest" linkLabel="See all">
        {recent.slice(0, 8).map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("recent") ? <ProductRailSkeleton key="recent-skeleton" testid="home-recent-skeleton" /> : null,
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
      <Footer />
    </div>
  );
}
