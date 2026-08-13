/**
 * Rider PWA service worker (Group D2) — scoped to /rider. Android/Chrome
 * web push only; this file intentionally has no iOS-specific handling (see
 * rider-push.ts on the app side for the same scope decision).
 *
 * Two jobs:
 *   1. 'push'           — show an OS notification when the app is in the
 *      background/closed. Payload shape MUST match backend/rider_push.py's
 *      send_to_subscription(): {"title", "body", "tag", "url"}.
 *   2. 'notificationclick' — focus an existing /rider tab if one is open,
 *      else open a new one, then close the notification.
 *
 * Deliberately NOT a full offline-caching service worker (no fetch-event
 * caching here) — riders always need live order data, stale-while-
 * revalidate would be actively wrong for a "claim this order before
 * someone else does" feed. This SW exists for push only.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "Lokl Rider", body: "You have a new update.", tag: "lokl-rider", url: "/rider" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON push payload (shouldn't happen — backend always sends JSON)
    // — fall back to the defaults above rather than dropping the notification.
  }

  const options = {
    body: data.body,
    tag: data.tag,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    // Distinct "urgent" pulse — new orders are time-sensitive (another
    // rider can claim it first), so this isn't a single soft buzz.
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || "/rider" },
    renotify: true,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/rider";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/rider") && "focus" in client) {
          if ("navigate" in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
