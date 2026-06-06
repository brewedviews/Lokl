"use client";

/** Bank details form — change requests are admin-approved before going live.
 * Account numbers are masked before being logged/sent to Sentry. */
import { useEffect, useState } from "react";
import { Landmark, Upload, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useMerchantAuthStore } from "@/stores";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function maskAccount(num: string): string {
  return num.replace(/(\d{4})\d+(\d{4})/, "$1****$2");
}

interface ChangeReq { id: string; change_type: string; status: string; created_at: string }

export default function MerchantBankPage() {
  const merchant = useMerchantAuthStore((s) => s.user) as (typeof useMerchantAuthStore extends () => infer T ? T : never) | null;
  type M = { bank_account_number?: string; bank_ifsc?: string; account_holder_name?: string };
  const m = (merchant ?? {}) as unknown as M;
  const [form, setForm] = useState({
    bank_account_number: m.bank_account_number || "",
    bank_ifsc: m.bank_ifsc || "",
    account_holder_name: m.account_holder_name || "",
  });
  const [chequeName, setChequeName] = useState("");
  const [chequeB64, setChequeB64] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ChangeReq[]>([]);

  const loadPending = () => {
    apiClient.get<ChangeReq[]>("/api/merchant/change-requests")
      .then((r) => setPending(r.data.filter((c) => c.change_type === "bank")))
      .catch(() => {});
  };

  useEffect(() => { loadPending(); }, []);

  const submit = async () => {
    if (!chequeB64) return toast.error("Upload a new cancelled cheque to validate the change");
    if (!form.bank_account_number || !form.bank_ifsc || !form.account_holder_name) return toast.error("All fields required");
    setBusy(true);
    try {
      await apiClient.post("/api/merchant/change-request", {
        change_type: "bank",
        new_values: form,
        supporting_doc_b64: chequeB64,
        reason: "Bank update from merchant dashboard",
      });
      toast.success("Change request submitted — admin will verify within 24h");
      setChequeB64(""); setChequeName("");
      loadPending();
    } catch (e) {
      // Mask account number before forwarding error
      const safeErr = getErrorMessage(e).replace(form.bank_account_number, maskAccount(form.bank_account_number));
      toast.error(safeErr);
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 md:p-10 max-w-2xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2"><Landmark size={24} /> Bank details</h1>
      <p className="text-[#595959] mt-1">Update your payout bank — admin will verify each change.</p>

      <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
        <Field label="Account holder *">
          <input data-testid="bank-holder" value={form.account_holder_name} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C]" />
        </Field>
        <Field label="Account number *">
          <input data-testid="bank-account" value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] tracking-wider" />
        </Field>
        <Field label="IFSC *">
          <input data-testid="bank-ifsc" value={form.bank_ifsc} onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] uppercase tracking-wider" />
        </Field>
        <label className="block cursor-pointer">
          <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5 font-semibold">New cancelled cheque (required for validation) *</div>
          <div className="px-4 py-3 rounded-xl border-2 border-dashed border-[#E5E2DC] hover:border-[#1A2B4C] flex items-center gap-2 text-sm">
            <Upload size={14} className="text-[#E68910]" />
            <span className="truncate flex-1">{chequeName || "Choose file…"}</span>
          </div>
          <input data-testid="bank-cheque" type="file" accept="image/*,.pdf" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setChequeName(f.name); setChequeB64(await fileToBase64(f)); }} />
        </label>
        <div className="flex justify-end pt-2">
          <button onClick={submit} disabled={busy} data-testid="submit-bank-change" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50">
            {busy ? "Submitting…" : "Submit for approval"} <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mt-6 bg-white border border-[#E5E2DC] rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><Clock size={16} /> Change request history</h3>
          <div className="space-y-2 text-sm">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-[#E5E2DC] last:border-0">
                <div className="text-xs text-[#595959]">{new Date(c.created_at).toLocaleString()}</div>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                  c.status === "approved" ? "bg-[#4F7363]/15 text-[#4F7363]" :
                  c.status === "rejected" ? "bg-red-100 text-red-500" : "bg-[#E68910]/15 text-[#E68910]"}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-1.5 font-semibold">{label}</div>
      {children}
    </div>
  );
}
