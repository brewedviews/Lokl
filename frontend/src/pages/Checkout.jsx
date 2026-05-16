import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Wallet, Banknote } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";
import { useCart } from "../contexts/CartContext";
import { toast } from "sonner";

export default function Checkout() {
  const { items, total, clear } = useCart();
  const nav = useNavigate();
  const [addr, setAddr] = useState({ name: "", phone: "", line1: "", city: "Jaipur", pincode: "" });
  const [payment, setPayment] = useState("UPI");
  const [placing, setPlacing] = useState(false);

  const place = async () => {
    if (!addr.name || !addr.phone || !addr.line1 || !addr.pincode) return toast.error("Please fill address");
    if (items.length === 0) return toast.error("Cart is empty");
    setPlacing(true);
    try {
      const { data } = await api.post("/orders", {
        items, address: addr, total, payment_method: payment,
        customer: { name: addr.name, phone: addr.phone },
      });
      localStorage.setItem("bf_customer_phone", addr.phone);
      clear();
      toast.success("Order confirmed!");
      nav(`/orders/${data.id}`);
    } catch (e) {
      toast.error("Order failed");
    } finally { setPlacing(false); }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="display text-2xl font-bold text-[#1A2B4C] mb-4">Delivery address</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <input data-testid="addr-name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder="Full name" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} placeholder="Phone" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="House no, street, locality" className="md:col-span-2 px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-city" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-pin" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} placeholder="Pincode" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="display text-2xl font-bold text-[#1A2B4C] mb-4">Payment</h2>
            <div className="grid grid-cols-3 gap-3">
              {[{ k: "UPI", i: Wallet }, { k: "Card", i: CreditCard }, { k: "COD", i: Banknote }].map(({ k, i: Icon }) => (
                <button key={k} onClick={() => setPayment(k)} data-testid={`pay-${k.toLowerCase()}`}
                  className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition ${payment === k ? "border-[#1A2B4C] bg-[#1A2B4C]/5" : "border-[#E5E2DC]"}`}>
                  <Icon size={20} className={payment === k ? "text-[#E68910]" : "text-[#595959]"} />
                  <span className="font-semibold text-sm">{k}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-[#595959] mt-3">Demo mode · payments are simulated for this preview.</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] h-fit">
          <h3 className="display text-xl font-bold text-[#1A2B4C] mb-3">Bag ({items.length})</h3>
          <div className="space-y-3 max-h-72 overflow-auto">
            {items.map((it) => (
              <div key={it.key} className="flex gap-3 text-sm">
                <img src={it.image} alt={it.name} className="w-14 h-16 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[#1A2B4C] truncate">{it.name}</div>
                  <div className="text-xs text-[#595959]">Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
                </div>
                <div className="font-semibold">₹{(it.price * it.qty).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-[#E5E2DC] mt-4 pt-4 flex justify-between font-bold">
            <span>Total</span><span className="text-[#1A2B4C]">₹{total.toLocaleString()}</span>
          </div>
          <button onClick={place} disabled={placing} data-testid="place-order-btn" className="w-full mt-5 px-6 py-3.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] disabled:opacity-50 transition">
            {placing ? "Placing…" : "Place order"}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
