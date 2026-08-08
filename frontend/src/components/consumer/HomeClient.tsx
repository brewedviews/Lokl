"use client";

/**
 * Home page client tree.
 *
 * Section order (desktop & mobile):
 *   1. Category pills
 *   2. Hero
 *   3. Just In (JustInSection — self-fetches newest arrivals + store chips)
 *   4. Popular stores
 *   5. Best deals (from home-products)
 *   6. Price bentos (under_499)
 *   7. Offers for you
 *   8. Open a store (merchant CTA)
 *   9. Loved by Bhilai shoppers
 *
 * Trending now is disabled pre-launch — with no order history yet it shows
 * duplicate/fake data. Code kept in place, just `enabled: false`.
 *
 * API calls on mount — critical (immediate):
 *   • /api/feed/home-products  — trending + best deals
 *   • /api/categories
 *   • /api/site/homepage-config
 *   • /api/site/home-stats
 * Deferred 800 ms (non-critical):
 *   • /api/catalog/offers
 *   • /api/catalog/testimonials
 *   • /api/feed/popular-stores
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { HeroV2 } from "@/components/consumer/v2/HeroV2";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { CustomerLove } from "@/components/consumer/v2/CustomerLove";
import { JustInSection } from "@/components/consumer/JustInSection";
import { TrustStickers } from "@/components/consumer/TrustStickers";
import { Skeleton } from "@/components/ui/Skeleton";
import { useLocationStore } from "@/stores";
import type { ProductCard as ProductCardType, StoreCard, CategoryNode, AreaTile, PriceBentoResponse } from "@/types";
import {
  trackSectionImpression, trackCategoryTileClick, trackCategoryTileImpression,
  trackPriceFilterClick, trackProductClick, trackStoreClick,
  trackOfferClick, trackMerchantCTAClick, observeImpression,
} from "@/lib/analytics";

interface OfferDoc { id: string; title: string; subtitle?: string; description?: string; code?: string; image?: string; cta_label?: string; cta_link?: string; background?: string }
interface TestimonialDoc { id: string; name: string; city: string; quote?: string; message?: string; rating?: number; avatar?: string }
interface HomeStatsDoc { fastest_eta_min?: number }
interface HeroConfigDoc { image?: string; eyebrow?: string; title_line1?: string; title_line2?: string; subtitle?: string }
interface SectionDoc { id: string; label: string; enabled: boolean; rank: number }
interface HomeProductsRail { store_id: string; store_name: string; store_slug: string; store_banner?: string; store_tagline?: string; products: ProductCardType[] }
interface HomeProductsResponse { store_rails: HomeProductsRail[]; trending: ProductCardType[]; best_deals: ProductCardType[]; premium_picks: ProductCardType[] }

// Rendered order (enabled sections only): category_pills → hero →
// under_499 → best_deals → for_her → for_him → offers → premium_picks →
// merchant_cta. just_in is PAUSED (enabled:false) — code and rank stay in
// place so re-enabling is a one-flag revert; its rank keeps it slotted
// right before best_deals, its old position, for when that happens.
// customer_love is also paused (matches the live call already made on this
// section). trending/stores stay disabled as before, ranks pushed clear of
// the reorder just so nothing here shares a rank.
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "category_pills", label: "Category pills",            enabled: true,  rank: 10 },
  { id: "hero",           label: "Hero",                      enabled: true,  rank: 20 },
  { id: "under_499",      label: "Under ₹499",                enabled: true,  rank: 30 },
  { id: "just_in",        label: "Just In",                   enabled: false, rank: 35 },
  { id: "best_deals",     label: "Best deals",                enabled: true,  rank: 40 },
  { id: "for_her",        label: "For Her",                   enabled: true,  rank: 50 },
  { id: "for_him",        label: "For Him",                   enabled: true,  rank: 60 },
  { id: "offers",         label: "Offers for you",            enabled: true,  rank: 70 },
  { id: "premium_picks",  label: "Premium picks",             enabled: true,  rank: 80 },
  { id: "trending",       label: "Trending now",              enabled: false, rank: 85 },
  { id: "merchant_cta",   label: "Open a store",              enabled: true,  rank: 90 },
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: false, rank: 100 },
  { id: "shop_by_area",   label: "Shop by Area",              enabled: true,  rank: 105 },
  { id: "stores",         label: "Popular stores",            enabled: false, rank: 110 },
];

/**
 * Injects a size/quality/format transform into a Cloudinary delivery URL
 * (e.g. `.../upload/w_300,q_auto,f_auto/...`) so category art doesn't ship
 * as a full-resolution original. No-op for any other host — we don't
 * control those images' transform syntax, so we never risk corrupting them.
 */
