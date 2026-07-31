"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocationStore } from "@/stores";
import { StoreListCard, StoreListCardSkeleton } from "@/components/consumer/StoreListCard";
import { Footer } from "@/components/consumer/Footer";
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
    <div className="min-h-screen bg-[#FDFBF7]">
      {/* pt-only — Footer supplies the single gap below via its own topGap
          margin. A trailing pb here would stack with that margin and leave
          the dead cream gap this page used to have. */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-10">
        <h1 data-testid="stores-title" className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Stores near you</h1>
        <p className="text-[#595959] mt-2">
          {loading
            ? "Loading…"
            : `${list.length} trusted local store${list.length !== 1 ? "s" : ""}${hasLocation ? " · sorted by distance" : ""}`}
        </p>
        {loading ? (
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
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
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
            {list.map((s) => <StoreListCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
