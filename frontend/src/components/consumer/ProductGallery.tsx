"use client";

/** Image gallery for the PDP. */
import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Sparkles, ShoppingBag } from "lucide-react";

export function ProductGallery({
  name,
  images,
  aiEnhanced,
}: { name: string; images: string[]; aiEnhanced?: boolean }) {
  const [imgIdx, setImgIdx] = useState(0);
  return (
    <div data-testid="pdp-image" className="relative rounded-2xl overflow-hidden bg-slate-100">
      {images[imgIdx] ? (
        <Image
          src={images[imgIdx]}
          alt={name}
          width={800}
          height={1000}
          priority
          className="w-full aspect-[4/5] object-cover"
        />
      ) : (
        <div className="w-full aspect-[4/5] flex flex-col items-center justify-center text-[#94A3B8] text-sm">
          <ShoppingBag size={36} className="mb-2 opacity-50" />
          <span>Image coming soon</span>
        </div>
      )}
      {images.length > 1 && (
        <>
          <button onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-white" aria-label="Previous image"><ChevronLeft size={18} /></button>
          <button onClick={() => setImgIdx((i) => (i + 1) % images.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center hover:bg-white" aria-label="Next image"><ChevronRight size={18} /></button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setImgIdx(i)} className={`w-2 h-2 rounded-full transition ${i === imgIdx ? "bg-[#0A1F5C] w-5" : "bg-white/80 border border-[#0A1F5C]/30"}`} aria-label={`Go to image ${i + 1}`} />
            ))}
          </div>
        </>
      )}
      {aiEnhanced && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#0A1F5C] text-white text-[11px] font-semibold flex items-center gap-1.5">
          <Sparkles size={11} className="text-[#F59E0B]" /> AI Enhanced
        </div>
      )}
    </div>
  );
}
