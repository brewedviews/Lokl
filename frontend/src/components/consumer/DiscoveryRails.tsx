"use client";

/** "Keep shopping" rails for empty cart/wishlist. Client-side fetch. */
import { useEffect, useState } from "react";
import { OffersStrip } from "./v2/OffersStrip";
import { HCarousel } from "./v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { api } from "@/lib/api";
import type { ProductCard as ProductCardType } from "@/types";

interface OfferDoc { id: string; title: string; subtitle?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }

export function DiscoveryRails({ testidPrefix = "discovery" }: { testidPrefix?: string }) {
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [sellingFast, setSellingFast] = useState<ProductCardType[]>([]);
  const [recent, setRecent] = useState<ProductCardType[]>([]);

  useEffect(() => {
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => {});
    api.products.popularInCity(10).then(setTrending).catch(() => {});
    api.products.sellingFast(10).then(setSellingFast).catch(() => {});
    api.products.newArrivals(10).then(setRecent).catch(() => {});
  }, []);

  return (
    <>
      {offers.length > 0 && <OffersStrip offers={offers} />}
      {trending.length > 0 && (
        <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid={`${testidPrefix}-trending`} link="/categories" linkLabel="See all">
          {trending.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
        </HCarousel>
      )}
      {sellingFast.length > 0 && (
        <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid={`${testidPrefix}-selling-fast`} link="/categories">
          {sellingFast.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
        </HCarousel>
      )}
      {recent.length > 0 && (
        <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid={`${testidPrefix}-recent`} link="/categories" linkLabel="See all">
          {recent.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
        </HCarousel>
      )}
    </>
  );
}
