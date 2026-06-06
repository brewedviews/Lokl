import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bike, MapPin, ShieldCheck, Clock, ChevronRight } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";

function etaFromDistance(km) {
  if (!km && km !== 0) return "30-45 min";
  const min = Math.max(15, Math.round(20 + Number(km) * 4));
  return `${min} min`;
}

// Pull "Sector 10" / "Civic Centre" etc. out of the stored business_address
function areaFromAddress(s) {
  return s.area || (s.address || "").split(",")[0].trim() || s.locality || s.city || "Bhilai";
}

// Mobile-only compact info chip — fixed slim height so two of these fit side-by-side
// right under the cover image, keeping the product grid above the fold on phones.
function InfoChip({ icon: Icon, label, value, accent = false, onClick, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="flex-1 min-w-0 bg-white rounded-xl border border-[#E5E2DC] px-3 py-2.5 text-left flex items-center gap-2 active:bg-[#FAF8F2] transition"
    >
      <div className={`w-8 h-8 shrink-0 rounded-lg grid place-items-center ${accent ? "bg-[#E68910]/10 text-[#E68910]" : "bg-[#0A1F5C]/8 text-[#0A1F5C]"}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-[#64748B] leading-tight">{label}</div>
        <div className="text-xs font-semibold text-[#0A1F5C] truncate">{value}</div>
      </div>
      <ChevronRight size={14} className="text-[#94A3B8] shrink-0" />
    </button>
  );
}

// Bottom-sheet style modal (mobile) / centered modal (desktop) for full story / delivery info
function InfoSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" data-testid="store-info-sheet">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold text-[#0A1F5C]">{title}</h3>
          <button onClick={onClose} className="text-[#64748B] text-2xl leading-none -mt-1" data-testid="store-info-sheet-close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function StorePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [sheet, setSheet] = useState(null); // 'story' | 'delivery' | null
  useEffect(() => { api.get(`/stores/${id}`).then((r) => setData(r.data)); }, [id]);
  // Remember the most recently visited store id — used by ProductDetail to keep
  // store-context across refreshes ("More from {store}" instead of generic
  // "You might also love").
  useEffect(() => { try { if (data?.store?.id) sessionStorage.setItem("lokl_last_store_id", data.store.id); } catch {} }, [data]);

  if (!data) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center">Loading…</div></div>;
  const { store, products } = data;
  const banners = (store.banners && store.banners.length > 0) ? store.banners : [store.banner].filter(Boolean);
  const eta = etaFromDistance(store.distance_km || store.eta_min);
  const area = areaFromAddress(store);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      {/* Cover — shorter on mobile so products show above the fold */}
      <div className="relative h-[28vh] sm:h-[45vh] md:h-[55vh] overflow-hidden bg-[#1A2B4C]">
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
        <div className="absolute bottom-0 left-0 right-0 max-w-7xl mx-auto px-4 md:px-8 pb-4 sm:pb-8 text-white">
          {store.trusted && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/90 text-[#1A2B4C] text-[10px] sm:text-xs font-semibold mb-2 sm:mb-3">
              <ShieldCheck size={11} className="text-[#4F7363]" /> Trusted Store
            </div>
          )}
          <h1 data-testid="store-name" className="font-display text-2xl sm:text-4xl md:text-6xl font-bold leading-[1.05]">{store.name}</h1>
          {store.tagline && <p className="text-white/80 mt-1 sm:mt-2 max-w-xl text-xs sm:text-base line-clamp-1 sm:line-clamp-none">{store.tagline}</p>}
        </div>
      </div>

      {/* Mobile-only: two compact info chips side-by-side — replaces the tall aside cards. */}
      <div className="md:hidden -mt-3 relative z-10 px-4">
        <div className="flex gap-2.5">
          {store.story && (
            <InfoChip
              icon={ShieldCheck}
              label="The Story"
              value={store.tagline || `About ${store.name}`}
              onClick={() => setSheet("story")}
              testid="chip-story"
            />
          )}
          <InfoChip
            icon={Bike}
            label="Delivery"
            value={`${eta} · ${area}`}
            accent
            onClick={() => setSheet("delivery")}
            testid="chip-delivery"
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-5 sm:pt-10 pb-10 grid md:grid-cols-3 md:gap-10">
        {/* Desktop-only aside — unchanged tall cards */}
        <aside className="hidden md:block space-y-5">
          {store.story && (
            <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
              <h3 className="font-display text-xl font-bold text-[#1A2B4C] mb-2">The Story</h3>
              <p className="text-sm text-[#595959] leading-relaxed">{store.story}</p>
            </div>
          )}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] text-sm">
            <h3 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Delivery</h3>
            <div className="space-y-2 text-[#595959]">
              <div className="flex items-center gap-2"><Bike size={14} className="text-[#E68910]" /> ETA {eta}</div>
              <div className="flex items-center gap-2"><MapPin size={14} className="text-[#E68910]" /> {area} · {store.city || "Bhilai"}</div>
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#4F7363]" /> Try-at-doorstep available</div>
            </div>
          </div>
        </aside>

        <div className="md:col-span-2">
          <h2 className="font-display text-xl sm:text-3xl font-bold text-[#1A2B4C] mb-3 sm:mb-6">From this store ({products.length})</h2>
          {products.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-8 sm:p-12 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E68910]/10 text-[#E68910] text-[11px] font-bold uppercase tracking-widest mb-3">Building it</div>
              <p className="text-sm text-[#595959]">This store hasn't listed any products yet — drop back soon.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              {products.map((p) => (
                <ProductCardV2
                  key={p.id}
                  p={{ ...p, store_name: store.name }}
                  compact
                  linkState={{ fromStore: store.id }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <InfoSheet open={sheet === "story"} onClose={() => setSheet(null)} title="The Story">
        <p className="text-sm text-[#595959] leading-relaxed whitespace-pre-line">{store.story}</p>
      </InfoSheet>
      <InfoSheet open={sheet === "delivery"} onClose={() => setSheet(null)} title="Delivery">
        <div className="space-y-3 text-sm text-[#595959]">
          <div className="flex items-center gap-2"><Bike size={15} className="text-[#E68910]" /> Estimated arrival: <b className="text-[#0A1F5C]">{eta}</b></div>
          <div className="flex items-center gap-2"><MapPin size={15} className="text-[#E68910]" /> {area} · {store.city || "Bhilai"}</div>
          <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#4F7363]" /> Try-at-doorstep available</div>
          {store.timing && <div className="flex items-center gap-2"><Clock size={15} className="text-[#E68910]" /> {store.timing}</div>}
        </div>
      </InfoSheet>

      <Footer />
    </div>
  );
}
