import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { serverFetch } from "@/lib/server-fetch";
import { storeStatusLabel } from "@/lib/utils";
import { ProductCard } from "@/components/consumer/ProductCard";
import { HCarousel } from "@/components/consumer/v2/HCarousel";
import { StoreInfoChips } from "@/components/consumer/StoreInfoChips";
import { StoreNotifyBanner } from "@/components/consumer/StoreNotifyBanner";
import { TrustSignalsCompact } from "@/components/consumer/TrustSignalsCompact";
import { OffersSection } from "@/components/consumer/sections/OffersSection";
import { StoreCatalogueSection, type StoreCategoryChip } from "@/components/consumer/StoreCatalogueSection";
import type { Store, ProductCard as ProductCardType, CategoryNode } from "@/types";

interface StoreDetailResponse {
  store: Store;
  products: ProductCardType[];
}

// G21 P1-10 — compact text-led L2 chip nav ("All / Running / Casual /
// Formal / Sandals"), computed from this store's own already-fetched
// product list against the global category tree (for real L2 names) —
// no new backend endpoint. Only the top categories by real product count,
// capped so this stays a slim pill row, never a second tile grid.
const MAX_CATEGORY_CHIPS = 6;

function buildCategoryChips(products: ProductCardType[], categories: CategoryNode[]): StoreCategoryChip[] {
  const l2Names = new Map<string, string>();
  for (const l1 of categories) {
    for (const l2 of l1.l2 ?? []) l2Names.set(l2.id, l2.name);
  }
  const counts = new Map<string, number>();
  for (const p of products) {
    if (!p.l2_id) continue;
    counts.set(p.l2_id, (counts.get(p.l2_id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([id]) => l2Names.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CATEGORY_CHIPS)
    .map(([id]) => ({ id, label: l2Names.get(id)! }));
}

// Below this many live products, splitting into New Arrivals / Bestsellers
// rails would mean two thin, near-identical strips pulled from the same
// small pool — a single "From this store" grid reads better. Above it,
// both rails get a real chance to show genuinely different products.
const SPLIT_RAIL_MIN_PRODUCTS = 6;

function etaFromDistance(km?: number | null) {
  if (km == null) return "45 min";
  const min = Math.max(15, Math.round(20 + Number(km) * 4));
  return `${min} min`;
}
function areaFromAddress(s: Store) {
  const firstSeg = (s.address || "").split(",")[0]?.trim();
  return s.area || firstSeg || s.locality || s.city || "Bhilai";
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const data = await serverFetch<StoreDetailResponse>(`/api/stores/${id}`);
  if (!data?.store) return { title: "Store not found", robots: { index: false } };
  const s = data.store;
  const title = `${s.name} — ${s.city ?? "Bhilai"} · Lokl`;
  const desc = (s.tagline || s.story || `Shop from ${s.name}, a trusted local store on Lokl. ${data.products.length} products available.`).slice(0, 160);
  return {
    title,
    description: desc,
    // Sibling `opengraph-image.tsx` provides the dynamic 1200×630 preview.
    openGraph: { title, description: desc, type: "website" },
  };
}

export default async function StorePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await serverFetch<StoreDetailResponse>(`/api/stores/${id}`);
  if (!data?.store) notFound();

  const store = data.store;
  const products = data.products ?? [];
  const banners = (store.banners && store.banners.length > 0) ? store.banners : [store.banner].filter(Boolean) as string[];
  const eta = etaFromDistance(store.distance_km);
  const area = areaFromAddress(store);

  // New Arrivals / Bestsellers rails key off the resolved store id
  // (store.id, not the route's slug-or-id param) — fetched in parallel,
  // after the store itself resolves. (The old L1-level "Shop by category"
  // tile row and its /api/stores/{id}/categories fetch were removed —
  // see the store-page redesign's own notes — it made the page read like
  // an L1 homepage; the catalogue's own L2 chip filter below, built from
  // `allCategories`, is a different, kept feature.)
  const splitRails = store.product_count >= SPLIT_RAIL_MIN_PRODUCTS;
  const [newArrivals, bestsellers, allCategories] = await Promise.all([
    splitRails ? serverFetch<ProductCardType[]>(`/api/feed/new-arrivals?store=${store.id}&limit=8`) : Promise.resolve(null),
    splitRails ? serverFetch<ProductCardType[]>(`/api/feed/best-sellers?store=${store.id}&limit=8`) : Promise.resolve(null),
    serverFetch<CategoryNode[]>(`/api/categories`),
  ]);
  // G21 P1-10 — these two rails now render ADDITIONALLY above the full
  // catalogue (not instead of it): "New at this store" / "Popular from
  // this store" only add value when they're a genuinely different,
  // SMALLER subset of a bigger catalogue below them. A store with a
  // small total catalogue has both feeds gracefully fall back to
  // "every visible product, reordered" (no real recency/sales signal to
  // narrow on yet) — showing that same full set three times in a row
  // (as "Popular", then "New", then the catalogue) would be redundant
  // clutter dressed up as curation, not real discovery value.
  const showRails = splitRails && !!newArrivals?.length && !!bestsellers?.length
    && newArrivals.length < products.length && bestsellers.length < products.length;
  const categoryChips = buildCategoryChips(products, allCategories || []);
  // Store-page redesign — same "initials, never a placeholder image" rule
  // MerchantMicroCard already applies to a missing logo, reused here for
  // BOTH the logo circle and the hero itself when a store has no
  // banner/image at all yet (a real, reachable state for a newly
  // onboarded merchant) — a deliberate branded panel, not an empty void
  // and never a stock/generated photo standing in for a real one.
  const storeInitial = (store.name || "S").trim().charAt(0).toUpperCase() || "S";

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1">
        <div className="relative h-[34vh] sm:h-[36vh] md:h-[42vh] overflow-hidden bg-[#0A1F5C]">
        {banners.length > 1 ? (
          <div className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar">
            {banners.map((b, i) => (
              <div key={b || `banner-${i}`} className="relative w-full h-full shrink-0 snap-center">
                <Image src={b} alt={`${store.name} ${i + 1}`} fill priority={i === 0} sizes="100vw" className="object-cover" />
              </div>
            ))}
          </div>
        ) : banners[0] ? (
          <Image src={banners[0]!} alt={store.name} fill priority sizes="100vw" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" data-testid="store-hero-fallback">
            <span className="font-display font-bold text-white/10 text-[8rem] sm:text-[10rem] leading-none select-none">
              {storeInitial}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 md:px-8 pb-4 sm:pb-6 text-white">
          {/* Availability SOP — gate on `badge` (the authoritative
              LIVE/Away/Closed/Store Offline source), not `is_open`, so this
              pill actually shows for the common "outside hours" Closed
              case too, not just Away/Offline. Text comes from the same
              shared storeStatusLabel() every other store-card surface
              uses, so this can never contradict them. */}
          {(store.trusted || store.badge !== "LIVE") && (
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              {store.trusted && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/90 text-[#0A1F5C] text-[10px] sm:text-xs font-semibold">
                  <ShieldCheck size={11} className="text-[#4F7363]" /> Trusted Store
                </div>
              )}
              {store.badge !== "LIVE" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/90 text-[#64748B] text-[10px] sm:text-xs font-semibold">
                  {storeStatusLabel(store.badge, store.next_open_label).label}
                </div>
              )}
            </div>
          )}
          {/* Logo + name/tagline — same circular-avatar-next-to-text
              composition MerchantMicroCard already uses for store logo
              display (PDP); falls back to the same initials-circle
              treatment when the store has no logo, so store identity
              always reads as one complete, coherent unit here rather
              than sometimes-avatar-sometimes-nothing. */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-white shrink-0 bg-[#0A1F5C] shadow-sm flex items-center justify-center">
              {store.logo ? (
                <Image src={store.logo} alt="" fill sizes="64px" className="object-cover" />
              ) : (
                <span className="font-display font-bold text-white text-lg sm:text-xl">{storeInitial}</span>
              )}
            </div>
            <div className="min-w-0">
              <h1 data-testid="store-name" className="font-display text-xl sm:text-2xl md:text-3xl font-medium leading-[1.1]">{store.name}</h1>
              {store.tagline && <p className="text-white/80 mt-1 sm:mt-2 max-w-xl text-xs sm:text-base line-clamp-1 sm:line-clamp-none">{store.tagline}</p>}
            </div>
          </div>
        </div>
      </div>

      <StoreInfoChips storyText={store.story ?? null} area={area} eta={eta} city={store.city || "Bhilai"} timing={store.timing} storeLat={store.lat ?? null} storeLng={store.lng ?? null} />

      {/* STORE CAMPAIGN/OFFER (G21 P1-10) — only rendered if this store has
          its own active, in-schedule campaign (store_id-scoped offer);
          self-fetches and returns null otherwise, so it occupies zero
          space on the vast majority of store pages that have none. */}
      <OffersSection storeId={store.id} />

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 sm:pt-8 pb-10">
        <StoreNotifyBanner
          badge={store.badge ?? ""}
          storeId={store.id}
          storeName={store.name}
          nextOpenLabel={store.next_open_label ?? null}
        />
        {products.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 sm:p-12 text-center">
            {store.next_open_label ? (
              <>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#64748B]/10 text-[#64748B] text-[11px] font-bold uppercase tracking-widest mb-3">{store.next_open_label}</div>
                <p className="text-sm text-[#595959]">Products will be visible once the store is back online.</p>
              </>
            ) : (
              <>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
                <p className="text-sm text-[#595959]">This store hasn&apos;t listed any products yet — drop back soon.</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* PRODUCT DISCOVERY (G21/G22, restyled) — Popular / New only
                when they add real, distinct value over the full catalogue
                below (see `showRails`, unchanged G22 safeguard: a smaller
                genuine subset, never the same set repeated). Horizontal
                rails now reuse the exact same HCarousel + compact
                ProductCard pattern Marketplace/L1 already use, instead of
                a 2-col grid of full-size cards — compact cards read as
                quick discovery, not another product-detail-sized shelf,
                and ~2 sit comfortably in view on a 390px screen. */}
            {showRails && bestsellers && bestsellers.length > 0 && (
              <HCarousel title="Popular from this store" testid="store-bestsellers">
                {bestsellers.map((p) => (
                  <ProductCard key={p.id} p={{ ...p, store_name: store.name }} size="compact" />
                ))}
              </HCarousel>
            )}
            {showRails && newArrivals && newArrivals.length > 0 && (
              <HCarousel title="New at this store" testid="store-new-arrivals">
                {newArrivals.map((p) => (
                  <ProductCard key={p.id} p={{ ...p, store_name: store.name }} size="compact" />
                ))}
              </HCarousel>
            )}
            <div className={showRails ? "pt-8" : "pt-6"}>
              <StoreCatalogueSection
                products={products}
                storeName={store.name}
                chips={categoryChips}
                heading={showRails ? "Full catalogue" : `From this store (${products.length})`}
              />
            </div>
          </>
        )}

        {/* Store policies — one compact block, every breakpoint (folded
            the old separate mobile/desktop copies of this same content
            into a single lightweight strip near the bottom rather than a
            dashboard-style card). */}
        <div className="mt-10 pt-6 border-t border-[#E5E2DC]">
          <h3 className="text-[11px] font-display font-semibold text-[#0A1F5C] uppercase tracking-wider mb-3">Store policies</h3>
          <TrustSignalsCompact />
        </div>
      </div>
      </div>
    </div>
  );
}
