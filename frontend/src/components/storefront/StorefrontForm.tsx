"use client";

/**
 * Shared storefront form — the single implementation of "what fields make
 * up a storefront and how they're validated," used by BOTH:
 *   - the merchant's own onboarding/edit page (app/merchant/storefront/page.tsx)
 *   - admin's "Setup Storefront" flow for a merchant with none yet
 *     (app/admin/merchants/[id]/page.tsx)
 *
 * Mirrors how components/products/ProductForm.tsx is shared between the
 * merchant product editor and admin product creation/edit — same field set,
 * same validation, same image-upload plumbing, no second implementation.
 *
 * Deliberately renders NO modal chrome of its own (unlike ProductForm,
 * which always renders its own backdrop+sheet): the merchant page is a
 * dedicated full-page onboarding step, while admin needs this inside a
 * modal. Each host supplies its own chrome around these bare fields so
 * neither context is forced into the other's presentation.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { X, ImagePlus, Clock, MapPin, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BHILAI_AREAS, findBhilaiArea } from "@/data/bhilai-areas";

const WEEKLY_OFF_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface StorefrontFormInitial {
  tagline?: string;
  story?: string;
  banners?: string[];
  banner_public_ids?: string[];
  locality?: string;
  opens_at?: string;
  closes_at?: string;
  lat?: number | null;
  lng?: number | null;
  area_slug?: string;
  area_label?: string;
  pincode?: string;
  upi_qr_url?: string;
  weekly_off?: string[];
}

/** Matches backend `StorefrontUpdate` field-for-field (server.py) — both
 *  POST /merchant/storefront and POST /admin/merchants/{id}/storefront
 *  accept this exact shape. */
export interface StorefrontFormBody {
  tagline: string;
  story: string;
  banner: string;
  banners: string[];
  banner_public_ids: string[];
  logo: string;
  logo_public_id: string;
  locality: string;
  opens_at: string;
  closes_at: string;
  lat: number;
  lng: number;
  area: string;
  area_label: string;
  pincode: string;
  upi_qr_url: string;
  weekly_off: string[];
  specialties: string[];
}

function toFormState(d: StorefrontFormInitial | null | undefined) {
  return {
    tagline: d?.tagline || "",
    story: d?.story || "",
    banners: d?.banners && d.banners.length ? d.banners : [],
    banner_public_ids: d?.banner_public_ids && d.banner_public_ids.length ? d.banner_public_ids : [],
    locality: d?.locality || "",
    opens_at: d?.opens_at || "10:00",
    closes_at: d?.closes_at || "18:00",
    lat: d?.lat != null ? String(d.lat) : "",
    lng: d?.lng != null ? String(d.lng) : "",
    area_slug: d?.area_slug || "",
    area_label: d?.area_label || "",
    pincode: d?.pincode || "",
    upi_qr_url: d?.upi_qr_url || "",
    weekly_off: d?.weekly_off || [],
  };
}

