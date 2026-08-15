"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Search as SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { ProductCard as ProductCardType, StoreCard, CategoryNode } from "@/types";

type CategoryWithImage = CategoryNode & { image?: string };

export default function SearchPage() {
  const sp = useSearchParams();
  const q = sp.get("q") || "";
  const [data, setData] = useState<{ products: ProductCardType[]; stores: StoreCard[] }>({ products: [], stores: [] });
  const [cats, setCats] = useState<CategoryWithImage[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!q) { setData({ products: [], stores: [] }); setBusy(false); return; }
    setBusy(true);
    api.search.search(q, 60).then((r) => setData(r)).finally(() => setBusy(false));
  }, [q]);

  useEffect(() => {
    api.catalog.categories().then((r) => setCats(r as CategoryWithImage[])).catch(() => {});
  }, []);

  const hasResults = data.products.length > 0 || data.stores.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <SearchIcon size={20} className="text-[#E68910]" />
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">
            {q ? <>Results for <span className="text-[#E68910]">&ldquo;{q}&rdquo;</span></> : "Search"}
          </h1>
        </div>

        {busy && <p className="text-sm text-[#595959]">Searching…</p>}

        {!busy && data.stores.length > 0 && (
          <section className="mb-10">
            <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Stores</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.stores.map((s) => (
                <Link key={s.id} href={`/store/${s.id}`} data-testid={`search-store-${s.id}`} className="bg-white rounded-2xl overflow-hidden border border-[#E5E2DC] hover:border-[#0A1F5C] transition">
                  <div className="relative aspect-[4/3] bg-[#FDFBF7]">
                    {s.image && <Image src={s.image} alt={s.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" />}
                  </div>
                  <div className="p-3">
                    <div className="font-semibold text-[#0A1F5C] truncate">{s.name}</div>
                    {s.tagline && <div className="text-[11px] text-[#595959] truncate">{s.tagline}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!busy && data.products.length > 0 && (
          <section className="mb-10">
            <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Products ({data.products.length})</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
              {data.products.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
            </div>
          </section>
        )}

        {!busy && !hasResults && q && (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-10 text-center mb-10">
            <p className="text-sm text-[#595959]">No matches for &ldquo;{q}&rdquo;. Try a different keyword.</p>
          </div>
        )}

        <section className="border-t border-[#E5E2DC] pt-8">
          <h3 className="font-display text-xl md:text-2xl font-bold text-[#0A1F5C]">Didn&apos;t get what you searched for?</h3>
          <p className="text-sm text-[#595959] mt-1 mb-5">Shop by category instead.</p>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3 md:gap-4">
            {cats.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} data-testid={`search-cat-${c.slug}`} className="group">
                <div className="relative aspect-square rounded-2xl overflow-hidden bg-white border border-[#E5E2DC]">
                  {c.image && <Image src={c.image} alt={c.name} fill sizes="(max-width: 768px) 33vw, 14vw" className="object-cover group-hover:scale-110 transition duration-500" />}
                </div>
                <div className="text-center mt-2 text-xs md:text-sm font-medium text-[#1C1C1C]">{c.name}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
