"""External notification helpers (WhatsApp via Twilio).

All functions are no-ops when the relevant env vars are missing or when the
recipient phone is invalid — they log a warning and return False rather than
raising, so they can be safely called from any route handler without
breaking the primary flow if the 3rd-party is down.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

log = logging.getLogger("lokl.notify")

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


def _to_whatsapp_addr(phone: str) -> Optional[str]:
    """Normalize a phone string to `whatsapp:+91XXXXXXXXXX`. Returns None if invalid."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = f"91{digits}"
    elif digits.startswith("0") and len(digits) == 11:
        digits = f"91{digits[1:]}"
    if not digits.startswith("91") or len(digits) != 12:
        return None
    return f"whatsapp:+{digits}"


def send_whatsapp(phone: str, body: str) -> bool:
    """Send a WhatsApp message via Twilio. Returns True on success.

    Twilio sandbox requires the recipient to first send `join <code>` to the
    sandbox number — for un-joined numbers Twilio returns a 4xx error which we
    log and swallow so the order flow is unaffected.
    """
    cli = _get_twilio()
    if cli is None:
        log.info("[WA mock] %s -> %s", phone, body[:80])
        return False
    to_addr = _to_whatsapp_addr(phone)
    if not to_addr:
        log.warning("[WA] invalid phone: %r", phone)
        return False
    sender = os.environ.get("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    try:
        msg = cli.messages.create(from_=sender, to=to_addr, body=body)
        log.info("[WA] %s sent (sid=%s)", to_addr, msg.sid)
        return True
    except Exception as e:
        log.warning("[WA] send to %s failed: %s", to_addr, e)
        return False


# ===== Domain-specific templates =====

def notify_order_placed(customer_phone: str, order_id: str, total: float, eta_min: int = 45) -> None:
    body = (
        f"🎉 Lokl: Order *{order_id}* confirmed!\n"
        f"Amount: ₹{total:,.0f}\n"
        f"Your store is preparing it. ETA ~{eta_min} mins.\n"
        f"Track: lokl.in/orders/{order_id}"
    )
    send_whatsapp(customer_phone, body)


def notify_merchant_new_order(merchant_phone: str, order_id: str, total: float, items_count: int) -> None:
    body = (
        f"🔔 NEW ORDER on Lokl — *{order_id}*\n"
        f"{items_count} item(s) · ₹{total:,.0f}\n"
        f"Open your dashboard to accept fast!"
    )
    send_whatsapp(merchant_phone, body)


def notify_order_accepted(customer_phone: str, order_id: str, store_name: str, otp: str = "") -> None:
    otp_line = f"Share OTP *{otp}* with the rider on arrival from {store_name}.\n" if otp else ""
    body = (
        f"✅ Lokl: Your order *{order_id}* was accepted by {store_name}.\n"
        f"{otp_line}"
        f"Rider will pick up shortly."
    )
    send_whatsapp(customer_phone, body)


def notify_order_rejected(customer_phone: str, order_id: str) -> None:
    body = (
        f"😔 Lokl: Order *{order_id}* could not be fulfilled this time.\n"
        f"If paid online, refund is auto-initiated (3-5 working days)."
    )
    send_whatsapp(customer_phone, body)


def notify_rider_pickup(rider_phone: str, *, order_id: str, otp: str, customer_name: str,
                        customer_phone: str, pickup: str, drop: str, items: list[dict]) -> None:
    """Notify the registered rider when a merchant accepts an order."""
    item_lines = "\n".join(
        f"  • {it.get('qty', 1)}× {it.get('name', 'Item')}" for it in (items or [])
    ) or "  (see app)"
    body = (
        f"🛵 New pickup on Lokl\n"
        f"Order: *{order_id}*\n"
        f"OTP: *{otp}*\n\n"
        f"Pickup: {pickup}\n"
        f"Drop:   {drop}\n\n"
        f"Customer: {customer_name} · {customer_phone}\n\n"
        f"Items:\n{item_lines}\n\n"
        f"Reply *{otp} - Delivered* once the customer hands the OTP back to you."
    )
    send_whatsapp(rider_phone, body)


def notify_order_on_the_way(customer_phone: str, order_id: str, otp: str) -> None:
    body = (
        f"🛵 Lokl: Order *{order_id}* is on the way!\n"
        f"Share this OTP with the rider on arrival: *{otp}*\n"
        f"Track: lokl.in/orders/{order_id}"
    )
    send_whatsapp(customer_phone, body)


def notify_order_cancelled(customer_phone: str, order_id: str, reason: str) -> None:
    body = (
        f"😔 Lokl: Order *{order_id}* was cancelled.\n"
        f"Reason: {reason}\n"
        f"If paid online, refund is auto-initiated (3-5 working days)."
    )
    send_whatsapp(customer_phone, body)


def notify_order_delivered(customer_phone: str, order_id: str) -> None:
    body = (
        f"📦 Lokl: Order *{order_id}* has been delivered.\n"
        f"Loved it? Rate your store in 1 tap."
    )
    send_whatsapp(customer_phone, body)


def notify_rider_return_pickup(rider_phone: str, *, return_id: str, order_id: str, otp: str,
                                customer_name: str, pickup_addr: str, items: list[dict],
                                reason: str = "") -> None:
    """Notify the rider for a return pickup (reverse pickup flow)."""
    item_lines = "\n".join(
        f"  • {it.get('qty', 1)}× {it.get('name', 'Item')}" for it in (items or [])
    ) or "  (see app)"
    body = (
        f"↩️ RETURN pickup on Lokl\n"
        f"Return: *{return_id}*\n"
        f"For order: {order_id}\n"
        f"OTP: *{otp}*\n\n"
        f"Pickup from: {customer_name}\n"
        f"Address: {pickup_addr}\n"
        + (f"Reason: {reason}\n" if reason else "")
        + f"\nItems to collect:\n{item_lines}\n\n"
        f"Reply *{otp} - Picked Up* once the customer hands over the items."
    )
    send_whatsapp(rider_phone, body)


def notify_return_status(customer_phone: str, return_id: str, status_label: str) -> None:
    body = (
        f"↩️ Lokl: Return *{return_id}* update — {status_label}.\n"
        f"Track at lokl.in/returns/{return_id}"
    )
    send_whatsapp(customer_phone, body)
