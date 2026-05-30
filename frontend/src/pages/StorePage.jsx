import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bike, MapPin, ShieldCheck, Clock } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";

function etaFromDistance(km) {
  if (!km && km !== 0) return "30-45 min";
  const min = Math.max(15, Math.round(20 + Number(km) * 4));
  return `${min} min`;
}

// Pull "Sector 10" / "Civic Centre" etc. out of the stored business_address
function areaFromAddress(s) {
  return s.area || (s.address || "").split(",")[0].trim() || s.locality || s.city || "Bhilai";
}

export default function StorePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/stores/${id}`).then((r) => setData(r.data)); }, [id]);

  if (!data) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center">Loading…</div></div>;
  const { store, products } = data;
  const banners = (store.banners && store.banners.length > 0) ? store.banners : [store.banner].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      {/* Banner carousel */}
      <div className="relative h-[45vh] md:h-[55vh] overflow-hidden bg-[#1A2B4C]">
        {banners.length > 1 ? (
          <div className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar">
            {banners.map((b, i) => (
              <img key={i} src={b} alt={`${store.name} ${i + 1}`} loading="lazy" className="w-full h-full object-cover snap-center shrink-0" />
            ))}
          </div>
        ) : (
          <img src={banners[0]} alt={store.name} className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 md:px-8 pb-8 text-white">
          {store.trusted && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 text-[#1A2B4C] text-xs font-semibold mb-3">
              <ShieldCheck size={12} className="text-[#4F7363]" /> Trusted Store
            </div>
          )}
          <h1 data-testid="store-name" className="display text-4xl md:text-6xl font-bold leading-[1.0]">{store.name}</h1>
          {store.tagline && <p className="text-white/80 mt-2 max-w-xl">{store.tagline}</p>}
          <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1.5"><Bike size={14} className="text-[#E68910]" /> {etaFromDistance(store.distance_km || store.eta_min)}</span>
            <span className="flex items-center gap-1.5"><MapPin size={14} className="text-[#E68910]" /> {areaFromAddress(store)}</span>
            {store.timing && <span className="flex items-center gap-1.5"><Clock size={14} className="text-[#E68910]" /> {store.timing}</span>}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-3 gap-10">
        <aside className="space-y-5">
          {store.story && (
            <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
              <h3 className="display text-xl font-bold text-[#1A2B4C] mb-2">The Story</h3>
              <p className="text-sm text-[#595959] leading-relaxed">{store.story}</p>
            </div>
          )}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] text-sm">
            <h3 className="display text-xl font-bold text-[#1A2B4C] mb-3">Delivery</h3>
            <div className="space-y-2 text-[#595959]">
              <div className="flex items-center gap-2"><Bike size={14} className="text-[#E68910]" /> ETA {etaFromDistance(store.distance_km)}</div>
              <div className="flex items-center gap-2"><MapPin size={14} className="text-[#E68910]" /> {areaFromAddress(store)} · {store.city || "Bhilai"}</div>
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#4F7363]" /> Try-at-doorstep available</div>
            </div>
          </div>
        </aside>
        <div className="md:col-span-2">
          <h2 className="display text-3xl font-bold text-[#1A2B4C] mb-6">From this store ({products.length})</h2>
          {products.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <p className="text-sm text-[#595959]">This store hasn't listed any products yet — drop back soon.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
              {products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