function cloudinaryOptimize(url: string | undefined | null, transform = "w_300,q_auto,f_auto"): string {
  if (!url) return "";
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/${transform}/`);
}

// ---------------------------------------------------------------------------
// For Her / For Him bento — reuses category_pills' tile visual pattern
// (mobile horizontal-scroll circles, desktop image-led portrait grid) against
// a curated list of L2s (+ a few standalone L1s) rather than the full
// category set. Tiles resolve their image from the same /api/categories
// response category_pills already fetches — no extra request.
// ---------------------------------------------------------------------------
interface GenderTileSpec {
  label: string;
  l1Slug: string;
  l2Slug?: string; // omit for a standalone L1 tile (e.g. Ethnic, Footwear)
}

const FOR_HER_TILES: GenderTileSpec[] = [
  { label: "Dresses",     l1Slug: "women", l2Slug: "dresses" },
  { label: "Tops",        l1Slug: "women", l2Slug: "tops" },
  { label: "Bottoms",     l1Slug: "women", l2Slug: "bottoms" },
  { label: "Ethnic",      l1Slug: "women", l2Slug: "ethnic-wear" },
  { label: "Co-ord Sets", l1Slug: "women", l2Slug: "coords" },
  { label: "Lingerie",    l1Slug: "women", l2Slug: "lingerie" },
  { label: "Footwear",    l1Slug: "women", l2Slug: "footwear" },
  { label: "Accessories", l1Slug: "accessories" },
];

const FOR_HIM_TILES: GenderTileSpec[] = [
  { label: "T-Shirts",    l1Slug: "men", l2Slug: "tshirts" },
  { label: "Jeans",       l1Slug: "men", l2Slug: "jeans" },
  { label: "Shirts",      l1Slug: "men", l2Slug: "shirts" },
  { label: "Ethnic",      l1Slug: "men", l2Slug: "ethnic-wear" },
  { label: "Formals",     l1Slug: "men", l2Slug: "formals" },
  { label: "Inner Wear",  l1Slug: "men", l2Slug: "innerwear" },
  { label: "Footwear",    l1Slug: "men", l2Slug: "footwear" },
  { label: "Accessories", l1Slug: "accessories" },
];

interface ResolvedGenderTile { key: string; href: string; image: string | null; label: string; minPrice: number | null }

function formatFromPrice(n: number): string {
  return `from ₹${Math.round(n).toLocaleString("en-IN")}`;
}

// Ethnic/Footwear/Lingerie tiles target the L2s already nested under
// l1-women / l1-men (l2-women-ethnic, l2-men-footwear, etc.) rather than
// the standalone l1-ethnic/l1-footwear/l1-lingerie categories or the
// product `gender` field. That field is unreliable — the merchant form
// never shows a gender picker once an L1 has L2 children, which Ethnic and
// Footwear both do, so it's almost never set — but these gendered L2s sidestep
// that entirely: they're real, separate category docs (same mechanism as
// Dresses/Tops/Bottoms), each with its own image and its own filtered
// destination, no gender field involved. Accessories has no gendered L2
// under either l1-women or l1-men, so it stays pointed at the shared
// standalone l1-accessories for both grids.
//
// Image is read ONLY from the tile's own target — l1.image for an L1-target
// tile, l2.image for an L2-target tile — never a cross-fallback between the
// two. A tile is only dropped when its target CATEGORY doesn't exist (l1
// missing, or l2Slug given but no matching l2 under that l1); if the
// category exists but its image is unset, the tile still renders with
// image: null so the grid keeps its full 8 tiles and the component below
// shows a blank placeholder instead of borrowing imagery from elsewhere.
function resolveGenderTiles(categories: CategoryNode[], specs: GenderTileSpec[]): ResolvedGenderTile[] {
  const out: ResolvedGenderTile[] = [];
  for (const spec of specs) {
    const l1 = categories.find((c) => c.slug === spec.l1Slug);
    if (!l1) continue;
    if (!spec.l2Slug) {
      out.push({ key: `l1-${l1.slug}`, href: `/c/${l1.slug}`, image: l1.image || null, label: spec.label, minPrice: l1.min_price ?? null });
      continue;
    }
    const l2 = (l1.l2 ?? []).find((s) => s.slug === spec.l2Slug);
    if (!l2) continue;
    out.push({ key: l2.id, href: `/c/${l1.slug}/${l2.slug}`, image: l2.image || null, label: spec.label, minPrice: l2.min_price ?? null });
  }
  return out;
}

// 4×2 shoppable grid (all 8 tiles always visible, no horizontal scroll) —
// deliberately NOT the same look as the top L1 pill row (category_pills):
// that's a full-bleed image with the label overlaid on a gradient. This is
// image + label + price chip sitting directly on the page background, no
// card/border/box, so the two rows read as different UI, not a repeat of
// the same pattern.
function GenderBentoSection({ id, title, tiles }: { id: string; title: string; tiles: ResolvedGenderTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div key={id} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid={`home-${id}`}>
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">{title}</h2>

      <div className="grid grid-cols-3 min-[360px]:grid-cols-4 gap-x-3 gap-y-4 sm:gap-x-4">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} data-testid={`${id}-tile-${t.key}`}
            className="group flex flex-col items-center gap-1.5 active:scale-[0.97] transition">
            <div className="relative w-full aspect-square rounded-card overflow-hidden bg-transparent">
              {t.image ? (
                <img src={cloudinaryOptimize(t.image, "w_300,q_auto,f_auto")} alt={t.label} loading="lazy" className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105" />
              ) : (
                <div className="w-full h-full bg-surface-tint" data-testid={`${id}-blank-${t.key}`} />
              )}
            </div>
            <span className="text-[12px] font-semibold text-brand-primary text-center leading-tight line-clamp-1 w-full">{t.label}</span>
            {t.minPrice != null && (
              <span className="inline-flex items-center rounded-pill bg-brand-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-white" data-testid={`${id}-price-${t.key}`}>
                {formatFromPrice(t.minPrice)}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

// "Shop by Area" — same overlay-card family as the price-bento tiles
// (under_499 render map entry below): full-bleed image, bottom navy
// gradient, name as the bold white hero + store-count as the small
// cream/orange subtitle, no white block underneath. Fixed grid-cols-3
// regardless of width (unlike the gender bento's responsive column
// count) since this set is always exactly 6. The count subtitle ALWAYS
// renders, including "0 stores" — a missing count isn't a reason to
// hide it, an area with no stores yet is still real information
// ("expanding here").
function ShopByAreaSection({ areas }: { areas: AreaTile[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_area">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Area</h2>

      <div className="grid grid-cols-3 gap-2">
        {areas.map((a) => (
          <Link key={a.slug} href={`/stores?area=${a.slug}`} data-testid={`shop-by-area-tile-${a.slug}`}
            className="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95">
            {a.image ? (
              <img
                src={cloudinaryOptimize(a.image, "w_400,q_auto,f_auto")}
                alt={a.name}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
              />
            ) : (
              // No CMS image set for this area — same styled navy gradient +
              // orange accent mark as the price tiles' empty state, so it
              // reads as intentional rather than a broken image.
              <div className="absolute inset-0 bg-gradient-to-br from-[#0A1F5C] via-[#122a6e] to-[#081540] flex items-center justify-center pb-6" data-testid={`shop-by-area-blank-${a.slug}`}>
                <div className="w-9 h-9 rounded-full bg-[#E68910]/20 flex items-center justify-center">
                  <Sparkles size={15} className="text-[#E68910]" />
                </div>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0A1F5C]/95 via-[#0A1F5C]/35 to-transparent pointer-events-none" />
            <div className="absolute bottom-2.5 left-2.5 right-2.5">
              <div className="font-display font-bold text-white text-[13px] sm:text-sm leading-tight line-clamp-1">{a.name}</div>
              <div className="text-[10px] font-semibold text-[#F5C99B] mt-0.5 leading-tight" data-testid={`shop-by-area-count-${a.slug}`}>
                {a.store_count} {a.store_count === 1 ? "store" : "stores"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
  const [sections, setSections] = useState<SectionDoc[]>(DEFAULT_SECTIONS);
  const [offers, setOffers] = useState<OfferDoc[]>([]);
  const [trending, setTrending] = useState<ProductCardType[]>([]);
  const [bestDeals, setBestDeals] = useState<ProductCardType[]>([]);
  const [premiumPicks, setPremiumPicks] = useState<ProductCardType[]>([]);
  const [_storeRails, setStoreRails] = useState<HomeProductsRail[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [areas, setAreas] = useState<AreaTile[]>([]);
  const [priceBento, setPriceBento] = useState<PriceBentoResponse | null>(null);
  const [nearby, setNearby] = useState<StoreCard[]>([]);
  const [popularStores, setPopularStores] = useState<StoreCard[]>([]);
  const [testimonials, setTestimonials] = useState<TestimonialDoc[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  // Gates the popular-stores / nearby-stores fetches — no point fetching
  // data for a section that's disabled and will never render. Seeded from
  // the local default and updated once the server config (which can
  // override enabled/disabled without a deploy) resolves. Mirrored into a
  // ref too since the deferred-fetch timer lives inside a mount-only
  // effect and can't reactively read updated state from its own closure.
  const [storesEnabled, setStoresEnabled] = useState(
    () => DEFAULT_SECTIONS.find((s) => s.id === "stores")?.enabled ?? false
  );
  const storesEnabledRef = useRef(storesEnabled);

  const markLoaded = (key: string) =>
    setLoaded((prev) => { const next = new Set(prev); next.add(key); return next; });
  const markError = (key: string) =>
    setErrors((prev) => { const next = new Set(prev); next.add(key); return next; });

  useEffect(() => {
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[] };
      if (c.hero) setHero(c.hero);
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        // Merge: server config toggles enabled/disabled, but LOCAL rank always wins
        // so newly added DEFAULT_SECTIONS entries always appear in the right order.
        const defaultMap = new Map(DEFAULT_SECTIONS.map((s) => [s.id, s]));
        const serverIds = new Set(c.sections.map((s: SectionDoc) => s.id));
        const extra = DEFAULT_SECTIONS.filter((s) => !serverIds.has(s.id));
        const merged = [
          ...c.sections.map((s: SectionDoc) => ({ ...s, rank: defaultMap.get(s.id)?.rank ?? s.rank })),
          ...extra,
        ];
        const seen = new Set<string>();
        const deduped = merged.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
        setSections(deduped);
        const resolvedStoresEnabled = deduped.find((s) => s.id === "stores")?.enabled ?? false;
        setStoresEnabled(resolvedStoresEnabled);
        storesEnabledRef.current = resolvedStoresEnabled;
      }
      markLoaded("hero");
    }).catch(() => { markLoaded("hero"); });
    api.catalog.categories().then((r) => setCategories(r)).catch(() => {});
    api.catalog.areas().then((r) => setAreas(r)).catch(() => {});
    api.catalog.priceBento().then((r) => setPriceBento(r)).catch(() => {});

    const _deferTimer = setTimeout(() => {
      api.catalog.offers().then((r) => { setOffers(r as unknown as OfferDoc[]); markLoaded("offers"); }).catch(() => { markLoaded("offers"); markError("offers"); });
      api.catalog.testimonials().then((r) => setTestimonials(r as unknown as TestimonialDoc[])).catch(() => {});
      if (storesEnabledRef.current) {
        api.stores.popular(10).then((r) => { setPopularStores(r); markLoaded("popularStores"); }).catch(() => { markLoaded("popularStores"); markError("popularStores"); });
      } else {
        markLoaded("popularStores");
      }
    }, 800);

    // Single request for all product content — replaces N+1 store fetches
    apiClient.get<HomeProductsResponse>("/api/feed/home-products").then((r) => {
      const data = r.data || { store_rails: [], trending: [], best_deals: [], premium_picks: [] };
      const hasProducts = (data.trending?.length || 0) + (data.store_rails?.length || 0) > 0;

      if (hasProducts) {
        setStoreRails(data.store_rails || []);
        setTrending(data.trending || []);
        setBestDeals(data.best_deals || []);
        setPremiumPicks(data.premium_picks || []);
      } else {
        // Direct fallback — fetch products without feed filtering
        apiClient.get("/api/products?limit=24&sort=newest").then((r2: any) => {
          const products: ProductCardType[] = r2.data?.products || r2.data || [];
          if (products.length > 0) {
            setTrending(products.slice(0, 8));
            setBestDeals(products.slice(8, 16));
            setPremiumPicks(products.slice(16, 24));
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
      markLoaded("sellingFast");
      markLoaded("recent");
      markLoaded("premiumPicks");
    }).catch(() => {
      // On total failure still try direct products
      apiClient.get("/api/products?limit=24").then((r2: any) => {
        const products: ProductCardType[] = r2.data?.products || [];
        if (products.length > 0) {
          setTrending(products.slice(0, 8));
          setBestDeals(products.slice(8, 16));
          setPremiumPicks(products.slice(16, 24));
        }
      }).catch(() => {});
      markLoaded("storeRails");
      markLoaded("sellingFast");
      markLoaded("recent");
      markLoaded("premiumPicks");
      markError("sellingFast");
      markError("recent");
      markError("premiumPicks");
    });

    return () => clearTimeout(_deferTimer);
  }, []);

  useEffect(() => {
    if (!storesEnabled) return;
    if (lat != null && lng != null) {
      api.stores.nearby({ lat, lng, limit: 10 }).then((r) => { setNearby(r); markLoaded("nearby"); }).catch(() => { markLoaded("nearby"); });
    }
  }, [lat, lng, storesEnabled]);

  const storesReady = loaded.has("nearby") || loaded.has("popularStores");
  const storesRail = nearby.length > 0 ? nearby : popularStores;
  const storesTitle = nearby.length > 0 ? "Stores near you" : "Popular stores in Bhilai";

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
  const StoreRailSkeleton = () => (
    <div className="pt-4 px-4 sm:px-6">
      <Skeleton className="h-7 w-44 rounded-full mb-1" />
      <Skeleton className="h-4 w-56 rounded-full mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shrink-0 w-36 rounded-2xl overflow-hidden bg-white">
            <Skeleton className="w-full h-20 rounded-none" />
            <div className="p-2.5 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
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

  const sectionRenderers: Record<string, React.ReactNode> = {
    hero: (
      <div key="hero" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("hero")); } catch {} } }}>
        <HeroV2 stats={stats} hero={hero} />
      </div>
    ),

    for_her: <GenderBentoSection key="for-her" id="for_her" title="For Her" tiles={resolveGenderTiles(categories, FOR_HER_TILES)} />,

    for_him: <GenderBentoSection key="for-him" id="for_him" title="For Him" tiles={resolveGenderTiles(categories, FOR_HIM_TILES)} />,

    under_499: (
      <div key="price-bentos" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("under_499")); } catch {} } }}>
        <div className="grid grid-cols-3 gap-2">
          {[
            // Gap-free, integer-price bands: <499, 499-1499, >=1500. The
            // hero text below says "₹1,500+" (not "₹1,499+") specifically
            // so it agrees with the >=1500 filter it links to — 1499 itself
            // belongs to the middle band, so a "₹1,499+" label would have
            // overlapped it.
            { href: "/products?price=under-499", hero: "Under ₹499", sub: "Steals & deals", filter: "under_499" as const, bentoKey: "under_499" as const },
            { href: "/products?price=499-1499", hero: "₹499–1,499", sub: "Most loved", filter: "499_999" as const, bentoKey: "most_loved" as const },
            { href: "/products?price=above-1499", hero: "₹1,500+", sub: "Premium picks", filter: "premium" as const, bentoKey: "premium" as const },
          ].map(({ href, hero, sub, filter, bentoKey }) => {
            const image = priceBento?.[bentoKey] ?? null;
            return (
              <Link key={href} href={href} onClick={() => { try { trackPriceFilterClick(filter); } catch {} }}
                className="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95">
                {image ? (
                  <img
                    src={cloudinaryOptimize(image, "w_400,q_auto,f_auto")}
                    alt={hero}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  // No product in this band yet (sparse catalog) — a styled
                  // navy gradient + a small orange accent mark reads as
                  // "premium / coming soon" rather than a broken image.
                  // Fills in automatically once inventory lands in range.
                  <div className="absolute inset-0 bg-gradient-to-br from-[#0A1F5C] via-[#122a6e] to-[#081540] flex items-center justify-center pb-6">
                    <div className="w-9 h-9 rounded-full bg-[#E68910]/20 flex items-center justify-center">
                      <Sparkles size={15} className="text-[#E68910]" />
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0A1F5C]/95 via-[#0A1F5C]/35 to-transparent pointer-events-none" />
                <div className="absolute bottom-2.5 left-2.5 right-2.5">
                  <div className="font-display font-bold text-white text-[13px] sm:text-sm leading-tight">{hero}</div>
                  <div className="text-[10px] font-semibold text-[#F5C99B] mt-0.5 leading-tight">{sub}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    ),

    category_pills: (
      <div key="category-pills" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
        {/* Mobile — horizontal-scroll tile strip, unchanged */}
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 md:hidden">
          {categories.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div className="w-16 h-16 rounded-2xl bg-[#E5E2DC] animate-pulse" />
                <div className="w-12 h-3 bg-[#E5E2DC] rounded animate-pulse" />
              </div>
            ))
          ) : (
            <>
              <Link href="/products" className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition">
                <div className="w-16 h-16 rounded-2xl bg-[#0A1F5C] flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-[#0A1F5C] text-center">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat, catIdx) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]">
                    {cat.image ? (
                      <img src={cloudinaryOptimize(cat.image, "w_128,q_auto,f_auto")} alt={cat.name} loading="lazy" className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="w-full h-full bg-[#E5E2DC] flex items-center justify-center">
                        <span className="text-2xl">👗</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-[#0A1F5C] text-center w-16 leading-tight line-clamp-2">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              ))}
            </>
          )}
        </div>

        {/* Desktop — image-led portrait card grid, one column per category */}
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
                <span className="font-display font-bold text-white text-sm">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat, catIdx) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC] transition hover:border-[#0A1F5C]"
                >
                  {cat.image ? (
                    <img src={cloudinaryOptimize(cat.image, "w_400,q_auto,f_auto")} alt={cat.name} loading="lazy" className="w-full h-full object-cover object-top transition duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="w-full h-full bg-[#E5E2DC]" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none" />
                  <span className="absolute bottom-3 left-3 right-3 font-display font-bold text-white text-sm leading-tight line-clamp-2 break-words">
                    {cat.name === "Lingerie & Innerwear" ? "Lingerie" : cat.name}
                  </span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    ),

    // Trending products
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

    // Best deals
    best_deals: errors.has("sellingFast") ? null
      : loaded.has("sellingFast") && bestDeals.length >= 1 ? (
          <HCarousel key="best-deals" title="Best deals" testid="home-best-deals" link="/products?sort=discount" linkLabel="See all">
            {bestDeals.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "best_deals", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : !loaded.has("sellingFast") ? <ProductRailSkeleton key="best-deals-skeleton" testid="home-best-deals-skeleton" /> : null,

    // Premium picks — highest-priced products, full stop
    premium_picks: errors.has("premiumPicks") ? null
      : loaded.has("premiumPicks") && premiumPicks.length >= 1 ? (
          <HCarousel key="premium-picks" title="Premium picks" testid="home-premium-picks" link="/products?sort=price_desc" linkLabel="See all">
            {premiumPicks.slice(0, 8).map((p, pIdx) => (
              <div key={p.id} onClick={() => { try { trackProductClick({ product_id: p.id, product_name: p.name, price: p.price, rail_name: "premium_picks", position: pIdx }); } catch {} }}>
                <ProductCard p={p} size="default" />
              </div>
            ))}
          </HCarousel>
        )
      : !loaded.has("premiumPicks") ? <ProductRailSkeleton key="premium-picks-skeleton" testid="home-premium-picks-skeleton" /> : null,

    offers: errors.has("offers") ? (
      <SectionError key="offers-error" minHeight="min-h-[120px]" />
    ) : loaded.has("offers") && offers.length > 0 ? (
      <section key="offers" className="pt-8" data-testid="offers-strip" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offers")); } catch {} } }}>
        <div className="px-4 sm:px-6 lg:px-8 mb-3 max-w-7xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">Offers for you</h2>
        </div>
        <div
          className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-6 lg:scroll-pl-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
        >
          {offers.slice(0, 6).map((offer) => {
            const href = offer.cta_link || "/categories";
            const cardStyle = { background: offer.background || "#0A1F5C" };
            const inner = (
              <div className="aspect-[16/9] relative">
                {offer.image && (
                  <img src={offer.image} alt={offer.title} className="absolute inset-0 w-full h-full object-cover opacity-70" />
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
                className="snap-start shrink-0 w-[78vw] sm:w-[340px] rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]"
                style={cardStyle}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </section>
    ) : !loaded.has("offers") ? <OffersSkeleton key="offers-skeleton" /> : null,

    // JustInSection self-fetches newest arrivals + the store-chip list and
    // collapses to null if no store has any visible products.
    just_in: <JustInSection key="just-in" />,

    stores: errors.has("popularStores") && !storesRail.length ? (
      <SectionError key="stores-error" minHeight="min-h-[200px]" />
    ) : storesReady && storesRail.length > 0 ? (
      <section key="stores" className="pt-8" data-testid="home-stores">
        <div className="px-4 sm:px-6 lg:px-8 flex items-end justify-between gap-3 mb-3 max-w-7xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight">{storesTitle}</h2>
          <a href="/stores" className="text-xs font-bold text-[#F59E0B] shrink-0 hover:underline">See all →</a>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-1">
          {storesRail.map((s) => (
            <Link key={s.id} href={`/store/${(s as any).slug || s.id}`}
              onClick={() => { try { trackStoreClick(s.id, s.name, "homepage_stores"); } catch {} }}
              className="flex-shrink-0 w-36 bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-sm transition active:scale-95">
              <div className="relative h-20 bg-[#E5E2DC]">
                {((s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo) ? (
                  <img src={(s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || s.logo} alt={s.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="p-2.5">
                <div className="font-bold text-[#0A1F5C] text-[12px] truncate">{s.name}</div>
                <div className="text-[10px] text-[#9CA3AF] mt-0.5">⚡ {s.eta_min ?? 45} min</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    ) : !storesReady ? <StoreRailSkeleton key="stores-skeleton" /> : null,

    merchant_cta: (
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
              <p className="text-white font-bold text-sm leading-tight">
                Own a store in Bhilai?
              </p>
              <p className="text-white/60 text-xs mt-0.5">
                Join Lokl — list your products for free
              </p>
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

    customer_love: <CustomerLove key="testimonials" items={testimonials} />,

    shop_by_area: <ShopByAreaSection key="shop-by-area" areas={areas} />,

  };

  const orderedSections = [...sections]
    .filter((s) => s.enabled !== false)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((s) => sectionRenderers[s.id])
    .filter(Boolean);

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7] bottom-nav-safe">
      <main className="flex-1">
        {orderedSections}
        <TrustStickers />
      </main>
    </div>
  );
}
