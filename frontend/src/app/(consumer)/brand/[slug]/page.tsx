import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Tag } from "lucide-react";
import { serverFetch } from "@/lib/server-fetch";
import { ProductCard } from "@/components/consumer/ProductCard";
import type { Brand, ProductCard as ProductCardType } from "@/types";

interface BrandDetailResponse {
  brand: Brand;
  products: ProductCardType[];
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const data = await serverFetch<BrandDetailResponse>(`/api/brands/${slug}`);
  if (!data?.brand) return { title: "Brand not found", robots: { index: false } };
  const b = data.brand;
  const title = `${b.name} · Lokl`;
  const desc = (b.description || `Shop ${b.name} on Lokl. ${data.products.length} products available.`).slice(0, 160);
  return {
    title,
    description: desc,
    // Sibling `opengraph-image.tsx` provides the dynamic 1200×630 preview.
    openGraph: { title, description: desc, type: "website" },
  };
}

export default async function BrandPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const data = await serverFetch<BrandDetailResponse>(`/api/brands/${slug}`);
  if (!data?.brand) notFound();

  const brand = data.brand;
  const products = data.products ?? [];

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="bg-[#0A1F5C]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 sm:py-12 flex items-center gap-4 sm:gap-6">
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-white overflow-hidden flex-shrink-0 flex items-center justify-center">
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt={brand.name} className="w-full h-full object-cover" />
            ) : (
              <Tag size={28} className="text-[#0A1F5C]" />
            )}
          </div>
          <div className="min-w-0 text-white">
            <h1 data-testid="brand-name" className="font-display text-2xl sm:text-4xl md:text-5xl font-bold leading-[1.05]">{brand.name}</h1>
            {brand.description && (
              <p className="text-white/80 mt-1 sm:mt-2 max-w-xl text-xs sm:text-base line-clamp-2">{brand.description}</p>
            )}
            <p className="text-[#E68910] text-[11px] sm:text-xs font-bold uppercase tracking-widest mt-2">
              {products.length} product{products.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 sm:pt-10 pb-10 w-full">
        <h2 className="font-display text-xl sm:text-3xl font-bold text-[#0A1F5C] mb-3 sm:mb-6">From {brand.name} ({products.length})</h2>
        {products.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 sm:p-12 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
            <p className="text-sm text-[#595959]">No products under this brand yet — drop back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
            {products.map((p) => (
              <ProductCard key={p.id} p={p} size="default" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
