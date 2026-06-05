"use client";

/**
 * Home page client tree — fetches all rails in parallel and composes the
 * HeroV2 + OffersStrip + Trending/SellingFast/NewArrivals carousels +
 * CustomerLove + nearby stores.
 *
 * Kept entirely client-side because the home page is heavily personalized
 * (geolocation-aware feeds, wishlist heart state, cart badge) — SSR would
 * just create hydration churn here. The SSR-critical pages are PDP + Store.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { HeroV2 } from "@/components/consumer/v2/HeroV2";
import { OffersStrip } from "@/components/consumer/v2/OffersStrip";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { StoreCardV2 } from "@/components/consumer/v2/StoreCardV2";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { Footer } from "@/components/consumer/Footer";
import { useLocationStore } from "@/stores";
import type { ProductCard, StoreCard } from "@/types";

interface OfferDoc { id: string; title: string; subtitle?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface HomeStatsDoc { fastest_eta_min?: number }
interface HeroConfigDoc { image?: string; eyebrow?: string; title_line1?: string; title_line2?: string; subtitle?: string }

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
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
      const heroPayload = (cfg as unknown as { hero?: HeroConfigDoc }).hero ?? null;
      setHero(heroPayload);
    }).catch(() => {});
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => {});
    api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
    api.products.popularInCity(10).then(setTrending).catch(() => {});
    api.products.sellingFast(10).then(setSellingFast).catch(() => {});
    api.products.newArrivals(10).then(setRecent).catch(() => {});
    api.stores.popular(8).then(setPopularStores).catch(() => {});
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 8 }).then(setNearby).catch(() => {});
    }
  }, [lat, lng]);

  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const railTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1">
        <HeroV2 stats={stats} hero={hero} />
        {offers.length > 0 && <OffersStrip offers={offers} />}
        {storesRail.length > 0 && (
          <HCarousel title={railTitle} subtitle="Trusted local merchants delivering today" testid="home-stores" link="/stores" linkLabel="See all">
            {storesRail.map((s) => <StoreCardV2 key={s.id} s={s} />)}
          </HCarousel>
        )}
        {trending.length > 0 && (
          <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid="home-trending" link="/categories" linkLabel="See all">
            {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
        {sellingFast.length > 0 && (
          <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="home-selling-fast" link="/categories">
            {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
        {recent.length > 0 && (
          <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="home-recent" link="/categories" linkLabel="See all">
            {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
        <CustomerLove items={testimonials} />
      </main>
      <Footer topGap={false} />
    </div>
  );
}
