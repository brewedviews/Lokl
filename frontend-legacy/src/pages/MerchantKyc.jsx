import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, FileText, Upload, Landmark, CheckCircle2, ChevronLeft, AlertCircle, PauseCircle } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";

const BUSINESS_TYPES = ["Proprietorship", "Partnership", "Pvt Ltd", "LLP", "OPC"];
const BUSINESS_CATEGORIES = [
  "Women's Fashion", "Men's Fashion", "Ethnic Wear", "Footwear",
  "Streetwear", "Accessories", "Kids Fashion", "Beauty", "Multi-category",
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function MerchantKyc() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [kycMeta, setKycMeta] = useState({ kyc_status: "draft", hold_comment: null, docs_present: {} });
  const [form, setForm] = useState({
    pan_number: "",
    gst_number: "",
    business_name: "",
    business_category: "",
    business_type: "",
    business_address: "",
    bank_account_number: "",
    bank_ifsc: "",
    account_holder_name: "",
    pan_doc_b64: "",
    gst_doc_b64: "",
    cancelled_cheque_b64: "",
  });
  const [files, setFiles] = useState({ pan: null, gst: null, cheque: null });

  // Pre-fill from existing KYC so the merchant doesn't restart from blank after an on_hold.
  useEffect(() => {
    api.get("/merchant/kyc/status").then(({ data }) => {
      const m = data?.merchant || {};
      const dp = data?.docs_present || {};
      setKycMeta({ kyc_status: data?.kyc_status || "draft", hold_comment: m.hold_comment || null, docs_present: dp });
      setForm((f) => ({
        ...f,
        pan_number: m.pan_number || "",
        gst_number: m.gst_number || "",
        business_name: m.business_name || "",
        business_category: m.business_category || "",
        business_type: m.business_type || "",
        business_address: m.business_address || "",
        bank_account_number: m.bank_account_number || "",
        bank_ifsc: m.bank_ifsc || "",
        account_holder_name: m.account_holder_name || "",
      }));
      setFiles({
        pan: dp.pan_doc ? "PAN already uploaded ✓" : null,
        gst: dp.gst_doc ? "GST already uploaded ✓" : null,
        cheque: dp.cancelled_cheque ? "Cancelled cheque already uploaded ✓" : null,
      });
    }).catch(() => { /* fresh form */ });
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleFile = async (key, fileKey, file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast.error("Max 4 MB");
    const b64 = await fileToBase64(file);
    set(key, b64);
    setFiles((p) => ({ ...p, [fileKey]: file.name }));
  };

  const validStep1 = () =>
    form.pan_number.length === 10 && form.business_name && form.business_category && form.business_type && form.business_address;
  // On resubmission, the cancelled cheque can be left blank if it was uploaded earlier.
  const validStep2 = () =>
    form.bank_account_number && form.bank_ifsc && form.account_holder_name &&
    (form.cancelled_cheque_b64 || kycMeta.docs_present?.cancelled_cheque);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post("/merchant/kyc/submit", form);
      toast.success("KYC submitted! Our team will review within 24 hours.");
      await refresh();
      nav("/merchant/onboarding");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Submission failed");
    } finally { setSubmitting(false); }
  };

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10 max-w-3xl">
        <div className="flex items-center gap-2 text-xs text-[#595959] mb-3">
          <Link to="/merchant/onboarding" className="hover:text-[#1A2B4C]"><ChevronLeft size={14} className="inline -mt-0.5" /> back</Link>
        </div>
        <h1 className="display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Complete KYC</h1>
        <p className="text-[#595959] mt-1">Three quick steps — we'll verify and approve within 24 hours.</p>

        {kycMeta.kyc_status === "on_hold" && kycMeta.hold_comment && (
          <div data-testid="kyc-hold-banner" className="mt-5 p-4 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/40 flex items-start gap-3">
            <PauseCircle size={20} className="text-[#E68910] shrink-0 mt-0.5" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#E68910] font-bold mb-0.5">KYC on hold — fix the items below</div>
              <div className="text-sm text-[#1C1C1C] whitespace-pre-wrap">{kycMeta.hold_comment}</div>
              <div className="text-[11px] text-[#595959] mt-2">All previously-submitted info is pre-filled. Update what needs fixing and hit Submit — we'll re-review.</div>
            </div>
          </div>
        )}
        {kycMeta.kyc_status === "submitted" && (
          <div data-testid="kyc-submitted-banner" className="mt-5 p-4 rounded-2xl bg-[#1A2B4C]/5 border border-[#1A2B4C]/20 text-sm text-[#1C1C1C]">
            Your KYC is currently under review. You can still edit the form and re-submit — the latest version replaces the previous one.
          </div>
        )}

        {/* Stepper */}
        <div className="flex items-center gap-2 mt-6 text-xs">
          {["Business", "Bank", "Review"].map((label, i) => {
            const n = i + 1;
            const active = step === n; const done = step > n;
            return (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${active ? "bg-[#1A2B4C] text-white" : done ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>
                  {done ? <CheckCircle2 size={12} /> : <span className="font-bold">{n}</span>} <span className="font-semibold">{label}</span>
                </div>
                {n < 3 && <div className="flex-1 h-px bg-[#E5E2DC]" />}
              </React.Fragment>
            );
          })}
        </div>

        {step === 1 && (
          <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
            <h2 className="display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><FileText size={18} /> Business details</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="PAN number *">
                <input data-testid="kyc-pan" maxLength={10} value={form.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="ABCDE1234F" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" />
              </Field>
              <Field label="GST number (optional)">
                <input data-testid="kyc-gst" value={form.gst_number} onChange={(e) => set("gst_number", e.target.value.toUpperCase())} placeholder="22ABCDE1234F1Z5" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" />
              </Field>
              <Field label="Registered business name *">
                <input data-testid="kyc-business-name" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="e.g. Bunto Store Pvt Ltd" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </Field>
              <Field label="Business category *">
                <select data-testid="kyc-category" value={form.business_category} onChange={(e) => set("business_category", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white">
                  <option value="">Select category</option>
                  {BUSINESS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Business type *">
                <select data-testid="kyc-type" value={form.business_type} onChange={(e) => set("business_type", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white">
                  <option value="">Select type</option>
                  {BUSINESS_TYPES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Business address *" full>
                <textarea data-testid="kyc-address" rows={2} value={form.business_address} onChange={(e) => set("business_address", e.target.value)} placeholder="House no, street, locality, city, pincode" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </Field>
              <FileUpload label="PAN card (image/PDF)" testId="kyc-pan-doc" file={files.pan} onChange={(f) => handleFile("pan_doc_b64", "pan", f)} />
              <FileUpload label="GST certificate (optional)" testId="kyc-gst-doc" file={files.gst} onChange={(f) => handleFile("gst_doc_b64", "gst", f)} />
            </div>
            <div className="flex justify-end pt-2">
              <button data-testid="kyc-next-1" disabled={!validStep1()} onClick={() => setStep(2)} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">
                Next <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
            <h2 className="display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><Landmark size={18} /> Bank account</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Account holder name *">
                <input data-testid="kyc-holder" value={form.account_holder_name} onChange={(e) => set("account_holder_name", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
              </Field>
              <Field label="Account number *">
                <input data-testid="kyc-account" value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] tracking-wider" />
              </Field>
              <Field label="IFSC code *">
                <input data-testid="kyc-ifsc" value={form.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} placeholder="SBIN0001234" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" />
              </Field>
              <FileUpload label="Cancelled cheque *" testId="kyc-cheque" file={files.cheque} onChange={(f) => handleFile("cancelled_cheque_b64", "cheque", f)} />
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="px-5 py-3 rounded-full border border-[#E5E2DC]"><ChevronLeft size={14} className="inline" /> Back</button>
              <button data-testid="kyc-next-2" disabled={!validStep2()} onClick={() => setStep(3)} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">
                Next <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
            <h2 className="display text-xl font-bold text-[#1A2B4C]">Review &amp; submit</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Row label="PAN" value={form.pan_number} />
              <Row label="GST" value={form.gst_number || "—"} />
              <Row label="Business" value={form.business_name} />
              <Row label="Category" value={form.business_category} />
              <Row label="Type" value={form.business_type} />
              <Row label="Address" value={form.business_address} />
              <Row label="Account holder" value={form.account_holder_name} />
              <Row label="Account / IFSC" value={`${form.bank_account_number} · ${form.bank_ifsc}`} />
              <Row label="Documents" value={`${files.pan ? "PAN ✓" : ""} ${files.gst ? "GST ✓" : ""} ${files.cheque ? "Cheque ✓" : ""}`} />
            </div>
            <div className="bg-[#FDFBF7] rounded-xl p-3 text-xs text-[#595959] flex gap-2">
              <AlertCircle size={14} className="text-[#E68910] shrink-0 mt-0.5" />
              By submitting you confirm the above details are accurate. Our team will verify within 24 hours and notify you.
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="px-5 py-3 rounded-full border border-[#E5E2DC]"><ChevronLeft size={14} className="inline" /> Back</button>
              <button data-testid="kyc-submit" disabled={submitting} onClick={submit} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#C9770E] disabled:opacity-60">
                {submitting ? "Submitting…" : "Submit KYC"} <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}
      </div>
    </MerchantLayout>
  );
}

const Field = ({ label, children, full }) => (
  <label className={`block ${full ? "md:col-span-2" : ""}`}>
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
    {children}
  </label>
);

const Row = ({ label, value }) => (
  <div className="bg-[#FDFBF7] rounded-xl px-3 py-2">
    <div className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</div>
    <div className="text-[#1C1C1C] truncate font-medium">{value || "—"}</div>
  </div>
);

const FileUpload = ({ label, file, onChange, testId }) => (
  <label className="block cursor-pointer">
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
    <div className="px-4 py-3 rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] transition flex items-center gap-2 text-sm">
      <Upload size={14} className="text-[#E68910]" />
      <span className="truncate flex-1">{file || "Choose file…"}</span>
    </div>
    <input data-testid={testId} type="file" accept="image/*,.pdf" onChange={(e) => onChange(e.target.files?.[0])} className="hidden" />
  </label>
);
