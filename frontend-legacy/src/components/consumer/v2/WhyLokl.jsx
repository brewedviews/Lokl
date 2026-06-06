import React, { useEffect, useState } from "react";
import { Truck, Store, ShirtIcon, RotateCcw, Shield } from "lucide-react";

const ITEMS = [
  { icon: Store, title: "Verified Local Stores", body: "Every merchant verified by Lokl" },
  { icon: Truck, title: "Fast Delivery", body: "Delivered within 30–45 minutes" },
  { icon: RotateCcw, title: "Easy Returns", body: "Simple and transparent returns" },
  { icon: Shield, title: "Cash On Delivery", body: "Pay after delivery" },
];

export default function WhyLokl() {
  return (
    <section className="px-4 py-8" data-testid="why-lokl">
      <h2 className="text-2xl font-display font-bold tracking-tight text-[#0A1F5C] mb-1">Why Lokl</h2>
      <p className="text-sm text-[#64748B] mb-4">Built for nearby fashion. Built for trust.</p>
      <div className="grid grid-cols-2 gap-3">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.title} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(10,31,92,0.06)] border border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/15 grid place-items-center mb-2"><Icon size={18} className="text-[#F59E0B]" /></div>
              <div className="text-[13px] font-bold text-[#0A1F5C] leading-tight">{it.title}</div>
              <div className="text-[11px] text-[#64748B] mt-1 leading-snug">{it.body}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HowLoklWorks() {
  const steps = [
    { n: "1", title: "Browse Nearby Stores", body: "Discover stores in your city" },
    { n: "2", title: "Try At Doorstep", body: "Try before you pay, where available" },
    { n: "3", title: "Keep What You Love", body: "Easy returns on the rest" },
  ];
  return (
    <section className="px-4 py-10 bg-[#F8FAFC]" data-testid="how-it-works">
      <h2 className="text-2xl font-display font-bold tracking-tight text-[#0A1F5C] mb-1">Shop local in 3 simple steps</h2>
      <p className="text-sm text-[#64748B] mb-5">Built for the Tier-2 high street.</p>
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3 bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(10,31,92,0.06)]">
            <div className="w-9 h-9 rounded-full bg-[#0A1F5C] text-white grid place-items-center font-bold shrink-0">{s.n}</div>
            <div>
              <div className="text-sm font-bold text-[#0F172A]">{s.title}</div>
              <div className="text-xs text-[#64748B] mt-0.5">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
