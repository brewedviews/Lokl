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
import { api } from "@/lib/api";
import { HeroV2 } from "@/components/consumer/v2/HeroV2";
import { OffersStrip } from "@/components/consumer/v2/OffersStrip";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { StoreCardV2 } from "@/components/consumer/v2/StoreCardV2";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { ShopByCategory } from "@/components/consumer/ShopByCategory";
import { Footer } from "@/components/consumer/Footer";
import { Skeleton, ProductCardSkeleton, StoreCardSkeleton } from "@/components/ui/Skeleton";
import { useLocationStore } from "@/stores";
import type { ProductCard, StoreCard } from "@/types";

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
  { id: "hero",            label: "Hero",                       enabled: true, rank: 10 },
  { id: "popular_in_city", label: "Trending now",               enabled: true, rank: 20 },
  { id: "categories",      label: "Shop by category",           enabled: true, rank: 30 },
  { id: "selling_fast",    label: "Selling fast",               enabled: true, rank: 40 },
  { id: "offers",          label: "Offers for you",             enabled: true, rank: 50 },
  { id: "under_499",       label: "Under ₹499",                 enabled: true, rank: 55 },
  { id: "recently_viewed", label: "Recently added",             enabled: true, rank: 60 },
  { id: "mid_range",       label: "₹499–₹1099",                 enabled: true, rank: 65 },
  { id: "stores",          label: "Popular stores",             enabled: true, rank: 70 },
  { id: "above_1099",      label: "Premium picks",              enabled: true, rank: 75 },
  { id: "customer_love",   label: "Loved by Bhilai shoppers",   enabled: true, rank: 80 },
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
  const [under499, setUnder499] = useState<ProductCard[]>([]);
  const [midRange, setMidRange] = useState<ProductCard[]>([]);
  const [above1099, setAbove1099] = useState<ProductCard[]>([]);
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
    api.products.popularInCity(10).then((r) => { setTrending(r); markLoaded("trending"); }).catch(() => { markLoaded("trending"); markError("trending"); });
    api.products.sellingFast(10).then((r) => { setSellingFast(r); markLoaded("sellingFast"); }).catch(() => { markLoaded("sellingFast"); markError("sellingFast"); });
    api.products.newArrivals(10).then((r) => { setRecent(r); markLoaded("recent"); }).catch(() => { markLoaded("recent"); markError("recent"); });
    api.products.underFiveHundred(10).then((r) => { setUnder499(r); markLoaded("under499"); }).catch(() => { markLoaded("under499"); markError("under499"); });
    api.products.midRange(10).then((r) => { setMidRange(r); markLoaded("midRange"); }).catch(() => { markLoaded("midRange"); markError("midRange"); });
    api.products.premium(10).then((r) => { setAbove1099(r); markLoaded("above1099"); }).catch(() => { markLoaded("above1099"); markError("above1099"); });
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
    popular_in_city: errors.has("trending") ? (
      <SectionError key="trending-error" minHeight="min-h-[320px]" />
    ) : loaded.has("trending") && trending.length > 0 ? (
      <HCarousel key="trending" title="Trending now" subtitle="Most ordered products nearby this week" testid="home-trending">
        {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("trending") ? <ProductRailSkeleton key="trending-skeleton" testid="home-trending-skeleton" /> : null,
    categories: <ShopByCategory key="categories" />,
    selling_fast: errors.has("sellingFast") ? (
      <SectionError key="selling-fast-error" minHeight="min-h-[320px]" />
    ) : loaded.has("sellingFast") && sellingFast.length > 0 ? (
      <HCarousel key="selling_fast" title="Selling fast" subtitle="Don't miss out — limited stock" testid="home-selling-fast">
        {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("sellingFast") ? <ProductRailSkeleton key="selling-fast-skeleton" testid="home-selling-fast-skeleton" /> : null,
    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <OffersStrip key="offers" offers={offers} />
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,
    recently_viewed: errors.has("recent") ? (
      <SectionError key="recent-error" minHeight="min-h-[320px]" />
    ) : loaded.has("recent") && recent.length > 0 ? (
      <HCarousel key="recent" title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="home-recent">
        {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("recent") ? <ProductRailSkeleton key="recent-skeleton" testid="home-recent-skeleton" /> : null,
    under_499: errors.has("under499") ? (
      <SectionError key="under499-error" minHeight="min-h-[320px]" />
    ) : loaded.has("under499") && under499.length > 0 ? (
      <HCarousel key="under_499" title="Under ₹499" subtitle="Great finds that won't break the bank" testid="home-under499">
        {under499.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("under499") ? <ProductRailSkeleton key="under499-skeleton" testid="home-under499-skeleton" /> : null,
    mid_range: errors.has("midRange") ? (
      <SectionError key="midrange-error" minHeight="min-h-[320px]" />
    ) : loaded.has("midRange") && midRange.length > 0 ? (
      <HCarousel key="mid_range" title="₹499–₹1099" subtitle="The sweet spot — quality meets value" testid="home-midrange">
        {midRange.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("midRange") ? <ProductRailSkeleton key="midrange-skeleton" testid="home-midrange-skeleton" /> : null,
    above_1099: errors.has("above1099") ? (
      <SectionError key="above1099-error" minHeight="min-h-[320px]" />
    ) : loaded.has("above1099") && above1099.length > 0 ? (
      <HCarousel key="above_1099" title="Premium picks" subtitle="Curated for the discerning shopper" testid="home-above1099">
        {above1099.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : !loaded.has("above1099") ? <ProductRailSkeleton key="above1099-skeleton" testid="home-above1099-skeleton" /> : null,
    stores: errors.has("popularStores") && !storesRail.length ? (
      <SectionError key="stores-error" minHeight="min-h-[260px]" />
    ) : storesReady && storesRail.length > 0 ? (
      <HCarousel key="stores" title={storesTitle} subtitle="Trusted local merchants delivering today" testid="home-stores" link="/stores" linkLabel="See all">
        {storesRail.map((s) => <StoreCardV2 key={s.id} s={s} />)}
      </HCarousel>
    ) : !storesReady ? <StoreRailSkeleton key="stores-skeleton" /> : null,
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
