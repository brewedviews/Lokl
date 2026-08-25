"use client";

/**
 * SellerCard — the single store-rail card family used across the app.
 * Originally private to HomeClient.tsx (its "Meet your sellers" rail),
 * extracted here once CategoryClient's new "Stores in {L1}" rail needed
 * the exact same card rather than a second, similar-looking one.
 *
 * aspect-[3/4], rounded-2xl, whisper shadow, neutral dark scrim, bold
 * white name + small cream area/ETA/distance subtitle + product count.
 * Store's own tagline/story is intentionally left out to keep the card
 * focused — name + locality/logistics + count is the priority.
 *
 * `openNow` shows a small light-green "Open now" pill; otherwise
 * `closedLabel` (e.g. "Opens at 6:00 PM", or a generic "Closed" when no
 * specific reopen time is known) shows a muted pill instead — so every
 * card carries a status, not just the open ones.
 *
 * Field-set enrichment (Phase 4, Part B): logo, ETA, product count and a
 * Verified pill all now render — but only when the caller's endpoint
 * actually supplies them (never fabricated). Not every call site's
 * backend query computes every field yet — e.g. distance/eta_min need
 * user lat/lng, which the cached stores_in_category rail deliberately
 * doesn't accept (a per-user value can't live in a shared TTL cache); see
 * that endpoint's own doc comment.
 *
 * Phase G4: optional `href` override, for CMS-pinned display cards
 * (StoreSectionModule's admin-curated supplement to its real store list)
 * that aren't real store records and so have nothing sensible at
 * `/store/{id}` — every existing call site omits it and keeps the
 * original `/store/{slug|id}` destination unchanged.
 *
 * G7 — `variant="discovery"`: the "Stores near you" card (both the
 * marketplace-global StoresNearYouSection and the redesigned per-L1
 * ShopByStoreSection use this SAME component/variant — one reusable
 * store-card system, not a card-per-surface). Image-on-top + white
 * footer-below, aspect-[4/3] (matches the real landscape banner asset
 * shape, same reasoning the old bespoke Shop-by-Store carousel card
 * already established) instead of the default `"overlay"` variant's
 * portrait scrim card — genuinely different enough visually (no
 * scrim/overlay at all) that branching inside one component was cleaner
 * than a second near-identical file. `"overlay"` (default) is completely
 * unchanged — every existing G4/G6 call site renders pixel-identically.
 */
import Link from "next/link";
import { Sparkles, BadgeCheck } from "lucide-react";
import { trackStoreClick } from "@/lib/analytics";
import { cloudinaryOptimize } from "@/lib/utils";

// Deliberately looser than the full StoreCard type (Home's own
// GET /api/feed/popular-stores /-nearby shape) — this component only
// ever reads a known subset of fields, all optional here, so
// CategoryClient's own GET /api/categories/{l1}/stores response (a
// different endpoint, a different field set) can be passed straight
// through without a cast, the same reasoning CategoryTileRow's own
// loosened `categories` prop already uses.
interface SellerCardStore {
  id: string;
  name: string;
  slug?: string | null;
  banner?: string | null;
  banners?: string[];
  image?: string | null;
  logo?: string | null;
  area_label?: string | null;
  area?: string | null;
  locality?: string | null;
  city?: string | null;
  specialties?: string[] | null;
  distance_km?: number | null;
  eta_min?: number | null;
  product_count?: number | null;
  trusted?: boolean;
}

