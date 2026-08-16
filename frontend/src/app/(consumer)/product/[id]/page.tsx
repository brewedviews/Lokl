import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { ProductGallery } from "@/components/consumer/ProductGallery";
import { ProductDetailPanel } from "@/components/consumer/ProductDetailPanel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { OffersCard } from "@/components/consumer/OffersCard";
import { SpecsTabs, type SpecRow } from "@/components/consumer/SpecsTabs";
import { MerchantMicroCard } from "@/components/consumer/MerchantMicroCard";
import type { Product, ProductCard as ProductCardType, Store } from "@/types";

interface ProductDetailResponse {
  product: Product;
  similar?: ProductCardType[];
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const data = await serverFetch<ProductDetailResponse>(`/api/products/${id}`);
  if (!data?.product) return { title: "Product not found", robots: { index: false } };
  const p = data.product;
  const title = `${p.name} — ${p.store_name} · Lokl`;
  const desc = (p.description || `Buy ${p.name} from ${p.store_name} on Lokl. Delivered fast from a trusted Bhilai store.`).slice(0, 160);
  return {
    title,
    description: desc,
    openGraph: { title, description: desc, type: "website" },
  };
}

export default async function ProductDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [data, relatedRaw] = await Promise.all([
    serverFetch<ProductDetailResponse>(`/api/products/${id}`),
    serverFetch<{ from_store: ProductCardType[]; similar: ProductCardType[] }>(`/api/products/${id}/related`),
  ]);
  if (!data?.product) notFound();

  const product = data.product;
  const fromStore = relatedRaw?.from_store ?? [];
  const similar = relatedRaw?.similar ?? [];
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const images = (product.images && product.images.length > 0)
    ? product.images
    : ([product.image].filter(Boolean) as string[]);

  // Merchant micro-card data — a second, small fetch rather than blocking
  // the two above; a failed/missing store fetch just means the "More from
  // {store}" section falls back to its old plain header (see storeInfo
  // below), never a broken page.
  const storeResp = product.store_id
    ? await serverFetch<{ store: Store }>(`/api/stores/${product.store_id}`)
    : null;
  const storeInfo = storeResp?.store ?? null;

  // Specs grid — trimmed to genuinely NEW data only. Delivery, returns,
  // try & buy and the store name are all shown elsewhere on this page
  // already (the delivery box, the returnable badge, the try-and-buy
  // callout, the price-block store link). Sizes and Category were dropped
  // too: sizes are already the interactive selector right below the title
  // (restating them here as text was pure duplication), and category adds
  // no decision-making value mid-page for a shopper who already clicked
  // into this exact product. Fabric/material and fit aren't on the product
  // data model yet, so those rows are simply omitted rather than shown
  // empty — they'll appear automatically once that data exists. When specs
  // ends up empty (true for every product today, since fabric/fit don't
  // exist yet), SpecsTabs already degrades gracefully to a plain
  // description block with no orphaned tab chip — see its own hasSpecs
  // check — so there's nothing left to remove here, just less to show.
  const specs: SpecRow[] = [
    ...((product as any).fabric ? [{ label: "Fabric", value: String((product as any).fabric) }] : []),
    ...((product as any).fit ? [{ label: "Fit", value: String((product as any).fit) }] : []),
  ];

  return (
    // ConsumerHeader renders here like everywhere else in the app (see
    // (consumer)/layout.tsx) — the PDP has no header of its own.
    //
    // StickyBottomNav is back on this route (no more /product/ exclusion)
    // — it's the ONLY persistent chrome here; PdpCtaRow (Buy now/Add to
    // bag) stays in normal document flow, not fixed, so there's no second
    // fixed bar competing with the nav. The layout's own bottom-nav-safe
    // padding already accounts for the nav's height, same as every other
    // consumer page.
    <div className="flex-1 flex flex-col bg-brand-bg">
      <div className="flex-1 w-full max-w-[1200px] mx-auto md:pt-6">

        {/*
          Mobile: single column — image card, then a rounded-top content
          sheet that overlaps the image's bottom edge (negative margin) so
          it reads as sliding up over it.
          Desktop: two columns — flexible gallery left, 440px sticky buy
          box right (unchanged side-by-side layout; the overlap treatment
          is a stacked-mobile-only effect).
        */}
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_440px] md:gap-10 md:px-8 md:items-start">

          {/* Left — gallery scrolls normally; buy box (right) is the sticky one */}
          <div>
            <ProductGallery
              name={product.name}
              images={images}
              aiEnhanced={product.ai_enhanced}
              discount={discount}
              tryAndBuy={product.try_at_doorstep}
              fit={(product as any).fit ?? null}
              isCleanBackground={(product as any).is_clean_background ?? false}
            />
          </div>

          {/* Right — sticky buy box on desktop; on mobile this is the
              content sheet sliding up over the image (rounded top,
              negative margin-top so it overlaps the image's rounded
              bottom corners).

              Sticky top offset is two values, not one, because
              ConsumerHeader's own mobile/desktop split is at `lg:` (1024px)
              while this grid goes two-column at `md:` (768px) — in that
              768-1023px gap ConsumerHeader is still its taller 2-row
              mobile layout (~109px measured), which top-24 (96px) sits
              inside of. md:top-[124px] clears that; lg:top-24 keeps the
              original, already-correct offset once the header drops to
              its single-row ~68px desktop form. */}
          <div className="-mt-5 rounded-t-[24px] bg-brand-bg relative z-10 md:mt-0 md:rounded-none md:sticky md:top-[124px] lg:top-24 md:self-start">
            <ProductDetailPanel
              product={product}
              discount={discount}
              storeCanOrder={product.store_can_order !== false}
              storeBadge={product.store_badge ?? "LIVE"}
              storeOpensAtLabel={product.store_opens_at_label ?? null}
              storeName={product.store_name}
              storeId={product.store_id}
              storeAreaLabel={storeInfo?.area_label}
            />

            {/* Offers + specs/description — optional/data-driven; each
                renders nothing if it has nothing real to show (no
                fabricated offers, specs or claims). All four trust signals
                (Secure payments/24h returns/Verified Seller/Made in
                Bhilai) now render together as one consistent list inside
                ProductDetailPanel, near delivery/store info — no separate
                large-badge tier here anymore. */}
            <div className="px-4 mt-4 md:px-0">
              <OffersCard price={product.price} />
            </div>

            <SpecsTabs specs={specs} description={product.description} />
          </div>
        </div>

        {/* Below-fold rails — full width within max-w-[1200px]. The global
            ConsumerHeader (mounted once, in the route-group layout, outside
            this scroll) stays sticky/visible through all of this — it never
            re-mounts or gets pushed off as the page scrolls. */}
        {fromStore.length > 0 && (
          <section className="px-4 mt-8 md:px-8" data-testid="from-store-rail">
            {/* Merchant micro-card, directly above the rail it belongs to —
                replaces the old plain bordered "name / View store →" row.
                logo/area/order-count are each independently optional; see
                MerchantMicroCard's own doc comment for what's real vs
                omitted per field. */}
            {product.store_id && (
              <MerchantMicroCard
                storeId={product.store_id}
                storeName={product.store_name}
                logo={storeInfo?.logo}
                areaLabel={storeInfo?.area_label}
                ordersThisMonth={storeInfo?.orders_this_month}
              />
            )}
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-4">More from {product.store_name}</h2>
            {/* Card width is solved algebraically, not guessed: 2.2 cards +
                1.2 gaps (gap-3 = 12px) should fill the row exactly, so the
                3rd card's peek is always the same intentional ~0.2-card
                sliver regardless of viewport width — 2.2W + 1.2(12px) =
                100% → W = (100% - 14.4px) / 2.2 ≈ 45.5% - 7px. Percentage
                is against the flex row's own content box, which already
                excludes this section's own px-4/md:px-8 padding, so this
                doesn't double-subtract it. Previously w-[38vw], which
                ignored that padding entirely — however much of a 3rd card
                showed at the edge was leftover-space arithmetic, not a
                designed peek. */}
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {fromStore.slice(0, 8).map((p) => (
                <div key={p.id} className="shrink-0 w-[calc(45.5%-7px)] sm:w-[180px]"><ProductCard p={p} size="default" /></div>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section id="similar-products" className="px-4 mt-8 md:px-8 pb-8" data-testid="similar-products">
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-4">You might also like</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {similar.slice(0, 8).map((p) => (
                <div key={p.id} className="shrink-0 w-[calc(45.5%-7px)] sm:w-[180px]"><ProductCard p={p} size="default" /></div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
