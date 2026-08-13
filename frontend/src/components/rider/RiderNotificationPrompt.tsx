"use client";

/**
 * Rider push-permission prompt (Group D2). Mounted once in the rider
 * layout so it's visible from any /rider page once a rider is
 * authenticated. Three states:
 *   - "default" (never asked): a dismissible banner explaining WHY, with
 *     an explicit "Enable notifications" button — the native permission
 *     dialog only fires from that deliberate tap, never on page load.
 *   - "denied": a small, dismissible hint on how to re-enable in browser
 *     settings — no "Enable" button (re-calling requestPermission() on an
 *     already-denied permission won't re-prompt in Chrome anyway, so a
 *     button that silently does nothing would be worse than no button).
 *   - "granted": renders nothing. On mount with permission already
 *     granted (from a prior session), silently (re)confirms the
 *     subscription is still registered with the backend — cheap,
 *     idempotent, no UI.
 *   - unsupported (no Push API — includes iOS Safari outside specific
 *     install conditions, by design out of scope): renders nothing, no
 *     error, the app keeps working via polling.
 *
 * Dismissal is per browser-tab-session (sessionStorage) — closing and
 * reopening the app shows it again if still un-decided, but it won't nag
 * within a single session after being dismissed once.
 */
import { useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { toast } from "sonner";
import { ensurePushSubscription, isPushSupported, type PushPermissionState } from "@/lib/push";

const DISMISS_KEY = "lokl_rider_push_prompt_dismissed";

export function RiderNotificationPrompt() {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [dismissed, setDismissed] = useState(true); // default true until checked, to avoid a flash
  const [requesting, setRequesting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) { setReady(true); return; }
    setPermission(Notification.permission);
    try { setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1"); } catch { setDismissed(false); }
    setReady(true);
    if (Notification.permission === "granted") {
      void ensurePushSubscription(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    }
  }, []);

  const enable = async () => {
    setRequesting(true);
    try {
      const result = await ensurePushSubscription(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
      setPermission(result);
      if (result === "granted") toast.success("Notifications on — you'll get pinged for new orders");
      else if (result === "denied") toast.error("Notifications blocked — you can turn them on in browser settings");
    } finally {
      setRequesting(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
  };

  if (!ready || dismissed || permission === "granted" || permission === "unsupported") return null;

  if (permission === "denied") {
    return (
      <div
        data-testid="rider-push-denied-hint"
        className="mx-4 mt-4 flex items-start gap-2.5 rounded-card border border-card-border bg-card-surface px-3.5 py-3"
      >
        <BellOff size={16} className="text-text-muted shrink-0 mt-0.5" />
        <p className="flex-1 text-xs text-text-secondary">
          Notifications are off, so you won&apos;t get pinged for new orders. Turn them on for this site in your
          browser&apos;s notification settings to enable them again.
        </p>
        <button type="button" onClick={dismiss} data-testid="rider-push-dismiss-btn" aria-label="Dismiss" className="text-text-muted shrink-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="rider-push-prompt"
      className="mx-4 mt-4 rounded-card-lg border border-brand-accent/30 bg-brand-accent/[0.06] px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-brand-accent/15 grid place-items-center shrink-0">
          <Bell size={16} className="text-brand-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-brand-primary">Turn on notifications</p>
          <p className="text-xs text-text-muted mt-0.5">Allow notifications so you don&apos;t miss orders — even when the app is in the background.</p>
        </div>
        <button type="button" onClick={dismiss} data-testid="rider-push-dismiss-btn" aria-label="Not now" className="text-text-muted shrink-0">
          <X size={14} />
        </button>
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={requesting}
        data-testid="rider-push-enable-btn"
        className="w-full mt-3 py-2.5 rounded-full bg-brand-accent text-white font-bold text-sm disabled:opacity-60"
      >
        {requesting ? "Enabling…" : "Enable notifications"}
      </button>
    </div>
  );
}
