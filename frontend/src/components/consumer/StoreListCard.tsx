"use client";

import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import type { Store } from "@/types";

const BADGE_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  LIVE:            { label: "Live",    dot: "bg-emerald-500", text: "text-emerald-700" },
  Away:            { label: "Away",    dot: "bg-brand-accent",   text: "text-brand-accent" },
  Closed:          { label: "Closed",  dot: "bg-[#94A3B8]",   text: "text-[#64748B]" },
  "Store Offline": { label: "Offline", dot: "bg-[#EF4444]",   text: "text-[#EF4444]" },
};

/**
 * /stores row — full-width list row (not a narrow grid tile), one per
 * line. Deliberately does NOT fabricate a distance when none is available
 * (the previous StoreCardV2 defaulted to a fake "1.5 km"). The distance
 * row simply doesn't render unless `distance_km` is real.
 */
export function StoreListCard({ s }: { s: Store }) {
  const image = s.banner || (Array.isArray(s.banners) && s.banners[0]) || s.image || s.logo;
  const badge = s.badge ? BADGE_STYLE[s.badge] : null;

  return (
    <Link
      href={`/store/${s.slug || s.id}`}
      data-testid={`store-list-card-${s.id}`}
      className="w-full flex items-center gap-4 bg-white border border-[#E5E2DC] rounded-2xl p-3 hover:shadow-[0_8px_24px_rgba(10,31,92,0.10)] transition active:scale-[0.99]"
    >
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#FDFBF7] shrink-0">
        {image ? (
          <Image src={image} alt={s.name} fill sizes="96px" className="object-cover" />
        ) : (
          <div className="w-full h-full v2-shimmer" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="text-base font-display font-bold text-[#0A1F5C] leading-tight truncate">{s.name}</h3>
        <div className="flex items-center gap-3 flex-wrap text-[12px] text-[#595959]">
          {s.distance_km != null && <span>{s.distance_km.toFixed(1)} km away</span>}
          {badge && (
            <span className={`inline-flex items-center gap-1.5 font-semibold ${badge.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          )}
        </div>
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
