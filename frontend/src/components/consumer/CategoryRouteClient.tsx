"use client";

/**
 * CategoryRouteClient — the thin routing-layer wrapper behind "/c/[slug]"
 * and its L2 catch-all "/c/[slug]/[...l2slug]". Resolves the URL's slug
 * segment(s) to real l1/l2 ids via the same cached ["categories"] query
 * CategoryTileRow/L1PageClient themselves use, cold-load skeleton while
 * unresolved.
 *
 * G9 §8-11 — until now, an l2slug was accepted in the URL but never
 * actually changed what rendered: this component always mounted the full
 * L1PageClient regardless, which only read l2slug deep inside its own
 * BrowseGridBlock to pre-set a filter at the very bottom of the whole L1
 * shopping home. That's the literal root cause of "clicking a category
 * reopens the entire homepage" — not a styling problem, a routing one.
 * Fixed here: a real l2slug that resolves to a real L2 now mounts the new,
 * dedicated `L2PlpClient` (a compact product-listing page) instead. No
 * l2slug (bare "/c/[slug]") keeps mounting L1PageClient exactly as before
 * — the L1 shopping home is unchanged.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { L1PageClient } from "@/components/consumer/L1PageClient";
import { L2PlpClient } from "@/components/consumer/L2PlpClient";

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

export function CategoryRouteClient() {
  const params = useParams<{ slug: string; l2slug?: string[] }>();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.catalog.categories(),
    staleTime: 5 * 60_000,
  });

  const l1 = categories.find((c) => c.slug === params.slug);

  if (!l1) {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFBF7]">
        <main className="flex-1">
          <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8">
            <div className="h-8 w-40 bg-[#E5E2DC] rounded-lg animate-pulse mb-3" />
            <SkeletonGrid />
          </div>
        </main>
      </div>
    );
  }

  const l2Slug = params.l2slug?.[0];
  const l2 = l2Slug ? (l1.l2 ?? []).find((s) => s.slug === l2Slug) : undefined;

  if (l2Slug && l2) {
    return <L2PlpClient l1={l1} l2={l2} />;
  }

  return <L1PageClient l1Id={l1.id} />;
}
