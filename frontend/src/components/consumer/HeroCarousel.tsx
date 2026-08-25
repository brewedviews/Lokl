"use client";

/**
 * HeroCarousel — the per-L1 hero banner, shown on Home (l1Id="l1-women",
 * since Women is the default-active tab there — see CategoryTileRow's own
 * doc comment) and on every /c/[slug] page (l1Id = that page's own L1).
 *
 * Redesign Phase B: self-fetches from the real backend HeroSlide
 * collection (GET /api/hero-slides?l1_id=..., Phase A's model) instead of
 * a static per-L1 config. An L1 with zero active slides published simply
 * renders nothing — real, expected, matches the same "correct plumbing,
 * sparse data" situation elsewhere in this redesign, not a bug.
 *
 * Redesign Phase F: visual REVERT from Phase B/D's full-bleed thin-banner
 * treatment back to a padded card, matching HeroV2's own visual language
 * (rounded-2xl card inside a max-w-7xl padded container, cream gradient
 * scrim, min-h-[300px]/[320px]) — NOT a revival of HeroV2 itself, and NOT
 * a return to a site-wide hero: this still self-fetches per-L1 HeroSlide
 * data exactly as Phase B built it, only the container/sizing/type-scale
 * changed. The "full-bleed, edge-to-edge, no card" idea Phase B tried
 * turned out not to earn its keep visually once seen against the rest of
 * the (still-cornered, still-padded) page — this reverts specifically
 * that call, not the underlying per-L1 data model, which stays.
 *
 * Text at this size was re-verified the same way the earlier thin-hero
 * fix was: laid out against both the real seeded headline and a longer
 * synthetic one at the new size before shipping, not assumed to "obviously
 * fit" just because the box got bigger.
 *
 * Scroll-snap + dot-indicator + autoplay mechanics are unchanged from
 * every prior version (still lifted from ProductGallery's own pattern —
 * see git history); only sizing/container/type-scale changed.
 *
 * Redesign Phase G3: three additions, all backwards-compatible with
 * existing HeroSlide docs that predate them —
 *   1. `subheadline` — optional second line rendered below the headline.
 *   2. `highlight_text` — a substring of `headline` rendered in the
 *      functional orange (renderHighlightedHeadline below); empty or
 *      non-matching just renders the whole headline in navy, same as
 *      before this phase.
 *   3. A floating delivery-status badge (bicycle icon, ETA, LIVE/AWAY
 *      pill) — the SAME ETAHeaderCard component (redesign-plan 3.7) and
 *      the SAME real GET /api/feed/delivery-status data source the
 *      dormant HeroV2.tsx already validated this exact pattern with, not
 *      a new trust component or a hardcoded "45 minutes". It's rendered
 *      once per carousel (not per slide) since delivery status is
 *      site-wide, not per-L1/per-slide content.
 *
 * G11 §8/§9 — headline weight dropped from `font-bold` to `font-medium`:
 * the hero now uses the SAME heading role/weight as every other page
 * heading (was previously carved out as "campaign artwork" — G11
 * explicitly reverses that exception, the hero should read as part of
 * Lokl, not an independently-designed campaign). The `eyebrow` field/
 * rendering mechanism itself is untouched and still generic (any slide
 * COULD set one) — G11 §8 only asked to remove the specific "Serving
 * Bhilai" content, which was cleared at the data level (migration 028)
 * on all four hero slides, not hardcoded out of this component.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bike } from "lucide-react";
import { api } from "@/lib/api";
import { ETAHeaderCard } from "@/components/consumer/ETAHeaderCard";
import type { HeroSlide } from "@/types";

const AUTOPLAY_MS = 4500;

/** Splits `headline` on the first occurrence of `highlight` and wraps
 *  that occurrence in the functional-orange span. No match (empty
 *  highlight, or a string that no longer appears verbatim in the
 *  headline) just returns the headline untouched. */
function renderHighlightedHeadline(headline: string, highlight?: string) {
  if (!highlight) return headline;
  const idx = headline.indexOf(highlight);
  if (idx === -1) return headline;
  const before = headline.slice(0, idx);
  const match = headline.slice(idx, idx + highlight.length);
  const after = headline.slice(idx + highlight.length);
  return (
    <>
      {before}
      <span className="text-[#E68910]">{match}</span>
      {after}
    </>
  );
}

function HeroSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-6">
      <div className="rounded-2xl min-h-[300px] md:min-h-[320px] bg-[#E5E2DC] animate-pulse" />
    </div>
  );
}

