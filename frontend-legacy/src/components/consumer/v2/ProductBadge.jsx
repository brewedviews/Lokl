import React from "react";
import { Flame, Star, Trophy, Sparkles, Zap, Tag } from "lucide-react";

const STYLES = {
  best_seller:  { icon: Trophy,   label: "Best Seller",   cls: "bg-[#F59E0B] text-white" },
  selling_fast: { icon: Flame,    label: "Selling Fast",  cls: "bg-[#EF4444] text-white" },
  top_rated:    { icon: Star,     label: "Top Rated",     cls: "bg-[#0A1F5C] text-white" },
  trending:     { icon: Sparkles, label: "Trending",      cls: "bg-[#7C3AED] text-white" },
  best_deal:    { icon: Tag,      label: "Best Deal",     cls: "bg-[#10B981] text-white" },
  new_arrival:  { icon: Zap,      label: "New",           cls: "bg-[#0A1F5C] text-white" },
  low_stock:    { icon: Flame,    label: "Low Stock",     cls: "bg-[#EF4444] text-white" },
};

export default function ProductBadge({ kind, className = "" }) {
  if (!kind) return null;
  const m = STYLES[kind] || STYLES.trending;
  const Icon = m.icon;
  return (
    <span data-testid={`badge-${kind}`} className={`v2-pop-in inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${m.cls} ${className}`}>
      <Icon size={10} className="shrink-0" />
      {m.label}
    </span>
  );
}
