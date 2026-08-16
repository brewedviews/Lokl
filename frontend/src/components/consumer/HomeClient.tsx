"use client";

/**
 * Home page client tree.
 *
 * Section order + enabled/disabled state is CMS-driven — see
 * DEFAULT_SECTIONS below (the seed/fallback) and the homepageConfig fetch
 * effect (the DB-is-authoritative merge). It is NOT a fixed list — an
 * admin can reorder or toggle any section from Homepage CMS -> Sections
 * without a code change, so don't rely on a hardcoded sequence in this
 * comment going stale again; read DEFAULT_SECTIONS for the current
 * default/fallback order.
 *
 * Trending now, Just In and Loved by Bhilai shoppers ship disabled by
 * default — code stays in place so re-enabling any of them from the CMS
 * is a toggle, not a code change.
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
import { Sparkles, RotateCcw } from "lucide-react";
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

// SEED/FALLBACK ONLY — this array's order and enabled state are what a
// brand-new site_config doc gets seeded with, and what the homepage falls
// back to if the CMS config is missing/malformed. Once a DB config exists,
// it is AUTHORITATIVE for order + enabled (see the homepageConfig fetch
// effect in HomeClient below) — an admin reorders/toggles sections from
// Homepage CMS -> Sections, not by editing this file. Keep this array in
// sync with the backend's DEFAULT_HOMEPAGE_SECTIONS (server.py) so a
// fresh install and the CMS's own seed agree.
//
// "open_now" (formerly its own "Open now near you" rail) has been folded
// into meet_sellers — the two showed the same store data with overlapping
// intent, so meet_sellers' rail is now open-stores-first, nearest-first,
// then closed stores — see sellersSorted in HomeClient and
// MeetSellersSection above. There is no longer a separate id for it.
// The standalone "stores" section (disabled "Popular stores" rail) has
// been deleted entirely — same storesRail data, same /stores destination
// as meet_sellers, just an older visual style; dead weight once
// meet_sellers covers the same ground.
// TrustStickers isn't part of this ranked list at all — it's hardcoded to
// render after {orderedSections} unconditionally (see JSX below), which
// always puts it last regardless of CMS order.
const DEFAULT_SECTIONS: SectionDoc[] = [
  { id: "category_pills", label: "Category pills",    enabled: true, rank: 10 },
  { id: "hero",           label: "Hero",              enabled: true, rank: 20 },
  { id: "under_499",      label: "Under ₹499",        enabled: true, rank: 70 },
  { id: "meet_sellers",   label: "Meet your sellers", enabled: true, rank: 50 },
  { id: "best_deals",     label: "Best deals",        enabled: true, rank: 30 },
  { id: "try_and_buy",    label: "Try & Buy",         enabled: true, rank: 40 },
  { id: "for_her",        label: "For Her",           enabled: true, rank: 100 },
  { id: "for_him",        label: "For Him",           enabled: true, rank: 105 },
  { id: "merchant_cta",   label: "Open a store",      enabled: true, rank: 60 },
  { id: "premium_picks",  label: "Premium picks",     enabled: true, rank: 90 },
  { id: "shop_by_area",   label: "Shop by Area",      enabled: true, rank: 80 },
  { id: "offers",         label: "Offers for you",    enabled: true, rank: 110 },

  // Optional / Future
  { id: "just_in",        label: "Just In",                   enabled: false, rank: 120 },
  { id: "trending",       label: "Trending now",              enabled: false, rank: 130 },
  { id: "customer_love",  label: "Loved by Bhilai shoppers",  enabled: false, rank: 140 },
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

// Small circular category avatars — the same visual scale/shape as
// category_pills' own mobile tile strip above (w-16 h-16 circle, label
// centered below), reused here instead of the large aspect-[3/4]
// rectangular cards this section used to render. Those rectangular cards
// (roughly half-width each) made this a tall, heavy section. No price
// pill overlay — a price badge doesn't sit well on a circular crop, and
// category_pills' own avatars don't carry one, so dropping it keeps the
// two patterns actually consistent rather than just visually similar.
//
// Static 4-column grid, NOT a horizontal scroll — an earlier pass made
// this a horizontal-scroll row, but with ~7-8 tiles per section that
// hides most of them behind a swipe a user has no visual cue to try.
// grid-cols-4 shows all of them up front, wrapping to a second
// (partially-filled) row rather than scrolling — every category is
// visible on load, not just the first 4-5.
function GenderBentoSection({ id, title, tiles }: { id: string; title: string; tiles: ResolvedGenderTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div key={id} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid={`home-${id}`}>
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">{title}</h2>

      <div className="grid grid-cols-4 gap-x-2 gap-y-4">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} data-testid={`${id}-tile-${t.key}`}
            className="flex flex-col items-center gap-1.5 active:scale-95 transition">
            <div className="relative w-16 h-16 rounded-full overflow-hidden bg-surface-tint border border-[#E5E2DC]">
              {t.image ? (
                <img
                  src={cloudinaryOptimize(t.image, "w_128,q_auto,f_auto")}
                  alt={t.label}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                // No CMS/category image yet — a quiet cream placeholder,
                // own orange accent mark. Name still renders below.
                <div className="absolute inset-0 flex items-center justify-center" data-testid={`${id}-blank-${t.key}`}>
                  <Sparkles size={15} className="text-brand-accent" />
                </div>
              )}
            </div>
            <span className="text-[11px] font-semibold text-brand-primary text-center w-16 leading-tight line-clamp-2">{t.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// "Shop by Area" — a LIGHT NAVIGATION card, same rationale as
// GenderBentoSection above: clean photo (no gradient scrim), the
// store-count pill overlaid bottom-left ON the image (own solid white
// fill + shadow so it reads over any photo), area name below the image in
// bold navy. Distinct from the price bentos' dark-gradient PROMOTIONAL
// treatment, which is unchanged. Fixed grid-cols-3 regardless of width
// (unlike the gender bento's responsive column count) since this set is
// always exactly 6. The count pill ALWAYS renders, including "0 stores" —
// a missing count isn't a reason to hide it, an area with no stores yet is
// still real information ("expanding here").
//
// aspect-[4/3] (was aspect-[3/4]) + gap-1.5 (was gap-2) — this is 6 EXISTING
// areas rendered denser, not a 3rd row of new areas: still exactly 3
// columns × 2 rows, just each card and the gaps between them shrunk.
// Badge/label font sizes scaled down to match (9px→8px badge, 12.5px→11px
// label) so neither looks oversized against the smaller photo.
function ShopByAreaSection({ areas }: { areas: AreaTile[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_area">
      <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-3">Shop by Area</h2>

      <div className="grid grid-cols-3 gap-1.5">
        {areas.map((a) => (
          <Link key={a.slug} href={`/stores?area=${a.slug}`} data-testid={`shop-by-area-tile-${a.slug}`}
            className="group flex flex-col gap-1 active:scale-95 transition">
            <div className="relative aspect-[4/3] rounded-card overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] bg-surface-tint">
              {a.image ? (
                <img
                  src={cloudinaryOptimize(a.image, "w_400,q_auto,f_auto")}
                  alt={a.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                // No CMS image set for this area — a quiet cream
                // placeholder, own orange accent mark. The area name and
                // store count still render normally (below the image /
                // pinned on the image respectively) — an empty photo isn't
                // a reason to hide either.
                <div className="absolute inset-0 flex items-center justify-center" data-testid={`shop-by-area-blank-${a.slug}`}>
                  <div className="w-7 h-7 rounded-full bg-brand-accent/15 flex items-center justify-center">
                    <Sparkles size={13} className="text-brand-accent" />
                  </div>
                </div>
              )}
              <span className="absolute bottom-1.5 left-1.5 inline-flex items-center rounded-pill bg-white px-1.5 py-0.5 text-[8px] font-bold leading-none text-brand-primary shadow-[0_1px_4px_rgba(0,0,0,0.3)]" data-testid={`shop-by-area-count-${a.slug}`}>
                {a.store_count} {a.store_count === 1 ? "store" : "stores"}
              </span>
            </div>
            <span className="text-[11px] font-bold text-brand-primary text-center leading-tight line-clamp-1">{a.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Shops near you" (rail heading — section id/title still says "meet
// sellers" in code/CMS, only the on-page copy changed) — the community/
// emotional pillar. Two parts:
//   A. A static cream positioning band (always renders — claims the local-
//      first story even with zero merchants onboarded).
//   B. A real-merchant rail sourced from nearby/popularStores — see
//      storesEnabled in HomeClient, which gates that fetch on this
//      section's own enabled flag (the standalone "stores" section that
//      used to share this fetch has since been removed as redundant).
// Sparse-catalog handling: whatever real stores exist render, in full —
// no trailing filler tile padding out a short rail. Zero stores → a single
// inviting banner, never a broken/empty scroll strip. All fallbacks are
// light (cream/tint), consistent with the recent navy-restraint pass — no
// dark slabs.
// ---------------------------------------------------------------------------
// Same overlay-tile pattern as ShopByAreaSection above (aspect-[3/4],
// rounded-2xl, whisper shadow, neutral dark scrim, bold white name +
// small cream area subtitle) — the single store-rail card family used
// across the homepage. No overlapping avatar — the name on the image is
// enough. Store's own tagline/story is intentionally left out to keep
// the card as clean as an area tile: name + area is the priority.
// `openNow` shows a small light-green "Open now" pill; otherwise
// `closedLabel` (e.g. "Opens at 6:00 PM", or a generic "Closed" when no
// specific reopen time is known) shows a muted pill instead — so every
// card in the merged meet_sellers rail carries a status, not just the
// open ones.
function SellerCard({ s, source = "meet_sellers", openNow = false, closedLabel }: { s: StoreCard; source?: string; openNow?: boolean; closedLabel?: string }) {
  const banner = (s as any).banner || (Array.isArray((s as any).banners) && (s as any).banners[0]) || s.image || null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const area = (s as any).area_label || (s as any).area || s.locality || "Bhilai"; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <Link key={s.id} href={`/store/${(s as any).slug || s.id}`} // eslint-disable-line @typescript-eslint/no-explicit-any
      onClick={() => { try { trackStoreClick(s.id, s.name, source); } catch {} }}
      data-testid={`${source}-card-${s.id}`}
      className="group flex-shrink-0 w-32 sm:w-36 relative aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95">
      {openNow ? (
        <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 text-[9px] font-bold text-[#0A1F5C]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> Open now
        </span>
      ) : closedLabel ? (
        <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/80 text-[9px] font-bold text-[#64748B]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]" /> {closedLabel}
        </span>
      ) : null}
      {banner ? (
        <>
          <img
            src={cloudinaryOptimize(banner, "w_320,q_auto,f_auto")}
            alt={s.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#141419]/75 via-[#141419]/30 to-transparent pointer-events-none" />
          <div className="absolute bottom-2.5 left-2.5 right-2.5">
            <div className="font-bold text-white text-[13px] sm:text-sm leading-tight line-clamp-1">{s.name}</div>
            <div className="text-[10px] font-semibold text-[#F0E9DD]/90 mt-0.5 leading-tight">{area}</div>
          </div>
        </>
      ) : (
        // No banner set for this store — same light cream/tint fallback the
        // area tiles use, not a dark slab.
        <div className="absolute inset-0 bg-[#F4F1E9] flex flex-col items-center justify-center gap-2 px-2 text-center">
          <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
            <Sparkles size={15} className="text-[#E68910]" />
          </div>
          <div>
            <div className="font-bold text-[#0A1F5C] text-[13px] sm:text-sm leading-tight line-clamp-1">{s.name}</div>
            <div className="text-[10px] font-semibold text-[#0A1F5C]/55 mt-0.5 leading-tight">{area}</div>
          </div>
        </div>
      )}
    </Link>
  );
}

// Combined "why local" + real-sellers rail. Used to be two sections
// (meet_sellers Part A/B, and a separate open_now rail) — merged into one
// since both showed the same store data with overlapping intent. `stores`
// is expected pre-sorted: open stores first, each bucket ascending by
// distance (see the sort in HomeClient below) — this component just
// renders whatever order it's given, per-card open/closed status included.
function MeetSellersSection({ stores, ready }: { stores: StoreCard[]; ready: boolean }) {
  return (
    <div className="pt-8" data-testid="home-meet_sellers">
      {/* Header/hook — editorial statement, same voice/treatment as the
          hero headline (bold display font, navy ink, orange accent word,
          left-aligned, sits directly on the page). No box, no pills.
          Always shows, independent of whether any seller is open. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display font-bold text-[#0A1F5C] text-[22px] sm:text-2xl leading-[1.15] tracking-tight max-w-md">
          your neighbour&apos;s shop, not a faraway <span className="text-[#E68910]">warehouse.</span>
        </h2>
        <p className="text-[13px] text-[#595959] mt-1.5 max-w-sm leading-relaxed">
          real shopkeepers. real bhilai. delivered in 45 mins.
        </p>
      </div>

      {/* Real-seller rail — open stores first (green "Open now" pill),
          then closed ones (muted "Opens at X" / "Closed" pill), each
          bucket nearest-first. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex items-end justify-between gap-3 mb-3">
          <h3 className="text-lg sm:text-xl font-display font-bold text-[#0A1F5C] leading-tight">Shops near you</h3>
          <a href="/stores" className="text-xs font-bold text-[#F59E0B] shrink-0 hover:underline">See all →</a>
        </div>

        {!ready ? (
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex-shrink-0 w-32 sm:w-36 aspect-[3/4] rounded-2xl bg-[#E5E2DC] animate-pulse" />
            ))}
          </div>
        ) : stores.length === 0 ? (
          <div className="bg-[#F4F1E9] rounded-2xl px-5 py-6 text-center flex flex-col items-center gap-2" data-testid="meet-sellers-empty">
            <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
              <Sparkles size={16} className="text-[#E68910]" />
            </div>
            <p className="text-[12px] font-semibold text-[#0A1F5C] max-w-xs mx-auto">
              We&apos;re onboarding your neighbourhood&apos;s shops right now — check back soon.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {stores.slice(0, 10).map((s) => {
              const isOpen = (s as any).availability_rank === 1; // eslint-disable-line @typescript-eslint/no-explicit-any
              const closedLabel = isOpen ? undefined : ((s as any).next_open_label || "Closed"); // eslint-disable-line @typescript-eslint/no-explicit-any
              return <SellerCard key={s.id} s={s} source="meet_sellers" openNow={isOpen} closedLabel={closedLabel} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Try & Buy" — Lokl's differentiated wedge (rider waits while you try, keep
// what you love, return the rest on the spot). A compact strip matching the
// merchant-CTA banner's proportions (rounded-2xl, whisper shadow, same
// overall footprint) — NOT a tall feature section. Light treatment (white
// card, navy text, orange accents), not a navy fill, per the restraint pass.
// The photo is CMS-settable (site_config.try_and_buy_image); a neutral
// cream fallback with a small orange icon renders when unset, same spirit
// as the price/area tiles' empty states.
// ---------------------------------------------------------------------------
function TryAndBuySection({ image }: { image: string }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-try_and_buy">
      <Link href="/try-and-buy" className="block">
        <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] flex items-stretch active:scale-[0.99] transition-transform">
          <div className="relative w-24 sm:w-28 shrink-0 bg-[#F4F1E9]">
            {image ? (
              <img
                src={cloudinaryOptimize(image, "w_240,q_auto,f_auto")}
                alt="Try & Buy"
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
                  <RotateCcw size={16} className="text-[#E68910]" />
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center">
            <p className="text-[10px] font-bold text-[#E68910] uppercase tracking-wide">Try &amp; Buy</p>
            <p className="font-bold text-[#0A1F5C] text-sm sm:text-base leading-tight mt-0.5">try before you pay.</p>
            <p className="text-[10px] sm:text-[11px] text-[#595959] mt-1 leading-snug">
              order it <span className="text-[#E68910] font-bold">·</span> rider waits while you try <span className="text-[#E68910] font-bold">·</span> keep what you love
            </p>
          </div>
        </div>
      </Link>
    </div>
  );
}

export function HomeClient() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stats, setStats] = useState<HomeStatsDoc | null>(null);
  const [hero, setHero] = useState<HeroConfigDoc | null>(null);
  const [tryAndBuyImage, setTryAndBuyImage] = useState<string>("");
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
  // data unless meet_sellers (the only remaining consumer of this fetch,
  // now that the standalone "stores" section has been removed) is enabled.
  // Seeded from the local default and updated once the server config
  // (which can override enabled/disabled without a deploy) resolves.
  // Mirrored into a ref too since the deferred-fetch timer lives inside a
  // mount-only effect and can't reactively read updated state from its own
  // closure.
  const [storesEnabled, setStoresEnabled] = useState(
    () => DEFAULT_SECTIONS.find((s) => s.id === "meet_sellers")?.enabled ?? false
  );
  const storesEnabledRef = useRef(storesEnabled);

  const markLoaded = (key: string) =>
    setLoaded((prev) => { const next = new Set(prev); next.add(key); return next; });
  const markError = (key: string) =>
    setErrors((prev) => { const next = new Set(prev); next.add(key); return next; });

  useEffect(() => {
    api.site.homeStats().then((r) => setStats(r as unknown as HomeStatsDoc)).catch(() => {});
    api.site.homepageConfig().then((cfg) => {
      const c = cfg as unknown as { hero?: HeroConfigDoc; sections?: SectionDoc[]; try_and_buy_image?: string };
      if (c.hero) setHero(c.hero);
      if (c.try_and_buy_image) setTryAndBuyImage(c.try_and_buy_image);
      if (Array.isArray(c.sections) && c.sections.length > 0) {
        // The DB config is now AUTHORITATIVE for order + enabled — this is
        // what makes the admin "Sections" CMS panel (Homepage Assets ->
        // Sections) actually take effect. Local DEFAULT_SECTIONS is used
        // only to fill in (a) any individual field missing/malformed on a
        // given DB entry — defensive; DB entries are always well-formed
        // today via admin_put_homepage_config's coercion, but a rank/
        // enabled value is never trusted blindly — and (b) whole sections
        // that exist in code but haven't been synced to the DB config yet,
        // so a newly-shipped section still appears (at its local default
        // rank/enabled) even before an admin or migration touches the CMS.
        // If this fetch fails, or returns no sections, `sections` state
        // simply keeps its useState(DEFAULT_SECTIONS) initial value below —
        // the homepage never blanks out on a missing/malformed CMS config.
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
        const resolvedStoresEnabled = deduped.find((s) => s.id === "meet_sellers")?.enabled ?? false;
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

  // meet_sellers' rail order: open stores first, then closed — each bucket
  // nearest-first. "Open" = availability_rank 1, the exact same LIVE rank
  // _store_availability() computes everywhere else in the app (badges,
  // checkout, order placement) — never a separate open/closed check.
  // distance_km is only populated when the backend had real user coords to
  // compute it from (nearby-stores; popularStores never gets one) — the
  // backend itself already falls back to the Bhilai centroid rather than a
  // faraway tester's real GPS (see _attach_distance_and_eta), so this never
  // sorts by a meaningless ~1000km reading. Missing distance sorts last
  // within its bucket, which for popularStores (no distance data at all)
  // just preserves the backend's own popularity order as a stable tiebreak.
  const sellersSorted = [...storesRail].sort((a, b) => {
    const aOpen = (a as any).availability_rank === 1 ? 0 : 1; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bOpen = (b as any).availability_rank === 1 ? 0 : 1; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (aOpen !== bOpen) return aOpen - bOpen;
    const aDist = (a as any).distance_km ?? Infinity; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bDist = (b as any).distance_km ?? Infinity; // eslint-disable-line @typescript-eslint/no-explicit-any
    return aDist - bDist;
  });

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
          ].map(({ href, hero, sub, filter, bentoKey }, i) => {
            const image = priceBento?.[bentoKey] ?? null;
            return (
              // aspect-[6/5] — was aspect-[3/4] (height = 1.333× width).
              // 6/5 brings height down to 0.833× width, ~62.5% of the old
              // height (inside the requested 60-70% range), while all 3
              // cards still fill the row in one line same as before — only
              // the height changed, not the column count. Internal text
              // inset trimmed from 2.5 to 2 to match the shorter card
              // (was starting to feel like it ate too much of the
              // remaining image at the new height); font sizes untouched.
              <Link key={href} href={href} onClick={() => { try { trackPriceFilterClick(filter); } catch {} }}
                className="group relative aspect-[6/5] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95">
                {image ? (
                  <>
                    <img
                      src={cloudinaryOptimize(image, "w_400,q_auto,f_auto")}
                      alt={hero}
                      loading="eager"
                      fetchPriority={i === 0 ? "high" : "auto"}
                      className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    {/* Neutral dark scrim, not navy — just enough to keep the
                        white text legible so the product photo's own color
                        shows through instead of everything reading as navy. */}
                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#141419]/75 via-[#141419]/30 to-transparent pointer-events-none" />
                    <div className="absolute bottom-2 left-2 right-2">
                      <div className="font-bold text-white text-[13px] sm:text-sm leading-tight">{hero}</div>
                      <div className="text-[10px] font-semibold text-[#F0E9DD]/90 mt-0.5 leading-tight">{sub}</div>
                    </div>
                  </>
                ) : (
                  // No product in this band yet (sparse catalog) — a LIGHT
                  // cream/tint fallback (not a dark navy slab): navy text, a
                  // small orange accent mark. An empty tile should read as
                  // quiet, not the heaviest, darkest element on the page.
                  // Fills in automatically once inventory lands in range.
                  <div className="absolute inset-0 bg-[#F4F1E9] flex flex-col items-center justify-center gap-1.5 px-2 text-center">
                    <div className="w-8 h-8 rounded-full bg-[#E68910]/15 flex items-center justify-center">
                      <Sparkles size={14} className="text-[#E68910]" />
                    </div>
                    <div>
                      <div className="font-bold text-[#0A1F5C] text-[13px] sm:text-sm leading-tight">{hero}</div>
                      <div className="text-[10px] font-semibold text-[#0A1F5C]/55 mt-0.5 leading-tight">{sub}</div>
                    </div>
                  </div>
                )}
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
                      // category_pills is the very first homepage section — only the
                      // first few tiles are actually visible without scrolling this
                      // horizontal strip, so only those need eager loading; later
                      // tiles are genuinely off-screen and stay lazy.
                      <img src={cloudinaryOptimize(cat.image, "w_128,q_auto,f_auto")} alt={cat.name}
                        loading={catIdx < 4 ? "eager" : "lazy"}
                        fetchPriority={catIdx === 0 ? "high" : "auto"}
                        className="w-full h-full object-cover object-top" />
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
                <span className="font-bold text-white text-sm">All</span>
              </Link>
              {(categories as any[]).slice(0, 9).map((cat, catIdx) => (
                <Link key={cat.id} href={`/c/${cat.slug}`}
                  onClick={() => { try { trackCategoryTileClick(cat.name, catIdx); } catch {} }}
                  ref={(el) => { if (el) { try { observeImpression(el, () => trackCategoryTileImpression(cat.name, catIdx)); } catch {} } }}
                  className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC] transition hover:border-[#0A1F5C]"
                >
                  {cat.image ? (
                    // Whole row fits within one desktop viewport width (a
                    // CSS grid, not a scroll strip like mobile) — the
                    // entire above-the-fold row loads eager.
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

    merchant_cta: (
      <div key="merchant-cta" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <a
          href="https://lokl.up.railway.app/merchant/register"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { try { trackMerchantCTAClick("homepage"); } catch {} }}
          className="block"
        >
          {/* Single line of copy, not a stacked title+subtitle — the old
              two-line version ("Own a store in Bhilai?" / "Join Lokl —
              list your products for free") made the subtitle wrap to a
              third line on narrow phones, which is what made the banner
              read as too thick. First attempt at a merged one-liner
              ("Own a store in Bhilai? List free on Lokl") still measured
              too long for the ~183px of text width actually left over
              once the "Join free →" pill and its gap are accounted for at
              375px — it truncated with an ellipsis instead of fitting.
              Just the original headline reliably fits at that width; the
              "free" part isn't lost, it's already carried by the Join
              free button right next to it. Tighter vertical padding
              (py-3, was py-4) now that there's only one line of text. */}
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

    meet_sellers: <MeetSellersSection key="meet-sellers" stores={sellersSorted} ready={storesReady} />,

    try_and_buy: <TryAndBuySection key="try-and-buy" image={tryAndBuyImage} />,

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
        <TrustStickers />
      </main>
    </div>
  );
}
