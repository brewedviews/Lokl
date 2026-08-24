"use client";

/**
 * MarketplaceHomeClient — "/" only (G7). Discovery/activation surface for
 * someone who hasn't chosen Women/Men/Kids yet: campaigns, offers, local
 * store discovery, generic categories, Shop by Area. Deliberately NOT
 * gender/L1-scoped anywhere in this file — if a section needs to know
 * the customer is shopping a specific L1, it belongs on L1PageClient
 * (/c/[slug]), not here. See that file's own top comment for the split
 * rationale and the shared pieces both surfaces import (OffersSection,
 * SellerCard's "discovery" variant, StoresNearYouSection).
 *
 * Before G7 this route rendered through L1PageClient with
 * `l1Id="l1-women" mode="home"` — i.e. Home was actually Women's
 * shopping page wearing a "home" label. That's gone: this is a
 * genuinely separate, smaller section composition, reusing existing
 * components/endpoints throughout (HeroCarousel, CategoryTile, the same
 * ranked site_config.homepage.sections doc L1PageClient reads — a
 * section simply doesn't render here if it's not registered in this
 * file's own `sectionRenderers` map, same "unknown id -> not rendered"
 * fallback used everywhere else in this codebase).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroCarousel } from "@/components/consumer/HeroCarousel";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { TrustStickers } from "@/components/consumer/TrustStickers";
import { OffersSection } from "@/components/consumer/sections/OffersSection";
import { StoresNearYouSection } from "@/components/consumer/sections/StoresNearYouSection";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackCategoryTileClick, trackCategoryTileImpression, trackMerchantCTAClick, trackProductClick, observeImpression } from "@/lib/analytics";
import type { ProductCard as ProductCardType, AreaTile, Brand } from "@/types";

interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }

// Marketplace-only default order — see server.py's DEFAULT_HOMEPAGE_SECTIONS
// for the full shared-list rationale. Only ids registered in this file's
// own sectionRenderers map (below) ever render here, regardless of what
// else exists in the shared CMS doc.
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",            label: "Hero",                        enabled: true, rank: 20 },
  { id: "category_pills",  label: "Shop by Category (marketplace)", enabled: true, rank: 10 },
  { id: "offers",          label: "Offers for you",             enabled: true, rank: 45 },
  { id: "stores_near_you", label: "Stores near you (marketplace)", enabled: true, rank: 50 },
  { id: "shop_by_area",    label: "Shop by Area",               enabled: true, rank: 60 },
  { id: "trending",        label: "Trending now",                enabled: true, rank: 70 },
  { id: "shop_by_brand",   label: "Shop by Brand",              enabled: true, rank: 140 },
  { id: "merchant_cta",    label: "Open a store",               enabled: true, rank: 170 },
];

function ShopByAreaSection({ areas }: { areas: AreaTile[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_area">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Area</h2>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {areas.map((a) => (
          <CategoryTile
            key={a.slug}
            density="generous"
            href={`/stores?area=${a.slug}`}
            testId={`shop-by-area-tile-${a.slug}`}
            image={a.image ? cloudinaryOptimize(a.image, "w_400,q_auto,f_auto") : undefined}
            label={a.name}
            badge={
              <span className="inline-flex items-center rounded-pill bg-white px-2 py-0.5 text-[10px] font-bold leading-none text-brand-primary shadow-[0_1px_4px_rgba(0,0,0,0.3)]" data-testid={`shop-by-area-count-${a.slug}`}>
                {a.store_count} {a.store_count === 1 ? "store" : "stores"}
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}

interface MarketplaceCategory { id: string; slug: string; name: string; image?: string | null }

// Promoted from G6's `category_pills` (was `hidden md:grid`, no heading,
// desktop-only) into the marketplace's own primary "generic Shop by
// Category" (G7 §20) — the real flat L1 list (Women/Men/Kids/Footwear/
// Ethnic/Lingerie/Accessories/Beauty/Sports), not invented. Now a
// horizontal-scroll row on mobile (same CategoryTile "dense" treatment
// used elsewhere) instead of being hidden there entirely.
function ShopByCategoryMarketplaceSection({ categories }: { categories: MarketplaceCategory[] }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3" data-testid="home-category_pills">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Category</h2>
      <div className="flex md:grid md:grid-cols-10 gap-3 md:gap-4 overflow-x-auto no-scrollbar pb-1">
        <Link
          href="/products"
          className="group relative shrink-0 w-20 md:w-auto aspect-[3/4] rounded-2xl overflow-hidden bg-[#0A1F5C] flex flex-col items-center justify-center gap-2 transition hover:scale-[1.02]"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          <span className="font-bold text-white text-xs">All</span>
        </Link>
        {categories.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shrink-0 w-20 md:w-auto aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
          ))
        ) : (
          categories.slice(0, 9).map((cat, catIdx) => (
            <Link key={cat.id} href={`/c/${cat.slug}`}
              onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
              ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
              className="group relative shrink-0 w-20 md:w-auto aspect-[3/4] rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC] transition hover:border-[#0A1F5C]"
            >
              {cat.image ? (
                <img src={cloudinaryOptimize(cat.image, "w_400,q_auto,f_auto")} alt={cat.name}
                  loading="eager" fetchPriority={catIdx === 0 ? "high" : "auto"}
                  className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105" />
              ) : (
                <div className="w-full h-full bg-[#E5E2DC]" />
              )}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none" />
              <span className="absolute bottom-2.5 left-2 right-2 font-bold text-white text-[11px] md:text-sm leading-tight line-clamp-2 break-words">
                {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function ShopByBrandSection({ brands, ready }: { brands: Brand[]; ready: boolean }) {
  return (
    <div className="pt-8" data-testid="home-shop_by_brand">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-lg sm:text-xl font-display font-bold text-[#0A1F5C] leading-tight">Shop by Brand</h3>
          <p className="text-[13px] text-[#595959] mt-1">the labels your favourite local stores carry.</p>
        </div>
        <a href="/brands" className="text-xs font-bold text-[#0A1F5C] shrink-0 hover:underline">See all →</a>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
        {!ready ? (
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div className="w-16 h-16 rounded-full bg-[#E5E2DC] animate-pulse" />
                <div className="w-14 h-2.5 rounded bg-[#E5E2DC] animate-pulse" />
              </div>
            ))}
          </div>
        ) : brands.length === 0 ? (
          <div className="bg-[#F4F1E9] rounded-2xl px-5 py-6 text-center flex flex-col items-center gap-2" data-testid="shop-by-brand-empty">
            <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
              <Tag size={16} className="text-[#E68910]" />
            </div>
            <p className="text-[12px] font-semibold text-[#0A1F5C] max-w-xs mx-auto">
              Brands are being added as stores tag their products — check back soon.
            </p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
            {brands.slice(0, 10).map((b) => (
              <CategoryTile
                key={b.id}
                density="dense"
                label={b.name}
                image={b.logo || null}
                href={`/brand/${b.slug}`}
                fallback={<Tag size={18} className="text-[#94A3B8]" />}
                testId={`shop-by-brand-${b.slug}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MarketplaceHomeClient() {
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [areas, setAreas] = useState<AreaTile[]>([]);
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [popularBrands, setPopularBrands] = useState<Brand[]>([]);
  const [brandsLoaded, setBrandsLoaded] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { sections?: SectionDoc[] };
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        const defaultMap = new Map(DEFAULT_SECTIONS.map((s) => [s.id, s]));
        const fromServer = c.sections
          .filter((s: SectionDoc) => defaultMap.has(s.id)) // only ids this surface knows how to render
          .map((s: SectionDoc) => {
            const fallback = defaultMap.get(s.id);
            return {
              id: s.id,
              label: s.label || fallback?.label || s.id,
              enabled: typeof s.enabled === "boolean" ? s.enabled : (fallback?.enabled ?? true),
              rank: typeof s.rank === "number" && !Number.isNaN(s.rank) ? s.rank : (fallback?.rank ?? 999),
            };
          });
        const seenIds = new Set(fromServer.map((s) => s.id));
        const missing = DEFAULT_SECTIONS.filter((s) => !seenIds.has(s.id));
        setSections([...fromServer, ...missing]);
      }
    }).catch(() => {});

    api.catalog.areas().then((r) => setAreas(r)).catch(() => {});

    apiClient.get<{ trending: ProductCardType[] }>("/api/feed/home-products").then((r) => {
      setTrending(r.data?.trending || []);
      setTrendingLoaded(true);
    }).catch(() => setTrendingLoaded(true));

    api.brands.list({ limit: 10, sort: "popular" })
      .then((r) => { setPopularBrands(r.brands.filter((b) => b.product_count > 0)); setBrandsLoaded(true); })
      .catch(() => setBrandsLoaded(true));
  }, []);

  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: <HeroCarousel key="hero" l1Id="global" />,

    category_pills: <ShopByCategoryMarketplaceSection key="category-pills" categories={categories as MarketplaceCategory[]} />,

    offers: <OffersSection key="offers" />,

    stores_near_you: <StoresNearYouSection key="stores-near-you" />,

    shop_by_area: <ShopByAreaSection key="shop-by-area" areas={areas} />,

    trending: trendingLoaded && trending.length >= 1 ? (
      <HCarousel key="trending" title="Trending now" testid="home-new-arrivals" link="/products?sort=trending" linkLabel="See all">
        {trending.slice(0, 8).map((p, pIdx) => (
          <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "trending", position: pIdx }); } catch {} }}>
            <ProductCard p={p} size="default" />
          </div>
        ))}
      </HCarousel>
    ) : null,

    shop_by_brand: <ShopByBrandSection key="shop-by-brand" brands={popularBrands} ready={brandsLoaded} />,

    merchant_cta: (
      <div key="merchant-cta" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <a
          href="https://lokl.up.railway.app/merchant/register"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { try { trackMerchantCTAClick("homepage"); } catch {} }}
          className="block"
        >
          <div className="bg-[#0A1F5C] rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
            <p className="min-w-0 text-white font-bold text-sm leading-tight truncate">Own a store in Bhilai?</p>
            <div className="flex-shrink-0 flex items-center gap-2 bg-[#E68910] text-white text-xs font-bold px-3 py-2 rounded-xl">
              <span>Join free</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        </a>
      </div>
    ),
  };

  const orderedSections = [...sections]
    .filter((s) => s.enabled !== false)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((s) => sectionRenderers[s.id])
    .filter(Boolean);

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <main className="flex-1">
        {orderedSections}
        <TrustStickers />
      </main>
    </div>
  );
}
