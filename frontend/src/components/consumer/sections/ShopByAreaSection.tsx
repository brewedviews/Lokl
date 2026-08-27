"use client";

/**
 * ShopByAreaSection — P0-4 (G20 product review): "Shop by Area" restoration.
 * Removed when Home/L1 were unified into MarketplaceHomeClient/L1PageClient
 * (see git history — the original ShopByAreaSection lived in the retired
 * HomeClient.tsx) because no store in the DB had `area_slug` set at the
 * time, so every tile would have honestly shown "0 stores." The data path
 * itself was never removed: `GET /api/areas` (real, live store counts via
 * `_area_store_counts()`), `CmsArea` CMS model + admin editor, and
 * `/stores?area=` (still reads the `?area=` query param) are all intact —
 * this only re-adds the homepage entry point, reusing every one of those
 * exactly as they already exist. `area_slug` is mandatory on merchant
 * storefront saves since iter-29, so real counts fill in as merchants save.
 *
 * Same visual language as its sibling StoresNearYouSection.tsx (identical
 * heading treatment, same max-w-7xl shell) — a light navigation grid, not a
 * promotional bento: plain photo (no gradient scrim), a small store-count
 * pill over the image, area name below in navy. Renders nothing at all when
 * there are zero featured areas (never an empty-grid placeholder).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cloudinaryOptimize } from "@/lib/utils";
import type { AreaTile } from "@/types";

export function ShopByAreaSection() {
  const [areas, setAreas] = useState<AreaTile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog.areas()
      .then((a) => { if (!cancelled) setAreas(a); })
      .catch(() => { if (!cancelled) setAreas([]); });
    return () => { cancelled = true; };
  }, []);

  if (!areas || areas.length === 0) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-shop_by_area">
      <div className="mb-3">
        <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight">Shop by area</h2>
        <p className="text-[13px] text-[#595959] mt-0.5">Discover stores in your Bhilai neighbourhood</p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {areas.map((a) => (
          <Link
            key={a.slug}
            href={`/stores?area=${a.slug}`}
            data-testid={`shop-by-area-tile-${a.slug}`}
            className="group flex flex-col gap-1.5 active:scale-95 transition"
          >
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-[#E5E2DC] bg-[#F4F1E9]">
              {a.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryOptimize(a.image, "w_400,q_auto,f_auto")}
                  alt={a.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center" data-testid={`shop-by-area-blank-${a.slug}`}>
                  <div className="w-7 h-7 rounded-full bg-[#E68910]/15 flex items-center justify-center">
                    <Sparkles size={13} className="text-[#E68910]" />
                  </div>
                </div>
              )}
              <span
                className="absolute bottom-1.5 left-1.5 inline-flex items-center rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#0A1F5C] shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
                data-testid={`shop-by-area-count-${a.slug}`}
              >
                {a.store_count} {a.store_count === 1 ? "store" : "stores"}
              </span>
            </div>
            <span className="text-[11px] font-bold text-[#0A1F5C] text-center leading-tight line-clamp-1">{a.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
