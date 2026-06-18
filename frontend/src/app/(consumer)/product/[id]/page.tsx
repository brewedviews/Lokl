import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Star, Bike, MapPin, ShieldCheck, Truck } from "lucide-react";
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
  const desc = (p.description || `Buy ${p.name} from ${p.store_name} on Lokl. Delivered in ${p.store_eta_min ?? 45} minutes from a trusted Bhilai store.`).slice(0, 160);
  return {
    title,
    description: desc,
    // Don't set `openGraph.images` here — the sibling `opengraph-image.tsx`
    // route auto-attaches a dynamic 1200×630 PNG with brand chrome + price.
    openGraph: { title, description: desc, type: "website" },
  };
}

export default async function ProductDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await serverFetch<ProductDetailResponse>(`/api/products/${id}`);
  if (!data?.product) notFound();

  const product = data.product;
  const similar = data.similar ?? [];
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const images = (product.images && product.images.length > 0) ? product.images : [product.image].filter(Boolean);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10 grid md:grid-cols-2 gap-6 md:gap-10">
        <div className="mx-3 mt-3 md:mx-0 md:mt-0">
          <ProductGallery name={product.name} images={images} aiEnhanced={product.ai_enhanced} />
        </div>
        <div data-testid="pdp-info">
          {product.store_id ? (
            <Link href={`/store/${product.store_id}`} data-testid="store-name-link" className="text-[11px] uppercase tracking-widest font-bold text-[#F59E0B] hover:underline">
              {product.store_name}
            </Link>
          ) : (
            <div className="text-[11px] uppercase tracking-widest text-[#64748B]">{product.store_name}</div>
          )}
          <h1 className="font-display text-2xl md:text-3xl font-bold text-[#0A1F5C] mt-2 leading-tight">{product.name}</h1>
          {product.store_badge && product.store_badge !== "LIVE" && (
            product.store_badge === "Closed" ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full mt-2">
                <span>⏰</span>
                {`Available from ${(product.store_opens_at_label || "").replace(/^Opens\s+(at\s+)?/i, "") || "soon"}`}
              </span>
            ) : (
              <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[11px] font-semibold ${
                product.store_badge === "Store Offline"
                  ? "bg-slate-100 text-slate-500"
                  : product.store_badge === "Away"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-600"
              }`}>
                {product.store_badge === "Away"
                ? "Back soon"
                : product.store_badge === "Store Offline"
                ? "Currently unavailable"
                : product.store_eta_message || product.store_badge}
              </div>
            )
          )}
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#10B981] text-white font-bold"><Star size={11} fill="currentColor" /> {product.rating || 4.5}</span>
            <span className="flex items-center gap-1 text-[#64748B]"><Bike size={13} /> {product.store_eta_min || 45} min</span>
            <span className="flex items-center gap-1 text-[#64748B]"><MapPin size={13} /> {Number(product.store_distance_km || 1.5).toFixed(1)} km</span>
            <span className="flex items-center gap-1 text-[#10B981]"><ShieldCheck size={13} /> Trusted</span>
          </div>
          <div className="flex items-end gap-2 mt-4">
            <span className="font-display text-3xl font-bold text-[#0A1F5C]">₹{Number(product.price).toLocaleString()}</span>
            {product.mrp && product.mrp > product.price && (
              <>
                <span className="text-sm text-[#94A3B8] line-through">₹{Number(product.mrp).toLocaleString()}</span>
                <span className="text-sm font-bold text-[#10B981]">{discount}% off</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">Inclusive of all taxes</p>
          {product.description && <p className="mt-4 text-sm text-[#1C1C1C] leading-relaxed line-clamp-3">{product.description}</p>}

          <ProductActions
            product={product}
            storeCanOrder={product.store_can_order !== false}
            storeBadge={product.store_badge ?? "LIVE"}
            storeOpensAtLabel={product.store_opens_at_label ?? null}
            storeName={product.store_name}
            storeId={product.store_id}
          />

          <div className="mt-6 grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-slate-100">
              <Truck size={16} className="text-[#F59E0B] mb-1.5" />
              <div className="font-semibold">Fast delivery</div>
              <div className="text-[#64748B]">{product.store_eta_min || 45} min</div>
            </div>
            <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-slate-100">
              <ShieldCheck size={16} className="text-[#10B981] mb-1.5" />
              <div className="font-semibold">Trusted store</div>
              <div className="text-[#64748B]">Verified merchant</div>
            </div>
          </div>
        </div>
      </div>

      {similar.length > 0 && (
        <section id="similar-products" className="max-w-6xl mx-auto px-4 md:px-8 mt-10 md:mt-14" data-testid="similar-products">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-[#0A1F5C] mb-5">You might also love</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {similar.slice(0, 4).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </div>
        </section>
      )}
      <Footer />
    </div>
  );
}
