"use client";

/**
 * OtherCategoriesSection — L1 pages only (G8 §18). A horizontal-scroll
 * row of the current L1's real L2 categories NOT already shown in that
 * L1's primary Shop-by-Category grid (Women's 6 / Men's 6 / Kids' 3) —
 * real taxonomy only, nothing invented. `primarySlugs` is passed in by
 * the caller (L1PageClient already owns each L1's own primary spec list)
 * so this component stays a dumb "the rest of this L1's L2s" renderer,
 * not a second place that has to know the primary six.
 *
 * Reuses CategoryTile's existing "dense" density (small circular tile +
 * label below) — same treatment ShopByBrandSection/BrowseGridBlock's own
 * tiles already use elsewhere, not a new tile design. Its built-in icon
 * fallback covers the many L2s here that don't have an admin-set image
 * yet (confirmed live: most of Women's/Men's non-primary L2s have no
 * `image` set).
 */
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { cloudinaryOptimize } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import type { CategoryNode } from "@/types";

export function OtherCategoriesSection({ l1, primarySlugs }: { l1: CategoryNode | undefined; primarySlugs: Set<string> }) {
  if (!l1) return null;
  const others = (l1.l2 ?? []).filter((s) => !primarySlugs.has(s.slug));
  if (others.length === 0) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-other_categories">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">Other Categories</h2>
      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
        {others.map((s) => (
          <CategoryTile
            key={s.id}
            density="dense"
            label={s.name}
            image={s.image ? cloudinaryOptimize(s.image, "w_200,q_auto,f_auto") : null}
            href={`/c/${l1.slug}/${s.slug}`}
            fallback={<Sparkles size={16} className="text-[#94A3B8]" />}
            testId={`other-category-${s.slug}`}
          />
        ))}
      </div>
    </div>
  );
}
