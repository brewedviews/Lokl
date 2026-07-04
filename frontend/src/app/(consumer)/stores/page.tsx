"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StoreCardV2 } from "@/components/consumer/v2/StoreCardV2";
import { Footer } from "@/components/consumer/Footer";
import { StoreCardSkeleton } from "@/components/ui";
import type { Store } from "@/types";

export default function StoresPage() {
  const [stores, setStores] = useState<Store[] | null>(null);

  useEffect(() => {
    api.stores.list({ limit: 60 }).then((r) => setStores(r)).catch(() => setStores([]));
  }, []);

  const loading = stores === null;
  const list = stores ?? [];

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        <h1 data-testid="stores-title" className="font-display text-4xl md:text-5xl font-bold text-[#0A1F5C]">Stores near you</h1>
        <p className="text-[#595959] mt-2">
          {loading ? "Loading…" : `${list.length} trusted local store${list.length !== 1 ? "s" : ""} · sorted by distance`}
        </p>
        {loading ? (
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
            {Array.from({ length: 8 }).map((_, i) => <StoreCardSkeleton key={`sk-${i}`} />)}
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
            {list.map((s) => <StoreCardV2 key={s.id} s={s} />)}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
