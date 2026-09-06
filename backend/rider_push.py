"""Web Push for riders (Group D1) — VAPID-based, Android/Chrome only.

iOS is explicitly OUT OF SCOPE: standard Web Push (the W3C Push API this
module targets) works on Android/Chrome and desktop Chrome/Firefox/Edge out
of the box; iOS Safari has separate, stricter PWA-installation
prerequisites for push that aren't handled here. No iOS-specific code
exists in this module — don't add any without a separate decision to do so.

Fire-and-forget by design, same contract notifications.py established for
SMS/WhatsApp (see that module's docstring): a push failure must NEVER
block the order/merchant-accept flow that triggered it, and every send
outcome is logged (success or failure) — a silently-misconfigured VAPID
key should be exactly as loud in the logs as a silently-misconfigured
Twilio credential was before the notification-provider migration's
Commit 1 fixed that.

### Usage
  - `is_configured()` — whether VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are set.
  - `send_to_subscription(subscription, title, body, ...)` — sends ONE
    push to ONE subscription. Synchronous/blocking (pywebpush has no
    async API) — callers on the FastAPI event loop must run this via
    `asyncio.to_thread`, never `await` it directly or call it in a tight
    loop on the loop itself (see server.py's _push_new_order_to_riders).
    Never raises; returns a result dict describing the outcome, including
    whether the subscription is expired (404/410 — caller should delete
    it from storage).

### Generating VAPID keys
See scripts/generate_vapid_keys.py — run once, put the output in Railway
as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
"""
import json
import logging
import os

log = logging.getLogger("lokl.push")

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:hello@shoplokl.in").strip()


def is_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def send_to_subscription(subscription: dict, title: str, body: str, *,
                          tag: str = "lokl-order", url: str = "/rider") -> dict:
    """Send ONE push message to ONE subscription.

    Returns `{"ok": bool, "expired": bool, "error": str | None}`.
    `expired=True` means the push service returned 404/410 — the
    subscription is gone (browser uninstalled the PWA, permission
    revoked, or the endpoint rotated) and the caller should remove it
    from storage. Never raises.
    """
    endpoint = (subscription or {}).get("endpoint", "")
    short = endpoint[-24:] if endpoint else "?"

    if not is_configured():
        log.warning("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured — skipping send to …%s", short)
        return {"ok": False, "expired": False, "error": "VAPID not configured"}
    keys = (subscription or {}).get("keys", {})
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        log.warning("[push] malformed subscription (missing endpoint/keys) — skipping")
        return {"ok": False, "expired": False, "error": "invalid subscription"}

    try:
        from pywebpush import webpush, WebPushException
    except ImportError as e:  # pragma: no cover — pywebpush is in requirements.txt
        log.warning("[push] pywebpush not installed — skipping send: %s", e)
        return {"ok": False, "expired": False, "error": "pywebpush not installed"}

    payload = json.dumps({"title": title, "body": body, "tag": tag, "url": url})
    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        log.info("[push] sent to …%s", short)
        return {"ok": True, "expired": False, "error": None}
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        expired = status in (404, 410)
        if expired:
            log.info("[push] subscription …%s expired (status=%s) — will be removed", short, status)
        else:
            log.warning("[push] send to …%s failed (status=%s): %s", short, status, e)
        return {"ok": False, "expired": expired, "error": str(e)}
    except Exception as e:
        log.warning("[push] send to …%s failed: %s", short, e)
        return {"ok": False, "expired": False, "error": str(e)}
