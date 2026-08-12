"use client";

/**
 * Rider order detail — the delivery workflow screen (Phase 1, Commit 4).
 *
 * One primary "what's next" button per state, not a status picker:
 *   accepted, not reached  -> "I've reached the store"   (reached-store)
 *   accepted, reached      -> "Picked up the order"      (picked-up)
 *   handed_off             -> "Mark delivered" -> OTP entry -> (deliver)
 *   delivered               -> success state -> back to feed
 *
 * Polls GET /api/rider/orders/{oid} every 8s (same cadence + stop-on-terminal
 * technique as the customer order-tracking page), stopping once the leg is
 * delivered.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Store, MapPin, Phone, Navigation, Package, CheckCircle2, Loader2,
  ShieldCheck, Wallet, QrCode, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import type { RiderOrderLegDetail } from "@/types";

const POLL_MS = 8000;

function mapsUrl(lat: number, lng: number, address: string): string {
  if (lat && lng) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export default function RiderOrderDetailPage() {
  const { oid } = useParams<{ oid: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<RiderOrderLegDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [cashCollected, setCashCollected] = useState(false);
  const [otpError, setOtpError] = useState("");

  const load = useCallback(() => {
    api.rider.orderDetail(oid)
      .then((d) => setDetail(d))
      .catch((err) => { toast.error(getErrorMessage(err)); })
      .finally(() => setLoading(false));
  }, [oid]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (detail?.status === "delivered") return;
      load();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid, detail?.status]);

  const reachedStore = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.rider.reachedStore(oid, detail.merchant_id);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  const pickedUp = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.rider.pickedUp(oid, detail.merchant_id);
      toast.success("Marked picked up");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  const submitDelivery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!detail || otpInput.length !== 4) return;
    setBusy(true);
    setOtpError("");
    try {
      await api.rider.deliver(oid, detail.merchant_id, {
        otp: otpInput,
        cash_collected: detail.payment.method === "cod" ? cashCollected : undefined,
      });
      toast.success("Delivered!");
      await load();
    } catch (err) {
      setOtpError(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  if (loading && !detail) {
    return (
      <div className="flex-1 grid place-items-center py-24">
        <Loader2 size={28} className="animate-spin text-brand-primary/40" />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex-1 grid place-items-center px-6 text-center py-24">
        <p className="text-sm text-text-muted">Couldn&apos;t load this order.</p>
      </div>
    );
  }

  const reached = !!detail.rider_assignment?.reached_store_at;
  const isDelivered = detail.status === "delivered";
  const isHandedOff = detail.status === "handed_off";

  if (isDelivered) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16" data-testid="rider-delivered-state">
        <div className="w-16 h-16 rounded-full bg-[#22C55E]/10 grid place-items-center mb-4">
          <CheckCircle2 size={32} className="text-[#22C55E]" />
        </div>
        <h2 className="font-display text-xl font-bold text-brand-primary">Delivered</h2>
        <p className="text-sm text-text-muted mt-1">Nice work. You&apos;re free for your next delivery.</p>
        <button
          onClick={() => router.replace("/rider")}
          data-testid="rider-back-to-feed-btn"
          className="mt-6 px-8 py-3.5 rounded-full bg-brand-primary text-white font-bold text-base"
        >
          Back to feed
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col pb-6" data-testid="rider-order-detail">
      <div className="px-4 pt-4">
        <button onClick={() => router.push("/rider")} className="inline-flex items-center gap-1 text-xs text-text-muted mb-3">
          <ArrowLeft size={14} /> Back
        </button>
      </div>

      <div className="px-4 space-y-4 flex-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-accent/10 text-brand-accent text-xs font-bold uppercase tracking-wide" data-testid="rider-status-pill">
          {isHandedOff ? "Picked up · Out for delivery" : reached ? "At the store" : "Heading to store"}
        </div>

        {/* PICKUP */}
        <section className="bg-card-surface border border-card-border rounded-card-lg p-4" data-testid="rider-pickup-block">
          <div className="flex items-center gap-2 mb-2">
            <Store size={16} className="text-brand-accent" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Pickup</h3>
          </div>
          <p className="font-bold text-brand-primary">{detail.pickup.store_name}</p>
          <p className="text-sm text-text-secondary mt-0.5">{detail.pickup.address}</p>
          <a
            href={mapsUrl(detail.pickup.lat, detail.pickup.lng, detail.pickup.address)}
            target="_blank" rel="noopener noreferrer" data-testid="rider-pickup-maps-link"
            className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-brand-primary"
          >
            <Navigation size={14} /> Open in Maps
          </a>
          {detail.items.length > 0 && (
            <div className="mt-3 pt-3 border-t border-card-border space-y-1">
              {detail.items.map((it, i) => (
                <div key={`${it.id}-${it.size ?? ""}-${i}`} className="text-sm text-text-secondary">
                  {it.qty}x {it.name}{it.size ? ` (${it.size})` : ""}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* DROP */}
        <section className="bg-card-surface border border-card-border rounded-card-lg p-4" data-testid="rider-drop-block">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={16} className="text-brand-accent" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Drop-off</h3>
          </div>
          <p className="font-bold text-brand-primary">{detail.drop.customer_name}</p>
          <p className="text-sm text-text-secondary mt-0.5">{detail.drop.address}</p>
          <div className="flex items-center gap-4 mt-2">
            <a
              href={mapsUrl(detail.drop.lat, detail.drop.lng, detail.drop.address)}
              target="_blank" rel="noopener noreferrer" data-testid="rider-drop-maps-link"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary"
            >
              <Navigation size={14} /> Open in Maps
            </a>
            {detail.drop.customer_phone && (
              <a href={`tel:${detail.drop.customer_phone}`} data-testid="rider-call-customer-link" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary">
                <Phone size={14} /> Call customer
              </a>
            )}
          </div>
        </section>

        {/* OTP heads-up */}
        <section className="bg-brand-accent/10 border border-brand-accent/20 rounded-card-lg p-4 flex items-start gap-2">
          <ShieldCheck size={16} className="text-brand-accent shrink-0 mt-0.5" />
          <p className="text-sm text-brand-primary">{detail.otp_note}</p>
        </section>

        {/* Payment */}
        <section className="bg-card-surface border border-card-border rounded-card-lg p-4" data-testid="rider-payment-block">
          <div className="flex items-center gap-2 mb-1">
            {detail.payment.upi_qr_url ? <QrCode size={16} className="text-brand-accent" /> : <Wallet size={16} className="text-brand-accent" />}
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Payment</h3>
          </div>
          <p className="text-sm text-text-secondary">{detail.payment.note}</p>
          {detail.payment.upi_qr_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.payment.upi_qr_url} alt="Store UPI QR code" className="w-32 h-32 mt-3 rounded-card border border-card-border object-contain bg-white" />
          )}
        </section>

        {showOtpForm && (
          <form onSubmit={submitDelivery} className="bg-card-surface border border-card-border rounded-card-lg p-4 space-y-3" data-testid="rider-otp-form">
            <h3 className="text-sm font-bold text-brand-primary">Enter the customer&apos;s delivery code</h3>
            <input
              value={otpInput}
              onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setOtpError(""); }}
              placeholder="••••" inputMode="numeric" autoFocus data-testid="rider-otp-input"
              className="w-full px-4 py-3 rounded-card border border-card-border text-center text-2xl tracking-[0.5em] font-bold text-brand-primary focus:border-brand-accent outline-none"
            />
            {otpError && <p className="text-sm text-red-600" data-testid="rider-otp-error">{otpError}</p>}
            {detail.payment.method === "cod" && (
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox" checked={cashCollected} onChange={(e) => setCashCollected(e.target.checked)}
                  data-testid="rider-cash-collected-checkbox" className="w-4 h-4 rounded border-card-border"
                />
                Cash collected from customer
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowOtpForm(false); setOtpError(""); setOtpInput(""); }}
                className="flex-1 py-3 rounded-full border border-card-border text-brand-primary font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={busy || otpInput.length !== 4} data-testid="rider-confirm-delivery-btn"
                className="flex-[2] py-3 rounded-full bg-[#22C55E] text-white font-bold text-sm disabled:opacity-60"
              >
                {busy ? "Confirming…" : "Confirm delivery"}
              </button>
            </div>
          </form>
        )}
      </div>

      {!showOtpForm && (
        <div className="sticky bottom-0 bg-brand-bg border-t border-card-border px-4 pt-3 pb-4 mt-4">
          {detail.status === "accepted" && !reached && (
            <button
              onClick={reachedStore} disabled={busy} data-testid="rider-reached-store-btn"
              className="w-full py-4 rounded-full bg-brand-primary text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Updating…" : "I've reached the store"}
            </button>
          )}
          {detail.status === "accepted" && reached && (
            <button
              onClick={pickedUp} disabled={busy} data-testid="rider-picked-up-btn"
              className="w-full py-4 rounded-full bg-brand-primary text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Updating…" : "Picked up the order"}
            </button>
          )}
          {isHandedOff && (
            <button
              onClick={() => setShowOtpForm(true)} data-testid="rider-mark-delivered-btn"
              className="w-full py-4 rounded-full bg-[#22C55E] text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <Package size={18} /> Mark delivered
            </button>
          )}
        </div>
      )}
    </div>
  );
}
