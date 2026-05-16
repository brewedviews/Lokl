import React, { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, XCircle, Bike, Phone, MapPin, Clock } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { toast } from "sonner";

// Inline beep so we don't need an audio file
const BEEP_DATA = "data:audio/wav;base64,UklGRiQEAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAEAACA/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+A/4D/";

export default function MerchantOrders() {
  const [orders, setOrders] = useState([]);
  const seenIds = useRef(new Set());
  const audioRef = useRef(null);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const load = async () => {
      try {
        const { data } = await api.get("/merchant/orders");
        // Detect new pending orders
        const news = data.filter((o) => o.status === "pending_merchant" && !seenIds.current.has(o.id));
        if (news.length > 0 && seenIds.current.size > 0) {
          news.forEach((o) => {
            if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}); }
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("New order on Bharat", { body: `${o.id} · ₹${o.total}` });
            }
            toast.success(`New order ${o.id}!`, { duration: 5000 });
          });
        }
        data.forEach((o) => seenIds.current.add(o.id));
        setOrders(data);
      } catch (e) { /* noop */ }
    };
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, []);

  const accept = async (id) => { await api.post(`/merchant/orders/${id}/accept`); toast.success("Order accepted"); refresh(); };
  const reject = async (id) => { await api.post(`/merchant/orders/${id}/reject`); toast.success("Order rejected"); refresh(); };
  const refresh = async () => { const { data } = await api.get("/merchant/orders"); setOrders(data); };

  const pending = orders.filter((o) => o.status === "pending_merchant");
  const history = orders.filter((o) => o.status !== "pending_merchant");

  return (
    <MerchantLayout>
      <audio ref={audioRef} src={BEEP_DATA} preload="auto" />
      <div className="p-6 md:p-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 data-testid="orders-title" className="display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2">
              <Bell size={24} className={pending.length ? "text-[#E68910] animate-pulse" : "text-[#595959]"} />
              Order requests
            </h1>
            <p className="text-[#595959] text-sm mt-1">{pending.length ? `${pending.length} pending — accept fast for happy customers!` : "No new orders right now."}</p>
          </div>
          {pending.length > 0 && <span className="px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold animate-pulse">{pending.length} NEW</span>}
        </div>

        <section className="space-y-3 mb-10">
          {pending.length === 0 ? (
            <div className="p-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl text-center text-sm text-[#595959]">
              You'll hear a ping here the moment a customer places an order.
            </div>
          ) : pending.map((o) => (
            <div key={o.id} data-testid={`order-${o.id}`} className="bg-white border-2 border-[#E68910] rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <div className="display text-lg font-bold text-[#1A2B4C]">{o.id}</div>
                  <div className="text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="display text-2xl font-bold text-[#4F7363]">₹{o.total.toLocaleString()}</div>
                  <div className="text-xs text-[#595959]">{o.payment_method}</div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div className="text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-[#595959]">Customer</div>
                  <div className="font-semibold flex items-center gap-1">{o.customer?.name || o.address?.name}</div>
                  <div className="flex items-center gap-1 text-xs text-[#595959]"><Phone size={11} /> {o.customer?.phone || o.address?.phone}</div>
                </div>
                <div className="text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-[#595959]">Delivery</div>
                  <div className="flex items-start gap-1 text-xs"><MapPin size={11} className="mt-0.5 shrink-0" /> {o.address?.line1}, {o.address?.city} - {o.address?.pincode}</div>
                </div>
              </div>
              <div className="space-y-1 mb-4 text-sm">
                {o.items.map((it, i) => (
                  <div key={i} className="flex justify-between"><span>{it.name} × {it.qty}{it.size ? ` (${it.size})` : ""}</span><span>₹{(it.price * it.qty).toLocaleString()}</span></div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => reject(o.id)} data-testid={`reject-${o.id}`} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-red-300 text-red-500 font-semibold hover:bg-red-50">
                  <XCircle size={14} /> Reject
                </button>
                <button onClick={() => accept(o.id)} data-testid={`accept-${o.id}`} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#4F7363] text-white font-semibold hover:bg-[#3a5a4d]">
                  <CheckCircle2 size={14} /> Accept order
                </button>
              </div>
            </div>
          ))}
        </section>

        {history.length > 0 && (
          <section>
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3">Order history</h2>
            <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                  <tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Total</th></tr>
                </thead>
                <tbody>
                  {history.map((o) => (
                    <tr key={o.id} className="border-t border-[#E5E2DC]">
                      <td className="px-4 py-2 font-semibold">{o.id}</td>
                      <td className="px-4 py-2 text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${o.status === "accepted" ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-red-100 text-red-500"}`}>{o.status}</span></td>
                      <td className="px-4 py-2 text-right font-semibold">₹{o.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </MerchantLayout>
  );
}
