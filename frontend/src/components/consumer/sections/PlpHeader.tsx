"use client";

/**
 * PlpHeader — the compact back + title/count + search-shortcut bar G9
 * built for L2PlpClient.tsx, extracted in G11 §3 so every product-listing
 * surface (L2 PLP today, /products going forward) renders through the
 * exact same header instead of two independently-maintained copies
 * slowly drifting apart. No giant page title, no large whitespace block
 * before products — the count sits inline with the title, same treatment
 * everywhere.
 */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Search as SearchIcon } from "lucide-react";

export function PlpHeader({ title, count }: { title: string; count?: number }) {
  const router = useRouter();
  return (
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
          {title}
          {count != null && <span className="text-sm font-normal text-[#595959] ml-1.5">({count})</span>}
        </h1>
        <Link href="/search" data-testid="plp-search" aria-label="Search"
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[#E5E2DC]/60 transition">
          <SearchIcon size={18} className="text-[#0A1F5C]" />
        </Link>
      </div>
    </div>
  );
}
