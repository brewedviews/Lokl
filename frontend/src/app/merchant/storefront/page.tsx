"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Store, ArrowRight, X, ImagePlus, Clock, MapPin, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useMerchantAuthStore } from "@/stores";
import { uploadImage, deleteUploadedImage } from "@/lib/uploads";
import { BHILAI_AREAS, findBhilaiArea } from "@/data/bhilai-areas";

export default function MerchantStorefrontPage() {
  const router = useRouter();
  const merchant = useMerchantAuthStore((s) => s.user) as (typeof useMerchantAuthStore extends () => infer T ? T : never) | null;
  type Mer = { store_name?: string; business_address?: string; storefront?: { tagline?: string; story?: string; banners?: string[]; banner_public_ids?: string[]; banner?: string; locality?: string; opens_at?: string; closes_at?: string; lat?: number; lng?: number; area_slug?: string; area_label?: string; pincode?: string } };
  const m = (merchant ?? {}) as unknown as Mer;
  const [form, setForm] = useState({
    tagline: "", story: "", banners: [] as string[], banner_public_ids: [] as string[],
    locality: "", opens_at: "10:00", closes_at: "18:00",
    lat: "", lng: "",
    // iter-29 (Item 2) — mandatory area picker + pincode.
    area_slug: "", area_label: "", pincode: "",
  });
  const [saving, setSaving] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [uploading, setUploading] = useState(false);
  // iter-29 (Item 2) — gates the Save button. True after the merchant picks
  // an area (which seeds default lat/lng) AND either confirms via the map
  // button OR loads an existing record that already has coords.
  const [pinPlaced, setPinPlaced] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (m.storefront) {
      const s = m.storefront;
      setForm({
        tagline: s.tagline || "", story: s.story || "",
        banners: s.banners && s.banners.length ? s.banners : (s.banner ? [s.banner] : []),
        banner_public_ids: s.banner_public_ids && s.banner_public_ids.length ? s.banner_public_ids : [],
        locality: s.locality || "", opens_at: s.opens_at || "10:00", closes_at: s.closes_at || "18:00",
        lat: s.lat != null ? String(s.lat) : "", lng: s.lng != null ? String(s.lng) : "",
        area_slug: s.area_slug || "",
        area_label: s.area_label || "",
        pincode: s.pincode || "",
      });
      // Pre-existing record with coords → the merchant has already pinned.
      if (s.lat != null && s.lng != null) setPinPlaced(true);
    }
  }, [m.storefront]);

  const pickBanner = async (file: File | null) => {
    if (!file) return;
    if (form.banners.length >= 5) return toast.error("Up to 5 banners");
    setUploading(true);
    try {
      const { image_url, public_id } = await uploadImage(file, "store_banner");
      setForm((f) => ({
        ...f,
        banners: [...f.banners, image_url],
        banner_public_ids: [...f.banner_public_ids, public_id],
      }));
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  const removeBanner = (idx: number) => {
    const pid = form.banner_public_ids[idx];
    setForm((f) => ({
      ...f,
      banners: f.banners.filter((_, i) => i !== idx),
      banner_public_ids: f.banner_public_ids.filter((_, i) => i !== idx),
    }));
    if (pid) void deleteUploadedImage(pid);
  };

  // iter-29 (Item 2) — area pick auto-fills pincode + seeds the map centre.
  // Pin is reset because the seeded coords are an area centroid, not the
  // exact store location; the merchant must confirm via "Use current location".
  const onPickArea = (slug: string) => {
    const a = findBhilaiArea(slug);
    if (!a) {
      setForm((f) => ({ ...f, area_slug: "", area_label: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      area_slug: a.slug,
      area_label: a.label,
      pincode: f.pincode || a.pincode,
      lat: a.lat.toFixed(6),
      lng: a.lng.toFixed(6),
    }));
    // The seeded coords are an approximation — force re-confirmation.
    setPinPlaced(false);
  };

  const save = async () => {
    setSubmitAttempted(true);
    if (!form.tagline || !form.story || form.banners.length === 0) return toast.error("Tagline, story and at least 1 cover image are required");
    if (form.opens_at >= form.closes_at) return toast.error("Closing time must be after opening time");
    // iter-29 (Item 2) — strict gate on area + pin before any save attempt.
    if (!form.area_slug) return toast.error("Please select your area");
    if (!(form.pincode || "").trim()) return toast.error("Pincode is required");
    if (!pinPlaced) return toast.error("Please place your pin on the map to confirm your exact location");
    const lat = parseFloat(form.lat), lng = parseFloat(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return toast.error("Pin your store on the map.");
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return toast.error("Invalid coordinates.");
    setSaving(true);
    try {
      await api.merchant.saveStorefront({
        tagline: form.tagline, story: form.story,
        banners: form.banners, banner: form.banners[0],
        banner_public_ids: form.banner_public_ids,
        logo: form.banners[0],
        logo_public_id: form.banner_public_ids[0] || "",
        locality: form.locality, opens_at: form.opens_at, closes_at: form.closes_at,
        lat, lng, specialties: [],
        area: form.area_slug, area_label: form.area_label, pincode: form.pincode.trim(),
      } as unknown as Parameters<typeof api.merchant.saveStorefront>[0]);
      toast.success("Storefront saved");
      router.replace("/merchant/products");
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Geolocation unsupported on this device");
    setPinning(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setPinPlaced(true);
        setPinning(false);
        toast.success("Pinned to your current location");
      },
      (err) => { setPinning(false); toast.error(err?.message || "Could not access location"); },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // iter-29 (Item 2) — merchant has selected an area but not yet confirmed
  // their exact pin. The seeded lat/lng are the area centroid, which we treat
  // as not-yet-pinned to force one explicit confirmation tap.
  const showPinHelper = !!form.area_slug && !pinPlaced;

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2"><Store size={26} /> Storefront</h1>
      <p className="text-[#595959] mt-1">Edit the public face of your store.</p>

      <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-3 pb-4 border-b border-[#E5E2DC]">
          <FieldRO label="Store name (locked)" value={m.store_name || ""} />
          <FieldRO label="Business address (locked)" value={m.business_address || ""} />
        </div>
        <Field label="Tagline *">
          <input data-testid="sf-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. Handpicked ethnic luxury" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
        </Field>
        <Field label="Store story *">
          <textarea data-testid="sf-story" value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} rows={3} placeholder="A few lines about your brand, heritage or vibe" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
        </Field>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Locality"><input data-testid="sf-locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="e.g. Sector 10" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
          <Field label="Opens at"><input data-testid="sf-opens" type="time" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
          <Field label="Closes at"><input data-testid="sf-closes" type="time" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
        </div>
        <p className="text-[11px] text-[#595959] -mt-2"><Clock size={11} className="inline mr-1" />Orders are accepted from 30 minutes after opening to 30 minutes before closing.</p>

        <div className="rounded-2xl border border-[#E5E2DC] bg-[#FDFBF7] p-4 space-y-4">
          {/* iter-29 (Item 2) — Area dropdown (mandatory) + auto-fill pincode */}
          <div>
            <label className="block">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">
                Area / Neighbourhood *
              </div>
              <select
                data-testid="sf-area-picker"
                value={form.area_slug}
                onChange={(e) => onPickArea(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white"
              >
                <option value="">Select your area…</option>
                {BHILAI_AREAS.map((a) => (
                  <option key={a.slug} value={a.slug}>{a.label} — {a.pincode}</option>
                ))}
              </select>
            </label>
            {submitAttempted && !form.area_slug && (
              <p data-testid="sf-area-error" className="text-red-500 text-xs mt-1">Please select your area</p>
            )}
          </div>

          <div>
            <label className="block">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">
                Pincode *
              </div>
              <input
                data-testid="sf-pincode"
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                placeholder="6-digit pincode"
                inputMode="numeric"
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white"
              />
            </label>
            {submitAttempted && !form.pincode.trim() && (
              <p data-testid="sf-pincode-error" className="text-red-500 text-xs mt-1">Pincode is required</p>
            )}
          </div>

          <div>
            <div className="flex items-start gap-2 mb-2">
              <MapPin size={16} className="text-[#E68910] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-[#1A2B4C]">Pin your exact store location *</div>
                <p className="text-[11px] text-[#595959] mt-0.5">Open this page while standing inside your store and tap below to confirm.</p>
              </div>
            </div>
            <button type="button" onClick={useCurrentLocation} disabled={pinning} data-testid="sf-use-current-location"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold disabled:opacity-60 hover:bg-[#0F1D38]">
              <Crosshair size={13} /> {pinning ? "Pinning…" : (pinPlaced ? "Re-pin to current location" : "Use current location")}
            </button>
            {showPinHelper && (
              <p data-testid="sf-pin-helper" className="mt-3 text-[12px] text-[#92400E] bg-[#FEF3C7] rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <MapPin size={12} /> Click the button above to mark your exact store location
              </p>
            )}
            {submitAttempted && !pinPlaced && form.area_slug && (
              <p data-testid="sf-pin-error" className="text-red-500 text-xs mt-2">Please place your pin on the map to confirm your exact location</p>
            )}
            {pinPlaced && form.lat && form.lng && !Number.isNaN(parseFloat(form.lat)) && !Number.isNaN(parseFloat(form.lng)) && (
              <div className="text-[11px] text-[#0A1F5C] mt-3" data-testid="sf-pinned-coords">
                Pinned: <strong>{parseFloat(form.lat).toFixed(5)}, {parseFloat(form.lng).toFixed(5)}</strong>
              </div>
            )}
          </div>
        </div>

        <Field label="Cover images (up to 5) *">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {form.banners.map((b, i) => (
              <div key={i} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]">
                <Image src={b} alt={`banner ${i + 1}`} fill sizes="200px" className="object-cover" unoptimized />
                <button onClick={() => removeBanner(i)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={13} /></button>
              </div>
            ))}
            {form.banners.length < 5 && (
              <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-[#E5E2DC] flex flex-col items-center justify-center cursor-pointer hover:border-[#1A2B4C] text-[#595959] text-xs gap-2">
                {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
                <span>{uploading ? "Uploading…" : "Upload"}</span>
                <input data-testid="sf-banner-upload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickBanner(e.target.files?.[0] ?? null)} disabled={uploading} />
              </label>
            )}
          </div>
        </Field>

        <div className="flex justify-end pt-3">
          <button data-testid="sf-save" disabled={saving} onClick={save} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-60">
            {saving ? "Saving…" : "Save & continue"} <ArrowRight size={14} />
          </button>
        </div>
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
