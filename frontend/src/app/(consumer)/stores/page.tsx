"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocationStore } from "@/stores";
import { StoreListCard, StoreListCardSkeleton } from "@/components/consumer/StoreListCard";
import type { Store } from "@/types";

export default function StoresPage() {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const hasLocation = lat != null && lng != null;
  const [stores, setStores] = useState<Store[] | null>(null);

  useEffect(() => {
    const params: { limit: number; lat?: number; lng?: number } = { limit: 60 };
    if (hasLocation) { params.lat = lat as number; params.lng = lng as number; }
    api.stores.list(params).then((r) => {
      // Backend sorts by availability rank then distance when coords are
      // given. With no selected delivery area, fall back to a stable,
      // predictable order (alphabetical) instead of raw insertion order.
      const list = hasLocation ? r : [...r].sort((a, b) => a.name.localeCompare(b.name));
      setStores(list);
    }).catch(() => setStores([]));
  }, [lat, lng, hasLocation]);

  const loading = stores === null;
  const list = stores ?? [];

  return (
    // flex-1 (not h-full) — html/body have no explicit height (globals.css
    // only sets bg/color/font), so a percentage-based h-full has no basis
    // to resolve against and silently falls back to `auto`. The shared
    // (consumer) layout's wrapper is now `flex flex-col` (see its comment),
    // so this root can flex-grow into it instead — no percentage involved,
    // always resolvable. This div is ALSO `flex flex-col` so its own
    // content area (flex-1 below) can grow to fill the true bottom of the
    // viewport on short pages, instead of leaving dead space above the
    // sticky bottom nav.
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 pt-10">
        <h1 data-testid="stores-title" className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Stores near you</h1>
        <p className="text-[#595959] mt-2">
          {loading
            ? "Loading…"
            : `${list.length} trusted local store${list.length !== 1 ? "s" : ""}${hasLocation ? " · sorted by distance" : ""}`}
        </p>
        {loading ? (
          <div className="mt-8 flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => <StoreListCardSkeleton key={`sk-${i}`} />)}
          </div>
        ) : list.length === 0 ? (
          <div className="mt-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
            <h3 className="font-display text-2xl font-bold text-[#0A1F5C]">No stores live yet</h3>
            <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">
              We&apos;re piloting in <strong>Bhilai</strong> and <strong>Raipur</strong>. Stores will appear here as our partner stores complete KYC and publish their first products.
            </p>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            {list.map((s) => <StoreListCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
