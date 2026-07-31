"use client";

import Link from "next/link";
import Image from "next/image";
import type { Store } from "@/types";

const BADGE_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  LIVE:            { label: "Live",    dot: "bg-emerald-500", text: "text-emerald-700" },
  Away:            { label: "Away",    dot: "bg-[#D97706]",   text: "text-[#D97706]" },
  Closed:          { label: "Closed",  dot: "bg-[#94A3B8]",   text: "text-[#64748B]" },
  "Store Offline": { label: "Offline", dot: "bg-[#EF4444]",   text: "text-[#EF4444]" },
};

/**
 * /stores card — deliberately does NOT fabricate a distance when none is
 * available (the previous StoreCardV2 defaulted to a fake "1.5 km"). The
 * distance row simply doesn't render unless `distance_km` is real.
 */
export function StoreListCard({ s }: { s: Store }) {
  const image = s.banner || (Array.isArray(s.banners) && s.banners[0]) || s.image || s.logo;
  const badge = s.badge ? BADGE_STYLE[s.badge] : null;

  return (
    <Link
      href={`/store/${s.slug || s.id}`}
      data-testid={`store-list-card-${s.id}`}
      className="block bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-[0_8px_24px_rgba(10,31,92,0.10)] transition active:scale-[0.99]"
    >
      <div className="relative h-28 bg-[#FDFBF7]">
        {image ? (
          <Image src={image} alt={s.name} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
        ) : (
          <div className="w-full h-full v2-shimmer" />
        )}
      </div>
      <div className="p-3 space-y-1">
        <h3 className="text-sm font-display font-bold text-[#0A1F5C] leading-tight line-clamp-1">{s.name}</h3>
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-[#595959]">
          {s.distance_km != null && <span>{s.distance_km.toFixed(1)} km</span>}
          {badge && (
            <span className={`inline-flex items-center gap-1 font-semibold ${badge.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function StoreListCardSkeleton() {
  return (
    <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
      <div className="h-28 bg-[#E5E2DC] animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-4 w-2/3 bg-[#E5E2DC] rounded animate-pulse" />
        <div className="h-3 w-1/3 bg-[#E5E2DC] rounded animate-pulse" />
      </div>
    </div>
  );
}
