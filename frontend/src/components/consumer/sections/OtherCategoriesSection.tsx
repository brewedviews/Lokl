"use client";

/**
 * OtherCategoriesSection — "More Categories" (G9 §9, renamed from G8's
 * "Other Categories"). L1 pages only. The current L1's real L2 categories
 * NOT already shown in that L1's primary Shop-by-Category grid (Women's
 * 6 / Men's 6 / Kids' 3) — real taxonomy only, nothing invented.
 * `primarySlugs` is passed in by the caller (L1PageClient already owns
 * each L1's own primary spec list) so this component stays a dumb "the
 * rest of this L1's L2s" renderer, not a second place that has to know
 * the primary six.
 *
 * G9 — a wrapping `grid-cols-4` grid (was a horizontal-scroll row),
 * matching §9's "4×4 grid where possible" ask. Capped at 16 tiles via
 * `.slice(0, 16)`, but that cap is never actually reached today — live
 * taxonomy tops out at 9 (Women) after removing the primary six, so this
 * renders as a partial grid (up to 3 rows), never padded to fill 16.
 *
 * Reuses CategoryTile's existing "dense" density (small circular tile +
 * label below) — same treatment BrowseGridBlock's own tiles use
 * elsewhere, not a new tile design. Its built-in icon fallback covers the
 * many L2s here that don't have an admin-set image yet.
 */
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { cloudinaryOptimize } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import type { CategoryNode } from "@/types";

const MAX_TILES = 16;

export function OtherCategoriesSection({ l1, primarySlugs }: { l1: CategoryNode | undefined; primarySlugs: Set<string> }) {
  if (!l1) return null;
  const others = (l1.l2 ?? []).filter((s) => !primarySlugs.has(s.slug)).slice(0, MAX_TILES);
  if (others.length === 0) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid="home-other_categories">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">More Categories</h2>
      <div className="grid grid-cols-4 gap-x-2 gap-y-4">
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
