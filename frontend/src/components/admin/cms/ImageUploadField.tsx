"use client";

/**
 * Reusable image upload field for the Homepage Asset CMS.
 *
 * Supports BOTH:
 *   • Cloudinary file upload (primary path) — drag/drop or click to browse
 *   • URL paste (secondary) — admin can paste any image URL
 *
 * Always shows a live preview, the recommended dimensions, and a
 * one-click "Remove" affordance.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, X, Loader2, ImageIcon } from "lucide-react";
import { adminApi } from "@/lib/api/admin";

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  recommended: string;     // e.g. "1920×700"
  testid: string;
  className?: string;
  /** Cloudinary folder to route into — defaults to the shared "cms" folder.
   *  Pass "brand_logo" from the Brand admin surface. */
  assetType?: "cms" | "brand_logo";
}

export function ImageUploadField({ label, value, onChange, recommended, testid, className, assetType = "cms" }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setBusy(true);
    try {
      const r = await adminApi.uploadCmsImage(file, assetType);
      onChange(r.image_url);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`block ${className || ""}`} data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#0A1F5C]">{label}</span>
        <span className="text-[10px] text-[#94A3B8]">Recommended: {recommended}</span>
      </div>

      <div className="relative aspect-[16/7] rounded-xl overflow-hidden border-2 border-dashed border-[#E5E2DC] bg-[#FDFBF7]">
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange("")}
              data-testid={`${testid}-remove`}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white shadow flex items-center justify-center text-[#DC2626] hover:bg-red-50"
              title="Remove image"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            data-testid={`${testid}-empty`}
            className="absolute inset-0 flex flex-col items-center justify-center text-[#94A3B8] hover:text-[#0A1F5C] hover:bg-white/60 transition"
          >
            <ImageIcon size={28} />
            <span className="text-[11px] mt-1.5 font-semibold">No image</span>
          </button>
        )}
        {busy && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-[#0A1F5C]" />
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid={`${testid}-file-input`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
      />

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          data-testid={`${testid}-upload-btn`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0A1F5C] text-white text-[11px] font-bold disabled:opacity-40"
        >
          <Upload size={12} /> Upload
        </button>
        <div className="flex-1 relative">
          <LinkIcon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste image URL"
            data-testid={`${testid}-url-input`}
            className="w-full pl-7 pr-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[11px] focus:border-[#0A1F5C] outline-none"
          />
        </div>
      </div>
    </div>
  );
}