export function HeroCarousel({ l1Id }: { l1Id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["hero-slides", l1Id],
    queryFn: () => api.catalog.heroSlides(l1Id),
    staleTime: 5 * 60_000,
  });

  const slides = [...(data ?? [])].sort((a, b) => a.order - b.order);

  const { data: deliveryStatus, isLoading: deliveryLoading, isError: deliveryErrored } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: () => api.catalog.deliveryStatus(),
    staleTime: 60_000,
  });
  // CLOSED is a scheduled, forward-looking state (outside operating
  // hours) — same call HeroV2.tsx's floating badge already made: dim the
  // text and hide the LIVE/AWAY pill entirely rather than showing a
  // stale/misleading status badge for it.
  const isClosedLabel = deliveryStatus?.label === "CLOSED";

  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => { idxRef.current = idx; }, [idx]);

  // G6 fix: this used to call `.scrollIntoView({ block: "nearest" })` on the
  // slide element itself. When the hero was scrolled off-screen (user
  // scrolled down the page) and autoplay fired, the browser had to move the
  // PAGE's own vertical scroll to satisfy "nearest" — the element had zero
  // visibility, so "nearest" still meant "bring it minimally into view",
  // i.e. scroll the whole page back toward the hero. Scrolling the
  // container's own `scrollLeft` directly (not scrollIntoView on a child)
  // only ever touches this element's internal horizontal scroll — it can't
  // touch the page's vertical position, structurally, regardless of where
  // the hero sits in the viewport.
  const goTo = (i: number) => {
    const el = scrollRef.current;
    const clamped = ((i % slides.length) + slides.length) % slides.length;
    setIdx(clamped);
    if (!el || !el.children[0]) return;
    const itemWidth = (el.children[0] as HTMLElement).offsetWidth;
    el.scrollTo({ left: itemWidth * clamped, behavior: "smooth" });
  };

  const stopAutoplay = () => {
    stoppedRef.current = true;
    if (autoplayTimer.current) { clearInterval(autoplayTimer.current); autoplayTimer.current = null; }
  };

  useEffect(() => {
    if (slides.length <= 1) return;
    autoplayTimer.current = setInterval(() => {
      if (stoppedRef.current) return;
      goTo(idxRef.current + 1);
    }, AUTOPLAY_MS);
    return () => { if (autoplayTimer.current) clearInterval(autoplayTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const handleScroll = () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || !el.children[0]) return;
      const itemWidth = (el.children[0] as HTMLElement).offsetWidth;
      setIdx(Math.round(el.scrollLeft / itemWidth));
    }, 80);
  };

  if (isLoading) return <HeroSkeleton />;
  if (slides.length === 0) return null;

  return (
    <section data-testid="hero-carousel" className="relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-6">
        <div className="relative rounded-2xl overflow-hidden bg-[#0A1F5C]">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onPointerDown={stopAutoplay}
            onTouchStart={stopAutoplay}
            className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
          >
            {slides.map((slide, i) => {
              const content = (
                <>
                  <Image
                    src={slide.image}
                    alt={slide.headline || ""}
                    fill
                    priority={i === 0}
                    sizes="(max-width: 768px) 100vw, 1200px"
                    className="object-cover object-[60%_45%] md:object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/95 via-[#FDFBF7]/80 to-[#FDFBF7]/30 md:bg-gradient-to-r md:from-[#FDFBF7]/95 md:via-[#FDFBF7]/55 md:to-transparent" />
                  <div className="relative flex flex-col max-w-2xl px-5 md:px-10 lg:px-12 pt-6 md:pt-10 pb-16 md:pb-20 min-h-[300px] md:min-h-[320px]">
                    {slide.eyebrow && (
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#E68910]">{slide.eyebrow}</span>
                    )}
                    {slide.headline && (
                      <h1 className="font-display font-medium text-[#0A1F5C] mt-1 text-[28px] leading-[1.1] md:text-4xl lg:text-5xl tracking-tight">
                        {renderHighlightedHeadline(slide.headline, slide.highlight_text)}
                      </h1>
                    )}
                    {slide.subheadline && (
                      <p className="mt-2.5 md:mt-3 text-[13px] md:text-base text-[#0A1F5C]/75 md:text-[#475569] max-w-md leading-relaxed">
                        {slide.subheadline}
                      </p>
                    )}
                  </div>
                </>
              );
              const slideClassName = "relative snap-start shrink-0 w-full min-h-[300px] md:min-h-[320px]";
              return slide.cta_link ? (
                <Link key={slide.id} href={slide.cta_link} data-testid={`hero-carousel-slide-${i}`} className={slideClassName}>
                  {content}
                </Link>
              ) : (
                <div key={slide.id} data-testid={`hero-carousel-slide-${i}`} className={slideClassName}>
                  {content}
                </div>
              );
            })}
          </div>

          {slides.length > 1 && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { stopAutoplay(); goTo(i); }}
                  data-testid={`hero-carousel-dot-${i}`}
                  aria-label={`Go to slide ${i + 1}`}
                  className="p-2 -m-2 flex items-center"
                >
                  <span className={`h-1.5 rounded-full transition-all ${i === idx ? "bg-[#0A1F5C] w-5" : "bg-[#0A1F5C]/30 w-1.5"}`} />
                </button>
              ))}
            </div>
          )}

          {/* Floating delivery-status badge — one per carousel (site-wide
              data, not per-slide), bottom-left per the approved reference.
              Hidden only on a genuine fetch error; shows ETAHeaderCard's
              own skeleton while loading rather than a guessed value. */}
          {!deliveryErrored && (
            <div className="absolute bottom-5 left-5 md:bottom-6 md:left-10 lg:left-12">
              <ETAHeaderCard
                variant="pill"
                size="compact"
                testId="hero-delivery-badge"
                icon={Bike}
                loading={deliveryLoading}
                muted={isClosedLabel}
                title={deliveryStatus?.eta_label || ""}
                subtitle={deliveryStatus?.message}
                statusBadge={
                  deliveryLoading || isClosedLabel || !deliveryStatus
                    ? null
                    : { label: deliveryStatus.label, tone: deliveryStatus.label === "AWAY" ? "away" : "live" }
                }
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
