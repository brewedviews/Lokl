/**
 * Rider web push (Group D2) — service worker registration + VAPID
 * subscribe/unsubscribe orchestration. Android/Chrome only; this module
 * feature-detects and no-ops everywhere the Push API isn't available
 * (notably iOS Safari outside specific PWA-install conditions) rather
 * than building any iOS-specific fallback — out of scope by decision, see
 * GROUP D2's brief.
 */
import { api } from "@/lib/api";

export const RIDER_SW_PATH = "/rider-sw.js";
export const RIDER_SW_SCOPE = "/rider";

/** Feature-detect the whole stack this needs — service worker, Push API,
 *  Notification API. All three are required; missing any one means "no
 *  background push here" and everything in this module becomes a no-op
 *  the rest of the app can safely call without checking first. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current permission state, or "unsupported" when the Push API isn't
 *  available at all (distinct from "default" — there's nothing to ask for). */
export type PushPermissionState = NotificationPermission | "unsupported";

export function getPushPermission(): PushPermissionState {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Discriminated outcome of `ensurePushSubscription()`. Deliberately NOT
 * collapsed into `PushPermissionState` — a rider needs to know WHY it
 * didn't work (misconfigured deploy vs. a one-off network blip vs. an
 * explicit "no") to get a useful message instead of a silently-stuck
 * button, and the caller must never treat anything other than
 * "subscribed" as success (see the false-"granted" bug this replaces).
 *   - "unsupported"      — no Push API in this browser (iOS Safari, etc.)
 *   - "not-configured"   — NEXT_PUBLIC_VAPID_PUBLIC_KEY missing at build
 *                          time; requestPermission() was never even called
 *   - "denied"           — the rider (or a prior session) said no
 *   - "dismissed"        — requestPermission() resolved without "granted"
 *                          or "denied" (native dialog closed with no
 *                          choice made — rare, but Chrome allows it)
 *   - "sw-unavailable"   — permission granted, but the service worker
 *                          couldn't be registered
 *   - "subscribe-failed" — permission granted, SW registered, but
 *                          pushManager.subscribe()/getSubscription() threw
 *   - "save-failed"      — a real PushSubscription exists locally, but the
 *                          backend POST failed, so the server can't send to
 *                          it yet
 *   - "subscribed"       — all three conditions met: granted AND a real
 *                          PushSubscription AND the backend confirmed it
 */
export type PushSubscribeStatus =
  | "unsupported"
  | "not-configured"
  | "denied"
  | "dismissed"
  | "sw-unavailable"
  | "subscribe-failed"
  | "save-failed"
  | "subscribed";

export interface PushSubscribeResult {
  status: PushSubscribeStatus;
  error?: unknown;
}

/** Registers the rider service worker if not already registered. Safe to
 *  call multiple times (register() is idempotent for the same script
 *  URL/scope). No-op when unsupported. */
export async function registerRiderServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(RIDER_SW_PATH, { scope: RIDER_SW_SCOPE });
  } catch (e) {
    console.warn("[push] service worker registration failed", e);
    return null;
  }
}

/** VAPID public keys arrive as URL-safe base64 (no padding) — the Push API
 *  wants a raw Uint8Array for applicationServerKey. Standard conversion. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function subscriptionToJSON(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint || sub.endpoint,
    keys: { p256dh: json.keys?.p256dh || "", auth: json.keys?.auth || "" },
  };
}

/**
 * Ensures the rider is subscribed to push and the backend has the current
 * subscription on file. Requests permission if it's still "default"
 * (caller should only invoke this from a deliberate user action — the
 * permission banner's "Enable notifications" button — never on unprompted
 * page load, browsers throttle/ignore unsolicited permission requests
 * anyway). If permission is already "granted" from a prior session, this
 * silently re-subscribes (pushManager.subscribe() returns the existing
 * subscription rather than prompting again) and re-POSTs it — cheap
 * idempotent housekeeping, safe to call on every authenticated page load.
 *
 * Returns a `PushSubscribeResult` — the caller MUST treat only
 * `{status: "subscribed"}` as success. Every other status is a distinct,
 * named failure so the UI can say something useful instead of quietly
 * doing nothing (the bug this replaces: a missing VAPID key used to
 * return `Notification.permission` — "default" — with no signal that
 * requestPermission() was never even called; a subscribe()/save failure
 * used to be swallowed and reported back as "granted", a false success).
 */
export async function ensurePushSubscription(vapidPublicKey: string | undefined): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return { status: "unsupported" };
  if (!vapidPublicKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — push disabled");
    return { status: "not-configured" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission === "denied") return { status: "denied" };
  if (permission !== "granted") return { status: "dismissed" };

  const registration = await registerRiderServiceWorker();
  if (!registration) return { status: "sw-unavailable" };

  let subscription: PushSubscription;
  try {
    subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's BufferSource typing wants a plain ArrayBuffer-backed view;
        // Uint8Array's type param is ArrayBufferLike (broader) as of recent
        // lib.dom typings — the runtime value is fine, this is a type-only cast.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      }));
  } catch (e) {
    console.warn("[push] subscribe failed", e);
    return { status: "subscribe-failed", error: e };
  }

  try {
    await api.rider.pushSubscribe(subscriptionToJSON(subscription));
  } catch (e) {
    console.warn("[push] failed to save subscription to backend", e);
    return { status: "save-failed", error: e };
  }

  return { status: "subscribed" };
}

/** Unsubscribes locally (browser) and tells the backend to forget this
 *  device's endpoint — called on rider logout so a signed-out session on
 *  a shared device stops receiving that rider's order pings. Safe/no-op
 *  when unsupported or never subscribed. */
export async function unsubscribeRiderPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration(RIDER_SW_SCOPE);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await api.rider.pushUnsubscribe(endpoint);
  } catch (e) {
    console.warn("[push] unsubscribe failed", e);
  }
}
