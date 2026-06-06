import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { Star, Bike, MapPin, ShieldCheck, Heart, ShoppingBag, Sparkles, Truck, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCardV2 from "../components/consumer/v2/ProductCardV2";
import { useCart } from "../contexts/CartContext";
import { toast } from "sonner";

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { add } = useCart();
  const [data, setData] = useState(null);
  const [size, setSize] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [storeContext, setStoreContext] = useState(null); // { id, name, products }

  // The user is in store-context if either:
  //  - they navigated from a store page (state.fromStore set on the Link), or
  //  - they refreshed and the last-visited store id in sessionStorage matches
  //    the current product's store_id.
  const fromStoreId = location.state?.fromStore || null;

  useEffect(() => {
    // Reset to a clean state every time the route id changes — including scroll
    // position. This is what makes related-product clicks feel like a fresh PDP.
    window.scrollTo({ top: 0, behavior: "auto" });
    setData(null); setSize(null); setImgIdx(0); setStoreContext(null);
    api.get(`/products/${id}`).then((r) => {
      setData(r.data);
      setSize(r.data.product.sizes?.[0] || null);
      // Resolve store-context: if state says fromStore (and matches the product),
      // OR sessionStorage marker matches the product's store, fetch that store's
      // products for the "More from {store}" section.
      const pStoreId = r.data.product?.store_id;
      const sessionStoreId = (() => {
        try { return sessionStorage.getItem("lokl_last_store_id"); } catch { return null; }
      })();
      const matchStore = (fromStoreId && pStoreId === fromStoreId) || (sessionStoreId && pStoreId === sessionStoreId);
      if (matchStore && pStoreId) {
        api.get(`/stores/${pStoreId}`).then((sr) => {
          const others = (sr.data?.products || []).filter((x) => x.id !== r.data.product.id).slice(0, 6);
          if (others.length > 0) {
            setStoreContext({ id: pStoreId, name: sr.data.store?.name || r.data.product.store_name, products: others });
          }
        }).catch(() => {});
      }
    });
  }, [id, fromStoreId]);

  if (!data) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center text-[#595959]">Loading…</div></div>;

  const { product, similar } = data;
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const images = (product.images && product.images.length > 0) ? product.images : [product.image].filter(Boolean);

  const handleAdd = () => {
    if (product.sizes?.length && !size) return toast.error("Please pick a size");
    add(product, size);
    toast.success("Added to bag");
  };

  const handleBuy = () => {
    if (product.sizes?.length && !size) return toast.error("Please pick a size");
    add(product, size);
    nav("/checkout");
  };

  return (
    <div className="min-h-screen bg-white">
      <ConsumerHeader />
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10 grid md:grid-cols-2 gap-6 md:gap-10">
        <div data-testid="pdp-image" className="relative rounded-2xl overflow-hidden bg-slate-100">
          {images[imgIdx] ? (
            <img src={images[imgIdx]} alt={product.name} className="w-full aspect-[4/5] object-cover" />
          ) : (
            <div className="w-full aspect-[4/5] flex flex-col items-center justify-center text-[#94A3B8] text-sm">
              <ShoppingBag size={36} className="mb-2 opacity-50" />
              <span>Image coming soon</span>
            </div>
          )}
          {images.length > 1 && (
            <>
              <button onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-white" aria-label="Previous image"><ChevronLeft size={18} /></button>
              <button onClick={() => setImgIdx((i) => (i + 1) % images.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-white" aria-label="Next image"><ChevronRight size={18} /></button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {images.map((_, i) => (
                  <button key={i} onClick={() => setImgIdx(i)} className={`w-2 h-2 rounded-full transition ${i === imgIdx ? "bg-[#0A1F5C] w-5" : "bg-white/80 border border-[#0A1F5C]/30"}`} aria-label={`Go to image ${i + 1}`} />
                ))}
              </div>
            </>
          )}
          {product.ai_enhanced && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[11px] font-semibold flex items-center gap-1.5">
              <Sparkles size={11} className="text-[#F59E0B]" /> AI Enhanced
            </div>
          )}
        </div>

        <div data-testid="pdp-info">
          {product.store_id ? (
            <Link to={`/store/${product.store_id}`} data-testid="store-name-link" className="text-[11px] uppercase tracking-widest font-bold text-[#F59E0B] hover:underline">
              {product.store_name}
            </Link>
          ) : (
            <div className="text-[11px] uppercase tracking-widest text-[#64748B]">{product.store_name}</div>
          )}
          <h1 className="font-display text-2xl md:text-3xl font-bold text-[#0A1F5C] mt-2 leading-tight">{product.name}</h1>

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

          {product.sizes?.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-sm font-semibold text-[#0A1F5C]">Select size</h4>
                <span className="text-[11px] font-bold text-[#F59E0B]">Try-at-doorstep available</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((s) => (
                  <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                    className={`min-w-11 px-3.5 py-2 rounded-full text-sm font-semibold border transition ${size === s ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white border-slate-200 hover:border-[#0A1F5C]"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <button onClick={handleAdd} data-testid="add-to-bag" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full border-2 border-[#0A1F5C] text-[#0A1F5C] text-sm font-bold hover:bg-[#0A1F5C] hover:text-white transition whitespace-nowrap">
              <ShoppingBag size={16} /> Add to bag
            </button>
            <button onClick={handleBuy} data-testid="buy-now" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-full bg-[#F59E0B] text-white text-sm font-bold hover:bg-[#cc7a0a] transition whitespace-nowrap">
              Buy now
            </button>
            <button aria-label="Wishlist" className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:border-[#0A1F5C] transition shrink-0">
              <Heart size={16} />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2 text-[11px]">
            <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-slate-100">
              <Truck size={16} className="text-[#F59E0B] mb-1.5" />
              <div className="font-semibold">Fast delivery</div>
              <div className="text-[#64748B]">{product.store_eta_min || 45} min</div>
            </div>
            <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-slate-100">
              <RefreshCw size={16} className="text-[#F59E0B] mb-1.5" />
              <div className="font-semibold">Easy returns</div>
              <div className="text-[#64748B]">7-day exchange</div>
            </div>
            <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-slate-100">
              <ShieldCheck size={16} className="text-[#10B981] mb-1.5" />
              <div className="font-semibold">Trusted store</div>
              <div className="text-[#64748B]">Verified merchant</div>
            </div>
          </div>
        </div>
      </div>

      {storeContext ? (
        <section className="max-w-6xl mx-auto px-4 md:px-8 mt-10 md:mt-14" data-testid="more-from-store">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-[#0A1F5C] mb-5">
            More from <Link to={`/store/${storeContext.id}`} className="text-[#E68910] hover:underline">{storeContext.name}</Link>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {storeContext.products.slice(0, 4).map((p) => (
              <ProductCardV2
                key={p.id}
                p={{ ...p, store_name: storeContext.name }}
                compact
                linkState={{ fromStore: storeContext.id }}
              />
            ))}
          </div>
        </section>
      ) : similar?.length > 0 ? (
        <section className="max-w-6xl mx-auto px-4 md:px-8 mt-10 md:mt-14" data-testid="similar-products">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-[#0A1F5C] mb-5">You might also love</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {similar.slice(0, 4).map((p) => <ProductCardV2 key={p.id} p={p} />)}
          </div>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}
