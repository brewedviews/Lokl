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


def fetch_captured_payment(razorpay_order_id: str, razorpay_payment_id: str) -> Optional[dict]:
    """Fetch the payment directly from Razorpay's API (server-to-server,
    using the secret key) rather than trusting anything client-supplied.

    Security fix (audit finding C-2): the synchronous POST /orders flow
    previously verified only the HMAC signature over
    (razorpay_order_id, razorpay_payment_id) — which proves that pairing
    is genuinely Razorpay-issued, but says nothing about how much was
    actually paid. A client could create a Razorpay order for an
    arbitrary (tampered) low amount, pay it, and present the
    genuinely-signed payment_id/order_id pair against an unrelated,
    full-price Lokl order. This returns the ACTUAL captured amount from
    Razorpay's own record of the payment so the caller can compare it
    against the server-computed order total before ever setting
    payment_status="paid" — the same amount-mismatch check
    `_handle_payment_captured` (the async webhook handler) already
    performs, now also enforced on this synchronous path.

    Returns None if Razorpay isn't configured, the payment isn't found,
    the payment's own order_id doesn't match, or it isn't ACTUALLY
    captured — the caller must treat None as "cannot confirm payment, do
    not mark paid."

    Deliberately requires status == "captured", nothing looser. An
    "authorized" payment (found during a later adversarial review of this
    same fix) means Razorpay has reserved/authorized funds but not yet
    actually moved them — the authorization can still fail to capture or
    expire unclaimed. Accepting "authorized" here would let an order be
    marked paid, and shipped, for money that was never actually
    collected. "failed"/"refunded" are correctly excluded by the same
    check, closing the payment-reuse/replay path those states would
    otherwise open.
    """
    cli = _get_client()
    if cli is None:
        return None
    try:
        payment = cli.payment.fetch(razorpay_payment_id)
    except Exception:
        return None
    if not payment or payment.get("order_id") != razorpay_order_id:
        return None
    if payment.get("status") != "captured":
        return None
    return payment


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
