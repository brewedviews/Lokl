"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, BadgeCheck } from "lucide-react";
import type { Store } from "@/types";
import { formatDistance, formatPrice, storeStatusLabel } from "@/lib/utils";

/** Only surface an "Up to X% OFF" merchandising line when there's a real,
 *  meaningful discount behind it — a 5% markdown isn't a reason to click.
 *  Matches the backend's own "no fake offer labels" rule: max_discount_percent
 *  is computed fresh from this store's actual visible products, never a
 *  denormalized/stale value, so a threshold here just decides what's
 *  worth surfacing, not whether the number is trustworthy. */
const MEANINGFUL_DISCOUNT_THRESHOLD = 20;

/** Lokl-branded fallback tile — the store's own initial on the brand navy,
 *  same idiom as the admin merchant-initial avatar. Renders for BOTH a
 *  missing image URL and a URL that 404s (via the <Image>'s onError
 *  below) — a broken-image icon must never reach the customer UI. */
function StoreImageFallback({ name }: { name: string }) {
  const initial = (name || "L").trim().charAt(0).toUpperCase();
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#0A1F5C] text-white font-display text-2xl font-bold">
      {initial}
    </div>
  );
}

/**
 * /stores row — full-width list row (not a narrow grid tile), one per line.
 *
 * Hierarchy (redesign — was a flat list of equally-weighted facts):
 *   Primary      — image, store name, verified badge
 *   Secondary    — category · locality
 *   Merchandising — the one reason to click: a real offer when meaningful
 *                   (>= MEANINGFUL_DISCOUNT_THRESHOLD), else starting price
 *                   (+ product count), else just product count
 *   Utility      — distance · delivery ETA when open, else a compact
 *                  storeStatusLabel() status (never a large standalone
 *                  "• Closed" block)
 *
 * Deliberately does NOT fabricate a distance/ETA/offer when none is
 * available — those pieces simply don't render unless the real value is
 * present, same discipline already applied everywhere else on this card.
 */
export function StoreListCard({ s }: { s: Store }) {
  const [imgError, setImgError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const image = s.banner || (Array.isArray(s.banners) && s.banners[0]) || s.image;
  const showImage = !!image && !imgError;
  const locality = s.area_label || s.area || s.locality;

  const hasOffer = (s.max_discount_percent ?? 0) >= MEANINGFUL_DISCOUNT_THRESHOLD;
  const merchandisingLine = hasOffer
    ? `Up to ${s.max_discount_percent}% OFF`
    : s.starting_price != null
      ? `Starting from ${formatPrice(s.starting_price)}${s.product_count ? ` · ${s.product_count} product${s.product_count === 1 ? "" : "s"}` : ""}`
      : s.product_count
        ? `${s.product_count} product${s.product_count === 1 ? "" : "s"}`
        : null;

  const { openNow, label: statusLabel } = storeStatusLabel(s.badge, s.next_open_label);
  const utilityStatus = openNow && s.eta_min != null ? `Delivery in ${s.eta_min} min` : statusLabel;

  return (
    <Link
      href={`/store/${s.slug || s.id}`}
      data-testid={`store-list-card-${s.id}`}
      className="w-full flex items-center gap-4 bg-white border border-[#E5E2DC] rounded-2xl p-3 hover:shadow-[0_8px_24px_rgba(10,31,92,0.10)] transition active:scale-[0.99]"
    >
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#FDFBF7] shrink-0">
        {showImage ? (
          <Image src={image} alt={s.name} fill sizes="96px" className="object-cover" onError={() => setImgError(true)} />
        ) : (
          <StoreImageFallback name={s.name} />
        )}
        {/* Logo — a distinct badge overlapping the cover image's corner,
            not a last-resort fill for the image slot above. Simply omits
            itself on a broken URL rather than showing a broken-image icon. */}
        {s.logo && !logoError && (
          <div className="absolute bottom-1 right-1 w-7 h-7 rounded-full overflow-hidden border-2 border-white shadow-sm bg-white">
            <Image src={s.logo} alt="" fill sizes="28px" className="object-cover" onError={() => setLogoError(true)} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {/* Primary */}
        <div className="flex items-center gap-1 min-w-0">
          <h3 className="text-base font-display font-bold text-[#0A1F5C] leading-tight truncate">{s.name}</h3>
          {s.trusted && (
            <span className="inline-flex items-center gap-0.5 shrink-0 text-[#3B82F6]" data-testid={`store-list-verified-${s.id}`}>
              <BadgeCheck size={14} />
            </span>
          )}
        </div>
        {/* Secondary */}
        {(s.primary_category || locality) && (
          <p className="text-[12px] text-[#595959] truncate">
            {[s.primary_category, locality].filter(Boolean).join(" · ")}
          </p>
        )}
        {/* Merchandising — the reason to click, one line, never all four signals at once */}
        {merchandisingLine && (
          <p
            data-testid={`store-list-merchandising-${s.id}`}
            className={hasOffer ? "text-[13px] font-bold text-[#E68910]" : "text-[12px] font-semibold text-[#0A1F5C]"}
          >
            {merchandisingLine}
          </p>
        )}
        {/* Utility */}
        {(s.distance_km != null || utilityStatus) && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-[#94A3B8]">
            {s.distance_km != null && <span>{formatDistance(s.distance_km)}</span>}
            {utilityStatus && <span>{utilityStatus}</span>}
          </div>
        )}
      </div>
      <ChevronRight size={18} className="text-[#94A3B8] shrink-0" />
    </Link>
  );
}

export function StoreListCardSkeleton() {
  return (
    <div className="w-full flex items-center gap-4 bg-white border border-[#E5E2DC] rounded-2xl p-3">
      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-[#E5E2DC] animate-pulse shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-1/2 bg-[#E5E2DC] rounded animate-pulse" />
        <div className="h-3 w-1/3 bg-[#E5E2DC] rounded animate-pulse" />
      </div>
    </div>
  );
}
