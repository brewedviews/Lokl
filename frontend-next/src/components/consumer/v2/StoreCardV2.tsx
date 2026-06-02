import Link from "next/link";
import Image from "next/image";
import { Star, MapPin, Zap, ShieldCheck } from "lucide-react";
import type { StoreCard as StoreCardType } from "@/types";

type AnyStore = StoreCardType & {
  banner?: string | null;
  since_year?: number;
  created_at?: string;
  social_proof?: string;
  orders_today?: number;
  review_count?: number;
  is_verified?: boolean;
  is_open?: boolean;
  next_open_label?: string;
  online?: boolean;
};

export function StoreCardV2({ s }: { s: AnyStore }) {
  const offline = s.online === false;
  const since = s.since_year || (s.created_at ? new Date(s.created_at).getFullYear() : null);
  const proof = s.social_proof
    || (s.orders_today && s.orders_today >= 5 ? `${s.orders_today} orders delivered today` : null)
    || (s.review_count && s.review_count >= 50 ? `Trusted by ${s.review_count}+ customers` : null);
  return (
    <Link
      href={`/store/${s.id}`}
      data-testid={`store-card-${s.id}`}
      className="group block bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] hover:shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.99]"
    >
      <div className="relative h-28 bg-slate-100 overflow-hidden">
        {s.banner ? (
          <Image
            src={s.banner}
            alt={s.name}
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            loading="lazy"
            className="object-cover group-hover:scale-105 transition duration-500"
          />
        ) : <div className="w-full h-full v2-shimmer" />}
        {s.is_verified !== false && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0A1F5C] text-white text-[10px] font-bold uppercase tracking-wide">
            <ShieldCheck size={11} /> Verified
          </span>
        )}
        {offline ? (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-[#EF4444] text-[10px] font-bold uppercase">Offline now</span>
        ) : s.is_open === false ? (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-[#64748B] text-[10px] font-bold uppercase">{s.next_open_label || "Closed"}</span>
        ) : null}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-[#0F172A] line-clamp-1">{s.name}</h3>
          {s.rating ? (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#10B981] text-white text-[10px] font-bold shrink-0">
              {Number(s.rating).toFixed(1)} <Star size={9} fill="currentColor" />
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-[#64748B] flex items-center gap-2 flex-wrap">
          {s.review_count ? <span>{s.review_count} reviews</span> : null}
          {since ? <span>· Since {since}</span> : null}
        </div>
        <div className="text-[11px] flex items-center gap-2 flex-wrap text-[#475569]">
          <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-[#0A1F5C]" />{(s.distance_km ?? 1.5).toFixed(1)} km</span>
          <span className="inline-flex items-center gap-1"><Zap size={11} className="text-[#F59E0B]" />{s.eta_min || 45} min</span>
        </div>
        {proof && (
          <div className="text-[10px] font-semibold text-[#F59E0B] pt-1 border-t border-slate-100 mt-1">{proof}</div>
        )}
      </div>
    </Link>
  );
}
