"use client";

/**
 * L2ProductRailSection — G9 §3's replacement for the old L1 editorial
 * store-card modules (Footwear/Ethnic/Lingerie Stores). Those modules
 * repeated the same "store card wall" three times per L1 page; G9 wants
 * "more products, less repetitive store UI" — one product/category rail
 * per L2 instead, using real taxonomy (no invented categories) and the
 * SAME `/api/products?l1=&l2=` endpoint `BrowseGridBlock`/`L2PlpClient`
 * already use, so no new backend work. "See all" links straight to the
 * matching `L2PlpClient` route — the same predictable L2-click model
 * §8 asks for everywhere else. Renders nothing when the L2 has zero
 * products (graceful drop, same convention every other optional L1
 * module already used).
 */
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType } from "@/types";

export function L2ProductRailSection({
  l1Id, l2Id, l2Href, heading, testid,
}: {
  l1Id: string;
  l2Id: string;
  l2Href: string;
  heading: string;
  testid: string;
}) {
  const [products, setProducts] = useState<ProductCardType[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<ProductCardType[]>("/api/products", { params: { l1: l1Id, l2: l2Id, limit: 10 } })
      .then((r) => { if (!cancelled) setProducts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [l1Id, l2Id]);

  if (!products || products.length === 0) return null;

  return (
    <HCarousel title={heading} link={l2Href} linkLabel="See all" testid={testid}>
      {products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
    </HCarousel>
  );
}
