import Link from "next/link";
import Image from "next/image";

/**
 * Replaces the old plain bordered "Store name / View store →" row on the
 * PDP. Every field here is checked against what GET /api/stores/{id}
 * actually returns before being rendered:
 *  - logo: real (stores.logo, set at merchant onboarding) — falls back to
 *    an initials circle when absent, never a placeholder image.
 *  - area label: real (stores.area_label) — the line is simply omitted
 *    when a store predates that field.
 *  - "N orders this month": real, computed server-side in GET
 *    /api/stores/{id} (db.orders.count_documents scoped to merchant_id +
 *    current calendar month, same exclusion filter as the merchant's own
 *    order-count queries). Omitted below 1 rather than showing "0 orders
 *    this month," which would undermine trust rather than build it.
 */
export function MerchantMicroCard({
  storeId,
  storeName,
  logo,
  areaLabel,
  ordersThisMonth,
}: {
  storeId: string;
  storeName?: string | null;
  logo?: string | null;
  areaLabel?: string | null;
  ordersThisMonth?: number;
}) {
  // store_name is normally denormalized onto every product at write time,
  // but this card shouldn't crash the page over a stale/missing one — same
  // "never trust a join is guaranteed" caution as the rest of this file.
  const displayName = (storeName ?? "").trim() || "This store";
  const initial = displayName.charAt(0).toUpperCase() || "S";

  return (
    <div
      data-testid="merchant-micro-card"
      className="mb-3 p-3 bg-white border border-warm-gray-border rounded-xl flex items-center gap-3"
    >
      <div className="relative w-11 h-11 rounded-full overflow-hidden bg-cream-warm border border-warm-gray-border shrink-0 flex items-center justify-center">
        {logo ? (
          <Image src={logo} alt={displayName} fill sizes="44px" className="object-cover" />
        ) : (
          <span className="text-base font-bold text-ink-navy">{initial}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-ink-navy truncate">{displayName}</p>
        {areaLabel && <p className="text-[11px] text-slate-gray truncate">{areaLabel}</p>}
        {!!ordersThisMonth && ordersThisMonth > 0 && (
          <p className="text-[11px] text-slate-gray truncate">{ordersThisMonth} orders this month</p>
        )}
      </div>

      <Link
        href={`/store/${storeId}`}
        data-testid="merchant-micro-card-view-store"
        className="shrink-0 text-xs font-semibold text-brand-accent"
      >
        View store →
      </Link>
    </div>
  );
}
