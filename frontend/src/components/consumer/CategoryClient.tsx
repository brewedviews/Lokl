"use client";

/**
 * Category L1 (and L2 via [...l2slug] sub-route, handled by the same UI).
 * Renders L2 tiles when the user is on `/c/[slug]` AND the category has
 * L2 children; otherwise shows the product grid filtered by gender + sort.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { OffersStrip } from "@/components/consumer/v2/OffersStrip";
import { Footer } from "@/components/consumer/Footer";
import type { ProductCard, CategoryNode } from "@/types";

type L2 = { id: string; name: string; slug: string; image?: string };
type Cat = Omit<CategoryNode, "l2"> & { l2?: L2[] };
interface OfferDoc { id: string; title: string; subtitle?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }

interface Props {
  l2slug?: string;
}

export function CategoryClient({ l2slug = "" }: Props) {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [gender, setGender] = useState("");
  const [sort, setSort] = useState("trending");

  const l1 = useMemo(() => cats.find((c) => c.slug === slug), [cats, slug]);
  const l2 = useMemo(() => (l1?.l2 ?? []).find((s) => s.slug === l2slug) || null, [l1, l2slug]);
  const showingL2 = !!l2;
  const showL2Tiles = !!l1 && (l1.l2?.length ?? 0) > 0 && !showingL2;

  useEffect(() => {
    api.catalog.categories().then((r) => setCats(r as Cat[])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!l1) return;
    const params = new URLSearchParams({ l1: l1.id, sort });
    if (l2) params.set("l2", l2.id);
    if (gender) params.set("gender", gender);
    apiClient
      .get<ProductCard[]>(`/api/products?${params.toString()}`)
      .then((r) => setProducts(r.data))
      .catch(() => setProducts([]));
  }, [l1, l2, gender, sort]);

  useEffect(() => {
    if (!showingL2) { setOffers([]); return; }
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => setOffers([]));
  }, [showingL2]);

  if (!l1) return <div className="p-10 text-center text-[#595959]">Loading…</div>;

  const title = l2 ? l2.name : l1.name;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
          <div className="flex items-center gap-2 text-xs text-[#595959] mb-2 flex-wrap">
            <Link href="/" className="hover:text-[#1A2B4C]">Home</Link><span>›</span>
            <Link href="/categories" className="hover:text-[#1A2B4C]">Categories</Link><span>›</span>
            {l2 ? (
              <>
                <Link href={`/c/${l1.slug}`} className="hover:text-[#1A2B4C]">{l1.name}</Link>
                <span>›</span><span data-testid="crumb-l2">{l2.name}</span>
              </>
            ) : (
              <span data-testid="crumb-l1">{l1.name}</span>
            )}
          </div>
          <h1 data-testid="cat-title" className="font-display text-3xl md:text-5xl font-bold text-[#1A2B4C] leading-tight">{title}</h1>

          {showL2Tiles ? (
            <>
              <p className="text-[#595959] text-sm mt-1">Browse {l1.name.toLowerCase()} by category</p>
              <div className="mt-6 grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
                {l1.l2!.map((s) => {
                  // iter-27 (Item 7) — non_clickable L2 renders as a static tile.
                  const inner = (
                    <>
                      <div className="relative aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                        {s.image && <Image src={s.image} alt={s.name} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover group-hover:scale-110 transition duration-500" />}
                      </div>
                      <div className="text-center mt-2 text-xs font-medium text-[#1C1C1C]">{s.name}</div>
                    </>
                  );
                  if ((s as { non_clickable?: boolean }).non_clickable) {
                    return (
                      <div key={s.id} data-testid={`l2-${s.slug}`} className="group rounded-2xl transition cursor-default">
                        {inner}
                      </div>
                    );
                  }
                  return (
                    <Link key={s.id} href={(s as { redirect_url?: string }).redirect_url || `/c/${l1.slug}/${s.slug}`} data-testid={`l2-${s.slug}`} className="group rounded-2xl active:scale-95 transition">
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="mt-6 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#595959] uppercase">Shop for:</span>
              {([["", "Everyone"], ["women", "Women"], ["men", "Men"], ["kids", "Kids"], ["unisex", "Unisex"]] as const).map(([g, l]) => (
                <button key={g || "all"} onClick={() => setGender(g)} data-testid={`gender-${g || "all"}`}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${gender === g ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white text-[#1C1C1C] border-[#E5E2DC]"}`}>
                  {l}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-[#595959]">{products.length} product{products.length !== 1 ? "s" : ""}</p>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-[#595959]" />
              <select value={sort} onChange={(e) => setSort(e.target.value)} data-testid="sort-select" className="px-3 py-2 rounded-full bg-white border border-[#E5E2DC] text-xs">
                <option value="trending">Trending</option><option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option><option value="rating">Top Rated</option>
              </select>
            </div>
          </div>

          {products.length === 0 ? (
            <div className="mt-6 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <h3 className="font-display text-xl md:text-2xl font-bold text-[#1A2B4C]">Coming soon to {title} in Bhilai</h3>
              <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We&apos;re onboarding local sellers right now — fresh drops will land here shortly.</p>
            </div>
          ) : (
            <div data-testid="cat-product-grid" className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {products.map((p) => <ProductCardV2 key={p.id} p={p} />)}
            </div>
          )}
        </div>
        {showingL2 && offers.length > 0 && <OffersStrip offers={offers} />}
      </main>
      <Footer />
    </div>
  );
}
