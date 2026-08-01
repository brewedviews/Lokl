"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { JustInProductCard, type JustInProduct } from "@/components/consumer/JustInProductCard";

interface JustInStoreOption {
  id: string;
  name: string;
}

interface JustInResponse {
  products: JustInProduct[];
  stores: JustInStoreOption[];
}

/**
 * "Just In" — bold navy band of newest arrivals across Bhilai stores.
 * Store-filter chips only appear once 2+ stores have visible products
 * (the `stores` list is computed unfiltered on the backend, so it stays
 * stable across chip switches). Collapses entirely if no store has any
 * visible products.
 */
export function JustInSection() {
  const [products, setProducts] = useState<JustInProduct[]>([]);
  const [stores, setStores] = useState<JustInStoreOption[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const qs = activeStoreId ? `?store_id=${encodeURIComponent(activeStoreId)}` : "";
    apiClient.get<JustInResponse>(`/api/feed/just-in${qs}`).then((r) => {
      if (cancelled) return;
      setProducts(r.data?.products ?? []);
      setStores(r.data?.stores ?? []);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [activeStoreId]);

  // `stores` is recomputed unfiltered on every request, so its length is a
  // stable proxy for "any visible products exist at all" — collapsing on
  // it (rather than the currently-filtered `products`) means the section
  // never disappears mid-session just because one chip's filter is empty.
  if (!loaded || stores.length === 0) return null;

  const showChips = stores.length >= 2;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
      <section className="bg-[#0A1F5C] rounded-2xl px-4 sm:px-5 py-6" data-testid="just-in-section">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E68910]" />
              <p className="text-[10px] font-bold text-white/70 uppercase tracking-[0.15em]">Fresh from Bhilai stores</p>
            </div>
            <h2 className="font-display font-bold text-white text-2xl leading-tight">Just In</h2>
          </div>
          <Link
            href="/products?sort=newest"
            className="text-xs font-bold text-[#E68910] shrink-0 pt-1 hover:underline underline-offset-4"
          >
            See all →
          </Link>
        </div>

        {showChips && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pt-4 -mx-1 px-1" data-testid="just-in-chips">
            <button
              type="button"
              onClick={() => setActiveStoreId(null)}
              data-testid="just-in-chip-all"
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
                activeStoreId === null ? "bg-[#E68910] text-white" : "bg-white/[0.12] text-white hover:bg-white/20"
              }`}
            >
              All stores
            </button>
            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveStoreId(s.id)}
                data-testid={`just-in-chip-${s.id}`}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
                  activeStoreId === s.id ? "bg-[#E68910] text-white" : "bg-white/[0.12] text-white hover:bg-white/20"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className={`flex gap-3 overflow-x-auto no-scrollbar ${showChips ? "pt-3" : "pt-4"}`}>
          {products.map((p) => (
            <JustInProductCard key={p.id} product={p} showStore={showChips} />
          ))}
        </div>
      </section>
    </div>
  );
}
