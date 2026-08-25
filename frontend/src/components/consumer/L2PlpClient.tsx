"use client";

/**
 * L2PlpClient — the compact, product-first L2 category listing page
 * G9 §8-13 asks for. Mounted by CategoryRouteClient whenever the URL's
 * l2slug resolves to a real L2 (e.g. /c/women/dresses); replaces what used
 * to be a full re-render of the entire L1 shopping home with the filter
 * pre-set at the very bottom.
 *
 * Compact header (back + small L2 name + search shortcut, no giant page
 * title), sort pills, then the product grid immediately — no dense
 * category-tile wall repeated a third time (that's `BrowseGridBlock`'s own
 * job on the bare L1 page, already trimmed down in the same G9 pass — see
 * that file's own comment). Data via the SAME `/api/products?l1=&l2=&sort=`
 * endpoint `BrowseGridBlock` already used for its filtered view — no new
 * backend endpoint. `ProductCard` reused as-is (not reimplemented) so the
 * G8 equal-height fix applies for free.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Search as SearchIcon } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { CategoryNode, ProductCard as ProductCardType } from "@/types";

type L2 = CategoryNode["l2"][number];
type SortKey = "nearest" | "price_asc" | "price_desc";

function SkeletonGrid() {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden bg-white border border-[#E5E2DC] animate-pulse">
          <div className="aspect-[3/4] bg-[#E5E2DC]" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-[#E5E2DC] rounded w-2/3" />
            <div className="h-3 bg-[#E5E2DC] rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function L2PlpClient({ l1, l2 }: { l1: CategoryNode; l2: L2 }) {
  const router = useRouter();
  const [sort, setSort] = useState<SortKey>("nearest");
  const [products, setProducts] = useState<ProductCardType[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    const p = new URLSearchParams({ l1: l1.id, l2: l2.id });
    if (sort === "price_asc") p.set("sort", "price_asc");
    if (sort === "price_desc") p.set("sort", "price_desc");
    apiClient.get<ProductCardType[]>(`/api/products?${p.toString()}`)
      .then((r) => { if (!cancelled) setProducts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [l1.id, l2.id, sort]);

  const isLoading = products === null;
  const list = useMemo(() => products ?? [], [products]);

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      {/* Compact header — back + small category name + search shortcut,
          per §12: no giant title, no huge whitespace before products. */}
      <div className="sticky top-0 z-10 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#E5E2DC]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            data-testid="plp-back"
            aria-label="Back"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[#E5E2DC]/60 transition"
          >
            <ChevronLeft size={20} className="text-[#0A1F5C]" />
          </button>
          <h1 data-testid="plp-title" className="flex-1 min-w-0 font-display font-medium text-base sm:text-lg text-[#0A1F5C] truncate">
            {l2.name}
            {!isLoading && <span className="text-sm font-normal text-[#595959] ml-1.5">({list.length})</span>}
          </h1>
          <Link href="/search" data-testid="plp-search" aria-label="Search"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[#E5E2DC]/60 transition">
            <SearchIcon size={18} className="text-[#0A1F5C]" />
          </Link>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 pt-3 pb-8">
        {/* Compact sort row — kept accessible per §13 without consuming
            the viewport before products appear. */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-3" data-testid="plp-sort">
          {([
            { key: "nearest", label: "Nearest" },
            { key: "price_asc", label: "Price: Low–High" },
            { key: "price_desc", label: "Price: High–Low" },
          ] as Array<{ key: SortKey; label: string }>).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              data-testid={`plp-sort-${opt.key}`}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                sort === opt.key
                  ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                  : "bg-white text-[#595959] border-[#E5E2DC]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <SkeletonGrid />
        ) : list.length === 0 ? (
          <div className="mt-4 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
            <h3 className="font-display text-xl font-medium text-[#0A1F5C]">Coming soon to {l2.name}</h3>
            <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">We&apos;re onboarding local sellers right now — fresh drops will land here shortly.</p>
          </div>
        ) : (
          <div data-testid="plp-product-grid" className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {list.map((p) => <ProductCard key={p.id} p={p} size="default" />)}
          </div>
        )}
      </div>
    </div>
  );
}
