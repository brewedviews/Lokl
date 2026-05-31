"""Razorpay integration — order creation, refund initiation, signature verifier.

Plays alongside the COD flow on `POST /api/orders`. Customer picks
`payment_method: "razorpay"` and the existing endpoint creates a Razorpay
order, returns the razorpay_order_id, and the webhook flips
`payment_status: paid` on the same Lokl order doc — no new collections, no
FSM rename. Money flow is gated by webhook signature + amount-mismatch check.
"""
import os, hmac, hashlib
from decimal import Decimal
from typing import Optional

_client = None
_warned = False


def _get_client():
    """Lazy-init so import never crashes when keys are blank (dev/test)."""
    global _client, _warned
    if _client is not None:
        return _client
    kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
    if not kid or not secret:
        if not _warned:
            print("[PAYMENT] Razorpay keys not set — online payments disabled")
            _warned = True
        return None
    import razorpay
    _client = razorpay.Client(auth=(kid, secret))
    mode = os.environ.get("RAZORPAY_MODE", "test")
    if mode == "live" and not kid.startswith("rzp_live_"):
        raise SystemExit(
            "[PAYMENT] RAZORPAY_MODE=live but KEY_ID is not rzp_live_*. Refusing to start."
        )
    print(f"[PAYMENT] Razorpay initialized in {mode} mode")
    return _client


def is_enabled() -> bool:
    return _get_client() is not None


def create_razorpay_order(lokl_order_id: str, amount_inr: Decimal,
                          customer_phone: str = "", customer_name: str = "") -> Optional[dict]:
    """Convert INR→paise server-side and create the Razorpay order. Returns the
    raw Razorpay order dict (caller persists `id` on the Lokl order). Raises
    ValueError on min/max bounds, returns None if Razorpay isn't configured."""
    cli = _get_client()
    if cli is None: return None
    paise = int((amount_inr * 100).quantize(Decimal("1")))
    if paise < 100:
        raise ValueError(f"Order amount ₹{amount_inr} is below minimum ₹1")
    if paise > 50_000_000:
        raise ValueError(f"Order amount ₹{amount_inr} exceeds maximum ₹5,00,000")
    return cli.order.create({
        "amount": paise, "currency": "INR",
        "receipt": lokl_order_id[:40],
        "notes": {"lokl_order_id": lokl_order_id, "customer_phone": customer_phone, "source": "lokl_app"},
        "payment_capture": 1,
    })


def refund_payment(razorpay_payment_id: str, amount_inr: Decimal, lokl_order_id: str) -> Optional[dict]:
    cli = _get_client()
    if cli is None: return None
    paise = int((amount_inr * 100).quantize(Decimal("1")))
    return cli.payment.refund(razorpay_payment_id, {
        "amount": paise,
        "notes": {"lokl_order_id": lokl_order_id, "reason": "order_cancelled"},
    })


def verify_webhook_signature(raw_body: bytes, received_sig: str) -> bool:
    """HMAC-SHA256 over the raw request body using RAZORPAY_WEBHOOK_SECRET."""
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    if not secret or not received_sig: return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received_sig)


def verify_payment_signature(razorpay_order_id: str, razorpay_payment_id: str, signature: str) -> bool:
    """Frontend-callback signature (kept for compat with the original
    `/webhooks/payment` JSON-body scaffold and for client-side verifyOrder)."""
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not secret or not signature: return False
    msg = f"{razorpay_order_id}|{razorpay_payment_id}".encode()
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
