import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Circle, Bike, Package } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";

export default function OrderTracking() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    api.get(`/orders/${id}`).then((r) => setOrder(r.data));
  }, [id]);

  if (!order) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <div className="bg-white rounded-3xl p-8 border border-[#E5E2DC] text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#4F7363]/10 flex items-center justify-center mb-4">
            <CheckCircle2 size={32} className="text-[#4F7363]" />
          </div>
          <h1 className="display text-3xl font-bold text-[#1A2B4C]">Order confirmed!</h1>
          <p className="text-[#595959] mt-2">Order ID: <span data-testid="order-id" className="font-semibold text-[#1A2B4C]">{order.id}</span></p>
          <div className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-full bg-[#E68910]/10 text-[#E68910] text-sm font-semibold">
            <Bike size={14} /> Arriving in 35-45 minutes
          </div>
        </div>

        <div className="mt-8 bg-white rounded-3xl p-8 border border-[#E5E2DC]">
          <h2 className="display text-xl font-bold text-[#1A2B4C] mb-5">Order timeline</h2>
          <div className="space-y-4">
            {order.timeline.map((t, idx) => (
              <div key={idx} className="flex items-center gap-3">
                {t.time ? <CheckCircle2 size={20} className="text-[#4F7363]" /> : <Circle size={20} className="text-[#E5E2DC]" />}
                <div className="flex-1">
                  <div className={`font-semibold ${t.time ? "text-[#1A2B4C]" : "text-[#595959]"}`}>{t.label}</div>
                  {t.time && <div className="text-xs text-[#595959]">{new Date(t.time).toLocaleTimeString()}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 bg-white rounded-3xl p-8 border border-[#E5E2DC]">
          <h2 className="display text-xl font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><Package size={20} /> Your bag</h2>
          {order.items.map((it) => (
            <div key={it.key} className="flex gap-3 py-3 border-b border-[#E5E2DC] last:border-0">
              <img src={it.image} className="w-14 h-16 rounded-lg object-cover" alt={it.name} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#1A2B4C]">{it.name}</div>
                <div className="text-xs text-[#595959]">Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
              </div>
              <div className="font-semibold">₹{(it.price * it.qty).toLocaleString()}</div>
            </div>
          ))}
          <div className="flex justify-between font-bold text-lg mt-4">
            <span>Total</span><span className="text-[#1A2B4C]">₹{order.total.toLocaleString()}</span>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