export function StorefrontForm({
  mode, storeName, businessAddress, initialData, onSubmit, onClose, callerScope = "merchant", submitLabel,
}: {
  mode: "create" | "edit";
  storeName: string;
  businessAddress?: string;
  initialData?: StorefrontFormInitial | null;
  onSubmit: (body: StorefrontFormBody) => Promise<void>;
  /** Omit for a dedicated page (no cancel affordance); pass for a modal. */
  onClose?: () => void;
  /** "admin" forces the admin JWT on image upload/delete — see lib/uploads.ts. */
  callerScope?: "merchant" | "admin";
  submitLabel?: string;
}) {
  const [form, setForm] = useState(() => toFormState(initialData));
  const [saving, setSaving] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Public_ids removed from `banners` in THIS session but not yet confirmed
  // via Save — the actual Cloudinary delete only fires once onSubmit
  // resolves successfully (see submit() below). Removing-then-discarding
  // (closing without saving) never touches Cloudinary.
  const [pendingDeletePublicIds, setPendingDeletePublicIds] = useState<string[]>([]);

  useEffect(() => {
    setForm(toFormState(initialData));
    setPendingDeletePublicIds([]);
    setSubmitAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  const pickBanner = async (file: File | null) => {
    if (!file) return;
    if (form.banners.length >= 5) return toast.error("Up to 5 banners");
    setUploading(true);
    try {
      const { image_url, public_id } = await uploadImage(file, "store_banner", callerScope);
      setForm((f) => ({ ...f, banners: [...f.banners, image_url], banner_public_ids: [...f.banner_public_ids, public_id] }));
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setUploading(false); }
  };
  const removeBanner = (idx: number) => {
    const pid = form.banner_public_ids[idx];
    setForm((f) => ({
      ...f,
      banners: f.banners.filter((_, i) => i !== idx),
      banner_public_ids: f.banner_public_ids.filter((_, i) => i !== idx),
    }));
    if (pid) setPendingDeletePublicIds((ids) => [...ids, pid]);
  };

  // Area pick auto-fills pincode + seeds lat/lng from the area centroid —
  // only when lat/lng aren't already set, so it never clobbers a pin the
  // merchant/admin already confirmed.
  const onPickArea = (slug: string) => {
    const a = findBhilaiArea(slug);
    if (!a) { setForm((f) => ({ ...f, area_slug: "", area_label: "" })); return; }
    setForm((f) => ({
      ...f,
      area_slug: a.slug, area_label: a.label, pincode: a.pincode,
      lat: f.lat || a.lat.toFixed(6),
      lng: f.lng || a.lng.toFixed(6),
    }));
  };

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Geolocation unsupported on this device");
    setPinning(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setPinning(false);
        toast.success("Pinned to current location");
      },
      (err) => { setPinning(false); toast.error(err?.message || "Could not access location"); },
      { timeout: 10000, enableHighAccuracy: true },
    );
  };

  const submit = async () => {
    setSubmitAttempted(true);
    if (!form.tagline || !form.story || form.banners.length === 0) return toast.error("Tagline, story and at least 1 cover image are required");
    if (form.opens_at >= form.closes_at) return toast.error("Closing time must be after opening time");
    if (!form.area_slug) return toast.error("Please select an area");
    if (!(form.pincode || "").trim()) return toast.error("Pincode is required");
    const lat = parseFloat(form.lat), lng = parseFloat(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return toast.error("Latitude and longitude are required — use \"Use current location\" or enter them directly");
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return toast.error("Invalid coordinates");
    if (!form.upi_qr_url) return toast.error("UPI QR code is required for payments");
    setSaving(true);
    try {
      await onSubmit({
        tagline: form.tagline, story: form.story,
        banners: form.banners, banner: form.banners[0] || "",
        banner_public_ids: form.banner_public_ids,
        logo: form.banners[0] || "", logo_public_id: form.banner_public_ids[0] || "",
        locality: form.locality, opens_at: form.opens_at, closes_at: form.closes_at,
        lat, lng, specialties: [],
        area: form.area_slug, area_label: form.area_label, pincode: form.pincode.trim(),
        upi_qr_url: form.upi_qr_url, weekly_off: form.weekly_off,
      });
      // Only now — once the storefront save is confirmed persisted — delete
      // any banners removed during this session.
      for (const pid of pendingDeletePublicIds) void deleteUploadedImage(pid, callerScope);
      setPendingDeletePublicIds([]);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-testid="storefront-form">
      <div className="grid md:grid-cols-2 gap-3 pb-4 border-b border-[#E5E2DC]">
        <FieldRO label="Store name (locked)" value={storeName} />
        <FieldRO label="Business address (locked)" value={businessAddress || ""} />
      </div>

      <Field label="Tagline *">
        <input data-testid="sf-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. Handpicked ethnic luxury" className={inputCls} />
      </Field>
      <Field label="Store story *">
        <textarea data-testid="sf-story" value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} rows={3} placeholder="A few lines about the brand, heritage or vibe" className={inputCls} />
      </Field>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Opens at"><input data-testid="sf-opens" type="time" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} className={inputCls} /></Field>
        <Field label="Closes at"><input data-testid="sf-closes" type="time" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} className={inputCls} /></Field>
      </div>
      <p className="text-[11px] text-[#595959] -mt-2"><Clock size={11} className="inline mr-1" />Orders are accepted from 30 minutes after opening to 30 minutes before closing.</p>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Weekly off days</div>
        <div className="flex flex-wrap gap-2">
          {WEEKLY_OFF_DAYS.map((day) => {
            const selected = form.weekly_off.includes(day);
            return (
              <button key={day} type="button" data-testid={`sf-weekly-off-${day}`}
                onClick={() => setForm({ ...form, weekly_off: selected ? form.weekly_off.filter((d) => d !== day) : [...form.weekly_off, day] })}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${selected ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#595959] border-[#E5E2DC] hover:border-[#0A1F5C]"}`}>
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5E2DC] bg-[#FDFBF7] p-4 space-y-4">
        <div>
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Area / neighbourhood *</div>
            <select data-testid="sf-area-picker" value={form.area_slug} onChange={(e) => onPickArea(e.target.value)} className={`${inputCls} bg-white appearance-auto`}>
              <option value="">Select area in Bhilai</option>
              {BHILAI_AREAS.map((a) => <option key={a.slug} value={a.slug}>{a.label} — {a.pincode}</option>)}
            </select>
          </label>
          {submitAttempted && !form.area_slug && <p data-testid="sf-area-error" className="text-red-500 text-xs mt-1">Please select an area</p>}
        </div>

        <div>
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">Pincode *</div>
            <input data-testid="sf-pincode" value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              placeholder="Pincode (auto-filled)" inputMode="numeric" maxLength={6} className={inputCls} />
          </label>
          {submitAttempted && !form.pincode.trim() && <p data-testid="sf-pincode-error" className="text-red-500 text-xs mt-1">Pincode is required</p>}
        </div>

        <div>
          <div className="flex items-start gap-2 mb-2">
            <MapPin size={16} className="text-[#E68910] shrink-0 mt-0.5" />
            <div className="text-sm font-semibold text-[#0A1F5C]">Exact store location *</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input data-testid="sf-lat" type="number" step="any" placeholder="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className={inputCls} />
            <input data-testid="sf-lng" type="number" step="any" placeholder="Longitude" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className={inputCls} />
          </div>
          <button type="button" onClick={useCurrentLocation} disabled={pinning} data-testid="sf-use-current-location"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-semibold disabled:opacity-60 hover:bg-[#0F1D38]">
            <Crosshair size={13} /> {pinning ? "Pinning…" : "Use current location"}
          </button>
          {submitAttempted && (!form.lat || !form.lng) && <p data-testid="sf-pin-error" className="text-red-500 text-xs mt-2">Latitude and longitude are required</p>}
        </div>
      </div>

      <Field label="UPI QR code *">
        <div className="flex items-start gap-4">
          {form.upi_qr_url && (
            <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-[#E5E2DC] shrink-0">
              <Image src={form.upi_qr_url} alt="UPI QR" fill sizes="96px" className="object-cover" unoptimized />
              <button onClick={() => setForm((f) => ({ ...f, upi_qr_url: "" }))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={11} /></button>
            </div>
          )}
          {!form.upi_qr_url && (
            <label className="w-24 h-24 rounded-xl border-2 border-dashed border-[#E5E2DC] flex flex-col items-center justify-center cursor-pointer hover:border-[#0A1F5C] text-[#595959] text-xs gap-1.5">
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
              <span className="text-center leading-tight">{uploading ? "Uploading…" : "Upload QR"}</span>
              <input data-testid="sf-qr-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploading(true);
                  try {
                    const { image_url } = await uploadImage(file, "store_banner", callerScope);
                    setForm((f) => ({ ...f, upi_qr_url: image_url }));
                  } catch (err) { toast.error(getErrorMessage(err)); }
                  finally { setUploading(false); }
                }} />
            </label>
          )}
          <p className="text-[11px] text-[#595959] mt-1">Riders use this to collect payment on delivery.</p>
        </div>
      </Field>

      <Field label="Cover images (up to 5) *">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {form.banners.map((b, i) => (
            <div key={i} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]">
              <Image src={b} alt={`banner ${i + 1}`} fill sizes="200px" className="object-cover" unoptimized />
              <button onClick={() => removeBanner(i)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={13} /></button>
            </div>
          ))}
          {form.banners.length < 5 && (
            <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-[#E5E2DC] flex flex-col items-center justify-center cursor-pointer hover:border-[#0A1F5C] text-[#595959] text-xs gap-2">
              {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
              <span>{uploading ? "Uploading…" : "Upload"}</span>
              <input data-testid="sf-banner-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickBanner(e.target.files?.[0] ?? null)} disabled={uploading} />
            </label>
          )}
        </div>
      </Field>
      <p className="text-xs text-[#9CA3AF] -mt-2">First image is the store cover. All images show in the store gallery.</p>

      <div className="flex items-center justify-end gap-2 pt-3">
        {onClose && <button type="button" onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#E5E2DC]">Cancel</button>}
        <button data-testid="sf-save" disabled={saving} onClick={submit} className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[#E68910] text-white disabled:opacity-60">
          {saving ? "Saving…" : submitLabel || (mode === "create" ? "Create storefront" : "Save & continue")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>{children}</label>;
}
function FieldRO({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5 font-semibold">{label}</div><input value={value} disabled className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7] text-[#595959] cursor-not-allowed" /></div>;
}
const inputCls = "w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#0A1F5C] bg-white";
