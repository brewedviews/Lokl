import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Bike, MapPin, ShieldCheck } from "lucide-react";
import { serverFetch } from "@/lib/server-fetch";
import { ProductCard } from "@/components/consumer/ProductCard";
import { StoreInfoChips } from "@/components/consumer/StoreInfoChips";
import { StoreNotifyBanner } from "@/components/consumer/StoreNotifyBanner";
import type { Store, ProductCard as ProductCardType } from "@/types";

interface StoreDetailResponse {
  store: Store;
  products: ProductCardType[];
}

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
          <h1 data-testid="store-name" className="font-display text-2xl sm:text-4xl md:text-6xl font-bold leading-[1.05]">{store.name}</h1>
          {store.tagline && <p className="text-white/80 mt-1 sm:mt-2 max-w-xl text-xs sm:text-base line-clamp-1 sm:line-clamp-none">{store.tagline}</p>}
        </div>
      </div>

      <StoreInfoChips storyText={store.story ?? null} area={area} eta={eta} city={store.city || "Bhilai"} timing={store.timing} />

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-5 sm:pt-10 pb-10 grid md:grid-cols-3 md:gap-10">
        <aside className="hidden md:block space-y-5">
          {store.story && (
            <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
              <h3 className="font-display text-xl font-bold text-[#0A1F5C] mb-2">The Story</h3>
              <p className="text-sm text-[#595959] leading-relaxed">{store.story}</p>
            </div>
          )}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] text-sm">
            <h3 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Delivery</h3>
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
              <div className="flex items-center gap-2"><MapPin size={14} className="text-[#E68910]" /> {area} · {store.city || "Bhilai"}</div>
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#4F7363]" /> Try-at-doorstep available</div>
            </div>
          </div>
        </aside>

        <div className="md:col-span-2">
          <h2 className="font-display text-xl sm:text-3xl font-bold text-[#0A1F5C] mb-3 sm:mb-6">From this store ({products.length})</h2>
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              {products.map((p) => (
                <ProductCard key={p.id} p={{ ...p, store_name: store.name }} size="default" />
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
