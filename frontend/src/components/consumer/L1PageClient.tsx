"use client";

/**
 * L1PageClient — the ONE shared, L1-parameterized page tree behind both
 * "/" (Home) and "/c/[slug]" (+ its L2 catch-all, "/c/[slug]/[...l2slug]").
 *
 * Redesign Phase E: before this, HomeClient.tsx and CategoryClient.tsx
 * were two genuinely separate implementations, manually kept in visual
 * sync across Phases A-D — see this session's own discovery report for
 * the full accounting of what was duplicated (Best Deals vs Bestsellers,
 * two different stores-rail implementations) vs. what was already shared
 * (HeroCarousel, SellerCard, CategoryTile). This file replaces both:
 * HomeClient.tsx is deleted entirely (see git history), and CategoryClient
 * .tsx's old slug-resolution responsibility moved to a thin wrapper,
 * CategoryRouteClient.tsx, that resolves a URL slug to an `l1Id` and
 * mounts this component — the exact same "resolve then render" shape
 * CategoryClient used internally, just extracted one layer up so this
 * component's own required input is just `l1Id`, not a slug.
 *
 * Two required decisions, made here rather than silently:
 *
 * 1. Best Deals (sort=discount) vs Bestsellers (sort=rating) — NOT kept
 *    as two rails. CategoryClient's own old doc comment stated its intent
 *    outright: "'Bestsellers' uses rating as the closest available
 *    quality signal to Home's Best deals rail (which sorts by discount %
 *    — not exposed as a query param here)." That parenthetical was wrong
 *    — GET /api/products has supported `sort=discount` the whole time
 *    (see server.py's all_products()); CategoryClient just didn't know
 *    it when written. Given the rail's own stated intent was to mirror
 *    Best Deals, and the only reason it diverged was a stale assumption
 *    about backend capability, this merge keeps ONE canonical rail — Best
 *    Deals, sort=discount, now L1-scoped via the real l1Id on every page
 *    — and drops "Bestsellers" (sort=rating) as the now-provably-redundant
 *    version, not a silent unexplained deletion.
 *
 * 2. Stores rail — CategoryClient's flat "Stores in {L1}" (one
 *    unscoped-by-L2 GET /categories/{l1}/stores call) is also dropped,
 *    not merged. It was never part of Phase D's locked homepage sequence.
 *    The unified page instead inherited the two things Phase D locked
 *    in: `meet_sellers` ("Shops near you" — nearby/popular stores,
 *    unscoped by L1, same everywhere) and the three gendered-L2 store
 *    modules (store_footwear/store_ethnic/store_lingerie — narrower than
 *    CategoryClient's old rail, scoped to a specific L2 not the whole
 *    L1). Together these were a strict superset of what the old L1-wide
 *    rail was approximating with a single blunt query — not two
 *    implementations of the same feature, one already-locked pair
 *    replacing one ad hoc one. Phase G2 later removed `meet_sellers`
 *    outright (see DEFAULT_SECTIONS' own comment below) — the three
 *    gendered-L2 store modules and Phase F's `shop_by_store` carousel
 *    now carry the whole stores-discovery job.
 *
 * `mode` — the one real difference left between the two surfaces after
 * the above: /c/[slug]'s own intrinsic browsing UI (an L2 filter grid +
 * a full sortable "Browse all {L1}" product grid) is NOT part of the
 * ranked CMS section system and never should be — it's core category-
 * browsing chrome, not a merchandising/discovery section an admin
 * toggles on and off, and it needs page-local filter state the CMS
 * sections don't. Home never rendered anything like it (its own
 * `browse_all` CMS section was a small CTA banner linking OUT to
 * /products, not an inline grid, until Phase G2 removed it — see
 * DEFAULT_SECTIONS' own comment) and Phase E's regression requirement was
 * that Home renders IDENTICALLY to before — so this block is opt-in via
 * `mode: "category"` (the default, matching CategoryClient's own prior
 * always-on behavior), and Home's call site explicitly passes
 * `mode="home"` to suppress it. `l1Id` remains the only REQUIRED input;
 * `mode` is optional with a sensible default, per the spec.
 *
 * L2 deep-link preservation: this component still reads
 * useParams()/useSearchParams() directly, unconditionally, exactly as
 * CategoryClient did — on "/" those hooks simply return no slug/l2slug
 * (there's no dynytic route segment there), so `l2FromUrl` naturally
 * resolves to "" and the (mode="home"-suppressed, so moot anyway) filter
 * state never activates. No prop-plumbing needed to keep this working
 * under either route tree.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Tag } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroCarousel } from "@/components/consumer/HeroCarousel";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { SellerCard } from "@/components/consumer/SellerCard";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { JustInSection } from "@/components/consumer/JustInSection";
import { TrustStickers } from "@/components/consumer/TrustStickers";
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { Skeleton } from "@/components/ui/Skeleton";
import { cloudinaryOptimize } from "@/lib/utils";
import type { ProductCard as ProductCardType, CategoryNode, AreaTile, PriceBentoResponse, Brand } from "@/types";
import {
  trackSectionImpression, trackCategoryTileClick, trackCategoryTileImpression,
  trackPriceFilterClick, trackProductClick,
  trackOfferClick, trackMerchantCTAClick, observeImpression,
} from "@/lib/analytics";

interface OfferDoc { id: string; title: string; subtitle?: string; description?: string; code?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }
interface HomeProductsRail { store_id: string; store_name: string; store_slug: string; store_banner?: string; store_tagline?: string; products: ProductCardType[] }
interface HomeProductsResponse { store_rails: HomeProductsRail[]; trending: ProductCardType[]; best_deals: ProductCardType[]; premium_picks: ProductCardType[] }

// CANONICAL SECTION LIST — now genuinely shared by all three routes
// ("/", "/c/[slug]", "/c/[slug]/[...l2slug]"), not just Home. See this
// file's own migration (018_reseed_homepage_sections_phase_d.py, and any
// later renumbered one) for the live DB seed; this is the seed/fallback
// used when a site_config doc is missing/malformed, or a newly-shipped
// id hasn't been synced to it yet. Keep in sync with the backend's
// DEFAULT_HOMEPAGE_SECTIONS (server.py), id-for-id/rank-for-rank.
//
// LOCKED SEQUENCE (Phase G2, superseding Phase F's): Hero -> Shop by
// Category -> Best Deals -> Shop by Price -> Shop by Store -> Premium
// Picks -> Shop by Area -> Footwear Store -> Ethnic Store ->
// Lingerie/Innerwear Store. Phase G2 removed five sections outright (not
// just disabled): "Shops near you"/meet_sellers, the standalone promo
// "browse_all" CTA strip (the separate inline "Browse all {L1}" product
// grid rendered by BrowseGridBlock below is NOT part of this ranked list
// at all — see that component's own comment — so it's unaffected),
// try_and_buy, for_her, and for_him.
//
// Section-id cheat sheet (each toggle's real-world meaning — id alone
// doesn't explain L1/gender targeting):
//   best_deals / premium_picks — L1-scoped via the page's own `l1Id` (was
//     hardcoded to Women on Home pre-Phase-E; now genuinely dynamic —
//     see resolveBestDealsQuery/resolvePremiumPicksQuery below).
//   shop_by_category / store_footwear / store_ethnic / store_lingerie —
//     all resolve against the page's own resolved L1 (name/slug/L2 list),
//     not a hardcoded gender. On an L1 whose L2 list doesn't have a
//     matching slug (e.g. Kids has no "dresses"/"lingerie"), the
//     corresponding tile/module simply doesn't render — same graceful
//     per-tile drop these already used before Phase E, just no longer
//     limited to Women.
//   shop_by_store — L1-scoped (GET /categories/{l1_id}/stores, no l2_id)
//     editorial store carousel, Phase F. Real production volume is sparse
//     today (at most 1 real store per L1 — see ShopByStoreSection's own
//     doc comment) so this renders nothing on most L1s right now; that's
//     expected, not a bug.
//   under_499 — kept its pre-rename id from the pre-overlapping-bands era
//     (see PRICE_BANDS_SEED in server.py); the CMS label reads "Shop by
//     Price" so this only matters to someone reading raw ids. Now
//     genuinely L1-scoped too (Phase F fix — see ShopByPriceSection).
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "category_pills",  label: "Category pills",              enabled: true,  rank: 10 },
  { id: "hero",             label: "Hero",                        enabled: true,  rank: 20 },
  { id: "shop_by_category", label: "Shop by Category",            enabled: true,  rank: 25 },
  { id: "best_deals",       label: "Best deals",                  enabled: true,  rank: 30 },
  { id: "under_499",        label: "Shop by Price",                enabled: true,  rank: 40 },
  { id: "shop_by_store",    label: "Shop by Store",               enabled: true,  rank: 50 },
  { id: "premium_picks",    label: "Premium picks",               enabled: true,  rank: 60 },
  { id: "shop_by_area",     label: "Shop by Area",                enabled: true,  rank: 70 },
  { id: "store_footwear",   label: "Footwear Store",              enabled: true,  rank: 90 },
  { id: "store_ethnic",     label: "Ethnic Store",                enabled: true,  rank: 100 },
  { id: "store_lingerie",   label: "Lingerie / Innerwear Store",  enabled: true,  rank: 110 },

  // Pre-redesign sections — not part of the locked sequence above.
  { id: "shop_by_brand",   label: "Shop by Brand",            enabled: true,  rank: 140 },
  { id: "merchant_cta",    label: "Open a store",             enabled: true,  rank: 170 },
  { id: "offers",          label: "Offers for you",           enabled: true,  rank: 180 },

  // Optional / Future
  { id: "just_in",        label: "Just In",                   enabled: false, rank: 190 },
  { id: "trending",       label: "Trending now",              enabled: false, rank: 200 },
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: false, rank: 210 },
];

interface ResolvedGenderTile { key: string; href: string; image: string | null; label: string; minPrice: number | null }

// ---------------------------------------------------------------------------
// "Shop by Category" — a curated 2x3 grid using CategoryTile's "generous"
// density. Redesign Phase E: `l1Slug` is now the PAGE's own resolved L1
// slug (was hardcoded "women" pre-unification) — Dresses/Tops/Bottoms/
// Footwear/Ethnic/Lingerie is still a Women-shaped spec list (that's what
// the locked design approved), so on Men/Kids only the slugs that happen
// to match (e.g. "footwear") render — fewer tiles, never a crash, same
// per-tile-drop mechanism this always had.
// ---------------------------------------------------------------------------
interface ShopByCategorySpec { label: string; l2Slug: string }

const SHOP_BY_CATEGORY_TILES: ShopByCategorySpec[] = [
  { label: "Dresses",  l2Slug: "dresses" },
  { label: "Tops",     l2Slug: "tops" },
  { label: "Bottoms",  l2Slug: "bottoms" },
  { label: "Footwear", l2Slug: "footwear" },
  { label: "Ethnic",   l2Slug: "ethnic-wear" },
  { label: "Lingerie", l2Slug: "lingerie" },
];

function resolveShopByCategoryTiles(categories: CategoryNode[], l1Slug: string): ResolvedGenderTile[] {
  const l1 = categories.find((c) => c.slug === l1Slug);
  if (!l1) return [];
  const out: ResolvedGenderTile[] = [];
  for (const spec of SHOP_BY_CATEGORY_TILES) {
    const l2 = (l1.l2 ?? []).find((s) => s.slug === spec.l2Slug);
    if (!l2) continue;
    out.push({ key: l2.id, href: `/c/${l1.slug}/${l2.slug}`, image: l2.image || null, label: spec.label, minPrice: l2.min_price ?? null });
  }
  return out;
}

function ShopByCategorySection({ tiles }: { tiles: ResolvedGenderTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_category">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Category</h2>
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

// ---------------------------------------------------------------------------
// Footwear / Ethnic / Lingerie(-or-Innerwear) Store sections — three
// independent modules, each an editorial banner + horizontal SellerCard
// row, sourced from GET /categories/{l1_id}/stores?l2_id=. `l1Slug` is now
// the page's own resolved L1 slug (was hardcoded "women"). Men swaps the
// third module to "Innerwear Store" (l2-men-innerwear — no l2-men-
// lingerie exists). Any other L1 (Kids, Ethnic, Footwear, ...) has no
// gendered module list at all, so all three sections cleanly render
// nothing there — same as they already did for every non-Women L1 before
// Phase E generalized l1Slug.
//
// Phase G4: layers an admin-curated CMS override on top, fetched from
// GET /store-section-overrides/{l1_id}/{l2_id} ALONGSIDE (never instead
// of) the real store query above — same (l1_id, l2_id) scoping key
// stores_in_category() itself matches on, so overrides are correctly
// isolated per L1+category (see that endpoint's own doc comment in
// server.py). Two effects: `banner_image`, when set, replaces the
// section's default L2-image banner; `pinned_stores` (admin display
// cards, not real stores) render in the SAME horizontal row, after the
// real stores. The section now only hides when BOTH lists are empty —
// previously it hid whenever there were zero real stores.
// ---------------------------------------------------------------------------
interface StoreModuleSpec { bannerLabel: string; l2Slug: string }

const WOMEN_STORE_MODULES: StoreModuleSpec[] = [
  { bannerLabel: "Footwear", l2Slug: "footwear" },
  { bannerLabel: "Ethnic",   l2Slug: "ethnic-wear" },
  { bannerLabel: "Lingerie", l2Slug: "lingerie" },
];

const MEN_STORE_MODULES: StoreModuleSpec[] = [
  { bannerLabel: "Footwear",        l2Slug: "footwear" },
  { bannerLabel: "Ethnic",          l2Slug: "ethnic-wear" },
  { bannerLabel: "Innerwear Store", l2Slug: "innerwear" },
];

interface GenderedSectionStore {
  id: string; slug?: string; name: string;
  logo?: string; banner?: string; banners?: string[];
  area_label?: string; locality?: string;
  product_count: number; availability_rank: number; next_open_label?: string;
}

function StoreSectionModule({ l1, spec }: { l1: CategoryNode; spec: StoreModuleSpec }) {
  const l2 = (l1.l2 ?? []).find((s) => s.slug === spec.l2Slug);

  const { data: stores } = useQuery({
    queryKey: ["gendered-store-section", l2?.id],
    queryFn: async () => {
      const r = await apiClient.get<GenderedSectionStore[]>(`/api/categories/${l1.id}/stores`, { params: { l2_id: l2!.id, limit: 10 } });
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l2,
  });

  const { data: override } = useQuery({
    queryKey: ["store-section-override", l1.id, l2?.id],
    queryFn: () => api.catalog.storeSectionOverride(l1.id, l2!.id),
    enabled: !!l2,
  });

  if (!l2 || !stores || !override) return null;

  const pinned = override.pinned_stores ?? [];
  if (stores.length === 0 && pinned.length === 0) return null;

  const bannerImage = override.banner_image || l2.image;
  const l2Href = `/c/${l1.slug}/${l2.slug}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid={`home-store-section-${spec.l2Slug}`}>
      <Link
        href={l2Href}
        className="group relative block aspect-[21/9] sm:aspect-[3/1] rounded-2xl overflow-hidden"
      >
        {bannerImage ? (
          <img
            src={cloudinaryOptimize(bannerImage, "w_1200,q_auto,f_auto")}
            alt={spec.bannerLabel}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[#0A1F5C]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <span className="absolute bottom-4 left-4 sm:left-6 font-display font-black text-white uppercase tracking-tight text-2xl sm:text-4xl leading-none">
          {spec.bannerLabel}
        </span>
      </Link>
      <div className="mt-4 flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {stores.map((s) => {
          const isOpen = s.availability_rank === 1;
          const closedLabel = isOpen ? undefined : (s.next_open_label || "Closed");
          return <SellerCard key={s.id} s={s} source={`store_${spec.l2Slug}`} openNow={isOpen} closedLabel={closedLabel} />;
        })}
        {/* Phase G4 — admin-pinned display cards, always after real
            stores. Not real store records: no logo/eta/product-count/
            trusted status, and `href` points at the card's own link (or
            this section's own L2 browse page when unset) rather than a
            fabricated /store/{id}. */}
        {pinned.map((p) => (
          <SellerCard
            key={p.id}
            s={{ id: p.id, name: p.name, banner: p.image || null }}
            source={`store_${spec.l2Slug}_pinned`}
            href={p.link || l2Href}
          />
        ))}
      </div>
    </div>
  );
}

