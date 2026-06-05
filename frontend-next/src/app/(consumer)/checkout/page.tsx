"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CreditCard, Wallet, Banknote, MapPin, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useCartStore, useCustomerAuthStore } from "@/stores";
import { CustomerOtpLogin } from "@/components/consumer/CustomerOtpLogin";
import { Footer } from "@/components/consumer/Footer";
import type { CustomerAddress, PaymentMethod } from "@/types";

const BLANK_ADDR = { name: "", phone: "", line1: "", landmark: "", city: "Bhilai", pincode: "", label: "Home" };

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.getTotal());
  const clearCart = useCartStore((s) => s.clearCart);
  const phone = useCustomerAuthStore((s) => s.phone);
  const hasAuth = useCustomerAuthStore((s) => s.isAuthenticated);

  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedId, setSelectedId] = useState("__new__");
  const [addr, setAddr] = useState({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" });
  const [payment, setPayment] = useState<PaymentMethod>("UPI");
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (!hasAuth || !phone) return;
    api.customers.get(phone).then(({ customer }) => {
      const list: CustomerAddress[] = customer?.addresses ?? [];
      setSavedAddresses(list);
      if (list.length > 0) {
        const first = list[0]!;
        setSelectedId(first.id);
        setAddr({
          name: first.name || customer.name || "",
          phone: first.phone || phone.slice(-10),
          line1: first.line1 || "",
          landmark: first.landmark || "",
          city: first.city || "Bhilai",
          pincode: first.pincode || "",
          label: first.label || "Home",
        });
      } else if (customer?.name) {
        setAddr((a) => ({ ...a, name: customer.name ?? "" }));
      }
    }).catch(() => {});
  }, [phone, hasAuth]);

  const pickSaved = (id: string) => {
    setSelectedId(id);
    if (id === "__new__") { setAddr({ ...BLANK_ADDR, phone: phone?.slice(-10) ?? "" }); return; }
    const a = savedAddresses.find((x) => x.id === id);
    if (a) setAddr({
      name: a.name || "", phone: a.phone || phone?.slice(-10) || "",
      line1: a.line1 || "", landmark: a.landmark || "",
      city: a.city || "Bhilai", pincode: a.pincode || "", label: a.label || "Home",
    });
  };

  const place = async () => {
    if (!addr.name || !addr.phone || !addr.line1 || !addr.pincode) return toast.error("Please fill name, phone, address and pincode");
    if (!/^[0-9]{10}$/.test(addr.phone)) return toast.error("Enter a valid 10-digit phone number");
    if ((addr.city || "").trim().toLowerCase() !== "bhilai") {
      return toast.error("Lokl is only serving Bhilai right now — please update your delivery city.");
    }
    if (items.length === 0) return toast.error("Cart is empty");
    if (!hasAuth) return toast.error("Please sign in to place this order");
    setPlacing(true);
    try {
      const order = await api.orders.create({
        items, address: addr, total, payment_method: payment,
        customer: { name: addr.name, phone: addr.phone },
      });
      clearCart();
      toast.success("Order confirmed!");
      router.push(`/orders/${order.id}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally { setPlacing(false); }
  };

  if (!hasAuth) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <div className="flex-1 max-w-md w-full mx-auto px-4 sm:px-8 pt-10 pb-16">
          <CustomerOtpLogin
            title="Sign in to checkout"
            subtitle="We use your number to deliver, send order updates, and process returns."
          />
        </div>
        <Footer />
      </div>
    );
  }

  const uniqueStores = Array.from(new Set(items.map((it) => it.store_name).filter(Boolean)));

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          {savedAddresses.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-[#E5E2DC]" data-testid="saved-addresses">
              <h3 className="text-[11px] uppercase tracking-widest text-[#595959] mb-3">Deliver to</h3>
              <div className="space-y-2">
                {savedAddresses.map((a) => (
                  <button key={a.id} type="button" data-testid={`pick-addr-${a.id}`} onClick={() => pickSaved(a.id)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition ${selectedId === a.id ? "border-[#1A2B4C] bg-[#1A2B4C]/5" : "border-[#E5E2DC] hover:border-[#1A2B4C]/40"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 text-sm">
                        <div className="font-semibold text-[#1A2B4C] flex items-center gap-2"><MapPin size={13} className="text-[#E68910]" />{a.label || "Home"} · {a.name || phone}</div>
                        <div className="text-[#595959] mt-0.5">{a.line1}</div>
                        {a.landmark && <div className="text-[11px] text-[#595959]">Landmark: {a.landmark}</div>}
                        <div className="text-[11px] text-[#595959]">{a.city || "Bhilai"} · {a.pincode}</div>
                      </div>
                      {selectedId === a.id && <CheckCircle2 size={16} className="text-[#E68910] shrink-0" />}
                    </div>
                  </button>
                ))}
                <button type="button" data-testid="pick-new-addr" onClick={() => pickSaved("__new__")}
                  className={`w-full text-left p-3 rounded-xl border-2 border-dashed flex items-center gap-2 transition ${selectedId === "__new__" ? "border-[#E68910] bg-[#E68910]/5 text-[#E68910]" : "border-[#E5E2DC] text-[#595959] hover:border-[#1A2B4C]/40"}`}>
                  <Plus size={14} /> <span className="text-sm font-semibold">Use a new address</span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">
              {selectedId === "__new__" ? "New delivery address" : "Address details"}
            </h2>
            <p className="text-xs text-[#595959] mb-4">Saved addresses appear in your account for one-tap checkout next time.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <input data-testid="addr-name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} placeholder="Full name" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <textarea data-testid="addr-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="House no, street, locality" rows={2} className="md:col-span-2 px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] resize-none" />
              <input data-testid="addr-landmark" value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} placeholder="Landmark (e.g. opposite SBI / near Globe Chowk)" className="md:col-span-2 px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-city" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City (Bhilai only)" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              <input data-testid="addr-pin" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Pincode" className="px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC]">
            <h2 className="font-display text-2xl font-bold text-[#1A2B4C] mb-4">Payment</h2>
            <div className="grid grid-cols-3 gap-3">
              {([{ k: "UPI", i: Wallet }, { k: "RAZORPAY", i: CreditCard }, { k: "COD", i: Banknote }] as const).map(({ k, i: Icon }) => (
                <button key={k} onClick={() => setPayment(k)} data-testid={`pay-${k.toLowerCase()}`}
                  className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition ${payment === k ? "border-[#1A2B4C] bg-[#1A2B4C]/5" : "border-[#E5E2DC]"}`}>
                  <Icon size={20} className={payment === k ? "text-[#E68910]" : "text-[#595959]"} />
                  <span className="font-semibold text-sm">{k === "RAZORPAY" ? "Card" : k}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-[#595959] mt-3">Demo mode · payments are simulated for this preview.</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] h-fit">
          <h3 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Bag ({items.length})</h3>
          {uniqueStores.length > 1 && (
            <div data-testid="multi-store-notice" className="mb-3 rounded-xl border border-[#E68910]/30 bg-[#E68910]/10 px-3 py-2 text-[12px] text-[#0A1F5C]">
              Your bag has items from <strong>{uniqueStores.length} stores</strong>. You&apos;ll pay once now and may receive
              <strong> {uniqueStores.length} separate deliveries</strong> — one from each store.
            </div>
          )}
          <div className="space-y-3 max-h-72 overflow-auto">
            {items.map((it) => (
              <div key={it.key} className="flex gap-3 text-sm">
                {it.image ? (
                  <Image src={it.image} alt={it.name} width={56} height={64} className="w-14 h-16 rounded-lg object-cover" />
                ) : <div className="w-14 h-16 rounded-lg bg-slate-100" />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[#1A2B4C] truncate">{it.name}</div>
                  <div className="text-xs text-[#595959]">{it.store_name ? `${it.store_name} · ` : ""}Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
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
