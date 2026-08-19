/**
 * ETAHeaderCard — bordered estimated-delivery card, meant to sit at the very
 * top of a page, before any product content (redesign-plan 3.7's
 * "estimated-delivery card variant"). Deliberately generic (icon/title/
 * subtitle props, no fetching of its own) so the SAME component can later
 * be dropped onto Home/PDP once those get their own ETA treatment — this
 * pass only wires it into the Bag/Checkout screen, no other page's ETA UI
 * has been touched.
 *
 * No orange here — per the color-system rules, orange is reserved for the
 * primary CTA and selected-state UI, not decorative headers.
 */
import type { ComponentType } from "react";
import { Bike } from "lucide-react";

interface ETAHeaderCardProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle?: string;
  loading?: boolean;
}

export function ETAHeaderCard({ icon: Icon = Bike, title, subtitle, loading = false }: ETAHeaderCardProps) {
  return (
    <div
      data-testid="eta-header"
      className="bg-white border border-[#E5E2DC] rounded-2xl px-4 py-3 flex items-center gap-3"
    >
      <div className="w-9 h-9 rounded-xl bg-[#0A1F5C]/8 grid place-items-center shrink-0">
        <Icon size={18} className="text-[#0A1F5C]" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <div className="h-4 w-36 bg-[#E5E2DC] rounded animate-pulse" />
        ) : (
          <p className="font-display font-bold text-[#0A1F5C] text-sm leading-tight">{title}</p>
        )}
        {!loading && subtitle && (
          <p className="text-xs text-[#64748B] truncate mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
