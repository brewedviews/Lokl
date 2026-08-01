"use client";

import Link from "next/link";
import Image from "next/image";

export interface JustInProduct {
  id: string;
  name: string;
  image: string;
  price: number;
  mrp: number | null;
  store_id: string;
  store_name: string;
  created_at: string;
}

interface Props {
  product: JustInProduct;
  /** Store name row only shows when the zone has multiple stores (chips visible) — redundant otherwise. */
  showStore: boolean;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Compact, image-led discovery card for the "Just In" band. Pure doorway
 * to the PDP — no cart/wishlist actions live here.
 */
export function JustInProductCard({ product: p, showStore }: Props) {
  const isNew = !!p.created_at && Date.now() - new Date(p.created_at).getTime() <= FOURTEEN_DAYS_MS;

  return (
    <Link
      href={`/product/${p.id}`}
      data-testid={`just-in-card-${p.id}`}
      className="block flex-shrink-0 w-[120px] sm:w-[132px] bg-white rounded-xl overflow-hidden active:scale-[0.97] transition"
    >
      <div className="relative aspect-[3/4] bg-slate-100">
        {p.image ? (
          <Image
            src={p.image}
            alt={p.name}
            fill
            sizes="(max-width: 640px) 120px, 132px"
            loading="lazy"
            className="object-cover object-top"
          />
        ) : (
          <div className="w-full h-full v2-shimmer" />
        )}
        {isNew && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-[#E68910] text-white text-[9px] font-bold uppercase leading-none">
            New
          </span>
        )}
      </div>

      <div className="p-2 space-y-0.5">
        {showStore && (
          <div className="text-[9px] font-bold uppercase tracking-wide text-[#E68910] truncate">{p.store_name}</div>
        )}
        <div className="text-[11px] font-semibold text-[#0A1F5C] leading-tight truncate">{p.name}</div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-[12px] font-bold text-[#0A1F5C]">₹{Number(p.price).toLocaleString("en-IN")}</span>
          {p.mrp && p.mrp > p.price && (
            <span className="text-[10px] text-[#9CA3AF] line-through">₹{Number(p.mrp).toLocaleString("en-IN")}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
