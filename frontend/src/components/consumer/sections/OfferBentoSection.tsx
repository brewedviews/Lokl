"use client";

/**
 * OfferBentoSection — G21 P1-9/P1-11. A separate PRESENTATION MODE of the
 * same `offers` entity (kind="bento"), for a campaign that deserves more
 * visual prominence than the standard banner: a seasonal campaign, a major
 * local event, a store campaign, a category sale, a launch activation —
 * used only when an admin explicitly sets kind="bento" on a row, never
 * automatically. Visually inspired by BudgetBentoSection's large-photo,
 * minimal-chrome bento language (same design tokens, same "photo does the
 * work" restraint) but reads from the CMS-controlled offers collection
 * instead of the fixed 4-price-band tiles — not a duplicate of that
 * component, a different content source under a similar visual idiom.
 *
 * Renders nothing when there are no active/scheduled kind="bento" offers
 * for this surface — zero space, matching every other CMS module here.
 * Capped at 4 tiles (a bento is a visual-prominence module, not a rail —
 * a 5th simultaneous "deserves visual prominence" campaign should really
 * be reconsidered by the admin, not silently laid out smaller).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackOfferClick, trackSectionImpression, observeImpression } from "@/lib/analytics";

// Matches the raw /api/offers doc shape (same fields OffersSection's own
// local OfferDoc reads) — the shared `Offer` type in @/types uses a
// differently-named bg/fg pair meant for a different consumer, so this
// stays a local shape rather than a mismatched shared import.
interface BentoOfferDoc {
  id: string; title: string; subtitle?: string; image?: string;
  cta_link?: string; background?: string; eyebrow?: string;
}

// Diagonal size treatment for exactly 4 tiles — index 0 and 3 (top-left,
// bottom-right) get the large card, 1 and 2 (top-right, bottom-left) the
// smaller one: literally "[large][smaller] / [smaller][large]".
const LARGE_AT_4 = new Set([0, 3]);

export function OfferBentoSection({ surface, storeId }: { surface?: string; storeId?: string }) {
  const [offers, setOffers] = useState<BentoOfferDoc[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog.offers(surface, "bento", storeId)
      .then((r) => { if (!cancelled) setOffers((r as unknown as BentoOfferDoc[]).slice(0, 4)); })
      .catch(() => { if (!cancelled) setOffers([]); });
    return () => { cancelled = true; };
  }, [surface, storeId]);

  if (!offers || offers.length === 0) return null;

  const n = offers.length;

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8"
      data-testid="offer-bento"
      ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offer_bento")); } catch {} } }}
    >
      <div className={n === 1 ? "" : "grid grid-cols-2 gap-2 sm:gap-3"}>
        {offers.map((offer, i) => {
          const large = n === 1 || (n === 3 && i === 0) || (n === 4 && LARGE_AT_4.has(i)) || (n === 2);
          return (
            <Link
              key={offer.id}
              href={offer.cta_link || "/categories"}
              onClick={() => { try { trackOfferClick(offer.id, ""); } catch {} }}
              data-testid={`offer-bento-${offer.id}`}
              className={[
                "group relative rounded-card overflow-hidden shadow-[0_2px_8px_rgba(10,31,92,0.06)] transition-all active:scale-[0.98]",
                large ? "aspect-[4/5] sm:aspect-[16/10]" : "aspect-square",
                n === 3 && i === 0 ? "col-span-2" : "",
              ].join(" ")}
            >
              {offer.image ? (
                <img
                  src={cloudinaryOptimize(offer.image, "w_700,q_auto,f_auto")}
                  alt={offer.title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0" style={{ background: offer.background || "#0A1F5C" }} />
              )}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/20 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
                {offer.eyebrow && (
                  <div className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-white/85">{offer.eyebrow}</div>
                )}
                <div className={`font-display font-medium text-white leading-tight tracking-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] ${large ? "text-base sm:text-2xl" : "text-sm sm:text-base"}`}>
                  {offer.title}
                </div>
                {large && offer.subtitle && (
                  <div className="text-xs sm:text-sm text-white/90 mt-1 line-clamp-2">{offer.subtitle}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
