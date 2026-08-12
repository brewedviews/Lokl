"""External notification helpers — provider-agnostic (Commit 1 of the
Twilio -> MSG91 migration).

We're moving providers, but with live merchants depending on notifications,
we migrate behind an abstraction + an env-var flag so MSG91 can be tested in
parallel and cut over with instant rollback (just flip NOTIFICATION_PROVIDER
back to "twilio"). THIS COMMIT ONLY refactors the existing Twilio logic
behind that abstraction — moved, not rewritten. No MSG91 yet (Commit 2). No
behavior change: Twilio remains the only provider and sends exactly the same
messages, in the same order, with the same fallback logic, as before.

### Architecture
  - `NotificationProvider` (ABC) — the interface every provider implements:
    send_sms, send_whatsapp, send_otp, verify_otp.
  - `TwilioProvider` — the current (and, for now, only) implementation.
    Contains everything that used to be free functions here: the Twilio
    client, phone formatting, the WhatsApp-then-SMS fallback chain, the OTP
    delivery-status poll. verify_otp() is a documented no-op passthrough —
    see its docstring.
  - `get_provider()` — factory reading NOTIFICATION_PROVIDER (default
    "twilio"). Only "twilio" exists today; anything else logs a warning and
    falls back to Twilio rather than breaking the app.
  - The OLD module-level functions (`send_with_fallback`, `send_sms`,
    `send_whatsapp`, `send_otp_with_fallback`) are KEPT, unchanged in name
    and signature, as thin delegates to `get_provider()`. This is
    deliberate: every one of the 18 domain notify_* functions below, AND
    six direct call sites in server.py, already call these by name — moving
    the *implementation* behind them onto the provider means zero call
    sites needed to change for this commit, which is exactly the point of
    a zero-behavior-change refactor. (test_smoke_imports.py also asserts
    `send_with_fallback` exists as a module attribute — must stay.)

### OTP delivery contract (unchanged)
`notify_customer_otp()` calls the active provider's `send_otp()`, which for
Twilio:
  1. Tries WhatsApp first. If `TWILIO_OTP_CONTENT_SID` is set we send the
     Meta-approved template (`HX...` with `content_variables={"1": otp}`);
     otherwise we send a plain WhatsApp body (sandbox path).
  2. Polls Twilio for ~5s. If the WA message ends in `failed`/`undelivered`
     OR never reaches `delivered`/`read`/`sent` by the deadline, the same OTP
     is sent again over SMS using `TWILIO_SMS_FROM`.
  3. SMS body is intentionally short — Twilio bills per 160-char segment.

The merchant/rider login-OTP notifications intentionally do NOT use
send_otp() — they need custom wording ("Lokl merchant login code...") that
doesn't fit the OTP template contract, so they go through the generic
send_with_fallback() path instead (unchanged from before).

`verify_otp()` is on the interface but not wired into anything yet: OTP
verification is, and remains, entirely local (bcrypt hash compare against
db.customer_otps / db.rider_otps in server.py) — this migration doesn't
touch that. The method exists purely so Commit 2's MSG91Provider has a real
place to plug in API-based verification later.

### Visibility (the silent-failure fix)
Previously, `_get_twilio()` returning None (missing/invalid
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) logged NOTHING — every send from
every OTP/notification path would silently no-op with zero trace in the
logs, while the API still returned "ok" to the caller. That's now a single
WARNING logged once per client-acquisition attempt (in
TwilioProvider._get_client()), so a systemic credential/config problem is
immediately visible in Railway logs instead of invisible. Every provider
method also logs its own outcome (success at INFO, failure at WARNING) —
fire-and-forget delivery stays fire-and-forget, but never silent.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Optional

log = logging.getLogger("lokl.notify")

APP_URL = os.environ.get("APP_URL", "https://www.shoplokl.in")
SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "+917719052107")
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "hello@shoplokl.in")


# ============================================================================
# Phone formatting — provider-agnostic (every provider needs E.164 numbers)
# ============================================================================

def _to_e164(phone: str) -> Optional[str]:
    """Normalize a phone string to E.164 `+91XXXXXXXXXX`. Returns None if invalid."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = f"91{digits}"
    elif digits.startswith("0") and len(digits) == 11:
        digits = f"91{digits[1:]}"
    if not digits.startswith("91") or len(digits) != 12:
        return None
    return f"+{digits}"


