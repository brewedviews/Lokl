import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { CheckCircle2, Circle, RotateCcw, Package, ArrowLeft } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";

export default function ReturnTracking() {
  const { id } = useParams();
  const [ret, setRet] = useState(null);

  useEffect(() => {
    const load = () => api.get(`/returns/${id}`).then((r) => setRet(r.data)).catch(() => {});
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, [id]);

  if (!ret) return <div className="min-h-screen bg-[#FDFBF7]"><ConsumerHeader /><div className="p-10 text-center">Loading…</div></div>;

  const showOtp = (ret.status === "pickup_assigned" || ret.status === "arriving") && ret.otp;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <Link to={`/orders/${ret.order_id}`} className="inline-flex items-center gap-1 text-sm text-[#595959] hover:text-[#1A2B4C] mb-3"><ArrowLeft size={14} /> Back to order</Link>

        <div className="bg-white rounded-3xl p-8 border border-[#E5E2DC] text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#E68910]/10 flex items-center justify-center mb-4">
            <RotateCcw size={32} className="text-[#E68910]" />
          </div>
          <h1 className="display text-3xl font-bold text-[#1A2B4C]" data-testid="return-status-headline">
            {ret.status === "completed" ? "Return completed"
              : ret.status === "picked_up" ? "Picked up · in transit"
              : ret.status === "arriving" ? "Pickup partner arriving"
              : ret.status === "pickup_assigned" ? "Pickup partner assigned"
              : "Return requested"}
          </h1>
          <p className="text-[#595959] mt-2">Return ID: <span data-testid="return-id" className="font-semibold text-[#1A2B4C]">{ret.id}</span></p>
          <p className="text-xs text-[#595959] mt-1">For order <Link to={`/orders/${ret.order_id}`} className="text-[#E68910] font-semibold hover:underline">{ret.order_id}</Link></p>
          <p className="text-xs text-[#595959] mt-1">Reason: <span className="text-[#1A2B4C]">{ret.reason}</span></p>
        </div>

        {showOtp && (
          <div className="mt-6 bg-[#1A2B4C] text-white rounded-3xl p-7 text-center border-2 border-[#E68910]/40" data-testid="return-otp-card">
            <div className="text-[11px] uppercase tracking-widest text-white/60">Share this OTP with the pickup partner</div>
            <div data-testid="return-otp" className="display text-5xl md:text-6xl font-bold tracking-[0.3em] tabular-nums text-[#E68910] mt-3">{ret.otp}</div>
            <p className="text-xs text-white/70 mt-3">Hand over the items only after the partner shows this 4-digit code.</p>
          </div>
        )}

        <div className="mt-8 bg-white rounded-3xl p-8 border border-[#E5E2DC]">
          <h2 className="display text-xl font-bold text-[#1A2B4C] mb-5">Return timeline</h2>
          <div className="space-y-4">
            {(ret.timeline || []).map((t, idx) => (
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
          <h2 className="display text-xl font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><Package size={20} /> Items being returned</h2>
          {(ret.items || []).map((it) => (
            <div key={it.key || it.id} className="flex gap-3 py-3 border-b border-[#E5E2DC] last:border-0">
              {it.id ? (
                <Link to={`/p/${it.id}`} className="shrink-0">
                  <img src={it.image} className="w-14 h-16 rounded-lg object-cover" alt={it.name} />
                </Link>
              ) : <img src={it.image} className="w-14 h-16 rounded-lg object-cover" alt={it.name} />}
              <div className="flex-1 min-w-0">
                {it.id ? (
                  <Link to={`/p/${it.id}`} className="font-semibold text-[#1A2B4C] hover:text-[#E68910] block truncate">{it.name}</Link>
                ) : (
                  <div className="font-semibold text-[#1A2B4C] truncate">{it.name}</div>
                )}
                <div className="text-xs text-[#595959]">Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
