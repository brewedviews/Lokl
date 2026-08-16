"use client";

/**
 * SellerCard — the single store-rail card family used across the app.
 * Originally private to HomeClient.tsx (its "Meet your sellers" rail),
 * extracted here once CategoryClient's new "Stores in {L1}" rail needed
 * the exact same card rather than a second, similar-looking one.
 *
 * aspect-[3/4], rounded-2xl, whisper shadow, neutral dark scrim, bold
 * white name + small cream area subtitle. No overlapping avatar — the
 * name on the image is enough. Store's own tagline/story is intentionally
 * left out to keep the card as clean as an area tile: name + area is the
 * priority.
 *
 * `openNow` shows a small light-green "Open now" pill; otherwise
 * `closedLabel` (e.g. "Opens at 6:00 PM", or a generic "Closed" when no
 * specific reopen time is known) shows a muted pill instead — so every
 * card carries a status, not just the open ones.
 */
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { trackStoreClick } from "@/lib/analytics";
import { cloudinaryOptimize } from "@/lib/utils";

// Deliberately looser than the full StoreCard type (Home's own
// GET /api/feed/popular-stores /-nearby shape) — this component only
// ever reads id/name/slug/banner(s)/image/area/locality, all optional
// here, so CategoryClient's own GET /api/categories/{l1}/stores response
// (a different endpoint, a different field set) can be passed straight
// through without a cast, the same reasoning CategoryTileRow's own
// loosened `categories` prop already uses.
interface SellerCardStore {
  id: string;
  name: string;
  slug?: string | null;
  banner?: string | null;
  banners?: string[];
  image?: string | null;
  area_label?: string | null;
  area?: string | null;
  locality?: string | null;
}

export function SellerCard({ s, source = "meet_sellers", openNow = false, closedLabel }: { s: SellerCardStore; source?: string; openNow?: boolean; closedLabel?: string }) {
  const banner = s.banner || (Array.isArray(s.banners) && s.banners[0]) || s.image || null;
  const area = s.area_label || s.area || s.locality || "Bhilai";
  return (
    <Link key={s.id} href={`/store/${s.slug || s.id}`}
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
