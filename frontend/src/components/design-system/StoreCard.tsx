"use client";

import Link from "next/link";
import Image from "next/image";

/**
 * StoreCard — the anti-Amazon hero element: a real storefront photo, not a
 * logo-in-a-list-row. Falls back to a tasteful navy tile with the store
 * name when no photo exists yet (onboarding doesn't require one today), so
 * it still reads as intentional rather than broken.
 */
interface StoreCardProps {
  id: string;
  name: string;
  /** Real storefront photo — required field coming in onboarding; optional here. */
  storefrontImage?: string | null;
  distanceKm?: number | null;
  isOpen: boolean;
  /** e.g. "10:00 AM" — shown as "Opens at 10:00 AM" when closed. */
  opensAtLabel?: string | null;
  className?: string;
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function StoreCard({
  id, name, storefrontImage, distanceKm, isOpen, opensAtLabel, className = "",
}: StoreCardProps) {
  return (
    <Link
      href={`/store/${id}`}
      data-testid={`store-card-${id}`}
      className={`block bg-surface-card rounded-card shadow-1 overflow-hidden transition active:scale-[0.98] ${className}`}
    >
      <div className="relative aspect-[16/10] bg-brand-primary overflow-hidden">
        {storefrontImage ? (
          <Image
            src={storefrontImage}
            alt={name}
            fill
            sizes="(max-width: 640px) 80vw, 320px"
            loading="lazy"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center px-5">
            <span className="text-section-header font-medium text-white text-center line-clamp-2">
              {name}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 space-y-1">
        <p className="text-section-header font-medium text-brand-primary line-clamp-1">{name}</p>
        <div className="flex items-center gap-2.5">
          {distanceKm != null && (
            <span className="text-meta text-brand-primary/60">{formatDistance(distanceKm)}</span>
          )}
          {isOpen ? (
            <span className="inline-flex items-center gap-1 text-meta font-medium text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Open
            </span>
          ) : (
            <span className="text-meta text-brand-primary/50">
              {opensAtLabel ? `Opens at ${opensAtLabel}` : "Closed"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
