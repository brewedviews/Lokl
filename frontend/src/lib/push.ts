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
 * Returns the resulting permission state so the caller can update its UI.
 */
export async function ensurePushSubscription(vapidPublicKey: string | undefined): Promise<PushPermissionState> {
  if (!isPushSupported()) return "unsupported";
  if (!vapidPublicKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — push disabled");
    return Notification.permission;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return permission;

  const registration = await registerRiderServiceWorker();
  if (!registration) return permission;

  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's BufferSource typing wants a plain ArrayBuffer-backed view;
        // Uint8Array's type param is ArrayBufferLike (broader) as of recent
        // lib.dom typings — the runtime value is fine, this is a type-only cast.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
    }
    await api.rider.pushSubscribe(subscriptionToJSON(subscription));
  } catch (e) {
    console.warn("[push] subscribe failed", e);
  }
  return permission;
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