// index addresses a fixed position (0=Footwear, 1=Ethnic, 2=Lingerie-or-
// Innerwear) in whichever gendered module list applies — both lists are
// authored in that order, so this stays correct for either gender without
// a lookup-by-label. Split into 3 independently-ranked sections (Phase D)
// so Premium picks can sit between Ethnic and Lingerie/Innerwear per the
// locked sequence.
function GenderedStoreSection({ categories, l1Slug, index }: { categories: CategoryNode[]; l1Slug: string; index: number }) {
  const l1 = categories.find((c) => c.slug === l1Slug);
  if (!l1) return null;
  const modules = l1Slug === "men" ? MEN_STORE_MODULES : l1Slug === "women" ? WOMEN_STORE_MODULES : [];
  const spec = modules[index];
  if (!spec) return null;
  return <StoreSectionModule l1={l1} spec={spec} />;
}

// ---------------------------------------------------------------------------
// "Shop by Price" — mixed-weight headline, asymmetric layout (one large
// dominant Under ₹499 card + two smaller stacked cards). Redesign Phase F:
// now genuinely L1-scoped — each tile's href carries `l1={l1Id}` (fixing
// the bug Phase E's own discovery flagged: previously these links had no
// l1 param at all, so tapping a price tier from e.g. the Men page showed
// every L1's products, not just Men's). Same overlapping-band data
// contract Phase A built ($lt semantics, under-499/-999/-1499).
// ---------------------------------------------------------------------------
const PRICE_BANDS = [
  { slug: "under-499",  price: "₹499",   sub: "Steals & deals", filter: "under_499" as const,  bentoKey: "under_499" as const },
  { slug: "under-999",  price: "₹999",   sub: "Everyday picks", filter: "under_999" as const,  bentoKey: "under_999" as const },
  { slug: "under-1499", price: "₹1,499", sub: "Best value",     filter: "under_1499" as const, bentoKey: "under_1499" as const },
];