def _to_whatsapp_addr(phone: str) -> Optional[str]:
    e164 = _to_e164(phone)
    return f"whatsapp:{e164}" if e164 else None


# ============================================================================
# Provider interface
# ============================================================================

class NotificationProvider(ABC):
    """Everything the app sends goes through one of these. Never call a
    vendor SDK directly from server.py or from the notify_* templates below
    — go through get_provider()."""

    @abstractmethod
    def send_sms(self, to: str, message: str) -> bool:
        """Plain SMS. Returns True on successful SUBMISSION (not delivery —
        vendor delivery-status callbacks are best-effort/out of scope)."""
        raise NotImplementedError

    @abstractmethod
    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None) -> Optional[str]:
        """WhatsApp send — either a plain `message` body, or, when
        `template_id` is given, a pre-approved template with
        `template_params` substituted in. Returns the provider's message
        id on successful submission, or None on failure."""
        raise NotImplementedError

    @abstractmethod
    def send_otp(self, to: str, otp: str) -> str:
        """OTP-specific send using the provider's own delivery-confirmation
        strategy. Returns "whatsapp", "sms", or "none" (which channel, if
        any, the OTP actually went out on)."""
        raise NotImplementedError

    @abstractmethod
    def verify_otp(self, to: str, otp: str) -> bool:
        """Provider-side OTP verification hook — see module docstring.
        Twilio's implementation is a no-op passthrough; server.py's local
        bcrypt-hash check remains the real verification for this commit."""
        raise NotImplementedError


# ============================================================================
# Twilio provider — Commit 1: the CURRENT logic, moved here (not rewritten).
# ============================================================================

# Status values Twilio returns. See https://www.twilio.com/docs/sms/send-messages#monitor-the-status-of-your-message
_TERMINAL_OK = {"delivered", "read", "sent"}
_TERMINAL_FAIL = {"failed", "undelivered"}
_POLL_BUDGET_SEC = 5.0
_POLL_INTERVAL = 0.7


