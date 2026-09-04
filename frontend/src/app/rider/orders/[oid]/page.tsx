"use client";

/**
 * Rider order detail — the delivery workflow screen (Phase 1, Commit 4;
 * revised Group A2 for the A1 backend redesign — simultaneous dispatch +
 * two-OTP model; revised again from live-testing fixes: see below).
 *
 * One primary "what's next" button per state, not a status picker:
 *   pending/accepted, not reached -> "I've reached the store"  (reached-store;
 *                                     works even before the merchant accepts)
 *   reached, merchant not accepted -> disabled "Waiting for the store to accept"
 *   reached, merchant accepted    -> "Out for delivery" — a plain button, no
 *                                     OTP entry (live-testing fix: the
 *                                     handoff code is DISPLAYED on this same
 *                                     screen, so having the rider re-type a
 *                                     value they can already see validates
 *                                     nothing; it's a shared visual reference
 *                                     the rider reads aloud and the merchant
 *                                     eyeballs on their own screen, not a
 *                                     self-entry gate)
 *   handed_off, no payment yet    -> "Payment received" (collect first;
 *                                     tap the UPI QR to enlarge it for the
 *                                     customer to scan)
 *   handed_off, payment done      -> "Mark delivered" -> enter the CUSTOMER's
 *                                     delivery code (a REAL third-party
 *                                     confirmation, unlike the handoff code
 *                                     above — kept as an entry form)
 *   delivered                     -> success state -> back to feed
 *
 * The merchant-handoff OTP is shown prominently and unconditionally (the
 * rider needs to know it well before the "out for delivery" step) —
 * separate from the customer's delivery OTP further down.
 *
 * Polls GET /api/rider/orders/{oid} every 8s (same cadence + stop-on-terminal
 * technique as the customer order-tracking page), stopping once the leg is
 * delivered.
 *
 * Group B2: a rider can now have several of these active at once (B1,
 * 386b588), so this screen fetches GET /rider/me/active once on mount to
 * show a compact "switch to another active order" strip — the OTHER legs
 * the rider is currently holding, each tappable to jump straight to its own
 * detail screen. This is purely a navigation convenience: it doesn't re-poll
 * (the strip can go one poll-cycle stale; landing on another order's page
 * re-fetches fresh state immediately), and it never affects what actions
 * are available here — each order's workflow is still entirely independent.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Store, MapPin, Phone, Navigation, Package, CheckCircle2, Loader2,
  ShieldCheck, Wallet, QrCode, ArrowLeft, KeyRound, Clock, X, Maximize2, LayoutList,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { riderLegStatusLabel } from "@/lib/rider-status";
import type { RiderOrderLegDetail, RiderMeActiveLeg } from "@/types";

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

  const [showQrModal, setShowQrModal] = useState(false);

  // Other active orders, for the quick-switch strip (Group B2) — fetched
  // once, not polled (see file header note).
  const [otherActive, setOtherActive] = useState<RiderMeActiveLeg[]>([]);

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

  useEffect(() => {
    api.rider.meActive()
      .then((r) => setOtherActive(r.active_legs.filter((l) => l.order_id !== oid)))
      .catch(() => { /* switcher strip is a convenience — fail quiet */ });
  }, [oid]);

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

  const markOutForDelivery = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.rider.outForDelivery(oid, detail.merchant_id, {});
      toast.success("Out for delivery");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  const markPaymentReceived = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.rider.paymentCompleted(oid, detail.merchant_id, { payment_method: detail.payment.method });
      toast.success("Payment marked received");
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
      await api.rider.deliver(oid, detail.merchant_id, { otp: otpInput, cash_collected: cashCollected });
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
  const paymentDone = !!detail.rider_assignment?.payment_completed_at;
  const isPending = detail.status === "pending";
  const isAccepted = detail.status === "accepted";
  const isHandedOff = detail.status === "handed_off";
  const isDelivered = detail.status === "delivered";
  const nextActive = otherActive[0];

  if (isDelivered) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16" data-testid="rider-delivered-state">
        <div className="w-16 h-16 rounded-full bg-[#22C55E]/10 grid place-items-center mb-4">
          <CheckCircle2 size={32} className="text-[#22C55E]" />
        </div>
        <h2 className="font-display text-xl font-bold text-brand-primary">Delivered</h2>
        <p className="text-sm text-text-muted mt-1">
          {otherActive.length > 0
            ? `Nice work. You still have ${otherActive.length} active order${otherActive.length === 1 ? "" : "s"}.`
            : "Nice work. You're free for your next delivery."}
        </p>
        {nextActive && (
          <button
            onClick={() => router.push(`/rider/orders/${nextActive.order_id}`)}
            data-testid="rider-next-order-btn"
            className="mt-6 px-8 py-3.5 rounded-full bg-[#22C55E] text-white font-bold text-base"
          >
            Continue to {nextActive.store_name}
          </button>
        )}
        <button
          onClick={() => router.replace("/rider")}
          data-testid="rider-back-to-feed-btn"
          className={otherActive.length > 0
            ? "mt-3 px-8 py-3 text-brand-primary font-semibold text-sm"
            : "mt-6 px-8 py-3.5 rounded-full bg-brand-primary text-white font-bold text-base"}
        >
          Back to my orders
        </button>
      </div>
    );
  }

  const statusLabel = riderLegStatusLabel(detail.status, detail.rider_assignment);

  return (
    <div className="flex-1 flex flex-col pb-6" data-testid="rider-order-detail">
      <div className="px-4 pt-4">
        <button onClick={() => router.push("/rider")} data-testid="rider-back-to-list-btn" className="inline-flex items-center gap-1 text-xs text-text-muted mb-3">
          <ArrowLeft size={14} />
          {otherActive.length > 0 ? `Back to my orders (${otherActive.length + 1} active)` : "Back"}
        </button>

        {otherActive.length > 0 && (
          <div className="mb-3 -mx-4 px-4 overflow-x-auto" data-testid="rider-order-switcher">
            <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">
              <LayoutList size={12} /> Switch to another active order
            </div>
            <div className="flex gap-2 pb-1">
              {otherActive.map((leg) => (
                <button
                  key={`${leg.order_id}:${leg.merchant_id}`}
                  type="button"
                  onClick={() => router.push(`/rider/orders/${leg.order_id}`)}
                  data-testid="rider-switcher-chip"
                  className="shrink-0 text-left bg-card-surface border border-card-border rounded-card px-3 py-2 min-w-[9rem]"
                >
                  <p className="text-xs font-bold text-brand-primary truncate max-w-[8rem]">{leg.store_name}</p>
                  <p className="text-[10px] text-brand-accent font-semibold mt-0.5">{leg.suggested_label}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 space-y-4 flex-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-accent/10 text-brand-accent text-xs font-bold uppercase tracking-wide" data-testid="rider-status-pill">
          {statusLabel}
        </div>

        {/* MERCHANT HANDOFF CODE — always visible once assigned, so the rider
            has it ready well before "out for delivery". */}
        <section className="bg-brand-primary text-white rounded-card-lg p-4" data-testid="rider-handoff-otp-card">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={16} className="text-brand-accent" />
            <div className="text-xs font-bold uppercase tracking-wide text-white/70">Merchant handoff code</div>
          </div>
          <div className="font-display text-3xl font-bold tracking-[0.3em]" data-testid="rider-handoff-otp-value">
            {detail.handoff_otp || "----"}
          </div>
          <p className="text-xs text-white/70 mt-1">{detail.handoff_otp_note}</p>
        </section>

        {/* PICKUP */}
        <section className="bg-card-surface border border-card-border rounded-card-lg p-4" data-testid="rider-pickup-block">
          <div className="flex items-center gap-2 mb-2">
            <Store size={16} className="text-brand-accent" />
            <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Pickup</div>
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
            <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Drop-off</div>
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

        {/* Customer delivery-code heads-up */}
        <section className="bg-brand-accent/10 border border-brand-accent/20 rounded-card-lg p-4 flex items-start gap-2">
          <ShieldCheck size={16} className="text-brand-accent shrink-0 mt-0.5" />
          <p className="text-sm text-brand-primary">{detail.otp_note}</p>
        </section>

        {/* Payment */}
        <section className="bg-card-surface border border-card-border rounded-card-lg p-4" data-testid="rider-payment-block">
          <div className="flex items-center gap-2 mb-1">
            {detail.payment.upi_qr_url ? <QrCode size={16} className="text-brand-accent" /> : <Wallet size={16} className="text-brand-accent" />}
            <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Payment</div>
          </div>
          <p className="font-bold text-brand-primary" data-testid="rider-payment-label">
            {detail.payment.label}
            {detail.payment.method === "COD" && ` — ₹${detail.payment.amount.toFixed(0)}`}
          </p>
          <p className="text-sm text-text-secondary mt-0.5">{detail.payment.note}</p>
          {detail.payment.upi_qr_url && (
            <button
              type="button" onClick={() => setShowQrModal(true)} data-testid="rider-qr-expand-trigger"
              className="relative mt-3 block w-32 h-32 rounded-card border border-card-border bg-white overflow-hidden group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.payment.upi_qr_url} alt="Store UPI QR code" className="w-full h-full object-contain" />
              <span className="absolute inset-0 bg-black/0 group-active:bg-black/10 transition flex items-end justify-end p-1.5">
                <span className="bg-brand-primary/90 text-white rounded-full p-1">
                  <Maximize2 size={12} />
                </span>
              </span>
            </button>
          )}
          {detail.payment.upi_qr_url && (
            <p className="text-[11px] text-text-muted mt-1.5">Tap the QR to show the customer a larger view</p>
          )}
          {isHandedOff && (
            <div className="mt-3 pt-3 border-t border-card-border">
              {paymentDone ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#22C55E]" data-testid="rider-payment-done-note">
                  <CheckCircle2 size={14} /> Payment received
                </p>
              ) : (
                <button
                  onClick={markPaymentReceived} disabled={busy} data-testid="rider-payment-received-btn"
                  className="w-full py-3 rounded-full bg-brand-primary text-white font-bold text-sm disabled:opacity-60"
                >
                  {busy ? "Updating…" : "Payment received"}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Customer delivery-OTP entry form */}
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
            {detail.payment.method === "COD" && (
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
          {!reached && (isPending || isAccepted) && (
            <button
              onClick={reachedStore} disabled={busy} data-testid="rider-reached-store-btn"
              className="w-full py-4 rounded-full bg-brand-primary text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Updating…" : "I've reached the store"}
            </button>
          )}
          {reached && isPending && (
            <button
              disabled data-testid="rider-waiting-for-merchant-btn"
              className="w-full py-4 rounded-full bg-card-border text-text-muted font-bold text-base flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <Clock size={18} /> Waiting for the store to accept
            </button>
          )}
          {reached && isAccepted && (
            <button
              onClick={markOutForDelivery} disabled={busy} data-testid="rider-out-for-delivery-btn"
              className="w-full py-4 rounded-full bg-brand-primary text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Updating…" : "Out for delivery"}
            </button>
          )}
          {isHandedOff && !paymentDone && (
            <p className="text-center text-xs text-text-muted py-2">Mark payment received above to continue</p>
          )}
          {isHandedOff && paymentDone && (
            <button
              onClick={() => setShowOtpForm(true)} data-testid="rider-mark-delivered-btn"
              className="w-full py-4 rounded-full bg-[#22C55E] text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <Package size={18} /> Mark delivered
            </button>
          )}
        </div>
      )}

      {showQrModal && detail.payment.upi_qr_url && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setShowQrModal(false)}
          data-testid="rider-qr-modal"
        >
          <div className="relative bg-white rounded-card-lg p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button" onClick={() => setShowQrModal(false)} data-testid="rider-qr-modal-close"
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-brand-primary text-white flex items-center justify-center shadow-lg"
            >
              <X size={16} />
            </button>
            <p className="text-center text-xs font-bold uppercase tracking-wide text-text-muted mb-3">Scan to pay</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detail.payment.upi_qr_url} alt="Store UPI QR code — enlarged" className="w-full aspect-square object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
