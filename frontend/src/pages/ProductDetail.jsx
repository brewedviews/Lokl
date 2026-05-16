import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Star, Bike, MapPin, ShieldCheck, Heart, ShoppingBag, Sparkles, Truck, RefreshCw } from "lucide-react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import ProductCard from "../components/consumer/ProductCard";
import { useCart } from "../contexts/CartContext";
import { toast } from "sonner";

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { add } = useCart();
  const [data, setData] = useState(null);
  const [size, setSize] = useState(null);

  useEffect(() => {
    api.get(`/products/${id}`).then((r) => {
      setData(r.data);
      setSize(r.data.product.sizes?.[0] || null);
    });
  }, [id]);

  if (!data) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center text-[#595959]">Loading…</div></div>;

  const { product, similar } = data;
  const discount = product.mrp ? Math.round((1 - product.price / product.mrp) * 100) : 0;

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
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-2 gap-10">
        <div data-testid="pdp-image" className="relative rounded-3xl overflow-hidden bg-white">
          <img src={product.image} alt={product.name} className="w-full aspect-[4/5] object-cover" />
          {product.ai_enhanced && (
            <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold flex items-center gap-1.5">
              <Sparkles size={12} className="text-[#E68910]" /> AI Enhanced
            </div>
          )}
        </div>

        <div data-testid="pdp-info">
          <div className="text-xs uppercase tracking-widest text-[#595959]">{product.store_name}</div>
          <h1 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C] mt-2 leading-tight">{product.name}</h1>

          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1"><Star size={14} className="fill-[#E68910] text-[#E68910]" />{product.rating}</span>
            <span className="flex items-center gap-1 text-[#595959]"><Bike size={14} /> {product.store_eta_min} min</span>
            <span className="flex items-center gap-1 text-[#595959]"><MapPin size={14} /> {product.store_distance_km} km</span>
            <span className="flex items-center gap-1 text-[#4F7363]"><ShieldCheck size={14} /> Trusted</span>
          </div>

          <div className="flex items-end gap-3 mt-6">
            <span className="display text-4xl font-bold text-[#1A2B4C]">₹{product.price.toLocaleString()}</span>
            {product.mrp && (
              <>
                <span className="text-lg text-[#595959] line-through">₹{product.mrp.toLocaleString()}</span>
                <span className="text-sm font-semibold text-[#4F7363]">{discount}% off</span>
              </>
            )}
          </div>
          <p className="text-xs text-[#595959] mt-1">Inclusive of all taxes</p>

          <p className="mt-6 text-[#1C1C1C] leading-relaxed">{product.description}</p>

          {product.sizes?.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-[#1A2B4C]">Select size</h4>
                <span className="text-xs text-[#E68910]">Try-at-doorstep available</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((s) => (
                  <button key={s} onClick={() => setSize(s)} data-testid={`size-${s}`}
                    className={`min-w-12 px-4 py-2.5 rounded-full text-sm font-semibold border transition ${size === s ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white border-[#E5E2DC] hover:border-[#1A2B4C]"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex gap-3">
            <button onClick={handleAdd} data-testid="add-to-bag" className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full border-2 border-[#1A2B4C] text-[#1A2B4C] font-semibold hover:bg-[#1A2B4C] hover:text-white transition">
              <ShoppingBag size={18} /> Add to bag
            </button>
            <button onClick={handleBuy} data-testid="buy-now" className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] transition">
              Buy now
            </button>
            <button className="w-14 h-14 rounded-full bg-white border border-[#E5E2DC] flex items-center justify-center hover:border-[#1A2B4C] transition">
              <Heart size={18} />
            </button>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-3 text-xs">
            <div className="p-4 rounded-2xl bg-white border border-[#E5E2DC]">
              <Truck size={18} className="text-[#E68910] mb-2" />
              <div className="font-semibold">Fast delivery</div>
              <div className="text-[#595959]">{product.store_eta_min} min</div>
            </div>
            <div className="p-4 rounded-2xl bg-white border border-[#E5E2DC]">
              <RefreshCw size={18} className="text-[#E68910] mb-2" />
              <div className="font-semibold">Easy returns</div>
              <div className="text-[#595959]">7-day exchange</div>
            </div>
            <div className="p-4 rounded-2xl bg-white border border-[#E5E2DC]">
              <ShieldCheck size={18} className="text-[#4F7363] mb-2" />
              <div className="font-semibold">Trusted store</div>
              <div className="text-[#595959]">Verified merchant</div>
            </div>
          </div>
        </div>
      </div>

      {similar?.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 md:px-8 mt-16">
          <h2 className="display text-3xl font-bold text-[#1A2B4C] mb-6">You might also love</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {similar.slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}