class TwilioProvider(NotificationProvider):
    """Moved verbatim from the old module-level _get_twilio/send_sms/
    send_whatsapp/_send_whatsapp_for_otp/_poll_message_status/
    send_otp_with_fallback/send_with_fallback — same Twilio calls, same
    fallback order, same formatting. Only the shape changed (free functions
    -> methods) plus the one visibility fix noted in the module docstring."""

    _client = None  # class-level lazy singleton — same caching as the old module global

    def _get_client(self):
        cls = type(self)
        if cls._client is not None:
            return cls._client
        sid = os.environ.get("TWILIO_ACCOUNT_SID")
        tok = os.environ.get("TWILIO_AUTH_TOKEN")
        if not sid or not tok:
            # THE silent-failure fix: this used to `return None` with zero
            # logging, meaning a missing/blank credential made every OTP and
            # notification in the app fail invisibly. Now it's impossible to
            # miss in the logs.
            log.warning(
                "[twilio] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured "
                "— all Twilio sends will be skipped until this is set"
            )
            return None
        try:
            from twilio.rest import Client
            cls._client = Client(sid, tok)
            return cls._client
        except Exception as e:  # pragma: no cover
            log.warning("[twilio] client init failed: %s", e)
            return None

    def _whatsapp_sender(self) -> str:
        """Configured WhatsApp sender, adding the `whatsapp:` prefix if missing."""
        s = (os.environ.get("TWILIO_WHATSAPP_FROM") or "whatsapp:+14155238886").strip().strip("'\"`")
        return s if s.startswith("whatsapp:") else f"whatsapp:{s}"

    # ---------------- interface methods ----------------

    def send_sms(self, to: str, message: str) -> bool:
        cli = self._get_client()
        if cli is None:
            log.info("[SMS mock] %s -> %s", to, message[:80])
            return False
        to_e164 = _to_e164(to)
        if not to_e164:
            log.warning("[SMS] invalid phone: %r", to)
            return False
        sender = (os.environ.get("TWILIO_SMS_FROM") or "").strip()
        if not sender:
            log.warning("[SMS] TWILIO_SMS_FROM is not configured — skipping fallback")
            return False
        try:
            msg = cli.messages.create(from_=sender, to=to_e164, body=message)
            log.info("[SMS] %s sent (sid=%s)", to_e164, msg.sid)
            return True
        except Exception as e:
            log.warning("[SMS] send to %s failed: %s", to_e164, e)
            return False

    def send_whatsapp(self, to: str, message: str, *,
                       template_id: Optional[str] = None,
                       template_params: Optional[dict] = None) -> Optional[str]:
        cli = self._get_client()
        if cli is None:
            log.info("[WA mock] %s -> %s", to, message[:80])
            return None
        to_addr = _to_whatsapp_addr(to)
        if not to_addr:
            log.warning("[WA] invalid phone: %r", to)
            return None
        try:
            if template_id:
                msg = cli.messages.create(
                    from_=self._whatsapp_sender(), to=to_addr,
                    content_sid=template_id,
                    content_variables=json.dumps(template_params or {}),
                )
            else:
                msg = cli.messages.create(from_=self._whatsapp_sender(), to=to_addr, body=message)
            log.info("[WA] %s sent (sid=%s)", to_addr, msg.sid)
            return msg.sid
        except Exception as e:
            log.warning("[WA] send to %s failed: %s", to_addr, e)
            return None

    def _poll_message_status(self, sid: str, budget_sec: float = _POLL_BUDGET_SEC) -> str:
        """Poll Twilio for terminal status. Time-budgeted so the request
        handler doesn't hang. If still `queued`/`sending`/`accepted` at the
        deadline we treat it as "not yet delivered" and signal fallback —
        better to send a duplicate SMS than leave a user stranded."""
        cli = self._get_client()
        if cli is None:
            return "unknown"
        deadline = time.monotonic() + budget_sec
        last = "queued"
        while time.monotonic() < deadline:
            try:
                m = cli.messages(sid).fetch()
                last = (m.status or "").lower()
                if last in _TERMINAL_OK or last in _TERMINAL_FAIL:
                    return last
            except Exception as e:
                log.warning("[OTP-WA] status poll failed (sid=%s): %s", sid, e)
                return "fetch_error"
            time.sleep(_POLL_INTERVAL)
        return last  # likely still `queued` / `sending`

    def send_otp(self, to: str, otp: str) -> str:
        content_sid = (os.environ.get("TWILIO_OTP_CONTENT_SID") or "").strip()
        plain_body = f"Your Lokl verification code is {otp}. Valid for 10 minutes."

        wa_sid = self.send_whatsapp(
            to, plain_body,
            template_id=content_sid or None,
            template_params={"1": str(otp)} if content_sid else None,
        )
        if wa_sid:
            status = self._poll_message_status(wa_sid)
            if status in _TERMINAL_OK:
                log.info("[OTP] delivered via=whatsapp to=%s status=%s", to, status)
                return "whatsapp"
            log.info("[OTP] WA status=%s — falling back to SMS for %s", status, to)

        if self.send_sms(to, plain_body):
            log.info("[OTP] delivered via=sms to=%s", to)
            return "sms"
        log.warning("[OTP] ALL channels failed for %s", to)
        return "none"

    def verify_otp(self, to: str, otp: str) -> bool:
        """No-op passthrough — see module + interface docstrings. Twilio
        never verifies anything itself; server.py's bcrypt-hash check
        against db.customer_otps/db.rider_otps is the real verification and
        is completely unaffected by this migration."""
        return True


