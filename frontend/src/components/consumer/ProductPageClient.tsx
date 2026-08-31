"use client";

/**
 * Owns the ONE piece of state the gallery and the detail panel must share:
 * which color is selected. page.tsx is a server component and
 * ProductGallery/ProductDetailPanel are siblings in its layout grid — a
 * server component can't hold client state, so this thin client wrapper
 * exists purely to lift `selectedColorId` above both of them. Renders
 * exactly the same grid/markup page.tsx used to build directly; nothing
 * about the layout changed, only where the color state lives.
 *
 * `key={selectedVariant?.id}` on ProductGallery is deliberate: switching
 * color must reset the gallery to its first image (not preserve whatever
 * index was showing for the previous color), and remounting is the
 * simplest correct way to guarantee that — same idiom as any
 * "identity change should reset internal state" case in React.
 */
import { useState } from "react";
import { ProductGallery } from "./ProductGallery";
import { ProductDetailPanel } from "./ProductDetailPanel";
import { OffersCard } from "./OffersCard";
import { SpecsTabs, type SpecRow } from "./SpecsTabs";
import type { Product, Store } from "@/types";

export function ProductPageClient({
  product,
  discount,
  storeInfo,
  specs,
}: {
  product: Product;
  discount: number;
  storeInfo: Store | null;
  specs: SpecRow[];
}) {
  const colorVariants = product.color_variants || [];
  const hasColorVariants = colorVariants.length > 0;
  const [selectedColorId, setSelectedColorId] = useState<string | null>(colorVariants[0]?.id ?? null);
  const selectedVariant = hasColorVariants
    ? colorVariants.find((v) => v.id === selectedColorId) ?? colorVariants[0]
    : null;

  const images = hasColorVariants
    ? (selectedVariant?.images.map((i) => i.url) ?? [])
    : (product.images && product.images.length > 0 ? product.images : ([product.image].filter(Boolean) as string[]));

  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_440px] md:gap-10 md:px-8 md:items-start">
      {/* Left — gallery scrolls normally; buy box (right) is the sticky one */}
      <div>
        <ProductGallery
          key={selectedVariant?.id ?? "default"}
          name={product.name}
          images={images}
          aiEnhanced={product.ai_enhanced}
          discount={discount}
          tryAndBuy={product.try_at_doorstep}
          fit={(product as unknown as { fit?: string | null }).fit ?? null}
          isCleanBackground={(product as unknown as { is_clean_background?: boolean }).is_clean_background ?? false}
        />
      </div>

      {/* Right — sticky buy box on desktop; on mobile this is the content
          sheet sliding up over the image (see page.tsx's own prior comment
          on the two-value sticky offset — unchanged, just moved here). */}
      <div className="-mt-5 rounded-t-[24px] bg-brand-bg relative z-10 md:mt-0 md:rounded-none md:sticky md:top-[124px] lg:top-24 md:self-start">
        <ProductDetailPanel
          product={product}
          discount={discount}
          storeBadge={product.store_badge ?? "LIVE"}
          storeOpensAtLabel={product.store_opens_at_label ?? null}
          storeName={product.store_name}
          storeId={product.store_id}
          storeAreaLabel={storeInfo?.area_label}
          selectedColorId={selectedColorId}
          onColorChange={setSelectedColorId}
        />

        <div className="px-4 mt-4 md:px-0">
          <OffersCard price={product.price} />
        </div>

        <SpecsTabs specs={specs} description={product.description} />
      </div>
    </div>
  );
}
