import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { ProductGallery } from "@/components/consumer/ProductGallery";
import { ProductActions } from "@/components/consumer/ProductActions";
import { ProductCard } from "@/components/consumer/ProductCard";
import { ProductTopActions } from "@/components/consumer/ProductTopActions";
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
  // duplication this pass removes. Fabric/material and fit aren't on the
  // product data model yet, so those rows are simply omitted rather than
  // shown empty — they'll appear automatically once that data exists.
  const specs: SpecRow[] = [
    { label: "Sizes", value: product.sizes && product.sizes.length > 0 ? product.sizes.join(", ") : "Free size" },
    ...(categoryLabel ? [{ label: "Category", value: categoryLabel }] : []),
    ...((product as any).fabric ? [{ label: "Fabric", value: String((product as any).fabric) }] : []),
    ...((product as any).fit ? [{ label: "Fit", value: String((product as any).fit) }] : []),
  ];

  return (
    // pb-24 (mobile only): the global bottom-nav-safe clearance from
    // (consumer)/layout.tsx is sized for StickyBottomNav alone — this page
    // also has its own sticky mobile add-to-bag bar (ProductActions)
    // sitting just above the nav, so the last rail item needs extra
    // clearance on top of that global padding or it ends up tucked behind
    // the bar. Desktop has no sticky bar (the right column IS the sticky
    // element), so no extra padding there.
    <div className="flex-1 flex flex-col bg-[#FDFBF7] pb-24 md:pb-0">
      <div className="flex-1 w-full max-w-[1200px] mx-auto">

        {/* Wishlist + share — top of the PDP content, right-aligned like a
            header action row, not inside the mid-page CTA row (see
            ProductActions' own note on why they moved). Sits above the
            two-column grid so it reads as page-level chrome on both
            breakpoints, not scoped to just the gallery column. */}
        <ProductTopActions product={product} />

        {/*
          Mobile: single column, gallery full-bleed, content padded inside ProductActions.
          Desktop: two columns — flexible gallery left, 440px sticky buy box right.
        */}
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_440px] md:gap-10 md:pt-6 md:px-8 md:items-start">

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

          {/* Right — sticky buy box */}
          <div className="md:sticky md:top-24 md:self-start">

            {/* Store name, badges, title, price, ratings */}
            <div className="px-4 pt-4 pb-2 md:px-0 md:pt-0">
              {product.store_id ? (
                <Link href={`/store/${product.store_id}`} data-testid="store-name-link"
                  className="text-xs text-[#E68910] font-semibold uppercase tracking-wide hover:underline">
                  {product.store_name}
                </Link>
              ) : (
                <span className="text-xs text-[#64748B] uppercase tracking-wide">{product.store_name}</span>
              )}

              {/* "Closed" intentionally renders nothing here — that status
                  (and its "opens at X") now lives solely in
                  DeliveryServiceability, below the CTA. Away/Offline/other
                  statuses aren't restated anywhere else, so they keep
                  their own badge here. */}
              {product.store_badge && product.store_badge !== "LIVE" && product.store_badge !== "Closed" && (
                <div className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  product.store_badge === "Store Offline" ? "bg-[#F4F1E9] text-[#64748B]" :
                  product.store_badge === "Away" ? "bg-[#E68910]/10 text-[#E68910]" : "bg-[#F4F1E9] text-[#595959]"
                }`}>
                  {product.store_badge === "Away" ? "Back soon" :
                   product.store_badge === "Store Offline" ? "Currently unavailable" :
                   (product as any).store_eta_message || product.store_badge}
                </div>
              )}

              <h1 className="font-display text-xl font-bold text-ink-navy mt-2 leading-snug">{product.name}</h1>

              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl font-bold text-ink-navy">₹{Number(product.price).toLocaleString("en-IN")}</span>
                {product.mrp && product.mrp > product.price && (
                  <>
                    <span className="text-xl text-slate-gray line-through">₹{Number(product.mrp).toLocaleString("en-IN")}</span>
                    <span className="inline-flex items-center rounded-full bg-moss-green-tint text-moss-green text-xs font-bold px-2 py-0.5">{discount}% off</span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-gray mt-1">(Inclusive of all taxes)</p>

              {(product as any).review_count > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="flex items-center gap-1 bg-[#4F7363] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    <span>{product.rating?.toFixed(1)}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                  </div>
                  <span className="text-xs text-[#64748B]">{(product as any).review_count} reviews</span>
                </div>
              )}
            </div>

            <div className="h-px bg-[#F5F5F5] mx-4 my-2 md:mx-0" />

            {/* Size picker, action bar, pickup button */}
            <ProductActions
              product={product}
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

            {/* Store link strip — ETA/serviceability now lives in
                ProductActions' DeliveryServiceability line, right below the
                CTA, so this doesn't repeat it; just the store name + a way
                back to the full storefront. */}
            {product.store_id && (
              <div className="mx-4 my-3 p-3 bg-white border border-[#E5E2DC] rounded-xl flex items-center gap-3 md:mx-0">
                <p className="flex-1 text-xs font-bold text-[#0A1F5C]">{product.store_name}</p>
                <Link href={`/store/${product.store_id}`} className="text-xs font-semibold text-[#E68910]">
                  View store →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Below-fold rails — full width within max-w-[1200px] */}
        {fromStore.length > 0 && (
          <section className="px-4 mt-8 md:px-8" data-testid="from-store-rail">
            <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#0A1F5C] leading-tight mb-4">More from {product.store_name}</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {fromStore.slice(0, 8).map((p) => (
                <div key={p.id} className="shrink-0 w-[38vw] sm:w-[180px]"><ProductCard p={p} size="default" /></div>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section id="similar-products" className="px-4 mt-8 md:px-8" data-testid="similar-products">
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
