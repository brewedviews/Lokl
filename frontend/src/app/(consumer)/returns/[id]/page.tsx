"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, RotateCcw, Package, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Footer } from "@/components/consumer/Footer";
import type { Return, OrderTimelineEntry } from "@/types";

export default function ReturnTrackingPage() {
  const { id } = useParams<{ id: string }>();
  const [ret, setRet] = useState<Return | null>(null);

  useEffect(() => {
    const load = () => api.orders.getReturn(id).then(setRet).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id]);

  if (!ret) {
    return (
      <div className="min-h-screen bg-[#FDFBF7]"><div className="p-10 text-center">Loading…</div></div>
    );
  }

  const showOtp = (ret.status === "pickup_assigned") && ret.otp;

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <Link href={`/orders/${ret.order_id}`} className="inline-flex items-center gap-1 text-sm text-[#595959] hover:text-[#1A2B4C] mb-3"><ArrowLeft size={14} /> Back to order</Link>

        <div className="bg-white rounded-3xl p-8 border border-[#E5E2DC] text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#E68910]/10 flex items-center justify-center mb-4">
            <RotateCcw size={32} className="text-[#E68910]" />
          </div>
          <h1 className="font-display text-3xl font-bold text-[#1A2B4C]" data-testid="return-status-headline">
            {ret.status === "refunded" ? "Return completed"
              : ret.status === "picked_up" ? "Picked up · in transit"
              : ret.status === "rider_arrived" ? "Pickup partner arriving"
              : ret.status === "pickup_assigned" ? "Pickup partner assigned"
              : "Return requested"}
          </h1>
          <p className="text-[#595959] mt-2">Return ID: <span data-testid="return-id" className="font-semibold text-[#1A2B4C]">{ret.id}</span></p>
          <p className="text-xs text-[#595959] mt-1">For order <Link href={`/orders/${ret.order_id}`} className="text-[#E68910] font-semibold hover:underline">{ret.order_id}</Link></p>
          <p className="text-xs text-[#595959] mt-1">Reason: <span className="text-[#1A2B4C]">{ret.reason}</span></p>
        </div>

        {showOtp && (
          <div className="mt-6 bg-[#1A2B4C] text-white rounded-3xl p-7 text-center border-2 border-[#E68910]/40" data-testid="return-otp-card">
            <div className="text-[11px] uppercase tracking-widest text-white/60">Share this OTP with the pickup partner</div>
            <div data-testid="return-otp" className="font-display text-5xl md:text-6xl font-bold tracking-[0.3em] tabular-nums text-[#E68910] mt-3">{ret.otp}</div>
            <p className="text-xs text-white/70 mt-3">Hand over the items only after the partner shows this 4-digit code.</p>
          </div>
        )}

        <div className="mt-8 bg-white rounded-3xl p-8 border border-[#E5E2DC]">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-5">Return timeline</h2>
          <div className="space-y-4">
            {(ret.timeline || []).map((t: OrderTimelineEntry, idx: number) => (
              <div key={t.status || `step-${idx}`} className="flex items-center gap-3">
                {t.at ? <CheckCircle2 size={20} className="text-[#4F7363]" /> : <Circle size={20} className="text-[#E5E2DC]" />}
                <div className="flex-1">
                  <div className="font-semibold text-[#1A2B4C]">{t.note || t.status}</div>
                  {t.at && <div className="text-xs text-[#595959]">{new Date(t.at).toLocaleTimeString()}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 bg-white rounded-3xl p-8 border border-[#E5E2DC]">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><Package size={20} /> Items being returned</h2>
          {(ret.items || []).map((it) => (
            <div key={it.id} className="flex gap-3 py-3 border-b border-[#E5E2DC] last:border-0">
              {it.id ? (
                <Link href={`/p/${it.id}`} className="shrink-0">
                  {it.image ? <Image src={it.image} width={56} height={64} className="w-14 h-16 rounded-lg object-cover" alt={it.name} /> : <div className="w-14 h-16 rounded-lg bg-slate-100" />}
                </Link>
              ) : it.image ? <Image src={it.image} width={56} height={64} className="w-14 h-16 rounded-lg object-cover" alt={it.name} /> : <div className="w-14 h-16 rounded-lg bg-slate-100" />}
              <div className="flex-1 min-w-0">
                {it.id ? (
                  <Link href={`/p/${it.id}`} className="font-semibold text-[#1A2B4C] hover:text-[#E68910] block truncate">{it.name}</Link>
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
