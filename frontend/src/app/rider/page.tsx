"use client";

/**
 * Rider home — the incoming-orders feed + "My active orders" (Phase 1,
 * Commit 4; revised Group B2 for the B1 backend redesign, 386b588).
 *
 * Group B1 removed the one-active-leg-per-rider limit — a rider can now
 * hold several deliveries at once, so this screen no longer redirects to a
 * single order the moment one exists. Instead it shows TWO sections:
 *   - "My active orders" — every leg from GET /rider/me/active, grouped
 *     into SUGGESTED batches by pickup proximity (batch_id/suggested_*
 *     fields — see types/rider.ts). Always visible regardless of the
 *     online toggle, since a rider might go offline to stop new
 *     assignments while still finishing what they already have.
 *   - "Available orders" — the existing unclaimed-orders feed, unchanged
 *     except accepting no longer navigates away (the rider can keep
 *     accepting more instead of being forced into one order's workflow).
 *
 * Polls GET /api/rider/orders/available every 6s while online (unchanged
 * cadence) and GET /api/rider/me/active every 8s always (matches the order
 * detail screen's poll rate) so status changes made from within an order's
 * workflow — or from another device — show up here too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, MapPin, Package, Loader2, PowerOff, Clock, Navigation2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage, getErrorStatus } from "@/lib/api-error";
import { useRiderAuthStore } from "@/stores";
import { riderLegStatusLabel, shortOrderRef } from "@/lib/rider-status";
import { playNewOrderPing } from "@/lib/audio-ping";
import type { RiderAvailableLeg, RiderMeActiveLeg, RiderBatchSummary } from "@/types";

const AVAILABLE_POLL_MS = 6000;
const ACTIVE_POLL_MS = 8000;

export default function RiderFeedPage() {
  const router = useRouter();
  const rider = useRiderAuthStore((s) => s.rider);
  const online = !!rider?.online;

  const [activeLegs, setActiveLegs] = useState<RiderMeActiveLeg[]>([]);
  const [batches, setBatches] = useState<RiderBatchSummary[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);

  const [legs, setLegs] = useState<RiderAvailableLeg[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const firstActiveLoad = useRef(true);
  // Group D2: foreground "new order" ping — the service worker's push
  // notification sound is suppressed while this tab is focused (Chrome
  // behavior), so a genuinely NEW leg appearing between polls needs its
  // own audible/vibration alert here. null until the first successful
  // poll resolves, so the very first page load (which is full of
  // "pre-existing" orders, not new ones) never pings.
  const knownLegKeys = useRef<Set<string> | null>(null);

  const loadActive = useCallback(() => {
    api.rider.meActive()
      .then((r) => { setActiveLegs(r.active_legs); setBatches(r.batches); })
      .catch(() => { /* transient poll failure — keep the last-known list */ })
      .finally(() => { setLoadingActive(false); firstActiveLoad.current = false; });
  }, []);

  useEffect(() => {
    loadActive();
    const t = setInterval(loadActive, ACTIVE_POLL_MS);
    return () => clearInterval(t);
  }, [loadActive]);

  const loadFeed = useCallback(() => {
    api.rider.available()
      .then((r) => {
        setLegs(r.legs);
        const nextKeys = new Set(r.legs.map((l) => `${l.order_id}:${l.merchant_id}`));
        if (knownLegKeys.current) {
          const isNew = [...nextKeys].some((k) => !knownLegKeys.current!.has(k));
          if (isNew) {
            playNewOrderPing();
            toast.message("New order available", { description: "Check the list below" });
          }
        }
        knownLegKeys.current = nextKeys;
      })
      .catch(() => { /* transient poll failure — keep the last-known list */ })
      .finally(() => setLoadingFeed(false));
  }, []);

  useEffect(() => {
    if (!online) { setLoadingFeed(false); return; }
    setLoadingFeed(true);
    loadFeed();
    const t = setInterval(loadFeed, AVAILABLE_POLL_MS);
    return () => clearInterval(t);
  }, [online, loadFeed]);

  const accept = async (leg: RiderAvailableLeg) => {
    const key = `${leg.order_id}:${leg.merchant_id}`;
    setAcceptingKey(key);
    try {
      await api.rider.accept(leg.order_id, leg.merchant_id);
      toast.success("Order accepted — added to your active orders");
      loadFeed();
      loadActive();
    } catch (err) {
      if (getErrorStatus(err) === 409) {
        toast.error("Someone else already took this order");
        loadFeed();
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setAcceptingKey(null);
    }
  };

  const openOrder = (leg: { order_id: string }) => router.push(`/rider/orders/${leg.order_id}`);

  // Group active legs by batch_id, preserving batches[] order (batch_id 0, 1, ...).
  const legsByBatch = new Map<number, RiderMeActiveLeg[]>();
  for (const leg of activeLegs) {
    const arr = legsByBatch.get(leg.batch_id) ?? [];
    arr.push(leg);
    legsByBatch.set(leg.batch_id, arr);
  }

  return (
    <div className="flex-1 px-4 py-4" data-testid="rider-home">
      {/* ---------------- MY ACTIVE ORDERS ---------------- */}
      {loadingActive && firstActiveLoad.current ? (
        <div className="py-8 grid place-items-center">
          <Loader2 size={22} className="animate-spin text-brand-primary/40" />
        </div>
      ) : activeLegs.length > 0 ? (
        <section className="mb-6" data-testid="rider-active-orders">
          <h1 className="font-display text-lg font-bold text-brand-primary mb-1">
            My active orders ({activeLegs.length})
          </h1>
          <p className="text-xs text-text-muted mb-3">Tap any order to continue its workflow</p>

          <div className="space-y-4">
            {batches.map((batch) => {
              const batchLegs = (legsByBatch.get(batch.batch_id) ?? [])
                .slice()
                .sort((a, b) => a.suggested_pickup_order - b.suggested_pickup_order);
              if (batchLegs.length === 0) return null;

              if (batch.size <= 1) {
                return batchLegs.map((leg) => (
                  <ActiveLegCard key={`${leg.order_id}:${leg.merchant_id}`} leg={leg} onOpen={openOrder} />
                ));
              }

              const pickupOrder = batchLegs.slice().sort((a, b) => a.suggested_pickup_order - b.suggested_pickup_order);
              const deliveryOrder = batchLegs.slice().sort((a, b) => a.suggested_delivery_order - b.suggested_delivery_order);

              return (
                <div
                  key={batch.batch_id}
                  data-testid="rider-batch-group"
                  className="rounded-card-lg border-2 border-brand-accent/30 bg-brand-accent/[0.04] p-3"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Navigation2 size={14} className="text-brand-accent" />
                    <h2 className="text-sm font-bold text-brand-primary">Nearby pickups — do these together</h2>
                  </div>
                  <p className="text-[11px] text-text-muted mb-2" data-testid="rider-batch-suggestion-note">
                    Suggested route, not required — work these in any order you like.
                  </p>
                  <p className="text-xs text-text-secondary bg-white/70 border border-card-border rounded-card px-2.5 py-2 mb-3" data-testid="rider-batch-route-summary">
                    <span className="font-semibold">Pickup:</span>{" "}
                    {pickupOrder.map((l) => l.store_name).join(" → ")}
                    {"  ·  "}
                    <span className="font-semibold">Deliver:</span>{" "}
                    {deliveryOrder.map((l) => shortOrderRef(l.order_id)).join(" → ")}
                  </p>
                  <div className="space-y-2.5">
                    {batchLegs.map((leg) => (
                      <ActiveLegCard key={`${leg.order_id}:${leg.merchant_id}`} leg={leg} onOpen={openOrder} compact />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---------------- AVAILABLE ORDERS ---------------- */}
      <h2 className="font-display text-lg font-bold text-brand-primary mb-1">Available orders</h2>
      <p className="text-xs text-text-muted mb-4">Updates automatically</p>

      {!online ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center" data-testid="rider-offline-state">
          <div className="w-16 h-16 rounded-full bg-card-border/60 grid place-items-center mb-4">
            <PowerOff size={28} className="text-text-muted" />
          </div>
          <h3 className="font-display text-base font-bold text-brand-primary">You&apos;re offline</h3>
          <p className="text-sm text-text-muted mt-1 max-w-xs">
            Go online using the toggle at the top to start receiving new delivery orders.
            {activeLegs.length > 0 && " You can still work your active orders above."}
          </p>
        </div>
      ) : loadingFeed ? (
        <div className="py-16 grid place-items-center">
          <Loader2 size={24} className="animate-spin text-brand-primary/40" />
        </div>
      ) : legs.length === 0 ? (
        <div className="py-16 text-center" data-testid="rider-feed-empty">
          <Package size={32} className="text-card-border mx-auto mb-3" />
          <p className="text-sm text-text-muted">No orders waiting right now — check back shortly.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="rider-feed">
          {legs.map((leg) => {
            const key = `${leg.order_id}:${leg.merchant_id}`;
            const accepting = acceptingKey === key;
            return (
              <div key={key} data-testid="rider-available-leg" className="bg-card-surface border border-card-border rounded-card-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-accent/10 grid place-items-center shrink-0">
                    <Store size={18} className="text-brand-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-brand-primary truncate">{leg.store_name}</p>
                      {leg.merchant_accepted ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#22C55E]/10 text-[#22C55E] text-[10px] font-bold uppercase tracking-wide shrink-0">
                          Ready
                        </span>
                      ) : (
                        <span data-testid="rider-leg-waiting-badge" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold uppercase tracking-wide shrink-0">
                          <Clock size={10} /> Waiting for store
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">Pickup: {leg.pickup_area}</p>
                    <div className="flex items-center gap-1 text-xs text-text-muted mt-1">
                      <MapPin size={12} className="shrink-0" />
                      Drop: {leg.drop_area}{leg.drop_pincode ? ` · ${leg.drop_pincode}` : ""}
                    </div>
                    <p className="text-xs text-text-muted mt-1">{leg.item_count} item{leg.item_count === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => accept(leg)}
                  disabled={acceptingKey !== null}
                  data-testid="rider-accept-btn"
                  className="w-full mt-3 py-3.5 rounded-full bg-brand-primary text-white font-bold text-base disabled:opacity-60"
                >
                  {accepting ? "Accepting…" : "Accept"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActiveLegCard({
  leg, onOpen, compact,
}: {
  leg: RiderMeActiveLeg;
  onOpen: (leg: { order_id: string }) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(leg)}
      data-testid="rider-active-leg-card"
      className={`w-full text-left bg-card-surface border border-card-border rounded-card-lg p-4 active:bg-brand-accent/5 transition ${compact ? "bg-white" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-brand-primary/10 grid place-items-center shrink-0">
            <Store size={16} className="text-brand-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-brand-primary truncate">{leg.store_name}</p>
            <p className="text-xs text-text-muted mt-0.5">Pickup: {leg.pickup_area}</p>
            <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
              <MapPin size={11} className="shrink-0" />
              Drop: {leg.drop_area}
            </div>
          </div>
        </div>
        <span
          data-testid="rider-suggested-label"
          className="shrink-0 px-2 py-1 rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold uppercase tracking-wide"
        >
          {leg.suggested_label}
        </span>
      </div>
      <p className="text-xs text-text-secondary mt-2 pt-2 border-t border-card-border" data-testid="rider-active-leg-status">
        {riderLegStatusLabel(leg.status, leg.rider_assignment)}
      </p>
    </button>
  );
}
