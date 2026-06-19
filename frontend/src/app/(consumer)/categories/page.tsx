"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { OffersStrip } from "@/components/consumer/v2/OffersStrip";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { Footer } from "@/components/consumer/Footer";
import type { ProductCard, CategoryCount } from "@/types";

interface OfferDoc { id: string; title: string; subtitle?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
type CategoryCountWithCount = CategoryCount & { slug: string; product_count?: number };

export default function CategoryHubPage() {
  const [cats, setCats] = useState<CategoryCountWithCount[]>([]);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCard[]>([]);
  const [sellingFast, setSellingFast] = useState<ProductCard[]>([]);
  const [recent, setRecent] = useState<ProductCard[]>([]);

  useEffect(() => {
    api.catalog.categoryCounts().then((r) => setCats(r as unknown as CategoryCountWithCount[])).catch(() => setCats([]));
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => setOffers([]));
    api.products.popularInCity(10).then(setTrending).catch(() => {});
    api.products.sellingFast(10).then(setSellingFast).catch(() => {});
    api.products.newArrivals(10).then(setRecent).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1">
        <section data-testid="category-hub-grid" className="max-w-7xl mx-auto px-4 sm:px-8 pt-8">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Shop by category</h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-1">All categories from your nearby stores.</p>
          {cats.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#64748B]">Loading categories…</div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4 mt-5">
                {cats.map((c) => (
                  <Link
                    key={c.id}
                    href={`/c/${c.slug}`}
                    data-testid={`category-tile-${c.slug}`}
                    className="group bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-md transition active:scale-95"
                  >
                    <div className="relative h-20 bg-slate-100">
                      {c.image && (
                        <Image src={c.image} alt={c.name} fill sizes="(max-width: 640px) 33vw, 16vw" className="object-cover group-hover:scale-105 transition duration-500" />
                      )}
                    </div>
                    <div className="text-center py-2 px-1">
                      <div className="text-[12px] font-bold text-[#0A1F5C]">{c.name}</div>
                      <div className="text-[10px] text-[#64748B] mt-0.5">{(c.product_count ?? c.count ?? 0).toLocaleString()} products</div>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mt-6">
                <Link href="/products" className="block w-full py-3.5 text-center bg-[#1A2B4C] text-white rounded-2xl font-semibold text-sm">
                  Browse all products →
                </Link>
              </div>
            </>
          )}
        </section>
        {offers.length > 0 && <OffersStrip offers={offers} />}
        {trending.length > 0 && (
          <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid="hub-trending" link="/categories" linkLabel="See all">
            {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
        {sellingFast.length > 0 && (
          <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid="hub-selling-fast" link="/categories">
            {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
        {recent.length > 0 && (
          <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid="hub-recent" link="/categories" linkLabel="See all">
            {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </HCarousel>
        )}
      </main>
      <Footer />
    </div>
  );
}
