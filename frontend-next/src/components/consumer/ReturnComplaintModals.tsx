"use client";

/** Customer Return + Complaint modals — port of legacy ReturnComplaintModals.jsx. */
import { useState } from "react";
import Image from "next/image";
import { X, RotateCcw, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import type { Order, OrderItem, Return, Complaint, ComplaintType } from "@/types";

const RETURN_REASONS = [
  "Damaged product",
  "Wrong item received",
  "Quality issue",
  "Size / fit issue",
  "Changed mind",
  "Other",
];

const COMPLAINT_TYPES: { value: ComplaintType | "return" | "delivery_issue"; label: string }[] = [
  { value: "general", label: "Return-related complaint" },
  { value: "missing_item", label: "Missing item" },
  { value: "damaged_item", label: "Damaged item" },
  { value: "late_delivery", label: "Delivery issue" },
  { value: "other", label: "General support request" },
];

export function ReturnModal({
  order,
  onClose,
  onCreated,
}: { order: Order; onClose: () => void; onCreated?: (r: Return) => void }) {
  const eligibleItems = (order.items || []).filter((it: OrderItem) => it.return_eligible);
  const [reason, setReason] = useState("");
  const [pickedIds, setPickedIds] = useState<string[]>(eligibleItems.map((it) => it.id));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPickedIds((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));

  const submit = async () => {
    if (!reason) return toast.error("Pick a reason for the return");
    if (pickedIds.length === 0) return toast.error("Pick at least one item to return");
    setBusy(true);
    try {
      const data = await api.orders.createReturn(order.id, { reason, item_ids: pickedIds });
      toast.success("Return request submitted");
      onCreated?.(data);
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" data-testid="return-modal">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-2xl font-bold text-[#1A2B4C] flex items-center gap-2"><RotateCcw size={20} /> Return product</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Items to return</div>
        <div className="space-y-2 mb-4">
          {eligibleItems.map((it) => (
            <label key={it.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#FDFBF7] cursor-pointer">
              <input type="checkbox" checked={pickedIds.includes(it.id)} onChange={() => toggle(it.id)} data-testid={`ret-pick-${it.id}`} className="w-4 h-4 accent-[#E68910]" />
              {it.image ? (
                <Image src={it.image} alt={it.name} width={40} height={48} className="w-10 h-12 rounded-md object-cover" />
              ) : <div className="w-10 h-12 rounded-md bg-slate-100" />}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-[#1A2B4C] truncate">{it.name}</div>
                <div className="text-[11px] text-[#595959]">Qty {it.qty}{it.size ? ` · ${it.size}` : ""}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Reason</div>
        <div className="grid grid-cols-1 gap-2 mb-5">
          {RETURN_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              data-testid={`ret-reason-${r.split(" ")[0].toLowerCase()}`}
              className={`text-left px-4 py-2.5 rounded-xl border transition ${reason === r ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white border-[#E5E2DC] hover:border-[#1A2B4C]"}`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            data-testid="submit-return"
            className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit return"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ComplaintModal({
  order,
  onClose,
  onCreated,
  prefillType = "general",
}: {
  order: Order;
  onClose: () => void;
  onCreated?: (c: Complaint) => void;
  prefillType?: ComplaintType;
}) {
  const [type, setType] = useState<ComplaintType>(prefillType);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!message.trim()) return toast.error("Please describe the issue");
    setBusy(true);
    try {
      const data = await api.orders.createComplaint(order.id, { type, message: message.trim() });
      toast.success("Complaint raised — our team will follow up shortly");
      onCreated?.(data);
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" data-testid="complaint-modal">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-2xl font-bold text-[#1A2B4C] flex items-center gap-2"><MessageCircle size={20} /> Customer care</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full border border-[#E5E2DC] flex items-center justify-center" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">What&apos;s the issue?</div>
        <div className="grid grid-cols-1 gap-2 mb-4">
          {COMPLAINT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value as ComplaintType)}
              data-testid={`cmp-type-${t.value}`}
              className={`text-left px-4 py-2.5 rounded-xl border transition ${type === t.value ? "bg-[#1A2B4C] text-white border-[#1A2B4C]" : "bg-white border-[#E5E2DC] hover:border-[#1A2B4C]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Tell us more</div>
        <textarea
          data-testid="cmp-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Describe what happened so our team can help…"
          className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none focus:border-[#1A2B4C] mb-5"
        />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            data-testid="submit-complaint"
            className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Sending…" : "Raise complaint"}
          </button>
        </div>
      </div>
    </div>
  );
}
