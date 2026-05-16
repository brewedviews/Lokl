import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Star, Bike, MapPin, ShieldCheck, Clock, Instagram } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";

export default function StorePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/stores/${id}`).then((r) => setData(r.data)); }, [id]);

  if (!data) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center">Loading…</div></div>;
  const { store, products } = data;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="relative h-[55vh] md:h-[60vh] overflow-hidden">
        <img src={store.banner} alt={store.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 md:px-8 pb-10 text-white">
          {store.trusted && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 text-[#1A2B4C] text-xs font-semibold mb-4">
              <ShieldCheck size={12} className="text-[#4F7363]" /> Trusted Boutique
            </div>
          )}
          <h1 data-testid="store-name" className="display text-5xl md:text-7xl font-bold leading-[0.95]">{store.name}</h1>
          <p className="text-white/80 mt-3 max-w-xl">{store.tagline}</p>
          <div className="flex flex-wrap items-center gap-4 mt-5 text-sm">
            <span className="flex items-center gap-1.5"><Star size={14} className="fill-[#E68910] text-[#E68910]" />{store.rating} · {store.reviews} reviews</span>
            <span className="flex items-center gap-1.5"><Bike size={14} /> {store.eta_min} min</span>
            <span className="flex items-center gap-1.5"><MapPin size={14} /> {store.locality}, {store.city}</span>
            <span className="flex items-center gap-1.5"><Clock size={14} /> {store.timing}</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-3 gap-10">
        <aside className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h3 className="display text-xl font-bold text-[#1A2B4C] mb-2">The Story</h3>
            <p className="text-sm text-[#595959] leading-relaxed">{store.story}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h3 className="display text-xl font-bold text-[#1A2B4C] mb-3">Specialties</h3>
            <div className="flex flex-wrap gap-2">
              {store.specialties?.map((s) => (
                <span key={s} className="px-3 py-1 rounded-full bg-[#E68910]/10 text-[#E68910] text-xs font-semibold">{s}</span>
              ))}
            </div>
          </div>
          <a href="#" className="flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-[#1A2B4C] text-[#1A2B4C] font-semibold hover:bg-[#1A2B4C] hover:text-white transition">
            <Instagram size={16} /> Follow boutique
          </a>
        </aside>
        <div className="md:col-span-2">
          <h2 className="display text-3xl font-bold text-[#1A2B4C] mb-6">From this boutique ({products.length})</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
