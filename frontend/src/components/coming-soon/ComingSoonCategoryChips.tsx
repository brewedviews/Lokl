"use client";

/**
 * ComingSoonCategoryChips — G15. Category storytelling, not shopping nav.
 *
 * Reuses the same GET /api/categories fetch CategoryTileRow/MarketplaceHomeClient
 * already use, and the same text-led/underline-on-hover treatment G13's
 * CategoryTileRow established — but isn't CategoryTileRow itself: that
 * component is mounted once inside (consumer)/(shop)/layout.tsx (depends on
 * useSelectedLayoutSegments() for that specific layout tree) and its links
 * go to real /c/{slug} shopping routes, which don't exist as a live
 * destination pre-launch. Each chip here is a plain button that
 * smooth-scrolls to the marketplace preview section instead.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CategoryNode } from "@/types";

const FALLBACK_LABELS = ["Women", "Men", "Kids", "Footwear", "Beauty", "Accessories"];

export function ComingSoonCategoryChips() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);

  useEffect(() => {
    api.catalog.categories().then(setCategories).catch(() => {});
  }, []);

  const labels = categories.length > 0 ? categories.map((c) => c.name) : FALLBACK_LABELS;

  const scrollToPreview = () => {
    document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section data-testid="coming-soon-categories" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
      <h2 className="font-display font-medium text-xl sm:text-2xl tracking-tight text-[#0A1F5C] leading-tight mb-4">
        Everything local, in one place.
      </h2>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {labels.map((label) => (
          <button
            key={label}
            type="button"
            onClick={scrollToPreview}
            data-testid={`category-chip-${label.toLowerCase()}`}
            className="font-display font-medium text-sm sm:text-base tracking-tight text-[#0A1F5C]/70 hover:text-[#0A1F5C] hover:underline underline-offset-4 transition"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
