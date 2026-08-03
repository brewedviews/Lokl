/**
 * PriceChip — the signature price element, identical everywhere app-wide.
 * This is the ONLY place orange appears in a filled shape (color-role rule:
 * orange = price chips, primary CTAs, active/selected states — nothing else).
 *
 * Replaces every ad-hoc price display (raw `₹{price}` spans, per-component
 * discount badges, etc.) — new UI should render prices through this, not
 * hand-roll another one.
 */
interface PriceChipProps {
  /** Current/selling price, in rupees. */
  price: number;
  /** Original price — renders as a muted-navy strikethrough beside the chip when higher than price. */
  mrp?: number | null;
  /** Show the small discount-% label when mrp implies one. Default true. */
  showDiscount?: boolean;
  className?: string;
}

function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function PriceChip({ price, mrp, showDiscount = true, className = "" }: PriceChipProps) {
  const hasMrp = typeof mrp === "number" && mrp > price;
  const discount = hasMrp ? Math.round((1 - price / mrp) * 100) : 0;

  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`} data-testid="price-chip">
      <span className="inline-flex items-center rounded-pill bg-brand-accent px-2 py-0.5 text-price-chip font-medium leading-none text-white">
        {formatInr(price)}
      </span>
      {hasMrp && (
        <span className="text-meta leading-none text-brand-primary/50 line-through">
          {formatInr(mrp)}
        </span>
      )}
      {hasMrp && showDiscount && discount > 0 && (
        <span className="text-meta font-medium leading-none text-brand-primary/50">
          {discount}% off
        </span>
      )}
    </span>
  );
}
