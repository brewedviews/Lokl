"use client";

/**
 * MarketplaceHomeClient — "/" only. Discovery/activation surface for
 * someone who hasn't chosen Women/Men/Kids yet: campaign hero, mixed
 * discovery categories, offers, real local store discovery, editorial
 * store modules, "Own a store." Deliberately NOT gender/L1-scoped
 * anywhere in this file — if a section needs to know the customer is
 * shopping a specific L1, it belongs on L1PageClient (/c/[slug]), not
 * here. See that file's own top comment for the split rationale and the
 * shared pieces both surfaces import (OffersSection, BudgetBentoSection,
 * StoreSectionModule, SellerCard's "discovery" variant,
 * StoresNearYouSection).
 *
 * G8 — target order: Hero -> Shop by Category (3x3 mixed) -> Offers ->
 * Best Deals (mixed) -> Picks for Every Budget -> Stores Near You -> Shop
 * by Area -> Ethnic Stores (global) -> Own a Store -> Premium Picks ->
 * Footwear Stores (global).
 *
 * P0-4 (G20 product review) restores Shop by Area — GET /api/areas,
 * AreasEditor and /stores?area= were never removed, only unlinked from
 * this page; see ShopByAreaSection's own doc comment. Shop by Brand and
 * Trending remain unlinked homepage sections (their endpoints/CMS tabs are
 * still untouched, just not part of this P0 pass).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroCarousel } from "@/components/consumer/HeroCarousel";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { TrustStickers } from "@/components/consumer/TrustStickers";
import { OffersSection } from "@/components/consumer/sections/OffersSection";
import { CommunicationStrip } from "@/components/consumer/sections/CommunicationStrip";
import { BudgetBentoSection } from "@/components/consumer/sections/BudgetBentoSection";
import { StoresNearYouSection } from "@/components/consumer/sections/StoresNearYouSection";
import { ShopByAreaSection } from "@/components/consumer/sections/ShopByAreaSection";
import { StoreSectionModule } from "@/components/consumer/sections/StoreSectionModule";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackMerchantCTAClick, trackProductClick } from "@/lib/analytics";
import type { ProductCard as ProductCardType, CategoryNode } from "@/types";

interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }

// Marketplace-only default order — see server.py's DEFAULT_HOMEPAGE_SECTIONS
// for the full shared-list rationale. Only ids registered in this file's
// own sectionRenderers map (below) ever render here, regardless of what
// else exists in the shared CMS doc.
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",                label: "Hero",                             enabled: true, rank: 20 },
  { id: "category_pills",      label: "Shop by Category (marketplace, 3x3)", enabled: true, rank: 25 },
  { id: "marketplace_offers",  label: "Offers for you (marketplace)",     enabled: true, rank: 30 },
  { id: "best_deals",          label: "Best deals",                       enabled: true, rank: 40 },
  { id: "under_499",           label: "Picks for Every Budget",           enabled: true, rank: 50 },
  { id: "stores_near_you",     label: "Stores near you (marketplace)",    enabled: true, rank: 60 },
  { id: "shop_by_area",        label: "Shop by Area",                     enabled: true, rank: 65 },
  { id: "global_store_ethnic", label: "Ethnic Stores (marketplace)",      enabled: true, rank: 70 },
  { id: "merchant_cta",        label: "Own a store",                      enabled: true, rank: 80 },
  { id: "premium_picks",       label: "Premium picks",                    enabled: true, rank: 90 },
  { id: "global_store_footwear", label: "Footwear Stores (marketplace)",  enabled: true, rank: 100 },
];

// ---------------------------------------------------------------------------
// Global "Shop by Category" — 3x3 grid, 9 real, already-imaged L2s mixed
// across Women/Men (G8 §7). Genuinely different from `shop_by_category`
// on L1 pages (that one's per-L1 taxonomy) — this is the marketplace's
// own generic discovery set. Plain constant array (same shape L1PageClient's
// WOMEN_CATEGORY_TILES etc. already use) rather than new CMS UI — easy to
// edit later without inventing a config surface this phase doesn't need.
// ---------------------------------------------------------------------------
interface MixedCategorySpec { label: string; l1Slug: string; l2Slug: string }

const MIXED_CATEGORY_TILES: MixedCategorySpec[] = [
  { label: "Dresses",        l1Slug: "women", l2Slug: "dresses" },
  { label: "Tops",           l1Slug: "women", l2Slug: "tops" },
  { label: "T-Shirts",       l1Slug: "men",   l2Slug: "tshirts" },
  { label: "Bottoms",        l1Slug: "women", l2Slug: "bottoms" },
  { label: "Jeans",          l1Slug: "men",   l2Slug: "jeans" },
  { label: "Ethnic",         l1Slug: "women", l2Slug: "ethnic-wear" },
  { label: "Lingerie",       l1Slug: "women", l2Slug: "lingerie" },
  { label: "Footwear",       l1Slug: "women", l2Slug: "footwear" },
  { label: "Men's Footwear", l1Slug: "men",   l2Slug: "footwear" },
];

interface ResolvedMixedTile { key: string; href: string; image: string | null; label: string }

function resolveMixedCategoryTiles(categories: CategoryNode[]): ResolvedMixedTile[] {
  const out: ResolvedMixedTile[] = [];
  for (const spec of MIXED_CATEGORY_TILES) {
    const l1 = categories.find((c) => c.slug === spec.l1Slug);
    const l2 = l1?.l2.find((s) => s.slug === spec.l2Slug);
    if (!l1 || !l2) continue;
    out.push({ key: l2.id, href: `/c/${l1.slug}/${l2.slug}`, image: l2.image || null, label: spec.label });
  }
  return out;
}

function ShopByCategoryMarketplaceSection({ categories }: { categories: CategoryNode[] }) {
  const tiles = resolveMixedCategoryTiles(categories);
  if (tiles.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3" data-testid="home-category_pills">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">Shop by Category</h2>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((t) => (
          <CategoryTile
            key={t.key}
            density="generous"
            href={t.href}
            testId={`shop-by-category-tile-${t.key}`}
            image={t.image ? cloudinaryOptimize(t.image, "w_400,q_auto,f_auto") : undefined}
            label={t.label}
          />
        ))}
      </div>
    </div>
  );
}

export function MarketplaceHomeClient() {
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  // Best Deals / Premium Picks — mixed (not L1-scoped) on the marketplace,
  // same /api/products endpoint L1PageClient's own L1-scoped rails use,
  // just without an `l1` param.
  const { data: bestDeals = [], isPending: bestDealsPending, isError: bestDealsErrored } = useQuery({
    queryKey: ["marketplace-best-deals"],
    queryFn: async () => {
      const r = await apiClient.get<{ products: ProductCardType[] }>("/api/products", { params: { sort: "discount", limit: 8 } });
      return Array.isArray(r.data) ? r.data : (r.data?.products || []);
    },
  });
  const { data: premiumPicks = [], isPending: premiumPicksPending, isError: premiumPicksErrored } = useQuery({
    queryKey: ["marketplace-premium-picks"],
    queryFn: async () => {
      const r = await apiClient.get<{ products: ProductCardType[] }>("/api/products", { params: { sort: "price_desc", limit: 8 } });
      return Array.isArray(r.data) ? r.data : (r.data?.products || []);
    },
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
  }, []);

  const ProductRailSkeleton = ({ testid }: { testid: string }) => (
    <div data-testid={testid} className="pt-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="h-6 w-44 rounded-full bg-[#E5E2DC] animate-pulse mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[38vw] sm:w-[180px] md:w-[200px] aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
        ))}
      </div>
    </div>
  );

  const sectionRenderers: Record<string, React.ReactNode> = {
    // P0-6 — the thin communication strip renders fixed immediately below
    // the hero, independent of section rank (it's not something an admin
    // reorders relative to other sections, only turns on/off per surface
    // via the CMS `placement` field on the underlying offers doc).
    hero: (
      <div key="hero">
        <HeroCarousel l1Id="global" />
        <CommunicationStrip surface="global" />
      </div>
    ),

    category_pills: <ShopByCategoryMarketplaceSection key="category-pills" categories={categories} />,

    marketplace_offers: <OffersSection key="marketplace-offers" surface="global" />,

    best_deals: bestDealsErrored ? null
      : !bestDealsPending && bestDeals.length >= 1 ? (
          <HCarousel key="best-deals" title="Best deals" testid="home-best-deals" link="/products?sort=discount" linkLabel="See all">
            {bestDeals.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "best_deals", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : bestDealsPending ? <ProductRailSkeleton key="best-deals-skeleton" testid="home-best-deals-skeleton" /> : null,

    under_499: <BudgetBentoSection key="budget-bento" />,

    stores_near_you: <StoresNearYouSection key="stores-near-you" />,

    shop_by_area: <ShopByAreaSection key="shop-by-area" />,

    global_store_ethnic: (
      <StoreSectionModule
        key="global-store-ethnic"
        l1Id="global"
        l2Id="global-ethnic"
        l2Href="/stores"
        l2Image={null}
        defaultHeading="Ethnic Stores"
        bannerLabel="Ethnic"
        testSlug="global-ethnic"
      />
    ),

    merchant_cta: (
      // G13 §7 — polish only, section order unchanged (the G8-G11 rank
      // order was deliberately established; this brief only asked to
      // improve presentation, not move it). A supporting line + slightly
      // more breathing room makes this read as a deliberate content block
      // in the local-discovery narrative rather than a thin ad strip
      // dropped between two unrelated rails.
      <div key="merchant-cta" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <a
          href="https://lokl.up.railway.app/merchant/register"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { try { trackMerchantCTAClick("homepage"); } catch {} }}
          className="block"
        >
          <div className="bg-[#0A1F5C] rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-white font-display font-medium text-base leading-tight truncate">Own a store in Bhilai?</p>
              <p className="text-white/70 text-xs mt-0.5 leading-snug line-clamp-2">Put your store on Lokl and reach nearby shoppers.</p>
            </div>
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

    premium_picks: premiumPicksErrored ? null
      : !premiumPicksPending && premiumPicks.length >= 1 ? (
          <HCarousel key="premium-picks" title="Premium picks" testid="home-premium-picks" link="/products?sort=price_desc" linkLabel="See all">
            {premiumPicks.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "premium_picks", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : premiumPicksPending ? <ProductRailSkeleton key="premium-picks-skeleton" testid="home-premium-picks-skeleton" /> : null,

    global_store_footwear: (
      <StoreSectionModule
        key="global-store-footwear"
        l1Id="global"
        l2Id="global-footwear"
        l2Href="/stores"
        l2Image={null}
        defaultHeading="Footwear Stores"
        bannerLabel="Footwear"
        testSlug="global-footwear"
      />
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
