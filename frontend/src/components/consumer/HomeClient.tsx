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
  { id: "recently_viewed", label: "Recently added",             enabled: true, rank: 60 },
  { id: "stores",          label: "Popular stores",             enabled: true, rank: 70 },
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
  const [nearby, setNearby] = useState<StoreCard[]>([]);
  const [popularStores, setPopularStores] = useState<StoreCard[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);

  useEffect(() => {
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[] };
      if (c.hero) setHero(c.hero);
      if (Array.isArray(c.sections) && c.sections.length > 0) setSections(c.sections);
    }).catch(() => { /* fall back to DEFAULT_SECTIONS */ });
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => {});
    api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
    api.products.popularInCity(10).then(setTrending).catch(() => {});
    api.products.sellingFast(10).then(setSellingFast).catch(() => {});
    api.products.newArrivals(10).then(setRecent).catch(() => {});
    api.stores.popular(10).then(setPopularStores).catch(() => {});
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then(setNearby).catch(() => {});
    }
  }, [lat, lng]);

  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

  // Iter-26 — Section registry. Keys MUST match the section IDs the CMS
  // publishes from `site_config.sections[].id` (popular_in_city / categories
  // / offers / selling_fast / stores / recently_viewed / customer_love).
  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: <HeroV2 key="hero" stats={stats} hero={hero} />,
    popular_in_city: trending.length > 0 ? (
      <HCarousel key="trending" title="Trending now" subtitle="Most ordered products nearby this week" testid="home-trending" link="/categories" linkLabel="See all">
        {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : null,
    categories: <ShopByCategory key="categories" />,
    selling_fast: sellingFast.length > 0 ? (
      <HCarousel key="selling_fast" title="Selling fast" subtitle="Don't miss out — limited stock" testid="home-selling-fast" link="/categories">
        {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : null,
    offers: offers.length > 0 ? <OffersStrip key="offers" offers={offers} /> : null,
    recently_viewed: recent.length > 0 ? (
      <HCarousel key="recent" title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="home-recent" link="/categories" linkLabel="See all">
        {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
      </HCarousel>
    ) : null,
    stores: storesRail.length > 0 ? (
      <HCarousel key="stores" title={storesTitle} subtitle="Trusted local merchants delivering today" testid="home-stores" link="/stores" linkLabel="See all">
        {storesRail.map((s) => <StoreCardV2 key={s.id} s={s} />)}
      </HCarousel>
    ) : null,
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
