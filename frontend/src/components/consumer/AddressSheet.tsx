"use client";

/**
 * AddressSheet — a proper mobile bottom sheet for adding an address,
 * replacing the old AddressModal in account/page.tsx (a `fixed inset-0
 * ... items-end md:items-center` hybrid that became a large centered
 * popup on desktop and had no drag handle/slide animation/scroll-lock on
 * mobile). Shell modeled directly on ConsumerHeader.tsx's own LocationSheet
 * — same portal-to-body, backdrop, `rounded-t-3xl`, drag handle, and the
 * already-existing `search-sheet-backdrop-in`/`location-sheet-in` CSS
 * animations (globals.css) — reusing an established in-app pattern rather
 * than inventing a new sheet primitive.
 *
 * z-[60]/[61] clears StickyBottomNav's z-50, so the sheet always renders
 * above the bottom nav, never behind it.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AddressPinPicker } from "./AddressPinPicker";

export type AddressFormValue = {
  name: string; phone: string; label: string; line1: string; landmark: string;
  city: string; pincode: string; lat: number | null; lng: number | null;
};

export function AddressSheet({ address, title = "Add address", onCancel, onSave }: { address: AddressFormValue; title?: string; onCancel: () => void; onSave: (a: AddressFormValue) => void }) {
  const [a, setA] = useState(address);
  const set = (k: keyof Omit<AddressFormValue, "lat" | "lng">, v: string) => setA((p) => ({ ...p, [k]: v }));

  // Lock background scroll while the sheet is open — the underlying page
  // must not scroll behind it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <>
      <div
        data-testid="address-sheet-backdrop"
        onClick={onCancel}
        className="fixed inset-0 z-[60] bg-[#0A1F5C]/45 search-sheet-backdrop-in"
      />
      <div
        data-testid="address-modal"
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-8 sm:w-full sm:max-w-lg z-[61] bg-white rounded-t-3xl sm:rounded-3xl shadow-[0_-16px_40px_rgba(10,31,92,0.18)] max-h-[88vh] flex flex-col overflow-hidden location-sheet-in"
      >
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-[#E5E2DC] rounded-full" />
        </div>
        <div className="shrink-0 flex items-center justify-between px-5 pt-1 pb-3 border-b border-[#E5E2DC]">
          <h2 className="font-display text-lg font-bold text-[#0A1F5C]">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            data-testid="address-sheet-close"
            className="w-8 h-8 rounded-full bg-[#FDFBF7] border border-[#E5E2DC] flex items-center justify-center shrink-0"
          >
            <X size={15} className="text-[#0A1F5C]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <select data-testid="addr-label" value={a.label} onChange={(e) => set("label", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none bg-white text-[#0A1F5C] text-sm">
                <option>Home</option><option>Office</option><option>Other</option>
              </select>
            </Field>
            <Field label="Name">
              <input data-testid="addr-name" value={a.name} onChange={(e) => set("name", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm" />
            </Field>
          </div>

          <Field label="Address">
            <textarea data-testid="addr-line1" value={a.line1} onChange={(e) => set("line1", e.target.value)} rows={2} placeholder="House no, street, area" className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm resize-none" />
          </Field>

          <Field label="Landmark (optional)">
            <input data-testid="addr-landmark" value={a.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. Opposite SBI" className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input data-testid="addr-city" value={a.city} onChange={(e) => set("city", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm" />
            </Field>
            <Field label="Pincode">
              <input data-testid="addr-pin" value={a.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm" />
            </Field>
          </div>

          <Field label="Phone">
            <input data-testid="addr-phone" value={a.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} className="w-full px-4 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C] text-sm" />
          </Field>

          <AddressPinPicker
            lat={a.lat}
            lng={a.lng}
            pincode={a.pincode}
            onChange={(lat, lng) => setA((p) => ({ ...p, lat, lng }))}
          />
        </div>

        <div className="shrink-0 flex gap-2 px-5 pt-3 border-t border-[#E5E2DC]" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <button onClick={onCancel} className="flex-1 px-5 py-3 rounded-full border border-[#E5E2DC] text-[#0A1F5C] font-semibold text-sm">Cancel</button>
          <button onClick={() => onSave(a)} data-testid="save-address" className="flex-[2] px-5 py-3 rounded-full bg-[#E68910] text-white font-semibold text-sm hover:bg-[#D97706] transition">Save address</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#64748B] mb-1.5">{label}</div>
      {children}
    </label>
  );
}
