"use client";

/**
 * StoresNearYouSection — Marketplace Home's real local-store discovery
 * (G7 §12-15). Genuinely different from the G4/G6 "editorial store
 * promotion" modules (store_footwear/ethnic/lingerie, CMS-curated —
 * see StoreSectionModule in L1PageClient.tsx, untouched by G7): this
 * section's job is "here are actual nearby/eligible stores," so it is
 * driven by real store data only, never CMS-pinned display cards.
 *
 * Data: `storesApi.nearby()` (GET /api/feed/nearby-stores) ONLY, when the
 * user has a real location (useLocationStore). No `popular()` fallback
 * (removed post-launch correction) — a section titled "Stores near you"
 * must mean genuinely nearby, never a silent substitution of unrelated
 * "popular" stores under that label. No location, or `nearby()` returns
 * zero (true today — no store in the DB has lat/lng set yet), both mean
 * the same thing: render the honest empty/discovery state below, not a
 * different dataset. If a "Popular stores" section is wanted later,
 * that's a genuinely separate section with its own honest label, not an
 * implicit fallback here.
 *
 * Always renders its own heading/shell (unlike the L1 store modules,
 * which render null when empty) — this section is central to the
 * marketplace page's own purpose, so a genuine zero-store state gets an
 * honest, visible discovery message instead of silently vanishing
 * (G7 §15/§31), not a fake populated list.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Store as StoreIcon } from "lucide-react";
import { storesApi } from "@/lib/api/stores";
import { useLocationStore } from "@/stores";
import { SellerCard } from "@/components/consumer/SellerCard";
import type { StoreCard } from "@/types";

export function StoresNearYouSection() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [stores, setStores] = useState<StoreCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (lat == null || lng == null) {
        if (!cancelled) setStores([]); // no real location -> honest empty state, not a different dataset
        return;
      }
      try {
        const nearby = await storesApi.nearby({ lat, lng, limit: 10 });
        if (!cancelled) setStores(nearby);
      } catch {
        if (!cancelled) setStores([]);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [lat, lng]);

  if (stores === null) return null; // still loading — no skeleton flash needed, this is below the fold

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-stores_near_you">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight">Stores near you</h2>
          <p className="text-[13px] text-[#595959] mt-0.5">Discover stores around Bhilai</p>
        </div>
        {stores.length > 0 && (
          <Link href="/stores" className="text-xs font-bold text-[#0A1F5C] shrink-0 hover:underline">See all →</Link>
        )}
      </div>

      {stores.length === 0 ? (
        <div className="bg-[#F4F1E9] rounded-2xl px-5 py-8 text-center flex flex-col items-center gap-2" data-testid="stores-near-you-empty">
          <div className="w-9 h-9 rounded-full bg-[#E68910]/15 flex items-center justify-center">
            <StoreIcon size={16} className="text-[#E68910]" />
          </div>
          <p className="text-[12px] font-semibold text-[#0A1F5C] max-w-xs mx-auto">
            New stores launching soon in Bhilai — check back shortly.
          </p>
        </div>
      ) : (
        // G13 — 2-column grid on mobile (was a horizontal scroll-carousel).
        // `fitToContainer` makes each SellerCard fill its grid cell instead
        // of using its own fixed rail width; CSS Grid's default row-stretch
        // plus the card's own `h-full flex flex-col` keeps both cards the
        // same height regardless of name length / whether categoryArea is
        // present. sm+ widens to 3 columns since there's more room.
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stores.map((s) => {
            const isOpen = (s as unknown as { is_open?: boolean }).is_open ?? false;
            const closedLabel = (s as unknown as { next_open_label?: string }).next_open_label || "Closed";
            return (
              <SellerCard
                key={s.id}
                s={s}
                source="stores_near_you"
                variant="discovery"
                openNow={isOpen}
                closedLabel={closedLabel}
                fitToContainer
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
