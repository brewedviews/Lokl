"use client";

/** 3-step KYC wizard ported from legacy MerchantKyc.jsx. */
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FileText, Upload, Landmark, CheckCircle2, ChevronLeft, AlertCircle, PauseCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { uploadImage } from "@/lib/uploads";

const BUSINESS_TYPES = ["Proprietorship", "Partnership", "Pvt Ltd", "LLP", "OPC"];
const BUSINESS_CATEGORIES = [
  "Women's Fashion", "Men's Fashion", "Ethnic Wear", "Footwear",
  "Streetwear", "Accessories", "Kids Fashion", "Beauty", "Multi-category",
];

interface KycForm {
  pan_number: string; gst_number: string; business_name: string;
  business_category: string; business_type: string; business_address: string;
  bank_account_number: string; bank_ifsc: string; account_holder_name: string;
  // Cloudinary public_ids for private KYC docs (preferred).
  pan_doc_public_id: string; gst_doc_public_id: string; cancelled_cheque_public_id: string;
  // Legacy base64 fields kept for backwards compatibility on resubmit.
  pan_doc_b64: string; gst_doc_b64: string; cancelled_cheque_b64: string;
}
interface DocsPresent { pan_doc?: boolean; gst_doc?: boolean; cancelled_cheque?: boolean }
interface KycMeta {
  kyc_status: string;
  hold_comment: string | null;
  docs_present: DocsPresent;
}

