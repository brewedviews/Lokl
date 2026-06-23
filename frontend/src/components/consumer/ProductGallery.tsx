"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ShoppingBag, Sparkles } from "lucide-react";

export function ProductGallery({
  name,
  images,
  aiEnhanced,
}: { name: string; images: string[]; aiEnhanced?: boolean }) {
  const [imgIdx, setImgIdx] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const prev = () => setImgIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setImgIdx((i) => (i + 1) % images.length);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 40) {
      if (diff > 0) next();
      else prev();
    }
  };

  if (images.length === 0) {
    return (
      <div
        data-testid="pdp-image"
        className="w-full aspect-[4/5] bg-slate-100 flex flex-col items-center justify-center text-[#94A3B8] text-sm"
      >
        <ShoppingBag size={36} className="mb-2 opacity-50" />
        <span>Image coming soon</span>
      </div>
    );
  }

  return (
    <div
      data-testid="pdp-image"
      className="relative w-full overflow-hidden bg-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(-${imgIdx * 100}%)` }}
      >
        {images.map((img, i) => (
          <div key={i} className="flex-shrink-0 w-full aspect-[4/5] relative">
            <Image
              src={img}
              alt={`${name} ${i + 1}`}
              fill
              sizes="100vw"
              priority={i === 0}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow items-center justify-center hover:bg-white"
            aria-label="Previous image"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={next}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow items-center justify-center hover:bg-white"
            aria-label="Next image"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      {images.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setImgIdx(i)}
              className={`h-2 rounded-full transition-all ${
                i === imgIdx ? "bg-[#1A2B4C] w-5" : "bg-white/80 border border-[#1A2B4C]/30 w-2"
              }`}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}

      {aiEnhanced && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#1A2B4C] text-white text-[11px] font-semibold flex items-center gap-1.5">
          <Sparkles size={11} className="text-[#E68910]" /> AI Enhanced
        </div>
      )}
    </div>
  );
}
