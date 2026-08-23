"use client";

/**
 * CategoryRouteClient — the thin routing-layer wrapper behind "/c/[slug]"
 * and its L2 catch-all "/c/[slug]/[...l2slug]". Its ONLY job is resolving
 * the URL's slug segment to a real l1Id, then mounting L1PageClient (the
 * genuinely shared page tree behind Home too — see that file's own top
 * comment for the full Phase E unification rationale). This is exactly
 * what CategoryClient.tsx used to do internally before Phase E split it
 * out: slug -> l1 lookup via the same cached ["categories"] query
 * CategoryTileRow/L1PageClient itself also use, cold-load skeleton while
 * unresolved.
 *
 * l1Id is passed down once resolved; mode defaults to "category" inside
 * L1PageClient, so no need to specify it here.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { L1PageClient } from "@/components/consumer/L1PageClient";

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
  const params = useParams<{ slug: string }>();
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

  return <L1PageClient l1Id={l1.id} />;
}
