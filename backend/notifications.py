"""External notification helpers (WhatsApp + SMS via Twilio).

All functions are no-ops when the relevant env vars are missing or when the
recipient phone is invalid — they log a warning and return False rather than
raising, so they can be safely called from any route handler without
breaking the primary flow if the 3rd-party is down.

### OTP delivery contract
`notify_customer_otp()` uses `send_otp_with_fallback()` which:
  1. Tries WhatsApp first. If `TWILIO_OTP_CONTENT_SID` is set we send the
     Meta-approved template (`HX...` with `content_variables={"1": otp}`);
     otherwise we send a plain WhatsApp body (sandbox path).
  2. Polls Twilio for ~5s. If the WA message ends in `failed`/`undelivered`
     OR never reaches `delivered`/`read`/`sent` by the deadline, the same OTP
     is sent again over SMS using `TWILIO_SMS_FROM`.
  3. SMS body is intentionally short — Twilio bills per 160-char segment.

All non-OTP notifications still use `send_whatsapp()` directly (best-effort).
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Optional

log = logging.getLogger("lokl.notify")

APP_URL = os.environ.get("APP_URL", "https://www.shoplokl.in")
SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "+917719052107")
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "hello@shoplokl.in")

# Status values Twilio returns. See https://www.twilio.com/docs/sms/send-messages#monitor-the-status-of-your-message
_TERMINAL_OK = {"delivered", "read", "sent"}
_TERMINAL_FAIL = {"failed", "undelivered"}
_POLL_BUDGET_SEC = 5.0
_POLL_INTERVAL = 0.7

_twilio_client = None  # lazy-init


def _get_twilio():
    global _twilio_client
    if _twilio_client is not None:
        return _twilio_client
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    tok = os.environ.get("TWILIO_AUTH_TOKEN")
    if not sid or not tok:
        return None
    try:
        from twilio.rest import Client
        _twilio_client = Client(sid, tok)
        return _twilio_client
    except Exception as e:  # pragma: no cover
        log.warning("Twilio init failed: %s", e)
        return None


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


def _whatsapp_sender() -> str:
    """Return the configured WhatsApp sender, adding the `whatsapp:` prefix if missing."""
    s = (os.environ.get("TWILIO_WHATSAPP_FROM") or "whatsapp:+14155238886").strip().strip("'\"`")
    return s if s.startswith("whatsapp:") else f"whatsapp:{s}"


def send_whatsapp(phone: str, body: str) -> bool:
    """Send a free-form WhatsApp message via Twilio. Returns True on submission success.

    NOTE: this is the "session" path — it works in the Twilio sandbox or, in
    production, only within a 24-hour window after the customer has messaged
    your business. For un-templated cold sends to a production number, prefer
    `send_whatsapp_template()`.
    """
    cli = _get_twilio()
    if cli is None:
        log.info("[WA mock] %s -> %s", phone, body[:80])
        return False
    to_addr = _to_whatsapp_addr(phone)
    if not to_addr:
        log.warning("[WA] invalid phone: %r", phone)
        return False
    try:
        msg = cli.messages.create(from_=_whatsapp_sender(), to=to_addr, body=body)
        log.info("[WA] %s sent (sid=%s)", to_addr, msg.sid)
        return True
    except Exception as e:
        log.warning("[WA] send to %s failed: %s", to_addr, e)
        return False


def _send_whatsapp_for_otp(phone: str, otp: str) -> Optional[str]:
    """Send the OTP over WhatsApp. Returns the message SID on submission success.

    Prefers the approved Content template when `TWILIO_OTP_CONTENT_SID` is set,
    otherwise falls back to a plain body (works on the sandbox or session window).
    """
    cli = _get_twilio()
    if cli is None:
        return None
    to_addr = _to_whatsapp_addr(phone)
    if not to_addr:
        return None
    content_sid = (os.environ.get("TWILIO_OTP_CONTENT_SID") or "").strip()
    try:
        if content_sid:
            # Production path: pre-approved Meta template referenced by HX... SID.
            import json
            msg = cli.messages.create(
                from_=_whatsapp_sender(),
                to=to_addr,
                content_sid=content_sid,
                content_variables=json.dumps({"1": str(otp)}),
            )
        else:
            # Interim path until template approval lands.
            body = f"Your Lokl verification code is {otp}. Valid for 10 minutes."
            msg = cli.messages.create(from_=_whatsapp_sender(), to=to_addr, body=body)
        log.info("[OTP-WA] %s submitted (sid=%s)", to_addr, msg.sid)
        return msg.sid
    except Exception as e:
        log.warning("[OTP-WA] submit failed for %s: %s", to_addr, e)
        return None


def _poll_message_status(sid: str, budget_sec: float = _POLL_BUDGET_SEC) -> str:
    """Poll Twilio for terminal status. Returns the last observed status.

    Time-budgeted so the request handler doesn't hang. If the message is still
    `queued`/`sending`/`accepted` at the deadline we treat it as "not yet delivered"
    and signal fallback — better to send a duplicate SMS than to leave a user
    stranded waiting for a code that may never arrive.
    """
    cli = _get_twilio()
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


def send_sms(phone: str, body: str) -> bool:
    """Send a plain SMS via Twilio. Returns True on submission success."""
    cli = _get_twilio()
    if cli is None:
        log.info("[SMS mock] %s -> %s", phone, body[:80])
        return False
    to_e164 = _to_e164(phone)
    if not to_e164:
        log.warning("[SMS] invalid phone: %r", phone)
        return False
    sender = (os.environ.get("TWILIO_SMS_FROM") or "").strip()
    if not sender:
        log.warning("[SMS] TWILIO_SMS_FROM is not configured — skipping fallback")
        return False
    try:
        msg = cli.messages.create(from_=sender, to=to_e164, body=body)
        log.info("[SMS] %s sent (sid=%s)", to_e164, msg.sid)
        return True
    except Exception as e:
        log.warning("[SMS] send to %s failed: %s", to_e164, e)
        return False


def send_otp_with_fallback(phone: str, otp: str) -> str:
    """Deliver an OTP with WhatsApp → SMS fallback.

    Returns one of: `"whatsapp"`, `"sms"`, `"none"`. The caller doesn't use this
    value today (delivery is fire-and-forget) but it's useful for tests and
    future analytics.
    """
    # Attempt WhatsApp first.
    wa_sid = _send_whatsapp_for_otp(phone, otp)
    if wa_sid:
        status = _poll_message_status(wa_sid)
        if status in _TERMINAL_OK:
            return "whatsapp"
        log.info("[OTP] WA status=%s — falling back to SMS for %s", status, phone)

    # SMS fallback.
    sms_body = f"Your Lokl verification code is {otp}. Valid for 10 minutes."
    if send_sms(phone, sms_body):
        return "sms"
    log.warning("[OTP] All channels failed for %s", phone)
    return "none"


def send_with_fallback(phone: str, body: str) -> str:
    """Best-effort delivery for ANY transactional message — WhatsApp first, SMS on failure.

    Unlike `send_otp_with_fallback`, this skips the 5-second status poll because
    order-flow notifications can't tolerate that latency in a request handler.
    Instead we treat any Twilio-side rejection (404/400 unregistered sender,
    daily cap exceeded, recipient not joined to sandbox, …) as "fall back now".
    Successful submission counts as success — terminal delivery status is best
    effort and surfaced via Twilio's own dashboard / status webhook (out of scope).

    Returns `"whatsapp"`, `"sms"`, or `"none"`.
    """
    log.info("[NOTIFY] %s <- %.80s", phone, body.replace("\n", " "))
    cli = _get_twilio()
    if cli is None:
        log.info("[NOTIFY mock] no Twilio client — skipping delivery for %s", phone)
        return "none"
    # 1) Try WhatsApp.
    to_wa = _to_whatsapp_addr(phone)
    if to_wa:
        try:
            msg = cli.messages.create(from_=_whatsapp_sender(), to=to_wa, body=body)
            log.info("[NOTIFY] WhatsApp OK sid=%s to=%s", msg.sid, to_wa)
            return "whatsapp"
        except Exception as e:
            log.warning("[NOTIFY] WhatsApp failed for %s (%s) — falling back to SMS", to_wa, e)
    # 2) SMS fallback.
    if send_sms(phone, body):
        log.info("[NOTIFY] SMS fallback delivered to %s", phone)
        return "sms"
    log.warning("[NOTIFY] all channels failed for %s", phone)
    return "none"


# ===== Domain-specific templates =====

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
    send_otp_with_fallback(customer_phone, otp)


def notify_merchant_otp(merchant_phone: str, otp: str) -> None:
    """iter-29 (Item 1): merchant phone-OTP login. Same Twilio fallback path
    as the customer OTP — WhatsApp first, then SMS. Body intentionally
    identifies this as a *merchant* code so the recipient doesn't mistake
    it for a customer sign-in (e.g. an owner who also shops on Lokl)."""
    if os.environ.get("CUSTOMER_OTP_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        log.warning("[MERCHANT-OTP-DEBUG] phone=%s otp=%s", merchant_phone, otp)
    body = (
        f"Lokl merchant login code: {otp}. "
        f"Valid for 10 minutes. Don't share this code with anyone."
    )
    # Try WhatsApp first via the OTP template if configured; otherwise the
    # plain body. send_otp_with_fallback() handles both legs but uses a
    # customer-facing template — for merchants we use the generic
    # send_with_fallback() so the wording is unambiguously merchant-themed.
    send_with_fallback(merchant_phone, body)


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


def notify_order_on_the_way(phone: str, order_id: str, otp: str) -> None:
    short = order_id[-6:].upper()
    body = (
        f"🚴 Your order #{short} is on the way!\n\n"
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
