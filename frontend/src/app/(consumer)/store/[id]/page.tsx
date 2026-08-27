import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Bike, MapPin, ShieldCheck } from "lucide-react";
import { serverFetch } from "@/lib/server-fetch";
import { ProductCard } from "@/components/consumer/ProductCard";
import { StoreInfoChips } from "@/components/consumer/StoreInfoChips";
import { StoreNotifyBanner } from "@/components/consumer/StoreNotifyBanner";
import { CategoryTile } from "@/components/consumer/CategoryTile";
import { TrustSignalsCompact } from "@/components/consumer/TrustSignalsCompact";
import { StoreDistanceText } from "@/components/consumer/StoreDistanceText";
import { OffersSection } from "@/components/consumer/sections/OffersSection";
import { StoreCatalogueSection, type StoreCategoryChip } from "@/components/consumer/StoreCatalogueSection";
import type { Store, ProductCard as ProductCardType, CmsCategory, CategoryNode } from "@/types";

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

  // Categories-sold tile row + New Arrivals / Bestsellers rails all key off
  // the resolved store id (store.id, not the route's slug-or-id param) —
  // fetched in parallel with each other, after the store itself resolves.
  const splitRails = store.product_count >= SPLIT_RAIL_MIN_PRODUCTS;
  const [categoriesSold, newArrivals, bestsellers, allCategories] = await Promise.all([
    serverFetch<CmsCategory[]>(`/api/stores/${store.id}/categories`),
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

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1">
        <div className="relative h-[28vh] sm:h-[45vh] md:h-[55vh] overflow-hidden bg-[#0A1F5C]">
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
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 md:px-8 pb-4 sm:pb-8 text-white">
          {store.trusted && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/90 text-[#0A1F5C] text-[10px] sm:text-xs font-semibold mb-2 sm:mb-3">
              <ShieldCheck size={11} className="text-[#4F7363]" /> Trusted Store
            </div>
          )}
          {store.is_open === false && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/90 text-[#64748B] text-[10px] sm:text-xs font-semibold mb-2 sm:mb-3 ml-2">
              {store.next_open_label || "Closed"}
            </div>
          )}
          {/* Logo + name/tagline — same circular-avatar-next-to-text
              composition MerchantMicroCard already uses for store logo
              display (PDP), just scaled up for the hero. Absent entirely
              when the store has no logo, same discipline as everywhere
              else a possibly-unset image renders on this page. */}
          <div className="flex items-center gap-3">
            {store.logo && (
              <div className="relative w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-white shrink-0 bg-white shadow-sm">
                <Image src={store.logo} alt="" fill sizes="64px" className="object-cover" />
              </div>
            )}
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

      {/* Categories this store sells — dense CategoryTile row, derived from
          real product l1_id values (GET /api/stores/{id}/categories), never
          from the merchant-declared `specialties` free text. Renders
          nothing when the store has no products yet. */}
      {categoriesSold && categoriesSold.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-5 sm:pt-8" data-testid="store-categories-sold">
          <h2 className="text-sm font-display font-medium text-[#0A1F5C] mb-3">Shop by category</h2>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
            {categoriesSold.map((c) => (
              <CategoryTile key={c.id} density="dense" label={c.name} image={c.image} href={`/c/${c.slug}`} testId={`store-category-${c.slug}`} />
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-5 sm:pt-10 pb-10 grid md:grid-cols-3 md:gap-10">
        <aside className="hidden md:block space-y-5">
          {store.story && (
            <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
              <h3 className="font-display text-xl font-medium text-[#0A1F5C] mb-2">The Story</h3>
              <p className="text-sm text-[#595959] leading-relaxed">{store.story}</p>
            </div>
          )}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] text-sm">
            <h3 className="font-display text-xl font-medium text-[#0A1F5C] mb-3">Delivery</h3>
            <div className="space-y-2 text-[#595959]">
              <div className="flex items-center gap-2">
                <Bike size={14} className={store.badge === "Away" ? "text-amber-500" : store.badge === "Store Offline" ? "text-slate-400" : "text-[#E68910]"} />
                {store.badge === "Away" ? (
                  <span className="text-amber-600 font-semibold">May be longer today <span className="font-normal text-[#64748B]">· {eta}</span></span>
                ) : store.badge === "Closed" ? (
                  <span className="text-[#64748B] font-semibold">{store.next_open_label || "Closed"} <span className="font-normal">· {eta}</span></span>
                ) : store.badge === "Store Offline" ? (
                  <span className="text-slate-500 font-semibold">Store offline <span className="font-normal text-[#64748B]">· {eta}</span></span>
                ) : (
                  <span>ETA {eta}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[#E68910]" />
                {area} · {store.city || "Bhilai"}
                <StoreDistanceText storeLat={store.lat} storeLng={store.lng} className="text-[#94A3B8]" />
              </div>
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#4F7363]" /> Try-at-doorstep available</div>
            </div>
          </div>
          {/* Policies/trust section (redesign-plan 3.4) — the standing
              4-item TrustSignalsCompact reused verbatim, not a second
              store-specific version. */}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h3 className="font-display text-xl font-medium text-[#0A1F5C] mb-3">Store policies</h3>
            <TrustSignalsCompact />
          </div>
        </aside>

        <div className="md:col-span-2">
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
            <div className="space-y-8">
              {/* PRODUCT DISCOVERY (G21 P1-10) — Popular / New only when
                  they add real, distinct value over the full catalogue
                  below (see `showRails`); Browse-by-category is a compact
                  chip row inside the catalogue module itself, not a
                  separate grid; the catalogue always renders (it's the
                  store's actual shelf), never an empty section. */}
              {showRails && bestsellers && bestsellers.length > 0 && (
                <div data-testid="store-bestsellers">
                  <h2 className="font-display text-xl sm:text-2xl font-medium text-[#0A1F5C] mb-3 sm:mb-6">Popular from this store</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
                    {bestsellers.map((p) => (
                      <ProductCard key={p.id} p={{ ...p, store_name: store.name }} size="default" />
                    ))}
                  </div>
                </div>
              )}
              {showRails && newArrivals && newArrivals.length > 0 && (
                <div data-testid="store-new-arrivals">
                  <h2 className="font-display text-xl sm:text-2xl font-medium text-[#0A1F5C] mb-3 sm:mb-6">New at this store</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
                    {newArrivals.map((p) => (
                      <ProductCard key={p.id} p={{ ...p, store_name: store.name }} size="default" />
                    ))}
                  </div>
                </div>
              )}
              <StoreCatalogueSection
                products={products}
                storeName={store.name}
                chips={categoryChips}
                heading={showRails ? "Full catalogue" : `From this store (${products.length})`}
              />
            </div>
          )}

          {/* Mobile-only: the aside's policies card is hidden below md, so
              trust signals still need a home in the main column here. */}
          <div className="md:hidden mt-8 bg-white rounded-2xl p-5 border border-[#E5E2DC]">
            <h3 className="font-display text-lg font-medium text-[#0A1F5C] mb-3">Store policies</h3>
            <TrustSignalsCompact />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
