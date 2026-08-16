"use client";

/**
 * HeroCarousel — replaces the old static HeroV2 in Home's hero slot.
 *
 * Scroll-snap + dot-indicator mechanics are lifted from ProductGallery's
 * mobile image gallery (flex overflow-x-auto snap-x snap-mandatory, a
 * debounced scroll listener deriving the active index, scrollIntoView for
 * programmatic navigation) rather than built from scratch — see that
 * component's own doc comment for why this is the established pattern
 * for a swipeable strip in this codebase.
 *
 * Autoplay: a single setInterval (AUTOPLAY_MS) advances to the next slide
 * via the same goTo() the dots use, wrapping back to 0 after the last
 * slide. Of the two pause behaviors the spec allowed (pause-and-resume-
 * after-inactivity vs. stop-permanently-on-manual-interaction), this uses
 * the LATTER — stopAutoplay() is called on the first touch/pointer-down
 * on the strip or the first dot click, and once called the interval never
 * restarts for the rest of this component's lifetime. Pause-and-resume
 * needs a second debounced timer that has to coexist with the autoplay
 * interval without racing it (e.g. a resume firing mid-drag); permanent
 * stop-on-interaction has no such race — "the user is now driving, stop
 * driving for them" is a strictly simpler rule and was chosen for that
 * reason, not because resume wouldn't also be valid.
 *
 * HeroSlide[] is a prop, not fetched here — for THIS phase the caller
 * passes DEFAULT_HERO_SLIDES (below), a static placeholder array reusing
 * imagery already referenced elsewhere in this codebase (the existing
 * hero image, plus the same Unsplash photos the Women/Men/Ethnic L1
 * category tiles already use — see backend/seed_data.py's L1_CATEGORIES).
 * Swapping in real backend-driven slides later (once the offers model's
 * ALLOWED_OFFER_FIELDS gap from the audit is fixed) is a data-source
 * change at the call site, not a change to this component.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export interface HeroSlide {
  id: string;
  image: string;
  mobileImage?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

const AUTOPLAY_MS = 4500;

// Reuses FALLBACK_HERO_IMG's exact asset (the one hero photo that actually
// exists in this codebase today, see v2/HeroV2.tsx) for slide 1, and the
// same Unsplash URLs backend/seed_data.py's L1_CATEGORIES already use for
// Women/Men/Ethnic Wear (bumped to a wider crop for a hero-sized banner)
// for slides 2-4 — placeholder content, not new asset uploads, per the
// phase-1 scope (no real offers/category-scoped banners yet).
export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    id: "welcome",
    image: "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    eyebrow: "Serving Bhilai",
    title: "Delivered in minutes from stores next door.",
    subtitle: "Hand-picked fashion from trusted Bhilai stores.",
    ctaLabel: "Shop now",
    ctaHref: "/products",
  },
  {
    id: "women",
    image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
    eyebrow: "New in",
    title: "Fresh drops in Women's Fashion",
    subtitle: "Dresses, ethnic wear and more from local stores.",
    ctaLabel: "Shop Women",
    ctaHref: "/c/women",
  },
  {
    id: "men",
    image: "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=1200&q=80",
    eyebrow: "Trending",
    title: "Level up your Men's wardrobe",
    subtitle: "Shirts, jeans and ethnic wear, delivered fast.",
    ctaLabel: "Shop Men",
    ctaHref: "/c/men",
  },
  {
    id: "ethnic",
    image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&q=80",
    eyebrow: "Festive ready",
    title: "Ethnic wear for every occasion",
    subtitle: "Kurtas, sarees and more from Bhilai's own stores.",
    ctaLabel: "Shop Ethnic Wear",
    ctaHref: "/c/ethnic",
  },
];

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
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

  // Autoplay — see doc comment above for why this is stop-permanently
  // (not pause/resume) once the user has touched the strip.
  useEffect(() => {
    if (slides.length <= 1) return;
    autoplayTimer.current = setInterval(() => {
      if (stoppedRef.current) return;
      goTo(idxRef.current + 1);
    }, AUTOPLAY_MS);
    return () => { if (autoplayTimer.current) clearInterval(autoplayTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Same debounced-scroll-end -> derive-active-index pattern ProductGallery
  // uses, so the dots stay correct whether a slide change came from
  // autoplay, a dot click, or the user's own swipe.
  const handleScroll = () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || !el.children[0]) return;
      const itemWidth = (el.children[0] as HTMLElement).offsetWidth;
      setIdx(Math.round(el.scrollLeft / itemWidth));
    }, 80);
  };

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
            {slides.map((slide, i) => (
              <div
                key={slide.id}
                data-testid={`hero-carousel-slide-${i}`}
                className="relative snap-start shrink-0 w-full min-h-[300px] md:min-h-[320px]"
              >
                <Image
                  src={slide.mobileImage || slide.image}
                  alt={slide.title}
                  fill
                  priority={i === 0}
                  sizes="100vw"
                  className="object-cover object-center md:hidden"
                />
                <Image
                  src={slide.image}
                  alt={slide.title}
                  fill
                  priority={i === 0}
                  sizes="(max-width: 768px) 100vw, 1200px"
                  className="object-cover object-[60%_45%] md:object-center hidden md:block"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#FDFBF7]/95 via-[#FDFBF7]/80 to-[#FDFBF7]/30 md:bg-gradient-to-r md:from-[#FDFBF7]/95 md:via-[#FDFBF7]/55 md:to-transparent" />
                <div className="relative px-5 md:px-10 lg:px-12 py-6 md:py-10 min-h-[300px] md:min-h-[320px] flex flex-col justify-center max-w-2xl">
                  {slide.eyebrow && (
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#E68910]">{slide.eyebrow}</span>
                  )}
                  <h1 className="font-display text-[26px] leading-[1.1] md:text-4xl lg:text-5xl font-bold tracking-tight text-[#0A1F5C] mt-1">
                    {slide.title}
                  </h1>
                  {slide.subtitle && (
                    <p className="mt-2.5 md:mt-3 text-[13px] md:text-base text-[#0A1F5C]/75 md:text-[#475569] max-w-md leading-relaxed">
                      {slide.subtitle}
                    </p>
                  )}
                  {slide.ctaLabel && slide.ctaHref && (
                    <Link
                      href={slide.ctaHref}
                      data-testid={`hero-carousel-cta-${i}`}
                      className="inline-flex items-center self-start mt-4 px-5 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-bold hover:bg-[#0A1F5C]/90 transition"
                    >
                      {slide.ctaLabel}
                    </Link>
                  )}
                </div>
              </div>
            ))}
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
                  className={`h-1.5 rounded-full transition-all ${i === idx ? "bg-[#0A1F5C] w-5" : "bg-[#0A1F5C]/30 w-1.5"}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