export function SellerCard({ s, source = "meet_sellers", openNow = false, closedLabel, href, variant = "overlay", fitToContainer = false }: { s: SellerCardStore; source?: string; openNow?: boolean; closedLabel?: string; /** Phase G4 — overrides the default `/store/{slug|id}` destination; used by CMS-pinned display cards, which aren't real store records. */ href?: string; variant?: "overlay" | "discovery"; /** G13 — discovery variant only. Fills the parent grid/flex cell (`w-full h-full`) instead of the card's own fixed `w-40 sm:w-44` rail width, for callers that lay cards out in a CSS grid (e.g. StoresNearYouSection's 2-col mobile grid) rather than a horizontal-scroll rail. Every other caller omits this and is unaffected. */ fitToContainer?: boolean }) {
  const banner = s.banner || (Array.isArray(s.banners) && s.banners[0]) || s.image || null;
  const area = s.area_label || s.area || s.locality || "Bhilai";
  const logisticsParts = [
    area,
    s.distance_km != null ? `${s.distance_km.toFixed(1)} km` : null,
    s.eta_min != null ? `${s.eta_min} min` : null,
  ].filter(Boolean);
  const nameRow = (
    <div className="flex items-center gap-1 min-w-0">
      <span className="font-bold text-[13px] sm:text-sm leading-tight line-clamp-1 min-w-0">{s.name}</span>
      {s.trusted && <BadgeCheck size={13} className="shrink-0 text-[#3B82F6]" aria-label="Verified store" />}
    </div>
  );

  if (variant === "discovery") {
    // "category · area" — real fields only, never a fabricated category
    // like "Fashion". distance_km is shown ONLY when the caller's own
    // endpoint actually computed it (never guessed here) — same
    // never-fabricate-distance rule the backend's _attach_distance_and_eta
    // already enforces.
    const categoryArea = [
      s.specialties && s.specialties.length > 0 ? s.specialties[0] : null,
      s.distance_km != null ? `${s.distance_km.toFixed(1)} km` : area,
    ].filter(Boolean).join(" · ");
    return (
      <Link key={s.id} href={href || `/store/${s.slug || s.id}`}
        onClick={() => { try { trackStoreClick(s.id, s.name, source); } catch {} }}
        data-testid={`${source}-card-${s.id}`}
        className={`group ${fitToContainer ? "w-full h-full flex flex-col" : "flex-shrink-0 w-40 sm:w-44"} rounded-2xl overflow-hidden bg-white shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-95`}>
        <div className="relative aspect-[4/3] bg-[#F4F1E9] shrink-0">
          {banner ? (
            <img
              src={cloudinaryOptimize(banner, "w_320,q_auto,f_auto")}
              alt={s.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
                <Sparkles size={15} className="text-[#E68910]" />
              </div>
            </div>
          )}
          {s.logo && (
            <div className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-full overflow-hidden border-2 border-white shadow-sm bg-white">
              <img src={cloudinaryOptimize(s.logo, "w_80,q_auto,f_auto")} alt="" className="w-full h-full object-cover" />
            </div>
          )}
        </div>
        <div className={`px-2.5 py-2 ${fitToContainer ? "flex-1 flex flex-col justify-center" : ""}`}>
          {nameRow}
          {categoryArea && <div className="text-[10px] text-[#64748B] mt-0.5 leading-tight line-clamp-1">{categoryArea}</div>}
          <div className="flex items-center gap-1 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${openNow ? "bg-[#22C55E]" : "bg-[#94A3B8]"}`} />
            <span className="text-[9px] font-bold text-[#64748B]">{openNow ? "Open now" : (closedLabel || "Closed")}</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link key={s.id} href={href || `/store/${s.slug || s.id}`}
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
      {/* Logo — a distinct floating badge (not a banner fallback source),
          top-right so it never collides with the open/closed pill at
          top-left. Simply absent when the store has no logo set. */}
      {s.logo && (
        <div className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full overflow-hidden border-2 border-white shadow-sm bg-white">
          <img src={cloudinaryOptimize(s.logo, "w_80,q_auto,f_auto")} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      {banner ? (
        <>
          <img
            src={cloudinaryOptimize(banner, "w_320,q_auto,f_auto")}
            alt={s.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#141419]/75 via-[#141419]/30 to-transparent pointer-events-none" />
          <div className="absolute bottom-2.5 left-2.5 right-2.5 text-white">
            {nameRow}
            <div className="text-[10px] font-semibold text-[#F0E9DD]/90 mt-0.5 leading-tight line-clamp-1">{logisticsParts.join(" · ")}</div>
            {!!s.product_count && (
              <div className="text-[9px] font-medium text-[#F0E9DD]/70 mt-0.5 leading-tight">{s.product_count} product{s.product_count === 1 ? "" : "s"}</div>
            )}
          </div>
        </>
      ) : (
        // No banner set for this store — same light cream/tint fallback the
        // area tiles use, not a dark slab.
        <div className="absolute inset-0 bg-[#F4F1E9] flex flex-col items-center justify-center gap-2 px-2 text-center">
          <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
            <Sparkles size={15} className="text-[#E68910]" />
          </div>
          <div className="text-[#0A1F5C]">
            {nameRow}
            <div className="text-[10px] font-semibold text-[#0A1F5C]/55 mt-0.5 leading-tight line-clamp-1">{logisticsParts.join(" · ")}</div>
            {!!s.product_count && (
              <div className="text-[9px] font-medium text-[#0A1F5C]/45 mt-0.5 leading-tight">{s.product_count} product{s.product_count === 1 ? "" : "s"}</div>
            )}
          </div>
        </div>
      )}
    </Link>
  );
}
