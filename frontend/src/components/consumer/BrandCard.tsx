import Link from "next/link";
import Image from "next/image";
import { Tag } from "lucide-react";
import type { Brand } from "@/types";

/**
 * /brands directory grid tile — logo, name, product count. Square-ish
 * card, not a list row (unlike StoreListCard) since the directory is a
 * browsing grid, matching the brief's "grid of all brands" ask.
 */
export function BrandCard({ b }: { b: Brand }) {
  return (
    <Link
      href={`/brand/${b.slug}`}
      data-testid={`brand-card-${b.id}`}
      className="flex flex-col items-center text-center bg-white border border-[#E5E2DC] rounded-2xl p-4 hover:shadow-[0_8px_24px_rgba(10,31,92,0.10)] transition active:scale-[0.98]"
    >
      <div className="relative w-16 h-16 rounded-full overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC] flex items-center justify-center shrink-0">
        {b.logo ? (
          <Image src={b.logo} alt={b.name} fill sizes="64px" className="object-cover" />
        ) : (
          <Tag size={20} className="text-[#94A3B8]" />
        )}
      </div>
      <h3 className="mt-3 text-sm font-display font-bold text-[#0A1F5C] leading-tight line-clamp-2">{b.name}</h3>
      <p className="text-[11px] text-[#595959] mt-1">{b.product_count} product{b.product_count === 1 ? "" : "s"}</p>
    </Link>
  );
}

export function BrandCardSkeleton() {
  return (
    <div className="flex flex-col items-center bg-white border border-[#E5E2DC] rounded-2xl p-4">
      <div className="w-16 h-16 rounded-full bg-[#E5E2DC] animate-pulse" />
      <div className="mt-3 h-4 w-2/3 bg-[#E5E2DC] rounded animate-pulse" />
      <div className="mt-1.5 h-3 w-1/2 bg-[#E5E2DC] rounded animate-pulse" />
    </div>
  );
}