# ============================================================================
# Provider factory / selector
# ============================================================================

_provider_instance: Optional[NotificationProvider] = None


def get_provider() -> NotificationProvider:
    """Returns the active NotificationProvider, selected once (cached) via
    NOTIFICATION_PROVIDER (default "twilio"). Only "twilio" exists as of
    this commit; an unrecognized value logs a warning and falls back to
    Twilio rather than breaking every send path."""
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance
    name = (os.environ.get("NOTIFICATION_PROVIDER") or "twilio").strip().lower()
    if name != "twilio":
        log.warning("[notify] NOTIFICATION_PROVIDER=%r is not implemented yet — using twilio", name)
    _provider_instance = TwilioProvider()
    return _provider_instance


# ============================================================================
# Module-level convenience functions — UNCHANGED PUBLIC API (names AND
# signatures). Every notify_* template below, plus six direct call sites in
# server.py, and test_smoke_imports.py's `hasattr(notif, "send_with_fallback")`
# check, all depend on these existing exactly as before. They now delegate
# to get_provider() instead of touching the Twilio SDK directly — that's the
# entire point of this commit.
# ============================================================================

def send_whatsapp(phone: str, body: str) -> bool:
    """Send a free-form WhatsApp message. Returns True on submission success.

    NOTE: this is the "session" path — it works in the Twilio sandbox or, in
    production, only within a 24-hour window after the customer has messaged
    your business."""
    return get_provider().send_whatsapp(phone, body) is not None


def send_sms(phone: str, body: str) -> bool:
    """Send a plain SMS. Returns True on submission success."""
    return get_provider().send_sms(phone, body)


def send_otp_with_fallback(phone: str, otp: str) -> str:
    """Deliver an OTP with WhatsApp -> SMS fallback. Returns "whatsapp",
    "sms", or "none"."""
    return get_provider().send_otp(phone, otp)


def send_with_fallback(phone: str, body: str) -> str:
    """Best-effort delivery for ANY transactional message — WhatsApp first, SMS on failure.

    Unlike `send_otp_with_fallback`, this skips the status poll because
    order-flow notifications can't tolerate that latency in a request
    handler. Any WhatsApp-side rejection (unregistered sender, daily cap,
    recipient not joined to sandbox, …) is treated as "fall back now".
    Successful submission counts as success — terminal delivery status is
    best effort, surfaced via the provider's own dashboard/status webhook.

    Returns `"whatsapp"`, `"sms"`, or `"none"`.
    """
    log.info("[NOTIFY] %s <- %.80s", phone, body.replace("\n", " "))
    provider = get_provider()
    sid = provider.send_whatsapp(phone, body)
    if sid:
        log.info("[NOTIFY] WhatsApp OK sid=%s to=%s", sid, phone)
        return "whatsapp"
    log.warning("[NOTIFY] WhatsApp failed for %s — falling back to SMS", phone)
    if provider.send_sms(phone, body):
        log.info("[NOTIFY] SMS fallback delivered to %s", phone)
        return "sms"
    log.warning("[NOTIFY] all channels failed for %s", phone)
    return "none"


# ============================================================================
# Domain-specific templates — UNCHANGED (still call send_with_fallback /
# send_otp_with_fallback by name; see module docstring for why that's
# sufficient to route every message through the provider abstraction).
# ============================================================================

