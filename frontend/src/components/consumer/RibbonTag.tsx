/**
 * RibbonTag — PDP gallery status callout. Two variants:
 *  - "corner": small rectangular tag (0 radius), pinned flush to the image
 *    corner (no margin/offset) for a status like a discount callout.
 *  - "banner": wider horizontal strip (~40% of image width) for "try & buy".
 * Both share the same fill/type treatment — orange bg, bold uppercase DM
 * Sans, white text.
 */
interface RibbonTagProps {
  text: string;
  variant?: "corner" | "banner";
  position?: "top-left" | "bottom-left";
  className?: string;
}

const POSITION = {
  "top-left": "top-0 left-0",
  "bottom-left": "bottom-0 left-0",
} as const;

export function RibbonTag({ text, variant = "corner", position = "top-left", className = "" }: RibbonTagProps) {
  return (
    <span
      data-testid="ribbon-tag"
      className={`absolute z-10 ${POSITION[position]} ${variant === "banner" ? "w-[40%] text-center" : ""} bg-brand-accent text-white font-dm-sans font-bold uppercase text-[11px] leading-none px-3 py-2 pointer-events-none select-none ${className}`}
      style={{ borderRadius: 0 }}
    >
      {text}
    </span>
  );
}
