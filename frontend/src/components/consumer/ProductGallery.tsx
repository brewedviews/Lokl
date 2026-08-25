"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ShoppingBag, Sparkles } from "lucide-react";
import { RibbonTag } from "./RibbonTag";

interface ProductGalleryProps {
  name: string;
  images: string[];
  aiEnhanced?: boolean;
  /** Discount %, if any — drives the top-left status ribbon ("SALE") on the
   *  first image. 0/undefined renders no ribbon (never fabricated). */
  discount?: number;
  /** Real try_at_doorstep flag — drives the bottom-left "try & buy" banner
   *  on the first image. */
  tryAndBuy?: boolean;
  /** Optional fit attribute (oversized/regular/slim) — not on the current
   *  product data model yet, so this is undefined today and the overlay
   *  simply never renders. Wired ahead of that field landing. */
  fit?: string | null;
  /** Only overlay `fit` text when the shot is a plain/light studio
   *  background — never on lifestyle/busy photography. Also not on the
   *  data model yet; defaults to false (never render) until a merchant/
   *  admin flag for this exists. */
  isCleanBackground?: boolean;
}

export function ProductGallery({
  name,
  images,
  aiEnhanced,
  discount = 0,
  tryAndBuy = false,
  fit = null,
  isCleanBackground = false,
}: ProductGalleryProps) {
  const [imgIdx, setImgIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = (i: number) => {
    const el = scrollRef.current;
    if (!el) { setImgIdx(i); return; }
    const item = el.children[i] as HTMLElement | undefined;
    item?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  const prev = () => goTo((imgIdx - 1 + images.length) % images.length);
  const next = () => goTo((imgIdx + 1) % images.length);

  // Native scroll-snap drives the carousel (see the flex/snap classes
  // below) instead of a JS transform — this is what makes the "peek" of
  // the next image at the right edge fall out for free: each slide is
  // 90% of the container width, so 10% of its right-hand neighbor is
  // always visible except on the LAST slide, which naturally ends flush
  // with no trailing peek since there's nothing after it.
  const handleScroll = () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || !el.children[0]) return;
      const itemWidth = (el.children[0] as HTMLElement).offsetWidth + 8; // + gap
      setImgIdx(Math.round(el.scrollLeft / itemWidth));
    }, 80);
  };

  const mainImage = images[imgIdx] ?? images[0] ?? "";
  const showFitOverlay = !!fit && isCleanBackground;

  if (images.length === 0) {
    return (
      <div
        data-testid="pdp-image"
        className="relative w-full aspect-[4/5] bg-cream-warm flex flex-col items-center justify-center text-[#94A3B8] text-sm"
      >
        <ShoppingBag size={36} className="mb-2 opacity-50" />
        <span>Image coming soon</span>
      </div>
    );
  }

  return (
    <div data-testid="pdp-image" className="relative">

      {/* ── MOBILE: capped at ~46% of viewport height — went through three
          passes before landing here. First was a short h-[22vh] padded tray
          that cropped a full-length garment down to just the upper chest.
          The fix for that swapped to a real portrait aspect ratio
          (aspect-[3/4]) at full width with no height cap at all, which
          fixed the crop but pushed title/price/size entirely below the
          fold. h-[58vh] (the initial "roughly 55-60%" target) still wasn't
          short enough once StickyBottomNav is factored in: that nav is
          fixed at the true bottom of the viewport and covers its own ~64px
          strip regardless of scroll position, so the effective visible
          fold on a 667px-tall phone is really ~603px, not 667. Measured
          against that real budget, h-[46vh] is what actually gets price
          fully visible and the "Size" label peeking above the nav without
          scrolling, while still showing enough of the photo that a full
          flat-lay/full-length shot doesn't read as cropped (object-cover
          on a ~46vh box crops far less than the old 22vh one did — verified
          against both a torso-crop photo and a full garment-on-hanger
          shot). No aspect-ratio class here — height is the fixed dimension,
          width is always 100%.

          G9 — switched to object-contain: object-cover on a fixed-height
          box was still cropping genuinely portrait/full-length product
          photos (the exact tradeoff this comment already documented above
          — "doesn't read as cropped" was a judgment call, not a guarantee).
          A PDP's job is letting the customer confidently see the whole
          product before buying, so bg-cream-warm stops being just a
          loading fallback and becomes the visible letterbox tray around
          whatever crop the source photo's own aspect ratio leaves — same
          token either way, no new color introduced. Rounded only at the
          bottom (rounded-b-[20px]), matching the "sheet slides up over the
          image" effect the content panel below still does. Desktop keeps
          its own unchanged aspect-[4/5] two-column layout (see below) —
          this is mobile-only. Thumbnails stay object-cover deliberately —
          they're a navigation aid, not the "see the product" moment, and
          uniform cropped squares scan faster than variable-content ones. ── */}
      <div className="md:hidden relative bg-cream-warm rounded-b-[20px] overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
        >
          {images.map((img, i) => (
            <div key={i} className="relative snap-start shrink-0 w-full h-[46vh] bg-white">
              <Image
                src={img}
                alt={`${name} ${i + 1}`}
                fill
                sizes="100vw"
                priority={i === 0}
                className="object-contain"
              />
              {i === 0 && discount > 0 && (
                <RibbonTag text={`${discount}% off`} position="top-left" />
              )}
              {i === 0 && tryAndBuy && (
                <RibbonTag text="try & buy" variant="banner" position="bottom-left" />
              )}
              {i === 0 && showFitOverlay && (
                <span
                  data-testid="pdp-fit-overlay"
                  className="absolute top-11 left-3 text-ink-navy font-bold text-sm uppercase tracking-wide"
                >
                  {fit}
                </span>
              )}
            </div>
          ))}
        </div>

        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="hidden sm:flex absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow items-center justify-center hover:bg-white"
              aria-label="Previous image"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={next}
              className="hidden sm:flex absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow items-center justify-center hover:bg-white"
              aria-label="Next image"
            >
              <ChevronRight size={18} />
            </button>
            <div className="flex justify-center gap-1.5 py-3">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === imgIdx ? "bg-ink-navy w-5" : "bg-white border border-ink-navy/30 w-2"
                  }`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── DESKTOP: vertical thumbnail rail + main image (unchanged
          side-by-side layout — the "sheet slides up over the image"
          mobile treatment doesn't apply to a two-column desktop grid). ── */}
      <div className="hidden md:flex gap-3">
        {images.length > 1 && (
          <div className="flex flex-col gap-2 w-[72px] shrink-0">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setImgIdx(i)}
                className={`relative w-[72px] h-[90px] rounded-xl overflow-hidden border-2 transition-all ${
                  i === imgIdx
                    ? "border-[#0A1F5C] opacity-100"
                    : "border-transparent opacity-50 hover:opacity-80"
                }`}
                aria-label={`View image ${i + 1}`}
              >
                <Image
                  src={img}
                  alt={`${name} ${i + 1}`}
                  fill
                  sizes="72px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {mainImage && (
          <div className="relative flex-1 aspect-[4/5] rounded-2xl overflow-hidden bg-cream-warm">
            <Image
              src={mainImage}
              alt={name}
              fill
              sizes="(min-width: 1200px) 600px, 50vw"
              priority
              className="object-contain"
            />
            {imgIdx === 0 && discount > 0 && (
              <RibbonTag text={`${discount}% off`} position="top-left" />
            )}
            {imgIdx === 0 && tryAndBuy && (
              <RibbonTag text="try & buy" variant="banner" position="bottom-left" />
            )}
            {imgIdx === 0 && showFitOverlay && (
              <span
                data-testid="pdp-fit-overlay-desktop"
                className="absolute top-11 left-3 text-ink-navy font-bold text-sm uppercase tracking-wide"
              >
                {fit}
              </span>
            )}
          </div>
        )}
      </div>

      {/* AI Enhanced badge — overlays both layouts, top-right. Wishlist and
          the back button were both removed from the image itself (bottom
          nav + OS back gesture cover "back"; wishlist/share now live as
          icon-only buttons in PdpCtaRow, beside Add to bag) — this badge is
          the only thing still overlaid on the photo. */}
      {aiEnhanced && (
        <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[11px] font-semibold flex items-center gap-1.5 pointer-events-none">
          <Sparkles size={11} className="text-[#E68910]" /> AI Enhanced
        </div>
      )}
    </div>
  );
}
