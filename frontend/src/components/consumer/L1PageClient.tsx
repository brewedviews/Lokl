"use client";

/**
 * L1PageClient — the L1 Shopping Home behind "/c/[slug]" (+ its L2
 * catch-all, "/c/[slug]/[...l2slug]"). Product/category focused: L1
 * hero, L1 categories, deals, product rails, L1 store discovery, Browse
 * All. Marketplace-wide activation content (Shop by Area, the generic
 * 9-L1 category grid, Shop by Brand, "Own a store") lives exclusively on
 * "/" now (MarketplaceHomeClient.tsx) — see that file's own top comment
 * for the full split rationale (G7). This file used to also render "/"
 * (hardcoded to l1Id="l1-women", mode="home") — that's retired; `mode`
 * is gone, this is unconditionally the shopping-home + Browse-All tree.
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
 * Browse All — /c/[slug]'s own intrinsic browsing UI (an L2 filter grid +
 * a full sortable "Browse all {L1}" product grid) is NOT part of the
 * ranked CMS section system and never should be — it's core category-
 * browsing chrome, not a merchandising/discovery section an admin
 * toggles on and off, and it needs page-local filter state the CMS
 * sections don't. Pre-G7 this was opt-in via a `mode` prop (Home passed
 * `mode="home"` to suppress it, since Home rendered through this same
 * component). G7 retired `mode` entirely — this file is L1-only now, so
 * Browse All always renders, unconditionally.
 *
 * L2 deep-link preservation: `BrowseGridBlock` reads
 * useParams()/useSearchParams() directly (params.l2slug from the
 * "/c/[slug]/[...l2slug]" catch-all, or a "?l2=" query param) to
 * pre-select the L2 filter grid — this file is only ever mounted under
 * "/c/[slug]" now, so both hooks always resolve against a real route.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroCarousel } from "@/components/consumer/HeroCarousel";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { SellerCard } from "@/components/consumer/SellerCard";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { TrustStickers } from "@/components/consumer/TrustStickers";
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { OffersSection } from "@/components/consumer/sections/OffersSection";
import { BudgetBentoSection } from "@/components/consumer/sections/BudgetBentoSection";
import { OtherCategoriesSection } from "@/components/consumer/sections/OtherCategoriesSection";
import { StoreSectionModule, type GenderedSectionStore } from "@/components/consumer/sections/StoreSectionModule";
import { Skeleton } from "@/components/ui/Skeleton";
import { cloudinaryOptimize } from "@/lib/utils";
import type { ProductCard as ProductCardType, CategoryNode } from "@/types";
import {
  trackSectionImpression, trackProductClick, observeImpression,
} from "@/lib/analytics";

interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }

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
// try_and_buy, for_her, and for_him. G6 removes "just_in" the same way —
// it was already enabled:false everywhere, but the component/id/route
// still existed; see JustInSection's own git history for the removed
// component (this section used to fetch GET /api/feed/just-in).
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
//     (see PRICE_BANDS_SEED in server.py); the CMS label reads "Picks for
//     Every Budget" now (G8) so this only matters to someone reading raw
//     ids. Renders the shared BudgetBentoSection (sections/), L1-scoped
//     via its own `l1Id` prop.
// G8 — target order: Hero -> Shop by Category -> Best Deals -> Picks for
// Every Budget (under_499) -> Stores Near You (shop_by_store) ->
// store_footwear/store_lingerie (whichever the current L1 has — see
// WOMEN_STORE_MODULES/MEN_STORE_MODULES/KIDS_STORE_MODULES below; Women
// only has `lingerie`, Men only has `footwear`, Kids has all three) ->
// Premium picks -> Offers -> store_ethnic (always last of the store
// modules, every L1) -> Other Categories -> Browse All (unranked chrome).
// Marketplace-only ids (category_pills, marketplace_offers,
// stores_near_you, global_store_ethnic/footwear, merchant_cta) are
// deliberately absent — see MarketplaceHomeClient.tsx.
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "hero",              label: "Hero",                        enabled: true,  rank: 20 },
  { id: "shop_by_category",  label: "Shop by Category",             enabled: true,  rank: 25 },
  { id: "best_deals",        label: "Best deals",                   enabled: true,  rank: 30 },
  { id: "under_499",         label: "Picks for Every Budget",       enabled: true,  rank: 40 },
  { id: "shop_by_store",     label: "Stores near you (L1)",         enabled: true,  rank: 50 },
  { id: "store_footwear",    label: "Footwear Store",               enabled: true,  rank: 55 },
  { id: "store_lingerie",    label: "Lingerie / Innerwear / Kids Store", enabled: true,  rank: 56 },
  { id: "premium_picks",     label: "Premium picks",                enabled: true,  rank: 70 },
  { id: "offers",            label: "Offers for you",               enabled: true,  rank: 80 },
  { id: "store_ethnic",      label: "Ethnic Store",                 enabled: true,  rank: 85 },
  { id: "other_categories",  label: "Other Categories",             enabled: true,  rank: 95 },

  // Optional / Future
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: false, rank: 210 },
];

interface ResolvedGenderTile { key: string; href: string; image: string | null; label: string; minPrice: number | null }

// ---------------------------------------------------------------------------
// "Shop by Category" — a curated grid using CategoryTile's "generous"
// density. Redesign Phase E: `l1Slug` is now the PAGE's own resolved L1
// slug (was hardcoded "women" pre-unification). G6: each L1 now has its
// OWN spec list (was one Women-shaped list reused everywhere, so Men/Kids
// only rendered whichever slugs happened to coincidentally match, e.g.
// "footwear") — activates the real, requested Men (6) and Kids (3) sets
// against the actual taxonomy (checked live in Mongo before writing this,
// not assumed). Kids intentionally has 3 entries, not 6 — the grid below
// is `grid-cols-3`, so 3 tiles fill one full row naturally; no placeholder
// tiles are added just to force a 2-row layout.
// ---------------------------------------------------------------------------
interface ShopByCategorySpec { label: string; l2Slug: string }

const WOMEN_CATEGORY_TILES: ShopByCategorySpec[] = [
  { label: "Dresses",  l2Slug: "dresses" },
  { label: "Tops",     l2Slug: "tops" },
  { label: "Bottoms",  l2Slug: "bottoms" },
  { label: "Footwear", l2Slug: "footwear" },
  { label: "Ethnic",   l2Slug: "ethnic-wear" },
  { label: "Lingerie", l2Slug: "lingerie" },
];

const MEN_CATEGORY_TILES: ShopByCategorySpec[] = [
  { label: "T-Shirts",   l2Slug: "tshirts" },
  { label: "Jeans",      l2Slug: "jeans" },
  { label: "Shirts",     l2Slug: "shirts" },
  { label: "Ethnic",     l2Slug: "ethnic-wear" },
  { label: "Footwear",   l2Slug: "footwear" },
  { label: "Inner Wear", l2Slug: "innerwear" },
];

const KIDS_CATEGORY_TILES: ShopByCategorySpec[] = [
  { label: "Girls Clothing",      l2Slug: "girls" },
  { label: "Boys Clothing",       l2Slug: "boys" },
  { label: "Infant and Toddler",  l2Slug: "infant" },
];

function resolveShopByCategoryTiles(categories: CategoryNode[], l1Slug: string): ResolvedGenderTile[] {
  const l1 = categories.find((c) => c.slug === l1Slug);
  if (!l1) return [];
  const specs = l1Slug === "men" ? MEN_CATEGORY_TILES : l1Slug === "kids" ? KIDS_CATEGORY_TILES : WOMEN_CATEGORY_TILES;
  const out: ResolvedGenderTile[] = [];
  for (const spec of specs) {
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

// ---------------------------------------------------------------------------
// Footwear / Ethnic / Lingerie(-or-Innerwear) Store sections — three
// independent modules, sourced from GET /categories/{l1_id}/stores?l2_id=.
// `l1Slug` is the page's own resolved L1 slug. Men swaps the third module
// to "Innerwear" (l2-men-innerwear — no l2-men-lingerie exists). Any other
// L1 (Kids, Ethnic, Footwear, ...) has no gendered module list at all, so
// all three sections cleanly render nothing there.
//
// Phase G4: layers an admin-curated CMS override on top, fetched from
// GET /store-section-overrides/{l1_id}/{l2_id} ALONGSIDE (never instead
// of) the real store query above — same (l1_id, l2_id) scoping key
// stores_in_category() itself matches on, so overrides are correctly
// isolated per L1+category (see that endpoint's own doc comment in
// server.py). Two effects: `banner_image`, when set, replaces the
// section's default L2-image banner; `pinned_stores` (admin display
// cards, not real stores) render in the SAME horizontal row, after the
// real stores. The section only hides when BOTH lists are empty.
//
// Visual-refinement pass: was "editorial banner, then a gap, then a
// separate store-card row" — two visibly distinct elements. Now ONE
// rounded module (matching JustInSection's own "one composed section"
// language): the banner image sits at the top of the SAME container and
// fades into the container's own background via a gradient that ends in
// that exact color (surface-tint, `#F4F1E9` — the app's own established
// "section separation" neutral, not a new color; see globals.css's own
// definition), so there's no hard edge between image and content, and
// the store-card row shares the same background/padding as the heading
// instead of floating in a `mt-4` gap below a separate bordered banner.
// No "See all"/CTA — the horizontal scroll of the card row is the only
// interaction, same as it already was before this pass.
// ---------------------------------------------------------------------------
interface StoreModuleSpec { bannerLabel: string; heading: string; l2Slug: string }
type StoreSlot = "footwear" | "ethnic" | "lingerie";

// G8 — restructured from positional arrays (index 0/1/2) to slot-keyed
// objects. §17's exact target order gives each L1 a DIFFERENT subset:
// Women shows only `lingerie` + `ethnic` (Footwear Stores dropped from
// Women's page); Men shows only `footwear` + `ethnic` (Innerwear/
// lingerie-slot dropped from Men's page); Kids keeps all three (its
// third slot was never lingerie — see the standing comment below). A
// missing key here is what makes GenderedStoreSection render nothing for
// that slot on that L1 — same graceful-drop mechanism as always, just
// keyed by name instead of array position now that the three slots no
// longer share one fixed page position (`footwear`/`lingerie` render
// early, right after Stores Near You; `ethnic` always renders late,
// after Offers — see DEFAULT_SECTIONS' own rank comment).
const WOMEN_STORE_MODULES: Partial<Record<StoreSlot, StoreModuleSpec>> = {
  ethnic:   { bannerLabel: "Ethnic",   heading: "Ethnic Stores",   l2Slug: "ethnic-wear" },
  lingerie: { bannerLabel: "Lingerie", heading: "Lingerie Stores", l2Slug: "lingerie" },
};

const MEN_STORE_MODULES: Partial<Record<StoreSlot, StoreModuleSpec>> = {
  footwear: { bannerLabel: "Footwear", heading: "Footwear Stores", l2Slug: "footwear" },
  ethnic:   { bannerLabel: "Ethnic",   heading: "Ethnic Stores",   l2Slug: "ethnic-wear" },
};

// G6 — Kids has no "lingerie" L2 (none exists in the taxonomy, checked
// live before writing this), so its `lingerie`-slot module deliberately
// isn't one — `heading` here is only ever a FALLBACK (see
// StoreSectionModule below); an admin can rename any of these three via
// the CMS's `display_title` without touching code, which is what makes
// this slot genuinely editorial rather than hardcoded to old gendered
// semantics. Kids keeps all three slots (unlike Women/Men's reduced-to-2
// set above) since none of its three content options is off-limits.
const KIDS_STORE_MODULES: Partial<Record<StoreSlot, StoreModuleSpec>> = {
  footwear: { bannerLabel: "Footwear",    heading: "Footwear Stores",    l2Slug: "footwear" },
  ethnic:   { bannerLabel: "Ethnic",      heading: "Ethnic Stores",      l2Slug: "ethnic" },
  lingerie: { bannerLabel: "Accessories", heading: "Accessories Stores", l2Slug: "accessories" },
};

function GenderedStoreSection({ categories, l1Slug, slot }: { categories: CategoryNode[]; l1Slug: string; slot: StoreSlot }) {
  const l1 = categories.find((c) => c.slug === l1Slug);
  if (!l1) return null;
  const modules = l1Slug === "men" ? MEN_STORE_MODULES : l1Slug === "women" ? WOMEN_STORE_MODULES : l1Slug === "kids" ? KIDS_STORE_MODULES : {};
  const spec = modules[slot];
  if (!spec) return null;
  const l2 = (l1.l2 ?? []).find((s) => s.slug === spec.l2Slug);
  if (!l2) return null;
  return (
    <StoreSectionModule
      l1Id={l1.id}
      l2Id={l2.id}
      l2Href={`/c/${l1.slug}/${l2.slug}`}
      l2Image={l2.image || null}
      defaultHeading={spec.heading}
      bannerLabel={spec.bannerLabel}
      testSlug={spec.l2Slug}
    />
  );
}


// ---------------------------------------------------------------------------
// L1 store discovery — "{L1} stores near you" (G7 §16, redesign of Phase
// F's "Shop by Store" carousel). This is the REAL-store counterpart to
// the CMS-editorial store_footwear/ethnic/lingerie modules below — real
// stores only, never CMS-pinned display cards (§17's "A vs B" distinction
// is deliberate: this section is "A", StoreSectionModule below is "B").
//
// Card: SellerCard's `variant="discovery"` (G7) — the SAME component the
// marketplace-global StoresNearYouSection uses, per §18's "one reusable
// StoreCard, not one per surface" rule. Was a bespoke large peek-carousel
// (top-overlay name, aspect-[4/3] ~75vw cards); now the same compact
// horizontal-scroll-row-of-cards treatment as every other store module.
//
// Data: unchanged — reuses Phase A's generalized GET /categories/{l1_id}
// /stores (no l2_id), same endpoint the gendered store modules below
// also call. Real production volume is sparse today (see this file's own
// git history) — same graceful "renders nothing when empty" this always
// had, deliberately NOT given the marketplace section's own visible
// empty-state (that's specific to "/" being more central to the whole
// page's purpose — see StoresNearYouSection's own comment).
// ---------------------------------------------------------------------------
function ShopByStoreSection({ l1 }: { l1: CategoryNode | undefined }) {
  const { data: stores } = useQuery({
    queryKey: ["shop-by-store", l1?.id],
    queryFn: async () => {
      const r = await apiClient.get<GenderedSectionStore[]>(`/api/categories/${l1!.id}/stores`, { params: { limit: 20 } });
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!l1,
  });

  const entries = (stores ?? []).filter((s) => !!(s.banner || (s.banners && s.banners[0])));
  if (entries.length === 0 || !l1) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_store">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">Stores Near You</h2>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {entries.map((s) => {
          const isOpen = s.availability_rank === 1;
          const closedLabel = isOpen ? undefined : (s.next_open_label || "Closed");
          return (
            <SellerCard
              key={s.id}
              s={{ ...s, banner: s.banner || (s.banners && s.banners[0]) || null }}
              source="shop_by_store"
              variant="discovery"
              openNow={isOpen}
              closedLabel={closedLabel}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /c/[slug]'s own intrinsic browsing chrome: an L2
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
          <h2 className="font-display font-medium text-lg sm:text-xl tracking-tight text-[#0A1F5C] leading-tight mb-4">
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
        <h1 data-testid="cat-title" className="text-2xl sm:text-3xl font-display font-medium text-[#0A1F5C] leading-tight">
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

export function L1PageClient({ l1Id }: { l1Id: string }) {
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);

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
  // "Other Categories" (§18) needs to know which L2 slugs the primary
  // Shop-by-Category grid already used, so it only shows the remainder —
  // same per-L1 spec lists that section already defines, just read here
  // too rather than duplicated.
  const primaryL2Slugs = useMemo(() => {
    const specs = l1Slug === "men" ? MEN_CATEGORY_TILES : l1Slug === "kids" ? KIDS_CATEGORY_TILES : WOMEN_CATEGORY_TILES;
    return new Set(specs.map((s) => s.l2Slug));
  }, [l1Slug]);

  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);

  useEffect(() => {
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { sections?: SectionDoc[] };
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        const defaultMap = new Map(DEFAULT_SECTIONS.map((s) => [s.id, s]));
        const fromServer = c.sections
          .filter((s: SectionDoc) => defaultMap.has(s.id)) // only ids this surface knows how to render — see this file's own top comment
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
    api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
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
  const bestDealsLink = `/products?l1=${l1Id}&sort=discount`;
  const premiumPicksLink = `/products?l1=${l1Id}&sort=price_desc`;

  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: (
      <div key="hero" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("hero")); } catch {} } }}>
        <HeroCarousel l1Id={l1Id} />
      </div>
    ),

    shop_by_category: <ShopByCategorySection key="shop-by-category" tiles={resolveShopByCategoryTiles(categories, l1Slug)} />,

    store_footwear: <GenderedStoreSection key="store-footwear" categories={categories} l1Slug={l1Slug} slot="footwear" />,
    store_ethnic: <GenderedStoreSection key="store-ethnic" categories={categories} l1Slug={l1Slug} slot="ethnic" />,
    store_lingerie: <GenderedStoreSection key="store-lingerie" categories={categories} l1Slug={l1Slug} slot="lingerie" />,

    under_499: <BudgetBentoSection key="budget-bento" l1Id={l1Id} />,

    shop_by_store: <ShopByStoreSection key="shop-by-store" l1={l1} />,

    other_categories: <OtherCategoriesSection key="other-categories" l1={l1} primarySlugs={primaryL2Slugs} />,

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

    offers: <OffersSection key="offers" />,

    customer_love: <CustomerLove key="testimonials" items={testimonials} />,
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
        {l1 && <BrowseGridBlock l1={l1} />}
        <TrustStickers />
      </main>
    </div>
  );
}
