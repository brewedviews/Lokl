"use client";

/**
 * CommunicationStrip — P0-6 (G20 product review). A very thin, editorial
 * ticker for offers/launch messaging/seasonal or campaign copy, sitting
 * directly below the hero. Shares the exact same `offers` collection and
 * admin editor as OffersSection's ad-hoc banners (P0-7) — distinguished
 * only by `kind="strip"` (text/CTA only, never an image) — not a second
 * CMS entity.
 *
 * Independently activatable per surface via `placement` (the same
 * "global"/L1-id sentinel HeroSlide already established): pass
 * `surface="global"` on the Marketplace home, `surface={l1Id}` on an L1
 * page. Renders NOTHING (zero layout space) when there's no active strip
 * for that surface — never an empty bar.
 *
 * Deliberately NOT a card: no border-radius-heavy container, no shadow,
 * no icon-circle — a plain thin row, one line, small type, horizontally
 * scrollable only if the combined message is wider than the viewport.
 * Multiple active strip docs for the same surface join into one line
 * separated by "•", ordered by the same `rank` field every other CMS list
 * already sorts by (priority when more than one is active).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface StripDoc {
  id: string;
  title: string;
  cta_link?: string;
}

export function CommunicationStrip({ surface }: { surface: string }) {
  const [strips, setStrips] = useState<StripDoc[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog.offers(surface, "strip")
      .then((r) => { if (!cancelled) setStrips(r as unknown as StripDoc[]); })
      .catch(() => { if (!cancelled) setStrips([]); });
    return () => { cancelled = true; };
  }, [surface]);

  if (!strips || strips.length === 0) return null;

  return (
    <div
      data-testid="communication-strip"
      className="border-b border-[#E5E2DC] bg-[#F4F1E9]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 py-1.5 whitespace-nowrap text-[11px] font-semibold text-[#0A1F5C] tracking-wide">
          {strips.map((s, i) => (
            <span key={s.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-[#94A3B8]">•</span>}
              {s.cta_link ? (
                <Link href={s.cta_link} data-testid={`communication-strip-item-${s.id}`} className="hover:underline">
                  {s.title}
                </Link>
              ) : (
                <span data-testid={`communication-strip-item-${s.id}`}>{s.title}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
