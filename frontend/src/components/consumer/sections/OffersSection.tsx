"use client";

/**
 * OffersSection — the ad-hoc image banner (P0-7). Extracted out of
 * L1PageClient in G7 so both MarketplaceHomeClient ("/") and
 * L1PageClient (/c/[slug]) can render the same banner component —
 * "Offers / events" is explicitly "Both" in G7's section-ownership table
 * (primary on the marketplace, "limited" on L1), not two different
 * components.
 *
 * P0-6/P0-7 (G20 product review): this now fetches ONLY kind="banner"
 * docs scoped to `surface` (the "global" sentinel for Marketplace, or the
 * calling page's own L1 id) — the thin text-only communication strip
 * (kind="strip") is a separate, deliberately much lighter component,
 * CommunicationStrip.tsx, sharing the exact same `offers` collection/
 * admin editor. Renders every matching banner (sorted by rank, already
 * done server-side), not just the first — an admin can run more than one
 * if they choose to. Aspect ratio is a bounded preset
 * (`offer.aspect_ratio`), never an arbitrary height, so a banner can't
 * break mobile layout; pre-existing docs with no aspect_ratio set fall
 * back to the original 21:9/28:9 look (unchanged, zero regression).
 *
 * Self-fetching (own useEffect + state) rather than taking `offers` as a
 * prop — this is what lets both page clients use it as a single
 * drop-in `<OffersSection surface="..." />` with no state threaded
 * through either parent's own staggered-fetch orchestration.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackOfferClick, trackSectionImpression, observeImpression } from "@/lib/analytics";

interface OfferDoc {
  id: string; title: string; subtitle?: string; image?: string;
  cta_label?: string; cta_link?: string; background?: string; eyebrow?: string;
  aspect_ratio?: "21:9" | "16:9" | "3:1" | "4:3";
}

// Bounded presets only (P0-7) — an admin picks one of these, never an
// arbitrary CSS height that could break the mobile layout.
const ASPECT_CLASS: Record<string, string> = {
  "21:9": "aspect-[21/9] sm:aspect-[28/9]",
  "16:9": "aspect-[16/9]",
  "3:1": "aspect-[3/1]",
  "4:3": "aspect-[4/3] sm:aspect-[16/9]",
};

export function OffersSection({ surface }: { surface: string }) {
  const [offers, setOffers] = useState<OfferDoc[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog.offers(surface, "banner")
      .then((r) => { if (!cancelled) setOffers(r as unknown as OfferDoc[]); })
      .catch(() => { if (!cancelled) setOffers([]); });
    return () => { cancelled = true; };
  }, [surface]);

  if (!offers || offers.length === 0) return null;

  return (
    <section className="pt-8 space-y-3" data-testid="offers-strip" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offers")); } catch {} } }}>
      {offers.map((offer) => {
        const href = offer.cta_link || "/categories";
        const aspectClass = ASPECT_CLASS[offer.aspect_ratio || "21:9"] || ASPECT_CLASS["21:9"];
        return (
          <div key={offer.id} className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <Link
              href={href}
              data-testid={`offer-${offer.id}`}
              onClick={() => { try { trackOfferClick(offer.id, ""); } catch {} }}
              className="block rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]"
              style={{ background: offer.background || "#0A1F5C" }}
            >
              <div className={`relative ${aspectClass}`}>
                {offer.image && (
                  <img src={cloudinaryOptimize(offer.image, "w_600,q_auto,f_auto")} alt={offer.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
                <div className="absolute inset-0 p-4 flex flex-col justify-center text-white">
                  <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">{offer.eyebrow || "Limited time"}</div>
                  <div className="text-lg sm:text-xl font-display font-bold mt-1 leading-tight">{offer.title}</div>
                  {offer.subtitle && <div className="text-xs sm:text-sm opacity-95 mt-1">{offer.subtitle}</div>}
                  <div className="mt-2 inline-flex items-center gap-1 text-xs font-bold">
                    {offer.cta_label || "Shop now"} →
                  </div>
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </section>
  );
}
