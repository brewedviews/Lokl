"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, RotateCcw, ArrowLeft, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Footer } from "@/components/consumer/Footer";
import type { Return } from "@/types";

type ReturnTimelineEntry = {
  label?: string;
  time?: string | null;
  at?: string | null;
  status?: string;
  note?: string;
};

const STATUS_LABELS: Record<string, string> = {
  requested: "Return Requested",
  pickup_assigned: "Pickup Partner Assigned",
  rider_arrived: "Pickup Partner On The Way",
  picked_up: "Product Picked Up",
  received: "Product Received",
  refunded: "Refund Processed",
  rejected: "Return Rejected",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  requested: "We've received your return request and are arranging pickup.",
  pickup_assigned: "A pickup partner has been assigned and will contact you soon.",
  rider_arrived: "Your pickup partner is on the way. Please keep the item ready.",
  picked_up: "Your item has been picked up. Refund will be processed shortly.",
  received: "We've received your item. Refund will be processed shortly.",
  refunded: "Your refund has been processed successfully.",
  rejected: "Unfortunately your return request could not be approved.",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "refunded") {
    return (
      <div className="w-10 h-10 rounded-full bg-[#4F7363]/10 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 size={20} className="text-[#4F7363]" />
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <XCircle size={20} className="text-red-500" />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#E68910]/10 flex items-center justify-center flex-shrink-0">
      <RotateCcw size={20} className="text-[#E68910]" />
    </div>
  );
}

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
  const firstItem = ret.items?.[0];

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-2xl mx-auto px-4 py-6 md:py-10">
        <Link href={`/orders/${ret.order_id}`} className="inline-flex items-center gap-1 text-sm text-[#595959] hover:text-[#1A2B4C] mb-4"><ArrowLeft size={14} /> Back to order</Link>

        <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-[#595959] uppercase tracking-widest font-semibold mb-1">Return #{ret.id.slice(-6)}</p>
              <h1 className="font-display text-xl md:text-2xl font-bold text-[#1A2B4C]" data-testid="return-status-headline">
                {STATUS_LABELS[ret.status] || ret.status}
              </h1>
              <p className="text-sm text-[#595959] mt-1">{STATUS_DESCRIPTIONS[ret.status]}</p>
            </div>
            <StatusIcon status={ret.status} />
          </div>
        </div>

        {showOtp && (
          <div className="mb-4 bg-[#1A2B4C] text-white rounded-2xl p-6 md:p-7 text-center border-2 border-[#E68910]/40" data-testid="return-otp-card">
            <div className="text-[11px] uppercase tracking-widest text-white/60">Share this OTP with the pickup partner</div>
            <div data-testid="return-otp" className="font-display text-4xl md:text-5xl font-bold tracking-[0.3em] tabular-nums text-[#E68910] mt-3">{ret.otp}</div>
            <p className="text-xs text-white/70 mt-3">Hand over the items only after the partner shows this 4-digit code.</p>
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm mb-4">
          <h2 className="text-sm font-semibold text-[#1A2B4C] uppercase tracking-widest mb-4">Timeline</h2>
          <div className="space-y-0">
            {ret.timeline.length === 0 && (
              <p className="text-sm text-[#595959]">No timeline updates yet.</p>
            )}
            {(ret.timeline as unknown as ReturnTimelineEntry[]).map((entry, i) => {
              const timestamp = entry.time || entry.at || null;
              const isDone = Boolean(timestamp);
              const isLast = i === ret.timeline.length - 1;
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? "bg-[#4F7363]" : "bg-[#E5E2DC]"}`}>
                      {isDone
                        ? <CheckCircle2 size={14} className="text-white" />
                        : <Circle size={14} className="text-[#94A3B8]" />}
                    </div>
                    {!isLast && <div className={`w-0.5 flex-1 my-1 ${isDone ? "bg-[#4F7363]" : "bg-[#E5E2DC]"}`} />}
                  </div>
                  <div className="pb-5">
                    <p className={`text-sm font-semibold ${isDone ? "text-[#1A2B4C]" : "text-[#94A3B8]"}`}>
                      {entry.label || entry.note || entry.status}
                    </p>
                    {timestamp && (
                      <p className="text-xs text-[#595959] mt-0.5">
                        {new Date(timestamp).toLocaleString("en-IN", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                        })}
                      </p>
                    )}
                    {!isDone && (
                      <p className="text-xs text-[#94A3B8] mt-0.5">Pending</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm mb-4">
          <h2 className="text-sm font-semibold text-[#1A2B4C] uppercase tracking-widest mb-3">Order Details</h2>
          <div className="flex items-center gap-3">
            {firstItem?.image && (
              <img src={firstItem.image} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
            )}
            <div>
              <p className="text-sm font-semibold text-[#1A2B4C]">{firstItem?.name || "Product"}</p>
              <p className="text-xs text-[#595959]">Order #{ret.order_id?.slice(-6)}</p>
              <p className="text-xs text-[#595959]">Reason: {ret.reason}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#F8F6F1] rounded-2xl p-4 text-center">
          <p className="text-xs text-[#595959]">Need help with your return?</p>
          <a href="mailto:hello@shoplokl.in" className="text-xs font-semibold text-[#E68910] mt-1 inline-block">
            Contact hello@shoplokl.in
          </a>
        </div>
      </div>
      <Footer />
    </div>
  );
}
