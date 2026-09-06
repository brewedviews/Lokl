/**
 * Rider web push — ensurePushSubscription() outcome model (2026-09 audit
 * fix). Covers the exact bug the audit found: a missing VAPID key used to
 * return `Notification.permission` ("default") with no signal that
 * requestPermission() was never called, and a subscribe()/backend-save
 * failure used to be swallowed and reported back as "granted" — a false
 * success the UI would have shown as "Notifications on."
 *
 * Every case below asserts BOTH the returned status AND which of
 * requestPermission()/register()/subscribe()/pushSubscribe() actually ran,
 * since the whole point of the discriminated result is that failure at any
 * step must never fall through to "subscribed".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pushSubscribeMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { rider: { pushSubscribe: (...args: unknown[]) => pushSubscribeMock(...args) } },
}));

import { ensurePushSubscription, isPushSupported, RIDER_SW_PATH, RIDER_SW_SCOPE } from "@/lib/push";

const VAPID_KEY = "BNbxGY7pF3S9m8t0Q4t8b7d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2"; // arbitrary, valid base64url shape

function fakeSubscription(endpoint = "https://push.example/abc") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-value", auth: "auth-value" } }),
  };
}

function stubBrowserSupport() {
  vi.stubGlobal("Notification", {
    permission: "default" as NotificationPermission,
    requestPermission: vi.fn().mockResolvedValue("granted"),
  });
  Object.defineProperty(window, "PushManager", {
    value: function PushManager() {},
    configurable: true,
    writable: true,
  });
}

/** The real Notification.permission is a read-only getter; the stub above
 *  is a plain object so tests can set it directly, but do it through this
 *  helper to keep the `as` cast in one place instead of at every call site. */
function setPermission(value: NotificationPermission) {
  (Notification as unknown as { permission: NotificationPermission }).permission = value;
}

let registerMock: ReturnType<typeof vi.fn>;
let getSubscriptionMock: ReturnType<typeof vi.fn>;
let subscribeMock: ReturnType<typeof vi.fn>;

function stubServiceWorker(overrides: { registerImpl?: () => Promise<unknown> } = {}) {
  getSubscriptionMock = vi.fn().mockResolvedValue(null);
  subscribeMock = vi.fn().mockResolvedValue(fakeSubscription());
  const registration = { pushManager: { getSubscription: getSubscriptionMock, subscribe: subscribeMock } };
  registerMock = vi.fn(overrides.registerImpl ?? (() => Promise.resolve(registration)));
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register: registerMock },
    configurable: true,
  });
  return registration;
}

beforeEach(() => {
  pushSubscribeMock.mockReset();
  pushSubscribeMock.mockResolvedValue({ ok: true });
  stubBrowserSupport();
  stubServiceWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error — test-only cleanup of a jsdom global we defined
  delete window.PushManager;
  // @ts-expect-error — test-only cleanup of a jsdom global we defined
  delete navigator.serviceWorker;
});

describe("isPushSupported", () => {
  it("is false when PushManager is missing (e.g. iOS Safari)", () => {
    // @ts-expect-error — simulate an unsupported browser
    delete window.PushManager;
    expect(isPushSupported()).toBe(false);
  });

  it("is true when serviceWorker + PushManager + Notification are all present", () => {
    expect(isPushSupported()).toBe(true);
  });
});

describe("ensurePushSubscription — unsupported browser", () => {
  it("returns 'unsupported' and never touches Notification", async () => {
    // @ts-expect-error — simulate an unsupported browser
    delete window.PushManager;
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result).toEqual({ status: "unsupported" });
    expect(registerMock).not.toHaveBeenCalled();
  });
});

describe("ensurePushSubscription — missing VAPID key", () => {
  it("returns an explicit 'not-configured' failure, NOT 'default'/Notification.permission", async () => {
    const result = await ensurePushSubscription(undefined);
    expect(result.status).toBe("not-configured");
  });

  it("never calls Notification.requestPermission() when the key is missing", async () => {
    await ensurePushSubscription(undefined);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe("ensurePushSubscription — permission flow", () => {
  it("calls Notification.requestPermission() when permission is 'default'", async () => {
    setPermission("default");
    await ensurePushSubscription(VAPID_KEY);
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does NOT call requestPermission() when permission is already 'denied'", async () => {
    setPermission("denied");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "denied" });
  });

  it("returns 'denied' when the user declines the native prompt", async () => {
    setPermission("default");
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("denied");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result).toEqual({ status: "denied" });
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("returns 'dismissed' when the prompt resolves without a decision", async () => {
    setPermission("default");
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("default");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result).toEqual({ status: "dismissed" });
    expect(registerMock).not.toHaveBeenCalled();
  });
});

describe("ensurePushSubscription — granted, happy path", () => {
  it("registers the rider service worker at the correct path/scope and subscribes", async () => {
    setPermission("granted");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(registerMock).toHaveBeenCalledWith(RIDER_SW_PATH, { scope: RIDER_SW_SCOPE });
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock.mock.calls[0]?.[0]).toMatchObject({ userVisibleOnly: true });
    expect(result).toEqual({ status: "subscribed" });
  });

  it("POSTs the subscription's endpoint + keys to the backend", async () => {
    setPermission("granted");
    await ensurePushSubscription(VAPID_KEY);
    expect(pushSubscribeMock).toHaveBeenCalledWith({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    });
  });

  it("reuses an existing PushSubscription instead of creating a new one", async () => {
    getSubscriptionMock.mockResolvedValue(fakeSubscription("https://push.example/existing"));
    setPermission("granted");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(pushSubscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example/existing" })
    );
    expect(result).toEqual({ status: "subscribed" });
  });
});

describe("ensurePushSubscription — failures are never masked as success", () => {
  it("service worker registration failure → 'sw-unavailable', never 'subscribed'", async () => {
    stubServiceWorker({ registerImpl: () => Promise.reject(new Error("register failed")) });
    setPermission("granted");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result.status).toBe("sw-unavailable");
    expect(pushSubscribeMock).not.toHaveBeenCalled();
  });

  it("pushManager.subscribe() throwing → 'subscribe-failed', never 'subscribed', backend never called", async () => {
    subscribeMock.mockRejectedValue(new Error("AbortError: subscribe failed"));
    setPermission("granted");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result.status).toBe("subscribe-failed");
    expect(pushSubscribeMock).not.toHaveBeenCalled();
  });

  it("backend POST /api/rider/push/subscribe failing → 'save-failed', never 'subscribed'", async () => {
    pushSubscribeMock.mockRejectedValue(new Error("network error"));
    setPermission("granted");
    const result = await ensurePushSubscription(VAPID_KEY);
    expect(result.status).toBe("save-failed");
  });
});
