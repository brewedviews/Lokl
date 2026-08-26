"use client";

/**
 * ComingSoonHero — G15/G16. Same visual architecture as the real
 * HeroCarousel (frontend/src/components/consumer/HeroCarousel.tsx) —
 * padded rounded card, cream gradient scrim, font-display headline with an
 * orange-highlighted phrase — but HeroCarousel itself isn't reusable here:
 * it fetches GET /api/feed/delivery-status and renders a live LIVE/AWAY ETA
 * badge, exactly the kind of live/transactional signal this page must not
 * show. This is a single static slide (no carousel/autoplay machinery
 * needed) and no floating status badge at all — G16 simplified this to a
 * pure launch-announcement hero, the "COMING SOON" eyebrow alone carries
 * that message now (a separate floating pill read as redundant chrome).
 *
 * The hero image itself is real, existing CMS content — the same
 * GET /api/hero-slides?l1_id=global slide HeroCarousel renders on the real
 * homepage today — read here for its `image` field only, not its live
 * cta_link/headline (this page writes its own coming-soon copy).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1600&q=80";

export function ComingSoonHero() {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    api.catalog.heroSlides("global")
      .then((slides) => setImage(slides[0]?.image || null))
      .catch(() => {});
  }, []);

  return (
    <section data-testid="coming-soon-hero" className="relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-6">
        <div className="relative rounded-2xl overflow-hidden bg-[#0A1F5C] min-h-[380px] md:min-h-[420px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image || FALLBACK_IMAGE}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-[60%_45%] md:object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/80 via-[#FDFBF7]/50 to-[#FDFBF7]/15 md:bg-gradient-to-r md:from-[#FDFBF7]/75 md:via-[#FDFBF7]/35 md:to-transparent" />

          <div className="relative flex flex-col max-w-2xl px-5 md:px-10 lg:px-12 pt-6 md:pt-10 pb-16 md:pb-20 min-h-[380px] md:min-h-[420px]">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#E68910]">
              Coming soon &middot; Bhilai
            </span>
            <h1 className="font-display font-medium text-[#0A1F5C] mt-1 text-[28px] leading-[1.1] md:text-4xl lg:text-5xl tracking-tight">
              Your neighbourhood, <span className="text-[#E68910]">online.</span>
            </h1>
            <p className="mt-2.5 md:mt-3 text-[13px] md:text-base text-[#0A1F5C]/75 md:text-[#475569] max-w-md leading-relaxed">
              Lokl is bringing the stores you already know and love online. Discover local businesses, shop from your neighbourhood and get what you need without leaving Bhilai.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 mt-5">
              <a
                href="#waitlist"
                data-testid="hero-waitlist-cta"
                className="inline-flex items-center rounded-full bg-brand-accent text-white text-sm font-bold px-5 py-2.5 active:scale-95 transition"
              >
                Join the waitlist
              </a>
              <a
                href="https://merchant.shoplokl.in"
                data-testid="hero-merchant-cta"
                className="inline-flex items-center rounded-full border border-[#0A1F5C]/25 text-[#0A1F5C] text-sm font-bold px-5 py-2.5 active:scale-95 transition"
              >
                Own a store? Register with Lokl
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
