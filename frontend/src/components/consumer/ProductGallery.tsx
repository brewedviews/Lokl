"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Heart, Share2, ShoppingBag, Sparkles } from "lucide-react";
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
  /** Needed for the wishlist toggle in the icon row below the gallery —
   *  see that row's own comment for why it lives here again instead of
   *  overlaid on the image. */
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

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
    } catch {
      return; // user cancelled the native share sheet — not an error
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
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

      {/* ── MOBILE: near-full-bleed — a user report that the previous short
          h-[22vh] crop only showed the upper chest of a garment (object-cover
          on a too-short box crops aggressively) is why this is now a real
          aspect ratio (aspect-[3/4], taller than desktop's 4/5) at full
          width with no inset padding, instead of a padded tray at a capped
          viewport-height fraction. object-cover still crops to fill the
          box, but a proper portrait aspect ratio needs far less cropping to
          show a full top-to-hem garment shot than a squat 22vh strip did.
          bg-cream-warm is now just a loading-state fallback color, not a
          visible tray — the image fills the box edge to edge. Rounded only
          at the bottom (rounded-b-[20px]), matching the "sheet slides up
          over the image" effect the content panel below still does.
          Desktop keeps its own unchanged aspect-[4/5] two-column layout
          (see below) — this is mobile-only. ── */}
      <div className="md:hidden relative bg-cream-warm rounded-b-[20px] overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
        >
          {images.map((img, i) => (
            <div key={i} className="relative snap-start shrink-0 w-full aspect-[3/4] bg-white">
              <Image
                src={img}
                alt={`${name} ${i + 1}`}
                fill
                sizes="100vw"
                priority={i === 0}
                className="object-cover"
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
          nav + OS back gesture cover "back"; wishlist moved to the icon
          row below and to ConsumerHeader) — this badge is the only thing
          still overlaid on the photo. */}
      {aiEnhanced && (
        <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[11px] font-semibold flex items-center gap-1.5 pointer-events-none">
          <Sparkles size={11} className="text-[#E68910]" /> AI Enhanced
        </div>
      )}

      {/* Icon row, below the gallery, in normal document flow — NOT
          overlaid on the image. Plain icon buttons (no circle background),
          minimal visual weight, matching the compact reference pattern
          rather than a floating isolated button. This is the
          product-specific wishlist toggle; ConsumerHeader's own wishlist
          icon is a plain nav link to /wishlist, not a per-product toggle,
          so the two don't duplicate the same job.

          Right-aligned (justify-end) — was left-aligned, sitting directly
          above ProductDetailPanel's store-name row and reading as if it
          collided with/sat on top of it. Right-aligning puts it in its own
          clear corner of that horizontal band instead.

          relative z-20: page.tsx's ProductDetailPanel wrapper pulls itself
          up with a negative margin (-mt-5) to slide its rounded top corner
          over the image card's own rounded bottom corners — that effect
          was designed when the image card was the last thing ProductGallery
          rendered. Now this icon row renders after it, in the same
          -mt-5 overlap zone, so without a higher z-index than that
          wrapper's z-10 it would render UNDER the panel and disappear. ── */}
      <div className="relative z-20 flex items-center justify-end gap-5 px-4 md:px-0 mt-3">
        <button
          type="button"
          aria-label="Wishlist"
          aria-pressed={wished}
          data-testid="wishlist-btn"
          onClick={handleWishlist}
          className="flex items-center gap-1.5 text-ink-navy active:scale-95 transition"
        >
          <Heart size={18} className={wished ? "text-orange-500" : "text-ink-navy"} fill={wished ? "currentColor" : "none"} />
          <span className="text-xs font-medium">{wished ? "Saved" : "Save"}</span>
        </button>
        <button
          type="button"
          aria-label="Share"
          data-testid="share-btn"
          onClick={() => void handleShare()}
          className="flex items-center gap-1.5 text-ink-navy active:scale-95 transition"
        >
          <Share2 size={17} />
          <span className="text-xs font-medium">Share</span>
        </button>
      </div>
    </div>
  );
}