def notify_customer_otp(customer_phone: str, otp: str) -> None:
    """Send the 6-digit login OTP to the customer.

    Production: tries WhatsApp first → SMS fallback after ~5s. Both channels
    use the exact wording our Meta-approved template expects, so once
    `TWILIO_OTP_CONTENT_SID` is set the WhatsApp leg automatically switches
    to the template path.

    Dev/preview: when `CUSTOMER_OTP_DEBUG=true` we also log the OTP to the
    backend log so testing works without a real phone.
    """
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        # WARNING level on purpose — the production logger config filters INFO
        # in preview/prod, so a debug OTP at INFO would never appear in the
        # supervisor log. We rely on this being readable from
        # /var/log/supervisor/backend.err.log for fork/preview testing.
        log.warning("[OTP-DEBUG] phone=%s otp=%s", customer_phone, otp)
    # Calls the provider directly (rather than the send_otp_with_fallback
    # shim) — this is the highest-traffic, most-watched OTP path, so it's
    # worth making the provider hop explicit here.
    result = get_provider().send_otp(customer_phone, otp)
    if result == "none":
        log.warning("[OTP] customer OTP delivery FAILED for %s (all channels)", customer_phone)


def notify_merchant_otp(merchant_phone: str, otp: str) -> None:
    """iter-29 (Item 1): merchant phone-OTP login. Same Twilio fallback path
    as the customer OTP — WhatsApp first, then SMS. Body intentionally
    identifies this as a *merchant* code so the recipient doesn't mistake
    it for a customer sign-in (e.g. an owner who also shops on Lokl).

    Uses send_with_fallback (the generic path), NOT send_otp — the OTP
    template contract is fixed-wording ("Your Lokl verification code is…"),
    and merchants need unambiguous merchant-themed wording instead."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[MERCHANT-OTP-DEBUG] phone=%s otp=%s", merchant_phone, otp)
    body = (
        f"Lokl merchant login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    send_with_fallback(merchant_phone, body)


def notify_rider_otp(rider_phone: str, otp: str) -> None:
    """Phase 1 rider delivery platform, Commit 2: rider phone-OTP login. Same
    Twilio fallback path as customer/merchant OTP — WhatsApp first, then SMS.
    Body intentionally identifies this as a *rider* code, same reasoning as
    notify_merchant_otp — riders may also be Lokl customers on the same
    phone. Same send_with_fallback rationale as notify_merchant_otp above
    (custom wording, not the fixed OTP template)."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[RIDER-OTP-DEBUG] phone=%s otp=%s", rider_phone, otp)
    body = (
        f"Lokl rider login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    send_with_fallback(rider_phone, body)


def notify_order_placed(phone: str, order_id: str, total: float) -> None:
    short = order_id[-6:].upper()
    body = (
        f"Hi! 🛍️ Your Lokl order #{short} is confirmed.\n\n"
        f"Amount: ₹{total:.0f}\n"
        f"Your store is packing your order — delivery in ~30 minutes.\n\n"
        f"Track here: {APP_URL}/account/orders/{order_id}\n\n"
        f"Questions? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body)


def notify_merchant_new_order(merchant_phone: str, order_id: str, total: float, items_count: int) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🛍️ NEW ORDER #{short}\n\n"
        f"{items_count} item(s) · ₹{total:.0f}\n\n"
        f"Accept quickly to keep your rating high!\n"
        f"👉 {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body)


def notify_order_accepted(phone: str, order_id: str, store_name: str, otp: str = "") -> None:
    """NOTE: unused since the rider-flow redesign (Group A1) removed the
    customer notification on merchant-accept — kept as-is (not deleted,
    unrelated to this commit) in case it's still referenced elsewhere or
    revived later."""
    short = order_id[-6:].upper()
    body = (
        f"✅ Order #{short} accepted by {store_name}!\n\n"
        f"Your rider is on the way. Expected delivery in ~30 minutes.\n\n"
        f"🔑 Delivery OTP: *{otp}*\n"
        f"Share this with your rider when they arrive.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(phone, body)


def notify_order_rejected(phone: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"😔 Order #{short} could not be fulfilled by the store.\n\n"
        f"Since you pay at delivery, no amount was charged.\n\n"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body)


def notify_rider_pickup(rider_phone: str, *, order_id: str, otp: str, customer_name: str,
                        store_name: str, store_address: str, customer_address: str,
                        items_summary: str = "", upi_qr_url: str = "",
                        store_lat: float = 0, store_lng: float = 0,
                        customer_lat: float = 0, customer_lng: float = 0) -> None:
    """Notify the registered rider when a merchant accepts an order."""
    short_id = order_id[-6:].upper()
    pickup_map = f"https://maps.google.com/?q={store_lat},{store_lng}" if store_lat and store_lng else ""
    drop_map = f"https://maps.google.com/?q={customer_lat},{customer_lng}" if customer_lat and customer_lng else ""
    body = f"""🛵 LOKL DELIVERY — #{short_id}

📦 PICKUP
{store_name}
{store_address}
{f"📍 Navigate: {pickup_map}" if pickup_map else ""}

🏠 DROP
{customer_name}
{customer_address}
{f"📍 Navigate: {drop_map}" if drop_map else ""}

🛍️ ITEMS
{items_summary or "(see app)"}

🔑 OTP: {otp}
Ask customer for this OTP on delivery.

{f"💳 UPI QR for payment:{chr(10)}{upi_qr_url}" if upi_qr_url else "💳 Collect payment via UPI/cash"}

✅ TO CONFIRM DELIVERY:
Reply: {otp} Delivered"""
    send_with_fallback(rider_phone, body)


def notify_order_on_the_way(phone: str, order_id: str, otp: str, rider_phone: str = "") -> None:
    """Rider-flow redesign: this is now the customer's FIRST delivery-related
    notification (merchant-accept no longer notifies) — it's where the
    delivery OTP is revealed, plus the assigned rider's phone when known."""
    short = order_id[-6:].upper()
    rider_line = f"🛵 Your rider: {rider_phone}\n" if rider_phone else ""
    body = (
        f"🚴 Your order #{short} is on the way!\n\n"
        f"{rider_line}"
        f"🔑 OTP: *{otp}*\n"
        f"Share this with your rider on arrival to confirm delivery.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(phone, body)


def notify_order_cancelled(phone: str, order_id: str, reason: str = "") -> None:
    short = order_id[-6:].upper()
    body = (
        f"❌ Order #{short} was cancelled.\n"
        f"{f'Reason: {reason}' + chr(10) if reason else ''}\n"
        f"Since you pay at delivery, no amount was charged.\n\n"
        f"Browse other stores: {APP_URL}\n"
        f"Need help? {SUPPORT_PHONE}"
    )
    send_with_fallback(phone, body)


def notify_order_delivered(phone: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🎉 Order #{short} delivered!\n\n"
        f"Hope you love it! Rate your experience:\n"
        f"{APP_URL}/account/orders/{order_id}\n\n"
        f"Shop again: {APP_URL}"
    )
    send_with_fallback(phone, body)


def notify_rider_return_pickup(rider_phone: str, *, return_id: str, order_id: str, otp: str,
                                customer_name: str, pickup_addr: str, items: list[dict],
                                reason: str = "") -> None:
    """Notify the rider for a return pickup (reverse pickup flow)."""
    item_lines = "; ".join(
        f"{it.get('qty', 1)}x {it.get('name', 'Item')}" for it in (items or [])
    ) or "(see app)"
    reason_part = f"Reason: {reason}. " if reason else ""
    body = (
        f"Lokl RETURN pickup — Return {return_id} (order {order_id}) OTP {otp}. "
        f"Pickup from: {customer_name}, {pickup_addr}. "
        f"{reason_part}"
        f"Items: {item_lines}. "
        f"Reply '{otp} - Picked Up' once the customer hands over the items."
    )
    send_with_fallback(rider_phone, body)


def notify_return_status(customer_phone: str, return_id: str, status_label: str) -> None:
    body = (
        f"Lokl: Return {return_id} update — {status_label}. "
        f"Track at {APP_URL}/returns/{return_id}"
    )
    send_with_fallback(customer_phone, body)


def notify_pickup_reserved(customer_phone: str, order_id: str, store_name: str,
                            pickup_code: str, expires_at: str,
                            store_address: str = "", maps_link: str = "") -> None:
    """Notify the customer that their store pickup is reserved with a 4-digit code."""
    short = order_id[-6:].upper()
    try:
        from datetime import datetime, timedelta, timezone
        exp_utc = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        exp_ist = exp_utc + timedelta(minutes=330)
        # Format: 5:30 PM
        h = exp_ist.hour % 12 or 12
        ampm = "AM" if exp_ist.hour < 12 else "PM"
        exp_str = f"{h}:{exp_ist.minute:02d} {ampm}"
        # today vs tomorrow in IST
        now_ist = datetime.now(timezone.utc) + timedelta(minutes=330)
        exp_day = "today" if exp_ist.date() == now_ist.date() else "tomorrow"
    except Exception:
        exp_str = "soon"
        exp_day = "today"
    body = (
        f"Item reserved at {store_name}!\n\n"
        f"Order #{short}\n"
        f"Your code: *{pickup_code}*\n\n"
        f"Show this code at the store counter.\n"
        f"Reserved until {exp_str} {exp_day}.\n\n"
    )
    if store_address:
        body += f"Store: {store_address}\n"
    if maps_link:
        body += f"Directions: {maps_link}\n"
    body += f"\nPay at the store after trying the product.\nTrack: {APP_URL}/account/orders/{order_id}"
    send_with_fallback(customer_phone, body)


def notify_merchant_pickup_reserved(merchant_phone: str, order_id: str,
                                     items_count: int, expires_at_iso: str) -> None:
    """Notify the merchant that a customer has reserved items for store pickup."""
    short = order_id[-6:].upper()
    try:
        from datetime import datetime, timezone
        exp_dt = datetime.fromisoformat(expires_at_iso.replace("Z", "+00:00"))
        exp_str = exp_dt.strftime("%-I:%M %p")
    except Exception:
        exp_str = "4 hours from now"
    body = (
        f"Store pickup reserved — #{short}\n\n"
        f"{items_count} item(s) reserved for in-store pickup.\n"
        f"Customer will arrive by {exp_str}.\n\n"
        f"Verify the 4-digit code the customer shows you.\n"
        f"See orders: {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body)


def notify_pickup_pending(customer_phone: str, order_id: str, store_name: str) -> None:
    """Notify the customer that their pickup request is pending merchant confirmation."""
    short = order_id[-6:].upper()
    body = (
        f"Pickup request received — #{short}\n\n"
        f"Your request to pick up from {store_name} is pending confirmation.\n"
        f"We'll send you the pickup code as soon as the store accepts.\n\n"
        f"Track: {APP_URL}/account/orders/{order_id}"
    )
    send_with_fallback(customer_phone, body)


def notify_merchant_pickup_pending(merchant_phone: str, order_id: str, items_count: int) -> None:
    """Notify the merchant of a new pickup request that requires their acceptance."""
    short = order_id[-6:].upper()
    body = (
        f"New pickup request — #{short}\n\n"
        f"{items_count} item(s) requested for in-store pickup.\n"
        f"Accept or decline at {APP_URL}/merchant/orders"
    )
    send_with_fallback(merchant_phone, body)


def notify_merchant_approved(merchant_phone: str, store_name: str) -> None:
    body = (
        f"Your Lokl store has been approved!\n\n"
        f"Store: {store_name}\n\n"
        f"Next steps:\n"
        f"1. Complete your store profile: {APP_URL}/merchant/storefront\n"
        f"2. Add your products: {APP_URL}/merchant/products\n"
        f"3. Toggle your store live when ready\n\n"
        f"Need help? Email hello@shoplokl.in"
    )
    send_with_fallback(merchant_phone, body)


def notify_merchant_first_order(merchant_phone: str, store_name: str, order_id: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"Your first order on Lokl is here!\n\n"
        f"Order #{short} at {store_name}\n\n"
        f"Accept it quickly at {APP_URL}/merchant/orders\n"
        f"First impressions matter — fast response builds your rating."
    )
    send_with_fallback(merchant_phone, body)
