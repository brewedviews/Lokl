import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash2, ShoppingBag, Bike } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import { useCart } from "../contexts/CartContext";

export default function Cart() {
  const { items, remove, updateQty, total } = useCart();
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <h1 className="display text-4xl font-bold text-[#1A2B4C]">Your bag</h1>
        {items.length === 0 ? (
          <div className="mt-12 text-center py-20 bg-white rounded-2xl border border-[#E5E2DC]">
            <ShoppingBag size={48} className="mx-auto text-[#E68910] mb-4" />
            <p className="text-[#595959]">Your bag is empty</p>
            <Link to="/" data-testid="empty-cart-cta" className="inline-block mt-6 px-6 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold hover:bg-[#0F1D38] transition">Start shopping</Link>
          </div>
        ) : (
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
