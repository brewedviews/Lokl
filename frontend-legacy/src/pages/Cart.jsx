import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash2, ShoppingBag, Bike } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import DiscoveryRails from "../components/consumer/DiscoveryRails";
import { useCart } from "../contexts/CartContext";

export default function Cart() {
  const { items, remove, updateQty, total } = useCart();
  const nav = useNavigate();

  // Empty state — mirror the Wishlist empty page: friendly card + the same
  // discovery rails (Offers / Trending / Selling fast / Recently added).
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <ConsumerHeader />
        <main className="flex-1">
          <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-8" data-testid="cart-header">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#E68910]/10 grid place-items-center">
                <ShoppingBag size={20} className="text-[#E68910]" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight">Your bag</h1>
                <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Items you add will appear here.</p>
              </div>
            </div>
          </section>
          <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-6" data-testid="cart-empty">
            <div className="bg-white border border-dashed border-[#E5E2DC] rounded-3xl p-6 sm:p-8 text-center">
              <ShoppingBag size={28} className="text-[#94A3B8] mx-auto mb-2" />
              <div className="text-base sm:text-lg font-display font-bold text-[#0A1F5C]">Your bag is empty</div>
              <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                Add items from your nearby Bhilai stores below — or jump straight to discovery.
              </p>
              <Link to="/" data-testid="empty-cart-cta" className="inline-block mt-4 px-6 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#0F1D38] transition">
                Start shopping
              </Link>
            </div>
          </section>
          <DiscoveryRails testidPrefix="cart" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <h1 className="display text-4xl font-bold text-[#1A2B4C]">Your bag</h1>
        {items.length === 0 ? null : (
          <div className="grid md:grid-cols-3 gap-8 mt-8">
            <div className="md:col-span-2 space-y-4">
              {items.map((it) => (
                <div key={it.key} data-testid={`cart-item-${it.id}`} className="flex gap-4 p-4 bg-white rounded-2xl border border-[#E5E2DC]">
                  <img src={it.image} alt={it.name} className="w-24 h-32 object-cover rounded-xl" />
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-[#595959]">{it.store_name}</div>
                    <h3 className="font-semibold text-[#1A2B4C]">{it.name}</h3>
                    {it.size && <div className="text-xs text-[#595959] mt-1">Size: {it.size}</div>}
                    <div className="flex items-center gap-1 text-xs text-[#E68910] mt-1"><Bike size={11} /> {it.store_eta_min} min</div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(it.key, it.qty - 1)} className="w-7 h-7 rounded-full border border-[#E5E2DC]">−</button>
                        <span className="font-semibold w-6 text-center">{it.qty}</span>
                        <button onClick={() => updateQty(it.key, it.qty + 1)} className="w-7 h-7 rounded-full border border-[#E5E2DC]">+</button>
                      </div>
                      <div className="font-bold text-[#1A2B4C]">₹{(it.price * it.qty).toLocaleString()}</div>
                    </div>
                  </div>
                  <button onClick={() => remove(it.key)} data-testid={`cart-remove-${it.id}`} className="text-[#595959] hover:text-red-500"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] h-fit sticky top-24">
              <h3 className="display text-xl font-bold text-[#1A2B4C] mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[#595959]">Subtotal</span><span>₹{total.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-[#595959]">Delivery</span><span className="text-[#4F7363]">FREE</span></div>
                <div className="border-t border-[#E5E2DC] my-3"></div>
                <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="text-[#1A2B4C]">₹{total.toLocaleString()}</span></div>
              </div>
              <button onClick={() => nav("/checkout")} data-testid="checkout-btn" className="w-full mt-6 px-6 py-3.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] transition">
                Checkout
              </button>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
