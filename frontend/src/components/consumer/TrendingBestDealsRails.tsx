"use client";

/**
 * Trending Now + Best Deals, in that order — the same two rails the
 * homepage shows, sourced from the same /api/feed/home-products endpoint
 * HomeClient.tsx uses for these rails. Deliberately NOT a refactor of
 * HomeClient's own inline rendering: that fetch is fused with store_rails
 * and a two-level fallback chain that doesn't apply outside the homepage.
 * This is a lean, independent consumer of the same backend response shape,
 * so both surfaces always reflect the same trending/best-deals logic
 * without either one drifting from a second, different data source.
 *
 * Used on the empty-bag page (and anywhere else that wants "what the
 * homepage shows" rather than a bespoke rail set). Each rail collapses
 * cleanly (renders nothing) once loaded if it has no products — no empty
 * skeleton lingers.
 */
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { HCarousel } from "./v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType } from "@/types";

interface HomeProductsResponse {
  trending: ProductCardType[];
  best_deals: ProductCardType[];
}

export function TrendingBestDealsRails({ testidPrefix = "home" }: { testidPrefix?: string }) {
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [bestDeals, setBestDeals] = useState<ProductCardType[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiClient.get<HomeProductsResponse>("/api/feed/home-products")
      .then((r) => {
        setTrending(r.data?.trending || []);
        setBestDeals(r.data?.best_deals || []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <>
      {trending.length > 0 && (
        <HCarousel title="Trending now" testid={`${testidPrefix}-trending`} link="/products?sort=trending" linkLabel="See all">
          {trending.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} size="default" />)}
        </HCarousel>
      )}
      {bestDeals.length > 0 && (
        <HCarousel title="Best deals" testid={`${testidPrefix}-best-deals`} link="/products?sort=discount" linkLabel="See all">
          {bestDeals.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} size="default" />)}
        </HCarousel>
      )}
    </>
  );
}