function ShopByPriceSection({ l1Id, priceBento }: { l1Id: string; priceBento: PriceBentoResponse | null }) {
  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8"
      data-testid="home-under_499"
      ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("under_499")); } catch {} } }}
    >
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Price</h2>
      <div className="grid grid-cols-3 gap-3">
        {PRICE_BANDS.map(({ slug, price, sub, filter, bentoKey }) => {
          const href = `/products?price=${slug}&l1=${l1Id}`;
          const image = priceBento?.[bentoKey] ?? null;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => { try { trackPriceFilterClick(filter); } catch {} }}
              data-testid={`price-band-${filter}`}
              className="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95"
            >
              {image ? (
                <>
                  <img
                    src={cloudinaryOptimize(image, "w_400,q_auto,f_auto")}
                    alt={`Under ${price}`}
                    loading="eager"
                    className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#141419]/75 via-[#141419]/30 to-transparent pointer-events-none" />
                  <div className="absolute text-white bottom-2.5 left-3 right-3">
                    <div className="font-semibold uppercase tracking-wide opacity-80 text-[9px]">Under</div>
                    <div className="font-display font-black leading-none text-xl sm:text-2xl mt-0.5">{price}</div>
                    <div className="font-semibold opacity-90 text-[10px] mt-1">{sub}</div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 bg-[#F4F1E9] flex flex-col items-center justify-center gap-1.5 px-2 text-center">
                  <div className="rounded-full bg-[#E68910]/15 flex items-center justify-center w-8 h-8">
                    <Sparkles size={14} className="text-[#E68910]" />
                  </div>
                  <div>
                    <div className="font-display font-black text-[#0A1F5C] leading-none text-lg">{price}</div>
                    <div className="font-semibold text-[#0A1F5C]/55 mt-1 text-[10px]">{sub}</div>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Shop by Store" (redesign Phase F) — a new editorial, snap-to-card
// carousel: center-aligned active card with adjacent cards peeking on
// both sides, ~75% viewport width per card, strongly rounded corners, no
// shadow, full-bleed image, store name overlaid near the TOP (distinct
// from SellerCard's bottom-overlay convention used elsewhere).
//
// Image source, confirmed by investigation before building anything: a
// store has TWO distinct image concepts — `logo` (small square merchant
// mark) and `banner`/`banners` (the storefront cover photo(s), uploaded
// via the mandatory merchant onboarding flow at a 4:3 landscape crop —
// see app/merchant/storefront/page.tsx's own upload UI). There is no
// portrait/tall image field on a store at all. Rather than stretch the
// small square logo into a tall card (which would look broken) or invent
// a portrait crop the merchant never provided, this carousel uses the
// real landscape banner and sizes its own card to aspect-[4/3] — the
// same aspect the source image already is, so object-cover crops barely
// anything rather than aggressively cropping a landscape photo into a
// portrait frame. A store lacking BOTH banner and banners[0] is skipped
// entirely, not rendered with a stretched/broken image.
//
// Data: reuses Phase A's generalized GET /categories/{l1_id}/stores
// (no l2_id — the whole L1, same endpoint the now-retired "Stores in
// {L1}" rail and the gendered store modules both already call), NOT a
// new backend endpoint — that endpoint already returns banner/banners.
// Real production volume (checked before shipping, not assumed): only 3
// real (non-test-fixture) stores exist at all today, and only ONE has any
// visible products in any L1 — so this section renders at most 1 card on
// Women/Men, 0 on Kids, today. That's the same "correct plumbing, sparse
// real content" situation every other store-scoped section in this
// redesign has shipped with — the carousel mechanics work correctly for
// any count (a single card just centers with empty peek space on both
// sides, which is a normal, non-broken degenerate case, not something
// that needed a special single-card layout).
// ---------------------------------------------------------------------------
interface ShopByStoreEntry { id: string; slug?: string; name: string; image: string }

function ShopByStoreSection({ l1 }: { l1: CategoryNode | undefined }) {
  const { data: stores } = useQuery({
    queryKey: ["shop-by-store", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get<GenderedSectionStore[]>(`/api/categories/${l1!.id}/stores`, { params: { limit: 20 } });
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  const entries: ShopByStoreEntry[] = (stores ?? [])
    .map((s) => ({ id: s.id, slug: s.slug, name: s.name, image: s.banner || (s.banners && s.banners[0]) || "" }))
    .filter((s) => !!s.image);

  if (entries.length === 0) return null;

  return (
    <div className="pt-8" data-testid="home-shop_by_store">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-3">
        <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">Shop by Store</h2>
      </div>
      <div className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory gap-3 px-[12.5vw] sm:px-[20%]">
        {entries.map((s) => (
          <Link
            key={s.id}
            href={`/store/${s.slug || s.id}`}
            data-testid={`shop-by-store-card-${s.id}`}
            className="group relative shrink-0 w-[75vw] sm:w-[60%] aspect-[4/3] rounded-3xl overflow-hidden snap-center active:scale-[0.98] transition"
          >
            <img
              src={cloudinaryOptimize(s.image, "w_800,q_auto,f_auto")}
              alt={s.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/65 via-black/15 to-transparent pointer-events-none" />
            <span className="absolute top-4 left-4 right-4 font-display font-bold text-white text-lg sm:text-xl leading-tight line-clamp-2">
              {s.name}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ShopByAreaSection({ areas }: { areas: AreaTile[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_area">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Area</h2>

      <div className="grid grid-cols-3 gap-3">
        {areas.map((a) => (
          <Link key={a.slug} href={`/stores?area=${a.slug}`} data-testid={`shop-by-area-tile-${a.slug}`}
            className="group flex flex-col gap-1.5 active:scale-95 transition">
            <div className="relative aspect-square rounded-card overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] bg-surface-tint">
              {a.image ? (
                <img
                  src={cloudinaryOptimize(a.image, "w_400,q_auto,f_auto")}
                  alt={a.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center" data-testid={`shop-by-area-blank-${a.slug}`}>
                  <div className="w-9 h-9 rounded-full bg-brand-accent/15 flex items-center justify-center">
                    <Sparkles size={16} className="text-brand-accent" />
                  </div>
                </div>
              )}
              <span className="absolute bottom-2 left-2 inline-flex items-center rounded-pill bg-white px-2 py-0.5 text-[10px] font-bold leading-none text-brand-primary shadow-[0_1px_4px_rgba(0,0,0,0.3)]" data-testid={`shop-by-area-count-${a.slug}`}>
                {a.store_count} {a.store_count === 1 ? "store" : "stores"}
              </span>
            </div>
            <span className="text-sm font-bold text-brand-primary text-center leading-tight line-clamp-1">{a.name}</span>
          </Link>
        ))}
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

// ---------------------------------------------------------------------------
// mode="category" only — /c/[slug]'s own intrinsic browsing chrome: an L2
// filter grid (all of this L1's L2s, filter-button behavior, not
// navigation) driving a full sortable "Browse all {L1}" product grid.
// Ported from the old CategoryClient.tsx essentially unchanged — this is
// NOT part of the ranked CMS section list (see this file's own top
// comment for why) and always renders last, right before TrustStickers.
// ---------------------------------------------------------------------------
type SortKey = "nearest" | "price_asc" | "price_desc";

function sortProducts(products: ProductCardType[], sort: SortKey): ProductCardType[] {
  const copy = [...products];
  if (sort === "price_asc") return copy.sort((a, b) => a.price - b.price);
  if (sort === "price_desc") return copy.sort((a, b) => b.price - a.price);
  return copy.sort((a, b) => {
    const aRank = a.store_availability_rank ?? 1;
    const bRank = b.store_availability_rank ?? 1;
    if (aRank !== bRank) return aRank - bRank;
    const aDist = a.store_distance_km ?? 999;
    const bDist = b.store_distance_km ?? 999;
    return aDist - bDist;
  });
}

function SkeletonGrid() {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden bg-white border border-[#E5E2DC] animate-pulse">
          <div className="aspect-[3/4] bg-[#E5E2DC]" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-[#E5E2DC] rounded w-2/3" />
            <div className="h-3 bg-[#E5E2DC] rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BrowseGridBlock({ l1 }: { l1: CategoryNode }) {
  const params = useParams<{ slug: string; l2slug?: string[] }>();
  const searchParams = useSearchParams();
  const l2FromUrl = params.l2slug?.[0] || searchParams.get("l2") || "";

  const [sort, setSort] = useState<SortKey>("nearest");
  const [l2Filter, setL2Filter] = useState(""); // slug
  useEffect(() => { setL2Filter(l2FromUrl); }, [l1.id, l2FromUrl]);

  const { data: subcategories = [] } = useQuery({
    queryKey: ["category-l2", l1.id],
    queryFn: async () => {
      const r = await apiClient.get(`/api/categories/${l1.id}/l2`);
      const subs = Array.isArray(r.data) ? r.data : (r.data?.subcategories || []);
      return (subs.length > 0 ? subs : (l1.l2 ?? [])) as CategoryNode["l2"];
    },
  });

  const l2FilterId = useMemo(() => {
    if (!l2Filter) return "";
    const sub = subcategories.find((s) => s.slug === l2Filter) ?? (l1.l2 ?? []).find((s) => s.slug === l2Filter);
    return sub?.id ?? "";
  }, [l2Filter, subcategories, l1]);

  const { data: allProducts = [], isPending: isLoading } = useQuery({
    queryKey: ["category-products", l1.id, l2FilterId, sort],
    queryFn: async () => {
      const p = new URLSearchParams({ l1: l1.id });
      if (l2FilterId) p.set("l2", l2FilterId);
      if (sort === "price_asc") p.set("sort", "price_asc");
      if (sort === "price_desc") p.set("sort", "price_desc");
      const r = await apiClient.get<ProductCardType[]>(`/api/products?${p.toString()}`);
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const products = useMemo(() => sortProducts(allProducts, sort), [allProducts, sort]);
  const l2List = subcategories.length > 0 ? subcategories : (l1.l2 ?? []);

  return (
    <>
      {l2List.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6" data-testid="cat-l2-grid">
          <h2 className="text-lg sm:text-xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">
            Shop by category
          </h2>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            {l2List.map((sub) => {
              const isActive = l2Filter === sub.slug;
              return (
                <CategoryTile
                  key={sub.id}
                  onClick={() => setL2Filter(isActive ? "" : sub.slug)}
                  testId={`l2-tile-${sub.slug}`}
                  active={isActive}
                  activeStyle="border"
                  image={sub.image}
                  label={sub.name}
                  fallback={<div className="absolute inset-0 bg-[#E5E2DC]" />}
                  labelClassName={isActive ? "text-[#0A1F5C]" : "text-[#595959]"}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#E68910] mb-1">Browse all</div>
        <h1 data-testid="cat-title" className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">
          {l1.name}
          {!isLoading && (
            <span className="text-sm font-normal text-[#595959] ml-2">({products.length})</span>
          )}
        </h1>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mt-3">
          {([
            { key: "nearest", label: "Nearest" },
            { key: "price_asc", label: "Price: Low–High" },
            { key: "price_desc", label: "Price: High–Low" },
          ] as Array<{ key: SortKey; label: string }>).map(opt => (
            <button key={opt.key}
              onClick={() => setSort(opt.key)}
              data-testid={`sort-${opt.key}`}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                sort === opt.key
                  ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                  : "bg-white text-[#595959] border-[#E5E2DC]"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <SkeletonGrid />
        ) : products.length === 0 ? (
          <div className="mt-6 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
            <h3 className="font-display text-xl md:text-2xl font-bold text-[#0A1F5C]">Coming soon to {l1.name} in Bhilai</h3>
            <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We&apos;re onboarding local sellers right now — fresh drops will land here shortly.</p>
          </div>
        ) : (
          <div data-testid="cat-product-grid" className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
          </div>
        )}
      </div>
    </>
  );
}

export function L1PageClient({ l1Id, mode = "category" }: { l1Id: string; mode?: "home" | "category" }) {
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [_storeRails, setStoreRails] = useState<HomeProductsRail[]>([]);

  // Best deals / Premium picks — L1-scoped via the page's own l1Id prop
  // directly (not the resolved `l1` object below), so these two rails can
  // start fetching immediately on mount without waiting on the categories
  // fetch to resolve first.
  const { data: bestDeals = [], isPending: bestDealsPending, isError: bestDealsErrored } = useQuery({
    queryKey: ["l1-best-deals", l1Id],
    queryFn: async () => {
      const r = await apiClient.get<{ products: ProductCardType[] }>("/api/products", { params: { l1: l1Id, sort: "discount", limit: 8 } });
      return Array.isArray(r.data) ? r.data : (r.data?.products || []);
    },
  });
  const { data: premiumPicks = [], isPending: premiumPicksPending, isError: premiumPicksErrored } = useQuery({
    queryKey: ["l1-premium-picks", l1Id],
    queryFn: async () => {
      const r = await apiClient.get<{ products: ProductCardType[] }>("/api/products", { params: { l1: l1Id, sort: "price_desc", limit: 8 } });
      return Array.isArray(r.data) ? r.data : (r.data?.products || []);
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });
  const l1 = useMemo(() => categories.find((c) => c.id === l1Id), [categories, l1Id]);
  const l1Slug = l1?.slug ?? "";

  const [areas, setAreas] = useState<AreaTile[]>([]);
  const [priceBento, setPriceBento] = useState<PriceBentoResponse | null>(null);
  const [popularBrands, setPopularBrands] = useState<Brand[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [brandsEnabled, setBrandsEnabled] = useState(
    () => DEFAULT_SECTIONS.find((s) => s.id === "shop_by_brand")?.enabled ?? false
  );
  const brandsEnabledRef = useRef(brandsEnabled);

  const markLoaded = (key: string) =>
    setLoaded((prev) => { const next = new Set(prev); next.add(key); return next; });
  const markError = (key: string) =>
    setErrors((prev) => { const next = new Set(prev); next.add(key); return next; });

  useEffect(() => {
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { sections?: SectionDoc[] };
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        const defaultMap = new Map(DEFAULT_SECTIONS.map((s) => [s.id, s]));
        const serverIds = new Set(c.sections.map((s: SectionDoc) => s.id));
        const extra = DEFAULT_SECTIONS.filter((s) => !serverIds.has(s.id));
        const fromServer = c.sections.map((s: SectionDoc) => {
          const fallback = defaultMap.get(s.id);
          return {
            id: s.id,
            label: s.label || fallback?.label || s.id,
            enabled: typeof s.enabled === "boolean" ? s.enabled : (fallback?.enabled ?? true),
            rank: typeof s.rank === "number" && !Number.isNaN(s.rank) ? s.rank : (fallback?.rank ?? 999),
          };
        });
        const merged = [...fromServer, ...extra];
        const seen = new Set<string>();
        const deduped = merged.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
        setSections(deduped);
        const resolvedBrandsEnabled = deduped.find((s) => s.id === "shop_by_brand")?.enabled ?? false;
        setBrandsEnabled(resolvedBrandsEnabled);
        brandsEnabledRef.current = resolvedBrandsEnabled;
      }
      markLoaded("hero");
    }).catch(() => { markLoaded("hero"); });
    api.catalog.areas().then((r) => setAreas(r)).catch(() => {});
    api.catalog.priceBento().then((r) => setPriceBento(r)).catch(() => {});

    const _deferTimer = setTimeout(() => {
      api.catalog.offers().then((r) => { setOffers(r as unknown as OfferDoc[]); markLoaded("offers"); }).catch(() => { markLoaded("offers"); markError("offers"); });
      api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
      if (brandsEnabledRef.current) {
        api.brands.list({ limit: 10, sort: "popular" })
          .then((r) => { setPopularBrands(r.brands.filter((b) => b.product_count > 0)); markLoaded("popularBrands"); })
          .catch(() => { markLoaded("popularBrands"); markError("popularBrands"); });
      } else {
        markLoaded("popularBrands");
      }
    }, 800);

    // Trending + store_rails — genuinely site-wide, not L1-scoped (see
    // this component's own top comment); same behavior on every route.
    apiClient.get<HomeProductsResponse>("/api/feed/home-products").then((r) => {
      const data = r.data || { store_rails: [], trending: [], best_deals: [], premium_picks: [] };
      const hasProducts = (data.trending?.length || 0) + (data.store_rails?.length || 0) > 0;

      if (hasProducts) {
        setStoreRails(data.store_rails || []);
        setTrending(data.trending || []);
      } else {
        apiClient.get("/api/products?limit=24&sort=newest").then((r2: any) => {
          const products: ProductCardType[] = r2.data?.products || r2.data || [];
          if (products.length > 0) {
            setTrending(products.slice(0, 8));
            const byStore: Record<string, ProductCardType[]> = {};
            products.forEach((p: any) => {
              if (!p.store_id) return;
              const bucket = byStore[p.store_id] ?? (byStore[p.store_id] = []);
              if (bucket.length < 8) bucket.push(p);
            });
            const rails = Object.entries(byStore).map(([sid, prods]) => ({
              store_id: sid,
              store_name: (prods[0] as any)?.store_name || "Local Store",
              store_slug: (prods[0] as any)?.store_slug || sid,
              store_banner: (prods[0] as any)?.store_banner || "",
              store_tagline: "Shop local, delivered fast",
              products: prods,
            }));
            if (rails.length > 0) setStoreRails(rails);
          }
        }).catch(() => {});
      }

      markLoaded("storeRails");
      markLoaded("recent");
    }).catch(() => {
      apiClient.get("/api/products?limit=24").then((r2: any) => {
        const products: ProductCardType[] = r2.data?.products || [];
        if (products.length > 0) {
          setTrending(products.slice(0, 8));
        }
      }).catch(() => {});
      markLoaded("storeRails");
      markLoaded("recent");
      markError("recent");
    });

    return () => clearTimeout(_deferTimer);
  }, []);

  const ProductRailSkeleton = ({ testid }: { testid: string }) => (
    <div data-testid={testid} className="pt-4 px-4 sm:px-6">
      <Skeleton className="h-7 w-44 rounded-full mb-1" />
      <Skeleton className="h-4 w-56 rounded-full mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[38vw] sm:w-[180px] md:w-[200px]">
            <Skeleton className="w-full aspect-[3/4] rounded-2xl mb-2" />
            <Skeleton className="h-3 w-3/4 rounded mb-1.5" />
            <Skeleton className="h-3 w-1/2 rounded mb-1.5" />
            <Skeleton className="h-6 w-full rounded-full" />
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

  const bestDealsLink = `/products?l1=${l1Id}&sort=discount`;
  const premiumPicksLink = `/products?l1=${l1Id}&sort=price_desc`;

  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: (
      <div key="hero" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("hero")); } catch {} } }}>
        <HeroCarousel l1Id={l1Id} />
      </div>
    ),

    shop_by_category: <ShopByCategorySection key="shop-by-category" tiles={resolveShopByCategoryTiles(categories, l1Slug)} />,

    store_footwear: <GenderedStoreSection key="store-footwear" categories={categories} l1Slug={l1Slug} index={0} />,
    store_ethnic: <GenderedStoreSection key="store-ethnic" categories={categories} l1Slug={l1Slug} index={1} />,
    store_lingerie: <GenderedStoreSection key="store-lingerie" categories={categories} l1Slug={l1Slug} index={2} />,

    under_499: <ShopByPriceSection key="shop-by-price" l1Id={l1Id} priceBento={priceBento} />,

    shop_by_store: <ShopByStoreSection key="shop-by-store" l1={l1} />,

    category_pills: (
      <div key="category-pills" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
        <div
          className="hidden md:grid gap-4 pb-2"
          style={{ gridTemplateColumns: `repeat(${categories.length === 0 ? 8 : Math.min(categories.length, 9) + 1}, minmax(0, 1fr))` }}
        >
          {categories.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
            ))
          ) : (
            <>
              <Link
                href="/products"
                className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#0A1F5C] flex flex-col items-center justify-center gap-2 transition hover:scale-[1.02]"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                <span className="font-bold text-white text-sm">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat, catIdx) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC] transition hover:border-[#0A1F5C]"
                >
                  {cat.image ? (
                    <img src={cloudinaryOptimize(cat.image, "w_400,q_auto,f_auto")} alt={cat.name}
                      loading="eager"
                      fetchPriority={catIdx === 0 ? "high" : "auto"}
                      className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="w-full h-full bg-[#E5E2DC]" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none" />
                  <span className="absolute bottom-3 left-3 right-3 font-bold text-white text-sm leading-tight line-clamp-2 break-words">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    ),

    trending: errors.has("recent") ? null
      : loaded.has("recent") && trending.length >= 1 ? (
          <HCarousel key="trending" title="Trending now" testid="home-new-arrivals" link="/products?sort=trending" linkLabel="See all">
            {trending.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "trending", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : !loaded.has("recent") ? <ProductRailSkeleton key="trending-skeleton" testid="home-new-arrivals-skeleton" /> : null,

    // Best deals — L1-scoped via l1Id. Canonical rail (sort=discount) —
    // see this file's own top comment for why CategoryClient's old
    // "Bestsellers" (sort=rating) rail was retired, not kept alongside it.
    best_deals: bestDealsErrored ? null
      : !bestDealsPending && bestDeals.length >= 1 ? (
          <HCarousel key="best-deals" title="Best deals" testid="home-best-deals" link={bestDealsLink} linkLabel="See all">
            {bestDeals.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "best_deals", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : bestDealsPending ? <ProductRailSkeleton key="best-deals-skeleton" testid="home-best-deals-skeleton" /> : null,

    premium_picks: premiumPicksErrored ? null
      : !premiumPicksPending && premiumPicks.length >= 1 ? (
          <HCarousel key="premium-picks" title="Premium picks" testid="home-premium-picks" link={premiumPicksLink} linkLabel="See all">
            {premiumPicks.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "premium_picks", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : premiumPicksPending ? <ProductRailSkeleton key="premium-picks-skeleton" testid="home-premium-picks-skeleton" /> : null,

    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <section key="offers" className="pt-8" data-testid="offers-strip" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offers")); } catch {} } }}>
        <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          {offers.slice(0, 1).map((offer) => {
            const href = offer.cta_link || "/categories";
            const cardStyle = { background: offer.background || "#0A1F5C" };
            const inner = (
              <div className="aspect-[16/9] relative">
                {offer.image && (
                  <img src={cloudinaryOptimize(offer.image, "w_600,q_auto,f_auto")} alt={offer.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
                <div className="absolute inset-0 p-5 flex flex-col justify-center text-white">
                  <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">Limited time</div>
                  <div className="text-xl font-display font-bold mt-1 leading-tight">{offer.title}</div>
                  {offer.subtitle && <div className="text-sm opacity-95 mt-1">{offer.subtitle}</div>}
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold">
                    {offer.cta_label || "Shop now"} →
                  </div>
                </div>
              </div>
            );
            return (
              <Link
                key={offer.id}
                href={href}
                data-testid={`offer-${offer.id}`}
                onClick={() => { try { trackOfferClick(offer.id, offer.code || ""); } catch {} }}
                className="block rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]"
                style={cardStyle}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </section>
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,

    just_in: <JustInSection key="just-in" />,

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
            <p className="min-w-0 text-white font-bold text-sm leading-tight truncate">
              Own a store in Bhilai?
            </p>
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

    customer_love: <CustomerLove key="testimonials" items={testimonials} />,

    shop_by_brand: <ShopByBrandSection key="shop-by-brand" brands={popularBrands} ready={loaded.has("popularBrands")} />,

    shop_by_area: <ShopByAreaSection key="shop-by-area" areas={areas} />,
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
        {mode === "category" && (l1 ? <BrowseGridBlock l1={l1} /> : null)}
        <TrustStickers />
      </main>
    </div>
  );
}
