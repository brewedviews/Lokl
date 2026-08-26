/**
 * ProductPreviewCard — G15. A read-only visual preview for the public
 * coming-soon page, NOT a variant of the real ProductCard.
 *
 * ProductCard unconditionally wires useCartStore/useWishlistStore and
 * renders live add-to-bag/qty-stepper controls regardless of props — there
 * is no clean opt-out short of stripping that machinery entirely. Per the
 * brief's own explicit fallback ("create a small wrapper/preview variant
 * rather than duplicating the entire component"), this is that wrapper:
 * image, discount badge, store name, product name, price/MRP only. No
 * heart, no cart controls, no store/cart hooks, no navigation — a plain
 * `div`, not a `Link`, so it's genuinely inert.
 */
import type { ProductCard as ProductCardType } from "@/types";

export function ProductPreviewCard({ p }: { p: Pick<ProductCardType, "id" | "name" | "price" | "mrp" | "image" | "store_name"> }) {
  const discount = p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(26,43,76,0.06)] h-full flex flex-col"
      data-testid={`preview-card-${p.id}`}
    >
      <div className="relative aspect-[3/4] bg-slate-100 overflow-hidden">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#F4F1E9]" />
        )}
        {discount > 0 && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/90 text-[#E68910] text-[9px] font-bold uppercase leading-none">
            {discount}% off
          </span>
        )}
      </div>
      <div className="p-2 pb-2.5 space-y-0.5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-[#E68910] line-clamp-1">
          {p.store_name || "Lokl Store"}
        </div>
        <div className="font-semibold text-[#0A1F5C] text-[12px] leading-tight line-clamp-2 min-h-[2.4em]">
          {p.name}
        </div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="font-bold text-[#0A1F5C] text-sm">₹{Number(p.price).toLocaleString()}</span>
          {p.mrp && p.mrp > p.price && (
            <span className="text-[#9CA3AF] line-through text-[11px]">₹{Number(p.mrp).toLocaleString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}
