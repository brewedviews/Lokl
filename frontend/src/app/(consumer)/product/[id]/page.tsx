import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { ProductPdpHeader } from "@/components/consumer/ProductPdpHeader";
import { ProductGallery } from "@/components/consumer/ProductGallery";
import { ProductDetailPanel } from "@/components/consumer/ProductDetailPanel";
import { ProductCard } from "@/components/consumer/ProductCard";
import { OffersCard } from "@/components/consumer/OffersCard";
import { TrustIconsRow } from "@/components/consumer/TrustIconsRow";
import { SpecsTabs, type SpecRow } from "@/components/consumer/SpecsTabs";
import type { Product, ProductCard as ProductCardType, CategoryNode } from "@/types";

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
  const [data, relatedRaw, categories] = await Promise.all([
    serverFetch<ProductDetailResponse>(`/api/products/${id}`),
    serverFetch<{ from_store: ProductCardType[]; similar: ProductCardType[] }>(`/api/products/${id}/related`),
    serverFetch<CategoryNode[]>("/api/categories"),
  ]);
  if (!data?.product) notFound();

  const product = data.product;
  const fromStore = relatedRaw?.from_store ?? [];
  const similar = relatedRaw?.similar ?? [];
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const images = (product.images && product.images.length > 0)
    ? product.images
    : ([product.image].filter(Boolean) as string[]);

  // Category — resolved from the taxonomy tree rather than exposing the
  // raw l1_id/l2_id. l2 wins when present (more specific).
  const l1 = categories?.find((c) => c.id === product.l1_id);
  const l2 = l1?.l2?.find((s) => s.id === product.l2_id);
  const categoryLabel = l2?.name || l1?.name || null;

  // Specs grid — trimmed to genuinely NEW data only. Delivery, returns,
  // try & buy and the store name are all shown elsewhere on this page
  // already (the delivery box, the returnable badge, the try-and-buy
  // callout, the price-block store link) — repeating them here was the
  // duplication a previous pass removed. Fabric/material and fit aren't on
  // the product data model yet, so those rows are simply omitted rather
  // than shown empty — they'll appear automatically once that data exists.
  const specs: SpecRow[] = [
    { label: "Sizes", value: product.sizes && product.sizes.length > 0 ? product.sizes.join(", ") : "Free size" },
    ...(categoryLabel ? [{ label: "Category", value: categoryLabel }] : []),
    ...((product as any).fabric ? [{ label: "Fabric", value: String((product as any).fabric) }] : []),
    ...((product as any).fit ? [{ label: "Fit", value: String((product as any).fit) }] : []),
  ];

  return (
    // No pb-24 here — the old mobile sticky CTA bar (and its clearance
    // padding) is gone, and StickyBottomNav/ConsumerHeader are both hidden
    // on this route (see their own pathname guards) in favour of
    // ProductPdpHeader, so there's no fixed bottom-nav to clear either.
    <div className="flex-1 flex flex-col bg-brand-bg">
      <ProductPdpHeader />

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
              product={product}
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
              bottom corners). */}
          <div className="-mt-5 rounded-t-[24px] bg-brand-bg relative z-10 md:mt-0 md:rounded-none md:sticky md:top-24 md:self-start">
            <ProductDetailPanel
              product={product}
              discount={discount}
              storeCanOrder={product.store_can_order !== false}
              storeBadge={product.store_badge ?? "LIVE"}
              storeOpensAtLabel={product.store_opens_at_label ?? null}
              storeName={product.store_name}
              storeId={product.store_id}
            />

            {/* Offers, trust icons, specs/description — all optional/
                data-driven; each renders nothing if it has nothing real
                to show (no fabricated offers, specs or claims). */}
            <div className="px-4 mt-4 md:px-0">
              <OffersCard price={product.price} />
            </div>

            <div className="px-4 mt-4 md:px-0">
              <TrustIconsRow />
            </div>

            <SpecsTabs specs={specs} description={product.description} />
          </div>
        </div>

        {/* Below-fold rails — full width within max-w-[1200px]. Header
            stays sticky/visible through all of this (ProductPdpHeader is
            mounted once, above, outside the scroll — it never re-mounts
            or gets pushed off as the page scrolls). */}
        {fromStore.length > 0 && (
          <section className="px-4 mt-8 md:px-8" data-testid="from-store-rail">
            {/* View Store row, directly above the rail it belongs to. */}
            {product.store_id && (
              <div className="mb-3 p-3 bg-white border border-[#E5E2DC] rounded-xl flex items-center gap-3">
                <p className="flex-1 text-xs font-bold text-[#0A1F5C]">{product.store_name}</p>
                <Link href={`/store/${product.store_id}`} className="text-xs font-semibold text-[#E68910]">
                  View store →
                </Link>
              </div>
            )}
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-4">More from {product.store_name}</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {fromStore.slice(0, 8).map((p) => (
                <div key={p.id} className="shrink-0 w-[38vw] sm:w-[180px]"><ProductCard p={p} size="default" /></div>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section id="similar-products" className="px-4 mt-8 md:px-8 pb-8" data-testid="similar-products">
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-4">You might also like</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {similar.slice(0, 8).map((p) => (
                <div key={p.id} className="shrink-0 w-[38vw] sm:w-[180px]"><ProductCard p={p} size="default" /></div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
