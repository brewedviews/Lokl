"use client";

/**
 * OffersSection — the thin campaign/offer strip (G6: eyebrow -> headline
 * -> detail -> CTA, `aspect-[21/9] sm:aspect-[28/9]`). Extracted out of
 * L1PageClient in G7 so both MarketplaceHomeClient ("/") and
 * L1PageClient (/c/[slug]) can render the exact same strip — "Offers /
 * events" is explicitly "Both" in G7's section-ownership table (primary
 * on the marketplace, "limited" on L1), not two different components.
 *
 * Self-fetching (own useEffect + state) rather than taking `offers` as a
 * prop — this is what lets both page clients use it as a single
 * drop-in `<OffersSection />` with no state threaded through either
 * parent's own staggered-fetch orchestration.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cloudinaryOptimize } from "@/lib/utils";
import { trackOfferClick, trackSectionImpression, observeImpression } from "@/lib/analytics";

interface OfferDoc {
  id: string; title: string; subtitle?: string; image?: string;
  cta_label?: string; cta_link?: string; background?: string; eyebrow?: string;
}

export function OffersSection() {
  const [offers, setOffers] = useState<OfferDoc[] | null>(null);

  useEffect(() => {
    api.catalog.offers().then((r) => setOffers(r as unknown as OfferDoc[])).catch(() => setOffers([]));
  }, []);

  if (!offers || offers.length === 0) return null;
  const offer = offers[0]!;
  const href = offer.cta_link || "/categories";
  const cardStyle = { background: offer.background || "#0A1F5C" };

  return (
    <section className="pt-8" data-testid="offers-strip" ref={(el) => { if (el) { try { observeImpression(el, () => trackSectionImpression("offers")); } catch {} } }}>
      <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <Link
          href={href}
          data-testid={`offer-${offer.id}`}
          onClick={() => { try { trackOfferClick(offer.id, ""); } catch {} }}
          className="block rounded-2xl overflow-hidden relative shadow-[0_8px_24px_rgba(10,31,92,0.12)] transition active:scale-[0.98]"
          style={cardStyle}
        >
          <div className="aspect-[21/9] sm:aspect-[28/9] relative">
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
    </section>
  );
}
