"use client";

/**
 * StoreSectionModule — the G4/G6 editorial store-CMS module renderer,
 * extracted to a shared file in G8 so both L1PageClient.tsx (real per-L1
 * modules — Footwear/Ethnic/Lingerie-or-Innerwear-or-Kids) and
 * MarketplaceHomeClient.tsx (new global, cross-L1 Ethnic/Footwear Stores)
 * can use the exact same component — "one reusable component," not one
 * per surface.
 *
 * Scalar props (not a `CategoryNode`) — a "global" scope has no real L1
 * taxonomy object to pass. `l1Id="global"` skips the real-store
 * aggregation query entirely (there's no `/categories/global/stores` —
 * that endpoint is inherently per-L1), so a global module is always
 * editorial-cards-only by construction — honest, not a fake merchant list.
 *
 * Phase G4: layers an admin-curated CMS override on top of real store
 * data (when not global), fetched from GET /store-section-overrides/
 * {l1_id}/{l2_id} ALONGSIDE (never instead of) the real store query —
 * same (l1_id, l2_id) scoping key stores_in_category() itself matches
 * on, so overrides are correctly isolated per L1+category (see that
 * endpoint's own doc comment in server.py). `banner_image`, when set,
 * replaces the section's default L2-image banner; `pinned_stores`
 * (admin display cards, not real stores) render in the SAME horizontal
 * row, after the real stores. The section only hides when BOTH lists
 * are empty.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { SellerCard } from "@/components/consumer/SellerCard";
import { cloudinaryOptimize, storeStatusLabel } from "@/lib/utils";

export interface GenderedSectionStore {
  id: string; slug?: string; name: string;
  logo?: string; banner?: string; banners?: string[];
  area_label?: string; locality?: string; specialties?: string[];
  product_count: number; availability_rank: number; next_open_label?: string; badge?: string;
}

interface StoreSectionModuleProps {
  l1Id: string;
  l2Id: string;
  l2Href: string;
  l2Image: string | null;
  defaultHeading: string;
  bannerLabel: string;
  testSlug: string;
}

export function StoreSectionModule({ l1Id, l2Id, l2Href, l2Image, defaultHeading, bannerLabel, testSlug }: StoreSectionModuleProps) {
  const isGlobal = l1Id === "global";

  const { data: stores } = useQuery({
    queryKey: ["gendered-store-section", l2Id],
    queryFn: async () => {
      const r = await apiClient.get<GenderedSectionStore[]>(`/api/categories/${l1Id}/stores`, { params: { l2_id: l2Id, limit: 10 } });
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !isGlobal,
  });

  const { data: override } = useQuery({
    queryKey: ["store-section-override", l1Id, l2Id],
    queryFn: () => api.catalog.storeSectionOverride(l1Id, l2Id),
  });

  if (!override || (!isGlobal && !stores)) return null;

  // G6 — `mode: "editorial_only"` skips real stores_in_category() results
  // entirely, showing only the admin's pinned cards. Default
  // ("real_plus_editorial") is the original G4 behavior: real stores
  // first, pinned cards after. Global modules are always editorial-only
  // (no real-store query ever ran for them — see `isGlobal` above).
  const editorialOnly = isGlobal || override.mode === "editorial_only";
  const realStores = editorialOnly ? [] : (stores ?? []);
  const pinned = override.pinned_stores ?? [];
  if (realStores.length === 0 && pinned.length === 0) return null;

  const bannerImage = override.banner_image || l2Image;
  // G6 — display_title is admin-controlled; defaultHeading is only the
  // fallback (unset override = identical to pre-G6 behavior). This is
  // what makes each slot's title a genuine editorial choice rather than
  // a hardcoded category label.
  const heading = override.display_title || defaultHeading;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" data-testid={`home-store-section-${testSlug}`}>
      <div className="rounded-2xl overflow-hidden bg-surface-tint">
        <Link href={l2Href} className="group relative block aspect-[16/9] sm:aspect-[21/9]">
          {bannerImage ? (
            <img
              src={cloudinaryOptimize(bannerImage, "w_1200,q_auto,f_auto")}
              alt={bannerLabel}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 bg-[#0A1F5C]" />
          )}
          {/* The fade target color (surface-tint) matches the container's
              own background exactly, so the image's bottom edge dissolves
              into the module instead of ending in a hard line — concentrated
              in roughly the bottom quarter (via-25%) so the photo itself
              stays vivid. Text starts right at the image's own bottom edge
              (no negative margin) so it's always on the fully-resolved
              solid background, regardless of which source image is behind
              it. */}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-tint via-surface-tint/15 via-25% to-transparent" />
        </Link>

        <div className="px-4 sm:px-5 pb-5 pt-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" />
            <p className="text-[10px] font-semibold text-brand-primary/50 uppercase tracking-[0.1em]">Bhilai stores</p>
          </div>
          <h2 className="font-display font-medium text-brand-primary text-xl sm:text-2xl leading-tight mb-4">{heading}</h2>

          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {realStores.map((s) => {
              const { openNow, label } = storeStatusLabel(s.badge, s.next_open_label);
              return <SellerCard key={s.id} s={s} source={`store_${testSlug}`} variant="discovery" openNow={openNow} closedLabel={label} />;
            })}
            {/* Phase G4 — admin-pinned display cards, always after real
                stores. Not real store records: no logo/eta/product-count/
                trusted status, and `href` points at the card's own link
                (or this section's own L2 browse page when unset) rather
                than a fabricated /store/{id}. */}
            {pinned.map((p) => (
              <SellerCard
                key={p.id}
                s={{ id: p.id, name: p.name, banner: p.image || null }}
                source={`store_${testSlug}_pinned`}
                variant="discovery"
                href={p.link || l2Href}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
