"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Trash2, ShoppingBag, Bike, AlertTriangle } from "lucide-react";
import { useCartStore } from "@/stores";
import { apiClient } from "@/lib/api-client";
import { DiscoveryRails } from "@/components/consumer/DiscoveryRails";
import { Footer } from "@/components/consumer/Footer";

interface StoreAvailStatus {
  can_order: boolean;
  badge: string;
  eta_message: string;
  opens_at_label?: string | null;
}

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const total = useCartStore((s) => s.getTotal());
  const [storeStatuses, setStoreStatuses] = useState<Record<string, StoreAvailStatus>>({});

  useEffect(() => {
    const uniqueStoreIds = [...new Set(items.map((i) => i.store_id).filter(Boolean))];
    if (uniqueStoreIds.length === 0) return;
    Promise.all(
      uniqueStoreIds.map((sid) =>
        apiClient.get<{ store: { badge?: string; is_open?: boolean; eta_message?: string; next_open_label?: string } }>(
          `/api/stores/${sid}`
        ).then((r) => {
          const s = r.data.store;
          return [sid, {
            can_order: s.is_open !== false,
            badge: s.badge ?? (s.is_open === false ? "Closed" : "LIVE"),
            eta_message: s.eta_message ?? "",
            opens_at_label: s.next_open_label ?? null,
          }] as [string, StoreAvailStatus];
        }).catch(() => [sid, { can_order: false, badge: "Unavailable", eta_message: "Store unavailable", opens_at_label: null }] as [string, StoreAvailStatus])
      )
    ).then((entries) => setStoreStatuses(Object.fromEntries(entries)));
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
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
              <Link href="/" data-testid="empty-cart-cta" className="inline-block mt-4 px-6 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#0F1D38] transition">
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

  const anyUnavailable = items.some((it) => {
    if (!it.store_id) return false;
    const status = storeStatuses[it.store_id];
    return status !== undefined && !status.can_order;
  });

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <div className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-8 py-10">
        <h1 className="font-display text-4xl font-bold text-[#0A1F5C]">Your bag</h1>
        <div className="grid md:grid-cols-3 gap-8 mt-8">
          <div className="md:col-span-2 space-y-4">
            {items.map((it) => {
              const storeStatus = it.store_id ? storeStatuses[it.store_id] : undefined;
              const itemUnavailable = storeStatus && !storeStatus.can_order;
              return (
              <div key={it.key} data-testid={`cart-item-${it.id}`} className={`flex gap-4 p-4 bg-white rounded-2xl border ${itemUnavailable ? "border-red-200 bg-red-50/30" : "border-[#E5E2DC]"}`}>
                {it.image ? (
                  <Image src={it.image} alt={it.name} width={96} height={128} className="w-24 h-32 object-cover rounded-xl" />
                ) : <div className="w-24 h-32 rounded-xl bg-slate-100" />}
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wider text-[#595959]">{it.store_name}</div>
                  <h3 className="font-semibold text-[#0A1F5C]">{it.name}</h3>
                  {it.size && <div className="text-xs text-[#595959] mt-1">Size: {it.size}</div>}
                  <div className="flex items-center gap-1 text-xs text-[#E68910] mt-1"><Bike size={11} /> Fast delivery</div>
                  {storeStatus?.badge === "Away" && (
                    <div className="text-xs text-amber-600 mt-0.5 font-semibold">May be delayed today</div>
                  )}
                  {storeStatus?.badge === "Closed" && storeStatus.opens_at_label && (
                    <div className="text-xs text-[#64748B] mt-0.5 font-semibold">Available from {storeStatus.opens_at_label.replace(/^Opens\s+(at\s+)?/i, "")}</div>
                  )}
                  {storeStatus?.badge === "Unavailable" && (
                    <div className="text-xs text-red-500 mt-0.5 font-semibold">Store unavailable</div>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(it.id, it.size ?? "", it.qty - 1)} className="w-7 h-7 rounded-full border border-[#E5E2DC]">−</button>
                      <span className="font-semibold w-6 text-center">{it.qty}</span>
                      <button onClick={() => updateQty(it.id, it.size ?? "", it.qty + 1)} className="w-7 h-7 rounded-full border border-[#E5E2DC]">+</button>
                    </div>
                    <div className="font-bold text-[#0A1F5C]">₹{(it.price * it.qty).toLocaleString()}</div>
                  </div>
                </div>
                <button onClick={() => removeItem(it.id, it.size ?? "")} data-testid={`cart-remove-${it.id}`} className="text-[#595959] hover:text-red-500"><Trash2 size={16} /></button>
              </div>
              );
            })}
          </div>
          <div className="bg-white rounded-2xl p-6 border border-[#E5E2DC] h-fit sticky top-24">
            <h3 className="font-display text-xl font-bold text-[#0A1F5C] mb-4">Order Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[#595959]">Subtotal</span><span>₹{total.toLocaleString()}</span></div>
              <div className="border-t border-[#E5E2DC] my-3"></div>
              <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="text-[#0A1F5C]">₹{total.toLocaleString()}</span></div>
            </div>
            {anyUnavailable && (
              <div className="mt-4 flex items-center gap-2 text-xs text-red-600 font-semibold">
                <AlertTriangle size={13} /> Some stores are unavailable. Remove those items to continue.
              </div>
            )}
            <button
              onClick={() => !anyUnavailable && router.push("/checkout")}
              data-testid="checkout-btn"
              disabled={anyUnavailable}
              className={`w-full mt-4 px-6 py-3.5 rounded-full font-semibold transition ${anyUnavailable ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-[#E68910] text-white hover:bg-[#C9770E]"}`}
            >
              Checkout
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
