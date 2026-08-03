"use client";

import Link from "next/link";
import Image from "next/image";
import { PriceChip } from "./PriceChip";

/**
 * ProductCutoutCard — the premium, cross-category discovery card. The
 * product photo sits as a cut-out on a --surface-tint disc so the card
 * looks correct for ANY category (grocery, electronics, fashion, beauty)
 * without a store-specific photo treatment.
 *
 * Deliberately minimal: no store name, no ETA, no add-to-cart — this is a
 * doorway to the PDP, not a transactional card (that's the existing
 * ProductCard, unaffected by this addition).
 *
 * `cutoutImage` is a background-removed Cloudinary variant, wired by a
 * later task. Until then (or whenever it's unavailable for a given
 * product), this falls back to the normal `image` — cropped to fill the
 * disc instead of floating on it — so the card never breaks.
 */
interface ProductCutoutCardProps {
  id: string;
  name: string;
  price: number;
  mrp?: number | null;
  /** Normal product photo — required as the fallback source. */
  image: string | null | undefined;
  /** Background-removed Cloudinary variant, if available. */
  cutoutImage?: string | null;
  className?: string;
}

export function ProductCutoutCard({
  id, name, price, mrp, image, cutoutImage, className = "",
}: ProductCutoutCardProps) {
  const isCutout = !!cutoutImage;
  const displayImage = cutoutImage || image;

  return (
    <Link
      href={`/product/${id}`}
      data-testid={`cutout-card-${id}`}
      className={`block bg-surface-card rounded-card shadow-1 overflow-hidden transition active:scale-[0.98] ${className}`}
    >
      {/* Image area — square, tint recess, disc-contained photo. The disc
          itself is white when there's no image at all: filling it with the
          same tint as the recess around it would make the disc invisible
          (tint-on-tint), the one way this "must not break" fallback can
          actually break. */}
      <div className="aspect-square bg-surface-tint p-4">
        <div className={`relative w-full h-full rounded-full overflow-hidden ${displayImage ? "bg-surface-tint" : "bg-surface-card"}`}>
          {displayImage && (
            <Image
              src={displayImage}
              alt={name}
              fill
              sizes="(max-width: 640px) 40vw, 220px"
              loading="lazy"
              className={isCutout ? "object-contain p-2" : "object-cover"}
            />
          )}
        </div>
      </div>

      {/* Name + price */}
      <div className="p-3 space-y-1.5">
        <p className="text-product-name font-normal text-brand-primary line-clamp-1">{name}</p>
        <PriceChip price={price} mrp={mrp} />
      </div>
    </Link>
  );
}
