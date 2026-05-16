import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, ArrowRight, Upload } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const BANNER_SAMPLES = [
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1555529771-835f59fc5efe?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=1200&auto=format&fit=crop&q=80",
];

export default function MerchantStorefront() {
  const { merchant, refresh } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    tagline: "", story: "", banner: BANNER_SAMPLES[0],
    specialties: "", locality: "", timing: "10am - 9pm",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (merchant?.storefront) {
      const s = merchant.storefront;
      setForm({
        tagline: s.tagline || "", story: s.story || "",
        banner: s.banner || BANNER_SAMPLES[0],
        specialties: (s.specialties || []).join(", "),
        locality: s.locality || "", timing: s.timing || "10am - 9pm",
      });
    }
  }, [merchant]);

  const save = async () => {
    if (!form.tagline || !form.story || !form.banner) return toast.error("Tagline, story and banner are required");
    setSaving(true);
    try {
      await api.post("/merchant/storefront", {
        ...form,
        specialties: form.specialties.split(",").map((s) => s.trim()).filter(Boolean),
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
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Locality">
              <input data-testid="sf-locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="e.g. Sector 10, Bhilai" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </Field>
            <Field label="Store timings">
              <input data-testid="sf-timing" value={form.timing} onChange={(e) => setForm({ ...form, timing: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            </Field>
          </div>
          <Field label="Specialties (comma separated)">
            <input data-testid="sf-specialties" value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="Bandhani, Block Print, Festive" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
          </Field>

          <Field label="Hero / banner image *">
            <input data-testid="sf-banner" value={form.banner} onChange={(e) => setForm({ ...form, banner: e.target.value })} placeholder="Paste image URL" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {BANNER_SAMPLES.map((u) => (
                <button key={u} type="button" onClick={() => setForm({ ...form, banner: u })} className={`aspect-[4/3] rounded-xl overflow-hidden border-2 transition ${form.banner === u ? "border-[#E68910]" : "border-transparent"}`}>
                  <img src={u} alt="banner" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            {form.banner && (
              <div className="mt-3 aspect-[3/1] rounded-2xl overflow-hidden bg-[#FDFBF7]">
                <img src={form.banner} alt="banner preview" className="w-full h-full object-cover" />
              </div>
            )}
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