export default function MerchantKycPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [kycMeta, setKycMeta] = useState<KycMeta>({ kyc_status: "draft", hold_comment: null, docs_present: {} });
  const [form, setForm] = useState<KycForm>({
    pan_number: "", gst_number: "", business_name: "", business_category: "", business_type: "",
    business_address: "", bank_account_number: "", bank_ifsc: "", account_holder_name: "",
    pan_doc_public_id: "", gst_doc_public_id: "", cancelled_cheque_public_id: "",
    pan_doc_b64: "", gst_doc_b64: "", cancelled_cheque_b64: "",
  });
  const [files, setFiles] = useState<{ pan: string | null; gst: string | null; cheque: string | null }>({ pan: null, gst: null, cheque: null });
  const [uploading, setUploading] = useState<{ pan: boolean; gst: boolean; cheque: boolean }>({ pan: false, gst: false, cheque: false });

  useEffect(() => {
    apiClient.get<{ kyc_status?: string; merchant?: Partial<KycForm> & { hold_comment?: string }; docs_present?: DocsPresent }>("/api/merchant/kyc/status")
      .then(({ data }) => {
        const m = data?.merchant || {};
        const dp = data?.docs_present || {};
        setKycMeta({ kyc_status: data?.kyc_status || "draft", hold_comment: m.hold_comment || null, docs_present: dp });
        setForm((f) => ({
          ...f,
          pan_number: m.pan_number || "", gst_number: m.gst_number || "",
          business_name: m.business_name || "", business_category: m.business_category || "",
          business_type: m.business_type || "", business_address: m.business_address || "",
          bank_account_number: m.bank_account_number || "", bank_ifsc: m.bank_ifsc || "",
          account_holder_name: m.account_holder_name || "",
        }));
        setFiles({
          pan: dp.pan_doc ? "PAN already uploaded ✓" : null,
          gst: dp.gst_doc ? "GST already uploaded ✓" : null,
          cheque: dp.cancelled_cheque ? "Cancelled cheque already uploaded ✓" : null,
        });
      })
      .catch(() => { /* fresh form */ });
  }, []);

  const set = <K extends keyof KycForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleFile = async (publicIdKey: keyof KycForm, fileKey: "pan" | "gst" | "cheque", file: File | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5 MB");
    if (!file.type.startsWith("image/")) return toast.error("Only image files (JPEG/PNG/WebP) are supported. Convert PDFs to image first.");
    setUploading((p) => ({ ...p, [fileKey]: true }));
    try {
      const { public_id } = await uploadImage(file, "kyc");
      set(publicIdKey, public_id);
      setFiles((p) => ({ ...p, [fileKey]: file.name }));
      toast.success(`${fileKey.toUpperCase()} uploaded`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setUploading((p) => ({ ...p, [fileKey]: false }));
    }
  };

  const validStep1 = form.pan_number.length === 10 && form.business_name && form.business_category && form.business_type && form.business_address;
  const validStep2 = form.bank_account_number && form.bank_ifsc && form.account_holder_name &&
    (form.cancelled_cheque_public_id || form.cancelled_cheque_b64 || kycMeta.docs_present.cancelled_cheque);

  const submit = async () => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/merchant/kyc/submit", form);
      toast.success("KYC submitted! Our team will review within 24 hours.");
      router.replace("/merchant/onboarding");
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-[#595959] mb-3">
        <Link href="/merchant/onboarding" className="hover:text-[#1A2B4C]"><ChevronLeft size={14} className="inline -mt-0.5" /> back</Link>
      </div>
      <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C]">Complete KYC</h1>
      <p className="text-[#595959] mt-1">Three quick steps — we&apos;ll verify and approve within 24 hours.</p>

      {kycMeta.kyc_status === "on_hold" && kycMeta.hold_comment && (
        <div data-testid="kyc-hold-banner" className="mt-5 p-4 rounded-2xl bg-[#E68910]/10 border border-[#E68910]/40 flex items-start gap-3">
          <PauseCircle size={20} className="text-[#E68910] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#E68910] font-bold mb-0.5">KYC on hold — fix the items below</div>
            <div className="text-sm text-[#1C1C1C] whitespace-pre-wrap">{kycMeta.hold_comment}</div>
            <div className="text-[11px] text-[#595959] mt-2">All previously-submitted info is pre-filled. Update what needs fixing and hit Submit.</div>
          </div>
        </div>
      )}
      {kycMeta.kyc_status === "submitted" && (
        <div data-testid="kyc-submitted-banner" className="mt-5 p-4 rounded-2xl bg-[#1A2B4C]/5 border border-[#1A2B4C]/20 text-sm text-[#1C1C1C]">
          Your KYC is currently under review. You can still edit the form and re-submit.
        </div>
      )}

      <div className="flex items-center gap-2 mt-6 text-xs">
        {["Business", "Bank", "Review"].map((label, i) => {
          const n = i + 1; const active = step === n; const done = step > n;
          return (
            <Fragment key={label}>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${active ? "bg-[#1A2B4C] text-white" : done ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-white border border-[#E5E2DC] text-[#595959]"}`}>
                {done ? <CheckCircle2 size={12} /> : <span className="font-bold">{n}</span>} <span className="font-semibold">{label}</span>
              </div>
              {n < 3 && <div className="flex-1 h-px bg-[#E5E2DC]" />}
            </Fragment>
          );
        })}
      </div>

      {step === 1 && (
        <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><FileText size={18} /> Business details</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="PAN number *"><input data-testid="kyc-pan" maxLength={10} value={form.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="ABCDE1234F" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" /></Field>
            <Field label="GST number (optional)"><input data-testid="kyc-gst" value={form.gst_number} onChange={(e) => set("gst_number", e.target.value.toUpperCase())} placeholder="22ABCDE1234F1Z5" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" /></Field>
            <Field label="Registered business name *"><input data-testid="kyc-business-name" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="e.g. Bunto Store Pvt Ltd" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
            <Field label="Business category *"><select data-testid="kyc-category" value={form.business_category} onChange={(e) => set("business_category", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white"><option value="">Select category</option>{BUSINESS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Business type *"><select data-testid="kyc-type" value={form.business_type} onChange={(e) => set("business_type", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] bg-white"><option value="">Select type</option>{BUSINESS_TYPES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Business address *" full><textarea data-testid="kyc-address" rows={2} value={form.business_address} onChange={(e) => set("business_address", e.target.value)} placeholder="House no, street, locality, city, pincode" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
            <FileUpload label="PAN card (image)" testId="kyc-pan-doc" file={files.pan} busy={uploading.pan} onChange={(f) => handleFile("pan_doc_public_id", "pan", f)} />
            <FileUpload label="GST certificate (optional, image)" testId="kyc-gst-doc" file={files.gst} busy={uploading.gst} onChange={(f) => handleFile("gst_doc_public_id", "gst", f)} />
          </div>
          <div className="flex justify-end pt-2">
            <button data-testid="kyc-next-1" disabled={!validStep1} onClick={() => setStep(2)} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">Next <ArrowRight size={14} /></button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><Landmark size={18} /> Bank account</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Account holder name *"><input data-testid="kyc-holder" value={form.account_holder_name} onChange={(e) => set("account_holder_name", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" /></Field>
            <Field label="Account number *"><input data-testid="kyc-account" value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] tracking-wider" /></Field>
            <Field label="IFSC code *"><input data-testid="kyc-ifsc" value={form.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} placeholder="SBIN0001234" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" /></Field>
            <FileUpload label="Cancelled cheque * (image)" testId="kyc-cheque" file={files.cheque} busy={uploading.cheque} onChange={(f) => handleFile("cancelled_cheque_public_id", "cheque", f)} />
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className="px-5 py-3 rounded-full border border-[#E5E2DC]"><ChevronLeft size={14} className="inline" /> Back</button>
            <button data-testid="kyc-next-2" disabled={!validStep2} onClick={() => setStep(3)} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white font-semibold disabled:opacity-50">Next <ArrowRight size={14} /></button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-8 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C]">Review &amp; submit</h2>
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
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
      {children}
    </label>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#FDFBF7] rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-[#595959]">{label}</div>
      <div className="text-[#1C1C1C] truncate font-medium">{value || "—"}</div>
    </div>
  );
}
function FileUpload({ label, file, onChange, testId, busy }: { label: string; file: string | null; onChange: (f: File | null) => void; testId: string; busy?: boolean }) {
  return (
    <label className="block cursor-pointer">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
      <div className="px-4 py-3 rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] transition flex items-center gap-2 text-sm">
        {busy ? <Loader2 size={14} className="text-[#E68910] animate-spin" /> : <Upload size={14} className="text-[#E68910]" />}
        <span className="truncate flex-1">{busy ? "Uploading…" : (file || "Choose file…")}</span>
      </div>
      <input data-testid={testId} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => onChange(e.target.files?.[0] ?? null)} className="hidden" />
    </label>
  );
}
