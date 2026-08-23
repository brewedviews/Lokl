"use client";

/**
 * HeroCarousel — the per-L1 hero banner, shown on Home (l1Id="l1-women",
 * since Women is the default-active tab there — see CategoryTileRow's own
 * doc comment) and on every /c/[slug] page (l1Id = that page's own L1).
 *
 * Redesign Phase B: this component now self-fetches from the real backend
 * HeroSlide collection (GET /api/hero-slides?l1_id=..., Phase A's model,
 * public-read endpoint added alongside this change) instead of taking a
 * `slides` prop — DEFAULT_HERO_SLIDES and l1HeroConfig.ts's static per-L1
 * copy are both gone, replaced by whatever an admin has published for that
 * L1 in CMS -> Homepage Assets -> Hero slides. An L1 with zero active
 * slides published (everything except Women today — see migration
 * 017_seed_hero_slides.py, the only seeded row) simply renders nothing;
 * this is real, expected, and matches the same "correct plumbing, sparse
 * data" situation Phase A's L2 store-aggregation work already surfaced —
 * not a bug, just content an admin hasn't entered yet.
 *
 * Visual rebuild: full-bleed (edge-to-edge, no rounded-2xl card/no max-w
 * padded tray around the image — unlike ProductGallery's PDP treatment,
 * which IS a padded/cornered card), replacing the old two-tier default/
 * compact sizing split entirely — there's now only one size, and it's the
 * same fixed `min-h-[200px]` at every breakpoint (a single shared
 * component property, not per-L1/per-breakpoint styling — Men/Kids will
 * inherit it automatically the moment either has a real published slide).
 *
 * height=200px, not the original ~92-104px "thin banner" first shipped:
 * that height was picked in the abstract and turned out to be a real
 * regression once tested against actual content — at 92-104px the
 * headline was already AT its 2-line clamp limit with the current
 * seeded copy ("Delivered in minutes from stores next door.", 45 chars)
 * and provably truncated on anything longer (measured live: a 62-char
 * headline clamped mid-word). 200px + text-lg headline + line-clamp-3
 * was arrived at by actually laying out both the real seeded headline and
 * a realistic longer one (screenshotted both) until neither clamped and
 * neither looked sparse — not a number picked in the abstract twice.
 * There is no separate CTA button/pill — the entire slide (full viewport
 * width × 200px) is itself the tap target via `cta_link`, which clears a
 * 44×44px minimum by a wide margin on its own; the HeroSlide backend
 * model has no subtitle or CTA-label field to render one from anyway.
 *
 * Scroll-snap + dot-indicator + autoplay mechanics are unchanged from the
 * pre-Phase-B version (still lifted from ProductGallery's own pattern —
 * see git history for the fuller rationale); only sizing/data-source
 * changed.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HeroSlide } from "@/types";

const AUTOPLAY_MS = 4500;

function HeroSkeleton() {
  return <div className="w-full min-h-[180px] bg-[#E5E2DC] animate-pulse" />;
}

export function HeroCarousel({ l1Id }: { l1Id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["hero-slides", l1Id],
    queryFn: () => api.catalog.heroSlides(l1Id),
    staleTime: 5 * 60_000,
  });

  const slides = [...(data ?? [])].sort((a, b) => a.order - b.order);

  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => { idxRef.current = idx; }, [idx]);

  const goTo = (i: number) => {
    const el = scrollRef.current;
    const clamped = ((i % slides.length) + slides.length) % slides.length;
    if (!el || !el.children[clamped]) { setIdx(clamped); return; }
    (el.children[clamped] as HTMLElement).scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const stopAutoplay = () => {
    stoppedRef.current = true;
    if (autoplayTimer.current) { clearInterval(autoplayTimer.current); autoplayTimer.current = null; }
  };

  // Autoplay — stop-permanently (not pause/resume) once the user has
  // touched the strip; see this file's own history for why that's simpler
  // than a resume-after-inactivity model.
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
    <section data-testid="hero-carousel" className="relative w-full overflow-hidden bg-[#0A1F5C]">
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
                sizes="100vw"
                className="object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#FDFBF7]/95 via-[#FDFBF7]/55 to-transparent" />
              <div className="relative h-full flex flex-col justify-center max-w-[75%] sm:max-w-md px-5 sm:px-8">
                {slide.eyebrow && (
                  <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-[#E68910]">{slide.eyebrow}</span>
                )}
                {slide.headline && (
                  <h1 className="font-display font-bold text-[#0A1F5C] text-lg sm:text-xl leading-snug line-clamp-3 mt-1.5">
                    {slide.headline}
                  </h1>
                )}
              </div>
            </>
          );
          const slideClassName = "relative snap-start shrink-0 w-full min-h-[200px]";
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
        <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1">
          {slides.map((_, i) => (
            // p-2 padding gives each dot a real ~24px+ touch target without
            // growing the visual mark itself — the inner span stays a slim
            // 1.5px bar, matching the rest of this component's restraint.
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
    </section>
  );
}
