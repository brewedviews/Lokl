import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, ArrowRight, Upload, X, ImagePlus, Clock } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

export default function MerchantStorefront() {
  const { merchant, refresh } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    tagline: "", story: "", banners: [],
    locality: "", opens_at: "10:00", closes_at: "18:00",
  });
  const [busyIdx, setBusyIdx] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (merchant?.storefront) {
      const s = merchant.storefront;
      setForm({
        tagline: s.tagline || "",
        story: s.story || "",
        banners: s.banners && s.banners.length ? s.banners : (s.banner ? [s.banner] : []),
        locality: s.locality || "",
        opens_at: s.opens_at || "10:00",
        closes_at: s.closes_at || "18:00",
      });
    }
  }, [merchant]);

  const pickBanner = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Image too large (max 5MB)");
    if (form.banners.length >= 5) return toast.error("Up to 5 banners");
    setBusyIdx(true);
    const r = new FileReader();
    r.onload = () => { setForm((f) => ({ ...f, banners: [...f.banners, r.result] })); setBusyIdx(false); };
    r.onerror = () => { toast.error("Could not read image"); setBusyIdx(false); };
    r.readAsDataURL(file);
  };
  const removeBanner = (idx) => setForm((f) => ({ ...f, banners: f.banners.filter((_, i) => i !== idx) }));

  const save = async () => {
    if (!form.tagline || !form.story || form.banners.length === 0) return toast.error("Tagline, story and at least 1 cover image are required");
    if (form.opens_at >= form.closes_at) return toast.error("Closing time must be after opening time");
    setSaving(true);
    try {
      await api.post("/merchant/storefront", {
        tagline: form.tagline, story: form.story,
        banners: form.banners, banner: form.banners[0],
        locality: form.locality,
        opens_at: form.opens_at, closes_at: form.closes_at,
        specialties: [],
      });
      toast.success("Storefront saved");
      await refresh();
      nav("/merchant/products");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10 max-w-3xl">
        <h1 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2"><Store size={26} /> Storefront</h1>
        <p className="text-[#595959] mt-1">Edit the public face of your boutique. <span className="text-[#E68910]">Store name &amp; business address can only be changed via a verified change request.</span></p>

        <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-3 pb-4 border-b border-[#E5E2DC]">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5 font-semibold">Store name (locked)</div>
              <input value={merchant?.store_name || ""} disabled className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7] text-[#595959] cursor-not-allowed" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5 font-semibold">Business address (locked)</div>
              <input value={merchant?.business_address || ""} disabled className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] bg-[#FDFBF7] text-[#595959] cursor-not-allowed" />
            </div>
          </div>
          <Field label="Tagline *">
            <input data-testid="sf-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. Handpicked ethnic luxury" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
          </Field>
          <Field label="Store story *">
            <textarea data-testid="sf-story" value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} rows={3} placeholder="A few lines about your brand, heritage or vibe" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
          </Field>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Locality">
              <input data-testid="sf-locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="e.g. Sector 10" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </Field>
            <Field label="Opens at">
              <input data-testid="sf-opens" type="time" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </Field>
            <Field label="Closes at">
              <input data-testid="sf-closes" type="time" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </Field>
          </div>
          <p className="text-[11px] text-[#595959] -mt-2"><Clock size={11} className="inline mr-1" />Orders are accepted from 30 minutes after opening to 30 minutes before closing. Outside these hours your store is shown as "Offline" to customers.</p>

          <Field label="Cover images (up to 5) — uploaded by you *">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {form.banners.map((b, i) => (
                <div key={i} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#FDFBF7] border border-[#E5E2DC]">
                  <img src={b} alt={`banner ${i + 1}`} className="w-full h-full object-cover" />
                  <button onClick={() => removeBanner(i)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"><X size={13} /></button>
                </div>
              ))}
              {form.banners.length < 5 && (
                <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-[#E5E2DC] flex flex-col items-center justify-center cursor-pointer hover:border-[#1A2B4C] text-[#595959] text-xs gap-2">
                  <ImagePlus size={20} />
                  <span>{busyIdx ? "Reading…" : "Upload"}</span>
                  <input data-testid="sf-banner-upload" type="file" accept="image/*" className="hidden" onChange={(e) => pickBanner(e.target.files?.[0])} />
                </label>
              )}
            </div>
            <p className="text-[10px] text-[#595959] mt-2">JPG/PNG · up to 5MB each. Shown as a carousel on your store listing and store page.</p>
          </Field>

          <div className="flex justify-end pt-3">
            <button data-testid="sf-save" disabled={saving} onClick={save} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-60">
              {saving ? "Saving…" : "Save & continue"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </MerchantLayout>
  );
}

const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
    {children}
  </label>
);
