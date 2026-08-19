"use client";

/**
 * /brands — Brand directory/browse page (Phase 4, Part C). Reuses the
 * already-built, paginated + searchable GET /api/brands as its sole data
 * source. No bottom-nav entry — reached only via Home's "Shop by Brand"
 * rail's "See all →" link, per the product decision.
 */
import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { brandsApi } from "@/lib/api/brands";
import { BrandCard, BrandCardSkeleton } from "@/components/consumer/BrandCard";
import type { Brand } from "@/types";

const PAGE_SIZE = 24;

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBrands(null);
    const t = setTimeout(() => {
      brandsApi.list({ search, skip: page * PAGE_SIZE, limit: PAGE_SIZE, sort: "name" })
        .then((r) => { setBrands(r.brands); setTotal(r.total); })
        .catch(() => { setBrands([]); setTotal(0); });
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, page]);

  // Reset to page 0 whenever the search query changes.
  useEffect(() => { setPage(0); }, [search]);

  const loading = brands === null;
  const list = brands ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 pt-10 pb-10">
        <h1 data-testid="brands-title" className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">
          Brands
        </h1>
        <p className="text-[#595959] mt-2">{loading ? "Loading…" : `${total} brand${total === 1 ? "" : "s"} on Lokl`}</p>

        <div className="relative mt-6 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands…"
            data-testid="brands-search"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C] text-sm bg-white"
          />
          <Search size={15} className="absolute left-3 top-3 text-[#9CA3AF]" />
        </div>

        {loading ? (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <BrandCardSkeleton key={`sk-${i}`} />)}
          </div>
        ) : list.length === 0 ? (
          <div className="mt-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
            <Tag size={24} className="mx-auto text-[#94A3B8] mb-2" />
            <h3 className="font-display text-xl font-bold text-[#0A1F5C]">
              {search ? "No brands match that search" : "No brands yet"}
            </h3>
            <p className="text-sm text-[#595959] mt-2">
              {search ? "Try a different spelling." : "Check back soon as more stores tag their products."}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {list.map((b) => <BrandCard key={b.id} b={b} />)}
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-8">
                <span className="text-[12px] text-[#64748B]">Page {page + 1} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    data-testid="brands-prev"
                    className="w-9 h-9 rounded-full border border-[#E5E2DC] bg-white disabled:opacity-30 flex items-center justify-center"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                    disabled={page + 1 >= totalPages}
                    data-testid="brands-next"
                    className="w-9 h-9 rounded-full border border-[#E5E2DC] bg-white disabled:opacity-30 flex items-center justify-center"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
