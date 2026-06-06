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
    s = (os.environ.get("TWILIO_WHATSAPP_FROM") or "whatsapp:+14155238886").strip()
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
    cli = _get_twilio()
    if cli is None:
        log.info("[NOTIFY mock] %s -> %s", phone, body[:80])
        return "none"
    # 1) Try WhatsApp.
    to_wa = _to_whatsapp_addr(phone)
    if to_wa:
        try:
            msg = cli.messages.create(from_=_whatsapp_sender(), to=to_wa, body=body)
            log.info("[WA] %s sent (sid=%s)", to_wa, msg.sid)
            return "whatsapp"
        except Exception as e:
            log.info("[WA] %s submit failed → SMS fallback: %s", to_wa, e)
    # 2) SMS fallback.
    if send_sms(phone, body):
        return "sms"
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
        log.info("[OTP-DEBUG] phone=%s otp=%s", customer_phone, otp)
    send_otp_with_fallback(customer_phone, otp)


def notify_order_placed(customer_phone: str, order_id: str, total: float, eta_min: int = 45) -> None:
    body = (
        f"Lokl: Order {order_id} confirmed! "
        f"Amount Rs.{total:,.0f}. Store is preparing it (ETA ~{eta_min} min). "
        f"Track: lokl.in/orders/{order_id}"
    )
    send_with_fallback(customer_phone, body)


def notify_merchant_new_order(merchant_phone: str, order_id: str, total: float, items_count: int) -> None:
    body = (
        f"Lokl: NEW ORDER {order_id} — {items_count} item(s) Rs.{total:,.0f}. "
        f"Open your dashboard to accept fast."
    )
    send_with_fallback(merchant_phone, body)


def notify_order_accepted(customer_phone: str, order_id: str, store_name: str, otp: str = "") -> None:
    otp_line = f"Share OTP {otp} with the rider on arrival from {store_name}. " if otp else ""
    body = (
        f"Lokl: Order {order_id} accepted by {store_name}. "
        f"{otp_line}Rider will pick up shortly."
    )
    send_with_fallback(customer_phone, body)


def notify_order_rejected(customer_phone: str, order_id: str) -> None:
    body = (
        f"Lokl: Order {order_id} could not be fulfilled this time. "
        f"If paid online, refund is auto-initiated (3-5 working days)."
    )
    send_with_fallback(customer_phone, body)


def notify_rider_pickup(rider_phone: str, *, order_id: str, otp: str, customer_name: str,
                        customer_phone: str, pickup: str, drop: str, items: list[dict]) -> None:
    """Notify the registered rider when a merchant accepts an order."""
    item_lines = "; ".join(
        f"{it.get('qty', 1)}x {it.get('name', 'Item')}" for it in (items or [])
    ) or "(see app)"
    body = (
        f"Lokl pickup — Order {order_id} OTP {otp}. "
        f"Pickup: {pickup} → Drop: {drop}. "
        f"Customer: {customer_name} ({customer_phone}). "
        f"Items: {item_lines}. "
        f"Reply '{otp} - Delivered' once customer hands the OTP back."
    )
    send_with_fallback(rider_phone, body)


def notify_order_on_the_way(customer_phone: str, order_id: str, otp: str) -> None:
    body = (
        f"Lokl: Order {order_id} is on the way! "
        f"Share OTP {otp} with the rider on arrival. "
        f"Track: lokl.in/orders/{order_id}"
    )
    send_with_fallback(customer_phone, body)


def notify_order_cancelled(customer_phone: str, order_id: str, reason: str) -> None:
    body = (
        f"Lokl: Order {order_id} was cancelled. Reason: {reason}. "
        f"If paid online, refund is auto-initiated (3-5 working days)."
    )
    send_with_fallback(customer_phone, body)


def notify_order_delivered(customer_phone: str, order_id: str) -> None:
    body = (
        f"Lokl: Order {order_id} has been delivered. "
        f"Loved it? Rate your store in 1 tap on lokl.in."
    )
    send_with_fallback(customer_phone, body)


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
        f"Track at lokl.in/returns/{return_id}"
    )
    send_with_fallback(customer_phone, body)
