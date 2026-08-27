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
import { storeStatusLabel } from "@/lib/utils";
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
        // P0-9 (G20 product review) — curated discovery set, not a long
        // list: at most 5 stores, "See all" reaches the full /stores page.
        const nearby = await storesApi.nearby({ lat, lng, limit: 5 });
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
        <>
          {/* P0-9 (G20 product review) — mobile: a horizontal discovery
              rail, not a dumped grid. Card width is set so ~2 are visible
              in the primary viewport at once (matches the brief exactly),
              the remaining stores of the curated 5 reached by swiping. */}
          <div className="flex sm:hidden gap-3 overflow-x-auto no-scrollbar -mx-4 px-4">
            {stores.map((s) => {
              const { openNow, label } = storeStatusLabel(s.badge, s.next_open_label);
              return (
                <div key={s.id} className="w-[46%] shrink-0">
                  <SellerCard s={s} source="stores_near_you" variant="discovery" openNow={openNow} closedLabel={label} fitToContainer />
                </div>
              );
            })}
          </div>

          {/* Tablet/desktop: a real 2x2 grid (curated set — the 5th store,
              if fetched, is reachable via "See all" instead of forcing an
              uneven 3rd row). */}
          <div className="hidden sm:grid sm:grid-cols-2 gap-3">
            {stores.slice(0, 4).map((s) => {
              const { openNow, label } = storeStatusLabel(s.badge, s.next_open_label);
              return (
                <SellerCard
                  key={s.id}
                  s={s}
                  source="stores_near_you"
                  variant="discovery"
                  openNow={openNow}
                  closedLabel={label}
                  fitToContainer
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
