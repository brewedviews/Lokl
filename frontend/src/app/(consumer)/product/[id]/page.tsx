import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverFetch } from "@/lib/server-fetch";
import { ProductGallery } from "@/components/consumer/ProductGallery";
import { ProductActions } from "@/components/consumer/ProductActions";
import { ProductCardV2 } from "@/components/consumer/v2/ProductCardV2";
import { Footer } from "@/components/consumer/Footer";
import type { Product, ProductCard } from "@/types";

interface ProductDetailResponse {
  product: Product;
  similar?: ProductCard[];
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
    serverFetch<{ from_store: ProductCard[]; similar: ProductCard[] }>(`/api/products/${id}/related`),
  ]);
  if (!data?.product) notFound();

  const product = data.product;
  const fromStore = relatedRaw?.from_store ?? [];
  const similar = relatedRaw?.similar ?? [];
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const images = (product.images && product.images.length > 0)
    ? product.images
    : ([product.image].filter(Boolean) as string[]);

  return (
    <div className="min-h-screen bg-white pb-32">
      {/* Full-width gallery — no side padding on mobile */}
      <ProductGallery name={product.name} images={images} aiEnhanced={product.ai_enhanced} />

      {/* Product info */}
      <div className="px-4 pt-4 pb-2">
        {product.store_id ? (
          <Link href={`/store/${product.store_id}`} data-testid="store-name-link"
            className="text-xs text-[#E68910] font-semibold uppercase tracking-wide hover:underline">
            {product.store_name}
          </Link>
        ) : (
          <span className="text-xs text-[#9CA3AF] uppercase tracking-wide">{product.store_name}</span>
        )}

        {product.store_badge && product.store_badge !== "LIVE" && (
          product.store_badge === "Closed" ? (
            <span className="ml-2 inline-flex items-center text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
              {`Available from ${(product.store_opens_at_label || "").replace(/^Opens\s+(at\s+)?/i, "") || "soon"}`}
            </span>
          ) : (
            <div className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              product.store_badge === "Store Offline" ? "bg-slate-100 text-slate-500" :
              product.store_badge === "Away" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
            }`}>
              {product.store_badge === "Away" ? "Back soon" :
               product.store_badge === "Store Offline" ? "Currently unavailable" :
               (product as any).store_eta_message || product.store_badge}
            </div>
          )
        )}

        <h1 className="text-xl font-bold text-[#1A2B4C] mt-2 leading-snug">{product.name}</h1>

        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-2xl font-bold text-[#1A2B4C]">₹{Number(product.price).toLocaleString("en-IN")}</span>
          {product.mrp && product.mrp > product.price && (
            <>
              <span className="text-sm text-[#9CA3AF] line-through">₹{Number(product.mrp).toLocaleString("en-IN")}</span>
              <span className="text-sm font-bold text-green-600">{discount}% off</span>
            </>
          )}
        </div>
        <p className="text-[11px] text-[#9CA3AF] mt-0.5">Inclusive of all taxes</p>

        {(product as any).review_count > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex items-center gap-1 bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              <span>{product.rating?.toFixed(1)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </div>
            <span className="text-xs text-[#9CA3AF]">{(product as any).review_count} reviews</span>
          </div>
        )}
      </div>

      <div className="h-px bg-[#F5F5F5] mx-4 my-3" />

      {/* Size picker + CTAs */}
      <ProductActions
        product={product}
        storeCanOrder={product.store_can_order !== false}
        storeBadge={product.store_badge ?? "LIVE"}
        storeOpensAtLabel={product.store_opens_at_label ?? null}
        storeName={product.store_name}
        storeId={product.store_id}
      />

      {product.description && (
        <div className="px-4 py-4 border-t border-[#F5F5F5] mt-4">
          <h3 className="text-sm font-bold text-[#1A2B4C] mb-2">Product details</h3>
          <p className="text-sm text-[#595959] leading-relaxed">{product.description}</p>
        </div>
      )}

      {/* Store info strip — only when real data is available */}
      {((product.store_eta_min ?? 0) > 0 || (product.store_distance_km ?? 0) > 0) && (
        <div className="mx-4 my-3 p-3 bg-[#FDFBF7] border border-[#E5E2DC] rounded-xl flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold text-[#1A2B4C]">{product.store_name}</p>
            {(product.store_eta_min ?? 0) > 0 && (
              <p className="text-xs text-[#9CA3AF] mt-0.5">
                Delivers in ~{product.store_eta_min} min
                {(product.store_distance_km ?? 0) > 0 && ` · ${Number(product.store_distance_km).toFixed(1)} km away`}
              </p>
            )}
          </div>
          {product.store_id && (
            <Link href={`/store/${product.store_id}`} className="text-xs font-semibold text-[#E68910]">
              View store →
            </Link>
          )}
        </div>
      )}

      {fromStore.length > 0 && (
        <section className="px-4 mt-8" data-testid="from-store-rail">
          <h2 className="font-bold text-lg text-[#1A2B4C] mb-4">More from {product.store_name}</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {fromStore.slice(0, 8).map((p) => (
              <div key={p.id} className="shrink-0 w-[38vw] sm:w-[180px]"><ProductCardV2 p={p} /></div>
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section id="similar-products" className="px-4 mt-8" data-testid="similar-products">
          <h2 className="font-bold text-lg text-[#1A2B4C] mb-4">You might also like</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {similar.slice(0, 8).map((p) => (
              <div key={p.id} className="shrink-0 w-[38vw] sm:w-[180px]"><ProductCardV2 p={p} /></div>
            ))}
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}
