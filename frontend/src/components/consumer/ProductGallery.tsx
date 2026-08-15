"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, ShoppingBag, Sparkles, Heart } from "lucide-react";
import { RibbonTag } from "./RibbonTag";
import { useWishlistStore } from "@/stores";
import type { Product } from "@/types";

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
  /** Wishlist toggle lives on the image itself (bottom-right, white circle)
   *  now that ConsumerHeader/ProductTopActions no longer render on the PDP —
   *  needs the full product for useWishlistStore.toggle(). */
  product: Product;
}

export function ProductGallery({
  name,
  images,
  aiEnhanced,
  discount = 0,
  tryAndBuy = false,
  fit = null,
  isCleanBackground = false,
  product,
}: ProductGalleryProps) {
  const router = useRouter();
  const [imgIdx, setImgIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isWishlisted = useWishlistStore((s) => s.isWishlisted(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [wished, setWished] = useState(false);
  useEffect(() => { setWished(isWishlisted); }, [isWishlisted]);
  const handleWishlist = () => {
    const next = toggleWishlist(product);
    const justAdded = next.some((x) => x.id === product.id);
    setWished(justAdded);
    toast.success(justAdded ? "Saved to wishlist" : "Removed from wishlist");
  };

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

  // Back button — was ProductPdpHeader's sticky-top affordance; that header
  // is retired in favour of the global ConsumerHeader (which has no "back"
  // concept), so this lives on the image itself now. Same visual treatment
  // (filled near-black circle, white chevron, w-10 h-10) as the old header's
  // unscrolled state, but always visible — no scroll-conditional styling.
  const backBtn = (testId: string) => (
    <button
      type="button"
      aria-label="Back"
      data-testid={testId}
      onClick={() => router.back()}
      className="absolute top-3 left-3 z-20 w-10 h-10 rounded-full flex items-center justify-center bg-near-black text-white shadow-sm active:scale-90 transition"
    >
      <ArrowLeft size={19} />
    </button>
  );

  const wishlistBtn = (testId: string) => (
    <button
      type="button"
      aria-label="Wishlist"
      aria-pressed={wished}
      data-testid={testId}
      onClick={handleWishlist}
      className="absolute bottom-3 right-3 z-10 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm active:scale-90 transition"
    >
      <Heart size={18} className={wished ? "text-orange-500" : "text-ink-navy"} fill={wished ? "currentColor" : "none"} />
    </button>
  );

  if (images.length === 0) {
    return (
      <div
        data-testid="pdp-image"
        className="relative w-full aspect-[4/5] bg-cream-warm flex flex-col items-center justify-center text-[#94A3B8] text-sm"
      >
        {backBtn("pdp-back-btn")}
        <ShoppingBag size={36} className="mb-2 opacity-50" />
        <span>Image coming soon</span>
      </div>
    );
  }

  return (
    <div data-testid="pdp-image" className="relative">

      {/* ── MOBILE: warm-gray card, square top (flush with the sticky
          header above), rounded-bottom only, padding around the product
          instead of full-bleed. Scroll-snap carousel with a right-edge
          peek. ── */}
      <div className="md:hidden relative bg-cream-warm rounded-b-[20px] pt-2 pb-4 px-4">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory rounded-2xl"
        >
          {images.map((img, i) => (
            <div key={i} className="relative snap-start shrink-0 w-full aspect-[4/5] rounded-2xl overflow-hidden bg-white">
              <Image
                src={img}
                alt={`${name} ${i + 1}`}
                fill
                sizes="90vw"
                priority={i === 0}
                className="object-cover"
              />
              {i === 0 && discount > 0 && (
                <RibbonTag text={`${discount}% off`} position="top-left-inset" />
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
        {wishlistBtn("wishlist-btn")}
        {backBtn("pdp-back-btn")}

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
            <div className="flex justify-center gap-1.5 mt-3">
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
          <div className="relative flex-1 aspect-[4/5] rounded-2xl overflow-hidden bg-slate-100">
            <Image
              src={mainImage}
              alt={name}
              fill
              sizes="(min-width: 1200px) 600px, 50vw"
              priority
              className="object-cover"
            />
            {imgIdx === 0 && discount > 0 && (
              <RibbonTag text={`${discount}% off`} position="top-left-inset" />
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
            {wishlistBtn("wishlist-btn-desktop")}
            {backBtn("pdp-back-btn-desktop")}
          </div>
        )}
      </div>

      {/* AI Enhanced badge — overlays both layouts, top-right (clear of
          both the top-left ribbon and the bottom-right wishlist heart). */}
      {aiEnhanced && (
        <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[11px] font-semibold flex items-center gap-1.5 pointer-events-none">
          <Sparkles size={11} className="text-[#E68910]" /> AI Enhanced
        </div>
      )}
    </div>
  );
}
