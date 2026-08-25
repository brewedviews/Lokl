"use client";

/**
 * Reusable image upload field for the Homepage Asset CMS.
 *
 * Supports BOTH:
 *   • Cloudinary file upload (primary path) — drag/drop or click to browse
 *   • URL paste (secondary) — admin pastes any image URL
 *
 * Always shows a live preview, the recommended dimensions, and a
 * one-click "Remove" affordance.
 *
 * G10 §10 — the URL-paste field used to call `onChange(rawUrl)` directly
 * on every keystroke, saving whatever foreign host's URL was typed
 * as-is. That's the actual root of "image dependent on an external URL
 * when it should be Lokl-managed": Cloudinary itself never auto-deletes
 * active assets (G9), but a foreign host's own URL can go dead on its
 * own schedule, entirely outside Lokl's control. Fixed by re-hosting:
 * pasting now requires an explicit "Use URL" action (click or Enter, not
 * live-as-you-type) that calls `adminApi.uploadCmsImageFromUrl`, which
 * downloads and re-uploads through Cloudinary server-side — the exact
 * same `cloudinary_service.upload_image_from_url()` already used for
 * merchant product-image sync. Only the resulting Cloudinary URL is ever
 * passed to `onChange`; the raw pasted URL is never itself saved.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Link as LinkIcon, X, Loader2, ImageIcon, ArrowRight } from "lucide-react";
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
  const [urlDraft, setUrlDraft] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const useUrl = async () => {
    const url = urlDraft.trim();
    if (!url) return;
    setFetchingUrl(true);
    try {
      const r = await adminApi.uploadCmsImageFromUrl(url, assetType);
      onChange(r.image_url);
      setUrlDraft("");
      toast.success("Image fetched and stored in Cloudinary");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fetch that image");
    } finally {
      setFetchingUrl(false);
    }
  };

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
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void useUrl(); } }}
            placeholder="…or paste an image URL, then fetch it"
            disabled={fetchingUrl}
            data-testid={`${testid}-url-input`}
            className="w-full pl-7 pr-3 py-1.5 rounded-full border border-[#E5E2DC] bg-white text-[11px] focus:border-[#0A1F5C] outline-none disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={() => void useUrl()}
          disabled={!urlDraft.trim() || fetchingUrl}
          data-testid={`${testid}-url-fetch-btn`}
          title="Fetch this URL and store it in Cloudinary"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-[#E5E2DC] text-[#0A1F5C] text-[11px] font-bold disabled:opacity-40 shrink-0"
        >
          {fetchingUrl ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
          {fetchingUrl ? "Fetching…" : "Use URL"}
        </button>
      </div>
      <p className="text-[9px] text-[#94A3B8] mt-1">
        Pasted URLs are downloaded and stored in Cloudinary — Lokl never links directly to an external image.
      </p>
    </div>
  );
}
