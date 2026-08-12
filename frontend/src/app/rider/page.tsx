"use client";

/**
 * Rider feed — the incoming-orders screen (Phase 1, Commit 4).
 *
 * On mount, checks GET /api/rider/me/active first: a rider mid-delivery has
 * nothing to accept (one-active-leg-per-rider, enforced server-side in
 * Commit 3) — the order detail screen IS their "feed" until they finish, so
 * we redirect straight there instead of duplicating an "active order" card
 * here.
 *
 * Polls GET /api/rider/orders/available every 6s while online — a bit
 * tighter than the customer tracker's 8s poll (lib/(consumer)/orders/[id])
 * since claim-latency here directly affects delivery speed, matching the
 * cadence the Phase 1 design doc called for.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, MapPin, Package, Loader2, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage, getErrorStatus } from "@/lib/api-error";
import { useRiderAuthStore } from "@/stores";
import type { RiderAvailableLeg } from "@/types";

const POLL_MS = 6000;

export default function RiderFeedPage() {
  const router = useRouter();
  const rider = useRiderAuthStore((s) => s.rider);
  const online = !!rider?.online;

  const [checkingActive, setCheckingActive] = useState(true);
  const [legs, setLegs] = useState<RiderAvailableLeg[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.rider.meActive()
      .then((r) => {
        if (cancelled) return;
        if (r.active && !redirectedRef.current) {
          redirectedRef.current = true;
          router.replace(`/rider/orders/${r.active.order_id}`);
          return;
        }
        setCheckingActive(false);
      })
      .catch(() => { if (!cancelled) setCheckingActive(false); });
    return () => { cancelled = true; };
  }, [router]);

  const loadFeed = useCallback(() => {
    api.rider.available()
      .then((r) => setLegs(r.legs))
      .catch(() => { /* transient poll failure — keep the last-known list */ })
      .finally(() => setLoadingFeed(false));
  }, []);

  useEffect(() => {
    if (checkingActive || !online) { setLoadingFeed(false); return; }
    setLoadingFeed(true);
    loadFeed();
    const t = setInterval(loadFeed, POLL_MS);
    return () => clearInterval(t);
  }, [checkingActive, online, loadFeed]);

  const accept = async (leg: RiderAvailableLeg) => {
    const key = `${leg.order_id}:${leg.merchant_id}`;
    setAcceptingKey(key);
    try {
      await api.rider.accept(leg.order_id, leg.merchant_id);
      toast.success("Order accepted");
      router.push(`/rider/orders/${leg.order_id}`);
    } catch (err) {
      if (getErrorStatus(err) === 409) {
        toast.error("Someone else already took this order");
        loadFeed();
      } else {
        toast.error(getErrorMessage(err));
      }
      setAcceptingKey(null);
    }
  };

  if (checkingActive) {
    return (
      <div className="flex-1 grid place-items-center py-24">
        <Loader2 size={28} className="animate-spin text-brand-primary/40" />
      </div>
    );
  }

  if (!online) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center" data-testid="rider-offline-state">
        <div className="w-16 h-16 rounded-full bg-card-border/60 grid place-items-center mb-4">
          <PowerOff size={28} className="text-text-muted" />
        </div>
        <h2 className="font-display text-lg font-bold text-brand-primary">You&apos;re offline</h2>
        <p className="text-sm text-text-muted mt-1 max-w-xs">
          Go online using the toggle at the top to start receiving delivery orders.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 py-4" data-testid="rider-feed">
      <h1 className="font-display text-lg font-bold text-brand-primary mb-1">Available orders</h1>
      <p className="text-xs text-text-muted mb-4">Updates automatically</p>

      {loadingFeed ? (
        <div className="py-16 grid place-items-center">
          <Loader2 size={24} className="animate-spin text-brand-primary/40" />
        </div>
      ) : legs.length === 0 ? (
        <div className="py-16 text-center" data-testid="rider-feed-empty">
          <Package size={32} className="text-card-border mx-auto mb-3" />
          <p className="text-sm text-text-muted">No orders waiting right now — check back shortly.</p>
        </div>
      ) : (
        <div className="space-y-3">
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
                    <p className="font-bold text-brand-primary truncate">{leg.store_name}</p>
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
