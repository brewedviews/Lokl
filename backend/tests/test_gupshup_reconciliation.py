"""Regression tests for the Gupshup template reconciliation + wiring
(2026-09).

Two parts, matching the two things that changed:

PART 1 — pure GupshupProvider payload tests (no DB, no event loop concerns).
Monkeypatches `requests.post` and asserts the EXACT `params` array each
wired notify_* function produces — this is what actually catches "sent a
variable Meta removed" or "wrong param count/order" bugs, since Gupshup
itself will silently accept a wrong-shaped params array and only fail (or
worse, partially render) on the live send.

PART 2 — DB-backed wiring tests, same in-process convention as
test_security_fixes.py / test_autopublish_reconciliation.py (no admin
login required, call FastAPI handler functions directly against the real
DB connection server.py already uses, one asyncio.run() for the whole
file). Covers: admin_reject/admin_hold actually calling the new WhatsApp
notify functions (in addition to, not instead of, the existing in-app
push), the payment_failed webhook's duplicate-protection guard, and an
empirical (not just static-read) confirmation that
_handle_payment_captured's existing idempotency check already prevents a
second notify_merchant_new_order for an order that's already paid.

Run with: cd backend && python3 -m pytest tests/test_gupshup_reconciliation.py -v
Requires a reachable MONGO_URL (same one server.py itself uses) for Part 2.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifications as notif


# ============================================================================
# PART 1 — GupshupProvider payload shape (no DB)
# ============================================================================

def _mock_post(captured: list):
    """A requests.post stand-in that records the decoded `template` field
    and returns a well-formed 202/success response so send_whatsapp()'s
    own status check passes."""
    class _Resp:
        status_code = 202
        content = b"1"
        def json(self):
            return {"status": "success", "messageId": "test-msg-id"}

    def _post(url, data=None, headers=None, timeout=None):
        captured.append(json.loads(data["template"]))
        return _Resp()

    return _post


def _gupshup_env(**extra):
    base = {
        "GUPSHUP_API_KEY": "test-key",
        "GUPSHUP_WHATSAPP_NUMBER": "919999999999",
        "GUPSHUP_APP_NAME": "LoklTest",
    }
    base.update(extra)
    return base


def test_merchant_otp_shares_customer_otp_template():
    """2026-09 reconciliation: no separate merchant OTP template exists —
    merchant_login_otp must resolve through the SAME env var as
    customer_otp, not a second GUPSHUP_TEMPLATE_MERCHANT_LOGIN_OTP."""
    env = notif.GupshupProvider._TEMPLATE_ENV
    assert env["merchant_login_otp"] == env["customer_otp"] == "GUPSHUP_TEMPLATE_CUSTOMER_OTP"
    assert env["rider_login_otp"] == "GUPSHUP_TEMPLATE_RIDER_LOGIN_OTP", "rider OTP must stay on its own separate template"
    assert env["rider_login_otp"] != env["customer_otp"]
    # No stale second env var anywhere in the mapping's values.
    assert "GUPSHUP_TEMPLATE_MERCHANT_LOGIN_OTP" not in env.values()


@pytest.mark.parametrize("message_type", ["customer_otp", "merchant_login_otp", "rider_login_otp"])
def test_otp_params_are_duplicated_exactly_twice(message_type):
    """FACT preserved from before this change: regardless of how many
    values are in template_params, exactly the first is used, sent TWICE
    (body + button component)."""
    captured = []
    provider = notif.GupshupProvider()
    with patch.dict(os.environ, _gupshup_env(), clear=False), \
         patch("requests.post", side_effect=_mock_post(captured)):
        msg_id = provider.send_whatsapp(
            "9876543210", "ignored for template sends",
            template_id="tpl-otp-123",
            template_params={"1": "482913", "2": "should be ignored"},
            message_type=message_type,
        )
    assert msg_id == "test-msg-id"
    assert len(captured) == 1
    assert captured[0]["params"] == ["482913", "482913"], "OTP must be duplicated into exactly 2 slots, extra values ignored"


def _send_via_gupshup(template_id, template_params, message_type):
    captured = []
    provider = notif.GupshupProvider()
    with patch.dict(os.environ, _gupshup_env(), clear=False), \
         patch("requests.post", side_effect=_mock_post(captured)):
        provider.send_whatsapp("9876543210", "ignored", template_id=template_id,
                                template_params=template_params, message_type=message_type)
    return captured[0]["params"]


def test_utility_template_params_are_not_duplicated():
    """A non-OTP message_type must NOT get the OTP's duplicate-first-value
    treatment — each template_params value is its own params slot."""
    params = _send_via_gupshup("tpl-x", {"1": "AAA", "2": "BBB", "3": "CCC"}, "merchant_new_order")
    assert params == ["AAA", "BBB", "CCC"]


# ============================================================================
# PART 1b — Gupshup 202/submitted response-handling fix (2026-09).
#
# Production log evidence (see the urgent-fix audit) showed real Gupshup
# template sends returning HTTP 202 {"status": "submitted", "messageId":
# "..."} — exactly what Gupshup's own docs document as the normal,
# successful, asynchronous-submission response — while the code's own
# `status == "success"` check rejected it as a failure. These tests pin
# the corrected contract directly against GupshupProvider.send_whatsapp(),
# independent of the higher-level template-payload tests above.
# ============================================================================

def _mock_resp(status_code, json_body):
    class _Resp:
        def __init__(self):
            self.status_code = status_code
            self.content = b"1" if json_body is not None else b""
        def json(self):
            return json_body or {}
    return _Resp()


def _send_with_mock_response(status_code, json_body, *, template_params=None):
    def _post(url, data=None, headers=None, timeout=None):
        return _mock_resp(status_code, json_body)
    provider = notif.GupshupProvider()
    with patch.dict(os.environ, _gupshup_env(), clear=False), \
         patch("requests.post", side_effect=_post):
        result = provider.send_whatsapp(
            "9876543210", "ignored", template_id="tpl-x",
            template_params=template_params or {"1": "AAA"}, message_type="merchant_new_order",
        )
    return result, provider.last_result


@pytest.mark.parametrize("status_code", [202, 200])
def test_2xx_submitted_with_message_id_is_success(status_code):
    """A. / B. — HTTP 202 or 200 + status=submitted + messageId -> SUCCESS."""
    result, last = _send_with_mock_response(status_code, {"status": "submitted", "messageId": "abc"})
    assert result == "abc"
    assert last["ok"] is True
    assert last["message_id"] == "abc"
    assert last["delivery_status"] == "submitted", \
        "must be recorded as SUBMITTED, never claimed as delivered"


@pytest.mark.parametrize("status_code,body", [
    (400, {"status": "error", "message": "bad request"}),
    (401, {"status": "error", "message": "unauthorized"}),
    (429, {"status": "error", "message": "rate limited"}),
    (500, {"status": "error", "message": "internal error"}),
    (503, {"status": "error", "message": "unavailable"}),
])
def test_http_error_status_codes_are_failures(status_code, body):
    """C./D./E./F. — HTTP 400/401/429/5xx -> FAILURE regardless of body."""
    result, last = _send_with_mock_response(status_code, body)
    assert result is None
    assert last["ok"] is False
    assert last["status_code"] == status_code


def test_2xx_with_explicit_error_status_is_failure():
    """G. — HTTP 2xx but the body explicitly says status=error -> FAILURE.
    Confirms the check is a positive allow-list (only "submitted"/"success"
    pass), not merely "any 2xx passes"."""
    result, last = _send_with_mock_response(200, {"status": "error", "message": "template not approved"})
    assert result is None
    assert last["ok"] is False


def test_submitted_without_message_id_is_not_blindly_successful():
    """H. — 202/submitted but no messageId -> FAILURE. Without a messageId
    there is nothing to reference this send by later, and an unexpectedly-
    shaped response is treated as suspect rather than trusted."""
    result, last = _send_with_mock_response(202, {"status": "submitted"})
    assert result is None, "must NOT be treated as a successful submission without a messageId"
    assert last["ok"] is False


def test_missing_template_id_is_still_a_local_failure():
    """I. — unchanged pre-existing behavior: no template_id -> local
    failure, no HTTP call attempted at all."""
    provider = notif.GupshupProvider()
    with patch.dict(os.environ, _gupshup_env(), clear=False), \
         patch("requests.post") as mock_post:
        result = provider.send_whatsapp("9876543210", "ignored", template_id=None,
                                         template_params={"1": "AAA"}, message_type="merchant_new_order")
    assert result is None
    assert provider.last_result["ok"] is False
    mock_post.assert_not_called()


def test_submitted_success_does_not_trigger_sms_fallback():
    """J. — a successful 202/submitted WhatsApp send must NOT fall through
    to provider.send_sms(), even with NOTIFICATION_SMS_FALLBACK_ENABLED on.
    That flag is a module-level constant computed once at import time
    (see notifications.py) — patch.dict(os.environ) alone can't affect
    it, so it's monkeypatched directly, same technique used for
    server.STORE_PICKUP_ENABLED elsewhere in this test suite."""
    def _post(url, data=None, headers=None, timeout=None):
        return _mock_resp(202, {"status": "submitted", "messageId": "xyz"})

    sms_calls = []
    orig_send_sms = notif.GupshupProvider.send_sms
    def spy_send_sms(self, *a, **kw):
        sms_calls.append((a, kw))
        return orig_send_sms(self, *a, **kw)

    env = _gupshup_env(NOTIFICATION_PROVIDER="gupshup",
                        GUPSHUP_TEMPLATE_MERCHANT_NEW_ORDER="tpl-x")
    notif._provider_instances.clear()
    orig_fallback_flag = notif.NOTIFICATION_SMS_FALLBACK_ENABLED
    notif.NOTIFICATION_SMS_FALLBACK_ENABLED = True
    notif.GupshupProvider.send_sms = spy_send_sms
    try:
        with patch.dict(os.environ, env, clear=False), patch("requests.post", side_effect=_post):
            outcome = notif.notify_merchant_new_order("9876543210", "o-test-order123", 500.0, 2)
    finally:
        notif.GupshupProvider.send_sms = orig_send_sms
        notif.NOTIFICATION_SMS_FALLBACK_ENABLED = orig_fallback_flag
        notif._provider_instances.clear()
    assert not sms_calls, "SMS fallback must never be attempted after a successful WhatsApp submission"


def test_submitted_success_produces_no_whatsapp_failed_log(caplog):
    """K. — a successful 202/submitted response must not produce a
    '[NOTIFY] ... whatsapp failed' log line."""
    import logging
    def _post(url, data=None, headers=None, timeout=None):
        return _mock_resp(202, {"status": "submitted", "messageId": "xyz"})

    env = _gupshup_env(NOTIFICATION_PROVIDER="gupshup", GUPSHUP_TEMPLATE_MERCHANT_NEW_ORDER="tpl-x")
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, env, clear=False), patch("requests.post", side_effect=_post), \
             caplog.at_level(logging.WARNING, logger="lokl.notify"):
            notif.notify_merchant_new_order("9876543210", "o-test-order123", 500.0, 2)
    finally:
        notif._provider_instances.clear()
    failed_logs = [r.message for r in caplog.records if "whatsapp failed" in r.message]
    assert not failed_logs, f"unexpected failure log(s) after a successful submission: {failed_logs}"


def _capture_send_with_fallback(fn, *args, **kwargs):
    """Runs a notify_* function with NOTIFICATION_PROVIDER=gupshup and a
    template configured for every message_type this test file cares
    about, capturing exactly what GupshupProvider.send_whatsapp() would
    send Gupshup. Returns the decoded `params` list, or None if no
    Gupshup send was attempted (e.g. template not configured)."""
    captured = []
    template_env_vars = {
        "GUPSHUP_TEMPLATE_ORDER_PLACED": "tpl-order-placed",
        "GUPSHUP_TEMPLATE_ORDER_ON_THE_WAY": "tpl-on-the-way",
        "GUPSHUP_TEMPLATE_ORDER_CANCELLED": "tpl-cancelled",
        "GUPSHUP_TEMPLATE_MERCHANT_ORDER_CANCELLED": "tpl-merchant-cancelled",
        "GUPSHUP_TEMPLATE_RIDER_PICKUP": "tpl-rider-pickup",
        "GUPSHUP_TEMPLATE_RIDER_RETURN_PICKUP": "tpl-rider-return-pickup",
        "GUPSHUP_TEMPLATE_ORDER_REJECTED": "tpl-rejected",
        "GUPSHUP_TEMPLATE_ORDER_DELIVERED": "tpl-delivered",
        "GUPSHUP_TEMPLATE_MERCHANT_NEW_ORDER": "tpl-new-order",
        "GUPSHUP_TEMPLATE_MERCHANT_APPROVED": "tpl-approved",
        "GUPSHUP_TEMPLATE_CUSTOMER_RETURN_STATUS": "tpl-return-status",
        "GUPSHUP_TEMPLATE_PAYMENT_FAILED": "tpl-payment-failed",
        "GUPSHUP_TEMPLATE_MERCHANT_KYC_REJECTED": "tpl-kyc-rejected",
        "GUPSHUP_TEMPLATE_MERCHANT_KYC_ON_HOLD": "tpl-kyc-on-hold",
    }
    env = _gupshup_env(NOTIFICATION_PROVIDER="gupshup", **template_env_vars)
    # get_provider() caches instances by name — clear so this test's env
    # patch is actually picked up rather than a provider built earlier
    # (e.g. by a different NOTIFICATION_PROVIDER) in the same process.
    notif._provider_instances.clear()
    with patch.dict(os.environ, env, clear=False), \
         patch("requests.post", side_effect=_mock_post(captured)):
        fn(*args, **kwargs)
    notif._provider_instances.clear()
    return captured[0]["params"] if captured else None


def test_order_rejected_drops_browse_url_keeps_refund_branch():
    params_refund = _capture_send_with_fallback(notif.notify_order_rejected, "9876543210", "order-abc123", refund_initiated=True)
    assert params_refund is not None, "order_rejected must be wired to Gupshup"
    assert len(params_refund) == 2, "browse-other-stores URL must not be sent — only order id + refund-status text"
    assert params_refund[0] == "ABC123"
    assert "refund" in params_refund[1].lower()
    assert notif.APP_URL not in params_refund[1] and notif.APP_URL not in params_refund[0]

    params_cod = _capture_send_with_fallback(notif.notify_order_rejected, "9876543210", "order-abc123", refund_initiated=False)
    assert "charged" in params_cod[1].lower() and "refund" not in params_cod[1].lower()


def test_order_delivered_drops_url_sends_only_order_id():
    params = _capture_send_with_fallback(notif.notify_order_delivered, "9876543210", "order-xyz999")
    assert params == ["XYZ999"]
    assert notif.APP_URL not in "".join(params)


def test_merchant_new_order_sends_only_id_count_total_no_url():
    params = _capture_send_with_fallback(notif.notify_merchant_new_order, "9876543210", "order-def456", 1249.0, 3)
    assert params == ["DEF456", "3", "1249"]
    assert notif.APP_URL not in "".join(params)


def test_merchant_approved_sends_only_store_name():
    params = _capture_send_with_fallback(notif.notify_merchant_approved, "9876543210", "Sahoo Collection")
    assert params == ["Sahoo Collection"]


def test_customer_return_status_uses_canonical_message_type():
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        _capture_send_with_fallback(notif.notify_return_status, "9876543210", "RET-8291", "o-lokltest-orderUYDDB9", "arriving")
    finally:
        notif.send_with_fallback = orig
    assert calls == ["customer_return_status"], "message_type must be renamed to match the Gupshup template's own name"


# {{1}} = the ORDER's short id (NOT the return id) — confirmed live from
# the Gupshup editor: "the ID displayed after 'Lokl order #'". return_id
# ("RET-8291") and order_id are deliberately different fixture values
# here specifically so a regression that swaps them fails loudly instead
# of accidentally matching. {{2}} = current status, {{3}} =
# status-specific message — see notify_return_status's own
# _RETURN_STATUS_COPY docstring for where that text comes from.
_EXPECTED_RETURN_PARAMS = {
    "pickup_assigned": ["UYDDB9", "pickup partner assigned", "A pickup partner has been assigned to collect your item(s)."],
    "arriving": ["UYDDB9", "pickup partner arriving", "Your pickup partner is arriving to collect the item(s)."],
    "picked_up": ["UYDDB9", "product picked up", "Your item(s) have been picked up."],
    "completed": ["UYDDB9", "return completed", "Your return has been completed."],
}


@pytest.mark.parametrize("status,expected", _EXPECTED_RETURN_PARAMS.items())
def test_customer_return_status_sends_order_short_id_not_return_id(status, expected):
    params = _capture_send_with_fallback(notif.notify_return_status, "9876543210", "RET-8291", "o-lokltest-orderUYDDB9", status)
    assert params == expected
    assert params[0] == "UYDDB9", "{{1}} must be the order's short id, not the return id (RET-8291)"
    assert "RET-8291" not in params, "the return id must never leak into a Gupshup template variable"
    assert notif.APP_URL not in "".join(params), "no tracking URL/CTA — the approved template already ends with its own static 'Thank you.'"


def test_return_requested_is_not_in_the_notify_gate():
    """'requested' is the return's creation state — create_return() never
    calls notify_return_status() for it, so it must not be treated as a
    notifiable status here either."""
    assert "requested" not in notif.RETURN_STATUS_NOTIFY_TYPES
    assert set(notif.RETURN_STATUS_NOTIFY_TYPES) == {"pickup_assigned", "arriving", "picked_up", "completed"}


def test_payment_failed_sends_only_order_id():
    params = _capture_send_with_fallback(notif.notify_payment_failed, "9876543210", "order-ghi789")
    assert params == ["GHI789"]


def test_merchant_kyc_rejected_sends_only_variable_1_store_name():
    params = _capture_send_with_fallback(notif.notify_merchant_kyc_rejected, "9876543210", "Sahoo Collection")
    assert params == ["Sahoo Collection"], "approved template has ONLY Variable 1 — must not send reason/URL/support phone"


def test_merchant_kyc_on_hold_sends_store_name_and_comment():
    params = _capture_send_with_fallback(notif.notify_merchant_kyc_on_hold, "9876543210", "Sahoo Collection", "PAN doc unclear")
    assert params == ["Sahoo Collection", "PAN doc unclear"]


def test_order_placed_sends_exactly_4_params_in_approved_order():
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    4 variables, ALL genuine (none dropped by Meta) — short order id,
    total, tracking URL, support phone, in that exact order."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_order_placed, "9876543210", "o-lokltest-orderHY93HK", 2499.0,
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["order_placed"], "message_type must be exactly 'order_placed'"
    assert len(params) == 4, "must be exactly 4 Gupshup template parameters"
    assert params[0] == "HY93HK", "{{1}} must be the short order id"
    assert params[1] == "2499", "{{2}} must be the order total (no currency symbol — the template's own static copy has it)"
    assert params[2] == f"{notif.APP_URL}/account/orders/o-lokltest-orderHY93HK", "{{3}} must be the real tracking URL"
    assert params[3] == notif.SUPPORT_PHONE, "{{4}} must be the support phone"
    assert params == ["HY93HK", "2499", f"{notif.APP_URL}/account/orders/o-lokltest-orderHY93HK", notif.SUPPORT_PHONE], \
        "parameters must be in the exact approved order: id, total, URL, phone"


def test_order_placed_has_exactly_one_call_site():
    """No duplicate order_placed notification path exists anywhere in the
    application backend (excludes this tests/ directory)."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "notify_order_placed(", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = [l for l in out.splitlines() if "def notify_order_placed" not in l]
    assert len(call_lines) == 1, f"expected exactly one call site, found {len(call_lines)}: {call_lines}"
    assert "server.py" in call_lines[0]
    # The one call site sits in the mutually-exclusive `else` branch of
    # `if order_type == "pickup":` (pickup orders get notify_pickup_pending
    # instead) — so a single order creation can never trigger both, and
    # never trigger notify_order_placed twice.
    assert "notify_order_placed(cust_phone, order_id, float(server_total))" in call_lines[0]


_ORDER_CANCELLED_REFUND_TEXT = "Since you pay at delivery, no amount was charged."


@pytest.mark.parametrize("reason", ["", "Out of stock", "Merchant unable to fulfil"])
def test_order_cancelled_sends_exactly_3_params_in_approved_order(reason):
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    3 variables — short order id, the existing (fixed) refund-status
    text, support phone. `reason` varies but must NEVER leak into a
    Gupshup parameter — the approved template has no slot for it."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_order_cancelled, "9876543210", "o-lokltest-orderZQ71PM", reason,
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["order_cancelled"], "message_type must be exactly 'order_cancelled'"
    assert len(params) == 3, "must be exactly 3 Gupshup template parameters"
    assert params == ["ZQ71PM", _ORDER_CANCELLED_REFUND_TEXT, notif.SUPPORT_PHONE], \
        "parameters must be in the exact approved order: id, refund-status text, support phone"
    if reason:
        assert reason not in params, "reason must never leak into a Gupshup parameter — no slot for it in the approved template"
    assert not any(notif.APP_URL in p for p in params), "no tracking URL/browse CTA — not variables in the approved template"


def test_order_cancelled_has_exactly_two_call_sites_neither_paid_aware():
    """Two legitimate, mutually-exclusive triggers — merchant cancelling
    their own accepted slice, and admin cancelling — not a duplicate-send
    risk (same pattern as the D3 finding in the original reconciliation
    audit: shared message, distinct actors). Also confirms NEITHER call
    site computes a real refund_initiated flag today, which is exactly
    why {{2}} is a fixed string rather than a branch."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "notify_order_cancelled(", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = [l for l in out.splitlines() if "notify_order_cancelled(cust_phone, oid, reason)" in l]
    assert len(call_lines) == 2, f"expected exactly two call sites, found {len(call_lines)}: {call_lines}"
    assert all("server.py" in l for l in call_lines)

    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    merchant_fn_start = src.index("async def merchant_cancel_order")
    admin_fn_start = src.index("async def admin_cancel_order")
    admin_fn_end = src.index("\n@api.", admin_fn_start)
    merchant_fn = src[merchant_fn_start:admin_fn_start]
    admin_fn = src[admin_fn_start:admin_fn_end]
    for fn_src, name in [(merchant_fn, "merchant_cancel_order"), (admin_fn, "admin_cancel_order")]:
        assert "refund_payment(" not in fn_src, \
            f"{name} does not currently call refund_payment() — if this ever changes, " \
            "notify_order_cancelled()'s fixed refund_status_text must be revisited"


@pytest.mark.parametrize("already_accepted", [True, False])
def test_merchant_order_cancelled_sends_exactly_one_param_short_id(already_accepted):
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    ONE variable, the order's short id — regardless of whether the
    merchant had already accepted their slice (that only changes the
    freeform body's wording, never the Gupshup template send)."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_merchant_order_cancelled, "9876543210",
            "9f1c2b3a-4d5e-6f70-8192-a3b4c5d6UYKQ71", already_accepted,
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["merchant_order_cancelled"], "message_type must be exactly 'merchant_order_cancelled'"
    assert len(params) == 1, "must be exactly one Gupshup template parameter"
    assert params == ["UYKQ71"], "{{1}} must be the short order id, not the full UUID"
    assert "9f1c2b3a-4d5e-6f70-8192-a3b4c5d6UYKQ71" not in params, "the full order UUID must never reach a Gupshup parameter"


def test_merchant_order_cancelled_excludes_reason_and_customer_details():
    """The approved template has no slot for any of these — confirms none
    of them can leak in even though the function receives a real
    merchant_phone and could theoretically be extended carelessly."""
    params = _capture_send_with_fallback(
        notif.notify_merchant_order_cancelled, "9876543210", "o-lokltest-orderUYKQ71", True,
    )
    assert len(params) == 1
    forbidden = ["9876543210", "Out of stock", "cancellation reason", "customer", notif.APP_URL]
    joined = " ".join(params)
    for value in forbidden:
        assert value not in joined, f"{value!r} must never appear in a merchant_order_cancelled Gupshup parameter"


def test_merchant_order_cancelled_recipient_and_trigger_preserved():
    """Static check: both call sites still notify the MERCHANT (not the
    customer), are still triggered only from customer_cancel_order(), and
    use notify_merchant_order_cancelled() — not a second/legacy path."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()

    call_lines = [l for l in src.splitlines() if "notify_merchant_order_cancelled(" in l and "def " not in l]
    assert len(call_lines) == 2, f"expected exactly 2 call sites, found {len(call_lines)}: {call_lines}"
    assert all('merch["phone"]' in l and ", oid, already_accepted=" in l for l in call_lines), \
        "both call sites must notify merch['phone'] (the merchant), keyed by oid"

    # Both sites must live inside customer_cancel_order — the only trigger.
    fn_start = src.index("async def customer_cancel_order")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    assert fn_src.count("notify_merchant_order_cancelled(") == 2, \
        "both call sites must be inside customer_cancel_order() — no other trigger exists"


def test_no_legacy_merchant_order_cancelled_paths_remain():
    """Static search confirming the old ad-hoc strings/message_type are
    fully gone from application code — no duplicate/legacy path left."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    this_test_file = os.path.abspath(__file__)
    out = subprocess.run(
        ["grep", "-rn", "merchant_order_cancelled_by_customer", backend_dir,
         "--include=*.py", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    # Excludes this test file itself (necessarily contains the search
    # string as a literal, to run this very assertion). A short prose
    # mention in a docstring (explaining what the old name WAS) is fine;
    # what must be gone is the string used as an actual message_type=
    # value passed to a real call, or an env var key still expecting it.
    live_refs = [
        l for l in out.splitlines()
        if this_test_file not in l
        and ('message_type="merchant_order_cancelled_by_customer"' in l
             or "MSG91_SMS_TEMPLATE_MERCHANT_ORDER_CANCELLED_BY_CUSTOMER" in l)
    ]
    assert not live_refs, f"legacy merchant_order_cancelled_by_customer references still live: {live_refs}"

    out2 = subprocess.run(
        ["grep", "-rn", "send_with_fallback(merch\\[.phone.\\], f\"Order {oid}", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    assert not out2.strip(), f"an old inline merchant-cancellation string still exists: {out2}"

    assert "merchant_order_cancelled" in notif.GupshupProvider._TEMPLATE_ENV
    assert notif.GupshupProvider._TEMPLATE_ENV["merchant_order_cancelled"] == "GUPSHUP_TEMPLATE_MERCHANT_ORDER_CANCELLED"


_RIDER_PICKUP_KWARGS = dict(
    order_id="o-lokltest-orderQZ81MN",
    otp="4821",
    customer_name="Priya Sharma",
    store_name="Sahoo Collection",
    store_address="Shop 12, Sector 10 Market, Bhilai",
    customer_address="H.No. 45, Nehru Nagar, Bhilai, 490020",
    items_summary="  • 2x Cotton Kurta (M)\n  • 1x Denim Jacket (L)",
    upi_qr_url="https://upi.example/qr/abc",
    store_lat=21.19, store_lng=81.33,
    customer_lat=21.21, customer_lng=81.35,
)
_RIDER_PICKUP_EXPECTED = [
    "QZ81MN", "Sahoo Collection", "Shop 12, Sector 10 Market, Bhilai",
    "Priya Sharma", "H.No. 45, Nehru Nagar, Bhilai, 490020",
    "  • 2x Cotton Kurta (M)\n  • 1x Denim Jacket (L)",
    "https://maps.google.com/?q=21.19,81.33",
    "https://maps.google.com/?q=21.21,81.35",
]


def test_rider_pickup_sends_exactly_8_params_in_approved_order():
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    8 variables, in order — order id, store name/address, customer
    name/address, items, store map URL, customer map URL."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_rider_pickup, "9800000000", **_RIDER_PICKUP_KWARGS,
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["rider_pickup"], "message_type must be exactly 'rider_pickup'"
    assert len(params) == 8, "must be exactly 8 Gupshup template parameters"
    assert params == _RIDER_PICKUP_EXPECTED, "parameters must be in the exact approved order"
    assert params[0] == "QZ81MN", "{{1}} must be the short order id"
    assert params[1] == "Sahoo Collection", "{{2}} must be the store name"
    assert params[2] == "Shop 12, Sector 10 Market, Bhilai", "{{3}} must be the store address"
    assert params[3] == "Priya Sharma", "{{4}} must be the customer name"
    assert params[4] == "H.No. 45, Nehru Nagar, Bhilai, 490020", "{{5}} must be the customer address"
    assert params[5] == "  • 2x Cotton Kurta (M)\n  • 1x Denim Jacket (L)", "{{6}} must be the items"
    assert params[6] == "https://maps.google.com/?q=21.19,81.33", "{{7}} must be the store map URL"
    assert params[7] == "https://maps.google.com/?q=21.21,81.35", "{{8}} must be the customer map URL"


def test_rider_pickup_excludes_otp_rider_phone_and_customer_phone():
    kwargs = dict(_RIDER_PICKUP_KWARGS)
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **kwargs)
    joined = " ".join(params)
    assert kwargs["otp"] not in joined, "delivery OTP must never reach a Gupshup parameter"
    assert "9800000000" not in joined, "rider phone (the recipient number itself) must never appear as a parameter value"
    assert not any(notif.APP_URL in p for p in params), "no tracking URL — not a variable in the approved template"


def test_rider_pickup_items_fallback_when_empty():
    """The existing '(see app)' fallback (already used in the freeform
    body) is reused for {{6}} when no items_summary is available — not a
    new fallback invented for Gupshup."""
    kwargs = dict(_RIDER_PICKUP_KWARGS)
    kwargs["items_summary"] = ""
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **kwargs)
    assert params[5] == "(see app)"


def test_rider_pickup_map_url_falls_back_to_address_search_when_lat_lng_missing():
    """2026-09 fix: an empty {{8}} silently killed the whole WhatsApp send
    (WhatsApp rejects empty template variables, with no error surfaced
    back to Lokl — see notify_rider_pickup's own docstring, evidenced by
    real production order LOKL-FC0F5E82). When lat/lng are unavailable
    (0, as they typically are for customer delivery addresses today), the
    corresponding map param must fall back to a Google Maps address-
    search link built from the REAL address text — never an empty
    string, never fabricated coordinates, never 0,0."""
    kwargs = dict(_RIDER_PICKUP_KWARGS)
    kwargs["customer_lat"] = 0
    kwargs["customer_lng"] = 0
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **kwargs)
    assert params[7] == "https://maps.google.com/?q=H.No.%2045%2C%20Nehru%20Nagar%2C%20Bhilai%2C%20490020"
    assert params[7] != "", "customer map URL must never be an empty template parameter"
    assert "21." not in params[7] and "81." not in params[7], "must not fabricate coordinates"
    assert params[6] == "https://maps.google.com/?q=21.19,81.33", "store map URL is unaffected when store lat/lng ARE available"


def test_rider_pickup_map_url_falls_back_to_app_url_when_address_also_missing():
    """Absolute last resort: if lat/lng AND the address text are both
    unavailable (a pathological case — real orders always have at least
    a city in the address), the map param must still never be empty."""
    kwargs = dict(_RIDER_PICKUP_KWARGS)
    kwargs["customer_lat"] = 0
    kwargs["customer_lng"] = 0
    kwargs["customer_address"] = ""
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **kwargs)
    assert params[7] == notif.APP_URL
    assert params[7] != ""


def test_rider_pickup_map_urls_unchanged_when_lat_lng_available():
    """Existing, working behavior (real coordinates available) must be
    completely unaffected by the fallback fix."""
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **_RIDER_PICKUP_KWARGS)
    assert params[6] == "https://maps.google.com/?q=21.19,81.33"
    assert params[7] == "https://maps.google.com/?q=21.21,81.35"


def test_rider_pickup_store_map_also_falls_back_when_store_lat_lng_missing():
    """The identical empty-parameter failure mode applies to {{7}}
    (store/pickup map) just as much as {{8}} — a store missing lat/lng
    would kill the send the same way. Same fix, same guarantee."""
    kwargs = dict(_RIDER_PICKUP_KWARGS)
    kwargs["store_lat"] = 0
    kwargs["store_lng"] = 0
    params = _capture_send_with_fallback(notif.notify_rider_pickup, "9800000000", **kwargs)
    assert params[6] == "https://maps.google.com/?q=Shop%2012%2C%20Sector%2010%20Market%2C%20Bhilai"
    assert params[6] != ""


def test_rider_pickup_recipient_and_trigger_preserved():
    """Static check: the one call site still passes the shared RIDER_PHONE
    ops number (not an individually-assigned rider), and still lives
    inside merchant_accept_order() — no new trigger, no rider-assignment
    logic changed."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    assert 'rider_phone = os.environ.get("RIDER_PHONE", "").strip()' in src, \
        "recipient must still be the shared RIDER_PHONE ops number"
    fn_start = src.index("async def merchant_accept_order")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    assert fn_src.count("notify_rider_pickup(") == 1, \
        "notify_rider_pickup must be called exactly once, only inside merchant_accept_order()"


def test_rider_pickup_has_exactly_one_call_site_no_duplicate_path():
    """No second Gupshup call path for this message exists anywhere in
    the application backend."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "notify_rider_pickup(", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = [l for l in out.splitlines() if "def notify_rider_pickup" not in l]
    assert len(call_lines) == 1, f"expected exactly one call site, found {len(call_lines)}: {call_lines}"
    assert "server.py" in call_lines[0]


def test_rider_pickup_gupshup_template_env_mapping():
    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_pickup") == "GUPSHUP_TEMPLATE_RIDER_PICKUP"


_RIDER_RETURN_PICKUP_KWARGS = dict(
    return_id="RET-8291",
    order_id="o-lokltest-orderHT62VB",
    otp="7734",
    customer_name="Priya Sharma",
    pickup_addr="H.No. 45, Nehru Nagar, Bhilai, 490020",
    items=[{"qty": 2, "name": "Cotton Kurta"}, {"qty": 1, "name": "Denim Jacket"}],
    reason="Size didn't fit",
    store_name="Sahoo Collection",
    store_address="Shop 12, Sector 10 Market, Bhilai",
    store_lat=21.19, store_lng=81.33,
    customer_lat=21.21, customer_lng=81.35,
)
_RIDER_RETURN_PICKUP_EXPECTED = [
    "HT62VB", "Priya Sharma", "H.No. 45, Nehru Nagar, Bhilai, 490020",
    "https://maps.google.com/?q=21.21,81.35",
    "Sahoo Collection", "Shop 12, Sector 10 Market, Bhilai",
    "https://maps.google.com/?q=21.19,81.33",
    "2x Cotton Kurta; 1x Denim Jacket",
]


def test_rider_return_pickup_sends_exactly_8_params_in_approved_order():
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    8 variables, in order — ORIGINAL order short id, customer
    name/address, customer map URL, store name/address, store map URL,
    returned items."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_rider_return_pickup, "9800000000", **_RIDER_RETURN_PICKUP_KWARGS,
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["rider_return_pickup"], "message_type must be exactly 'rider_return_pickup'"
    assert len(params) == 8, "must be exactly 8 Gupshup template parameters"
    assert params == _RIDER_RETURN_PICKUP_EXPECTED, "parameters must be in the exact approved order"


def test_rider_return_pickup_uses_original_order_id_not_return_id():
    params = _capture_send_with_fallback(
        notif.notify_rider_return_pickup, "9800000000", **_RIDER_RETURN_PICKUP_KWARGS,
    )
    assert params[0] == "HT62VB", "{{1}} must be the ORIGINAL order's short id"
    assert "RET-8291" not in params, "the return id must never be passed as {{1}} or leak into any parameter"
    assert not any("RET-" in p for p in params), "no return id anywhere in the Gupshup parameters"


def test_rider_return_pickup_addresses_from_correct_records():
    params = _capture_send_with_fallback(
        notif.notify_rider_return_pickup, "9800000000", **_RIDER_RETURN_PICKUP_KWARGS,
    )
    assert params[2] == "H.No. 45, Nehru Nagar, Bhilai, 490020", "{{3}} customer address must come from the order's own address, not the store"
    assert params[5] == "Shop 12, Sector 10 Market, Bhilai", "{{6}} store address must come from the merchant record, not the customer address"
    assert params[4] == "Sahoo Collection", "{{5}} store name must come from db.merchants, not a return/order field"


def test_rider_return_pickup_items_mapped_correctly():
    kwargs = dict(_RIDER_RETURN_PICKUP_KWARGS)
    kwargs["items"] = [{"qty": 3, "name": "Saree"}]
    params = _capture_send_with_fallback(notif.notify_rider_return_pickup, "9800000000", **kwargs)
    assert params[7] == "3x Saree"

    kwargs["items"] = []
    params_empty = _capture_send_with_fallback(notif.notify_rider_return_pickup, "9800000000", **kwargs)
    assert params_empty[7] == "(see app)", "reuses the function's own existing empty-items fallback"


def test_rider_return_pickup_map_urls_only_with_real_coordinates():
    """Store map URL present (real coordinates); customer map URL empty
    (no fabricated coordinates) when lat/lng are unavailable — the common
    case today, per the audit."""
    kwargs = dict(_RIDER_RETURN_PICKUP_KWARGS)
    kwargs["customer_lat"] = 0
    kwargs["customer_lng"] = 0
    params = _capture_send_with_fallback(notif.notify_rider_return_pickup, "9800000000", **kwargs)
    assert params[3] == "", "customer map URL must be a safe empty value, never a fabricated URL, when coordinates are missing"
    assert params[6] == "https://maps.google.com/?q=21.19,81.33", "store map URL must still use its own real coordinates"

    kwargs2 = dict(_RIDER_RETURN_PICKUP_KWARGS)
    kwargs2["store_lat"] = 0
    kwargs2["store_lng"] = 0
    params2 = _capture_send_with_fallback(notif.notify_rider_return_pickup, "9800000000", **kwargs2)
    assert params2[6] == "", "store map URL must also be empty (not fabricated) when store coordinates are missing"


def test_rider_return_pickup_excludes_otp_return_id_and_reason():
    params = _capture_send_with_fallback(
        notif.notify_rider_return_pickup, "9800000000", **_RIDER_RETURN_PICKUP_KWARGS,
    )
    joined = " ".join(params)
    assert _RIDER_RETURN_PICKUP_KWARGS["otp"] not in joined, "OTP must never reach a Gupshup parameter"
    assert "RET-8291" not in joined, "return id must never reach a Gupshup parameter"
    assert _RIDER_RETURN_PICKUP_KWARGS["reason"] not in joined, "reason must never reach a Gupshup parameter — not a variable in the approved template"


def test_rider_return_pickup_freeform_body_still_carries_otp_and_return_id():
    """OTP and return_id must remain in the Twilio/MSG91 freeform body
    exactly as before — only the Gupshup template send excludes them."""
    sent = {}
    def fake_send_whatsapp(to, message, *, template_id=None, template_params=None, message_type=None):
        sent["body"] = message
        return "msg-id"

    class _FakeTwilioLike(notif.NotificationProvider):
        def send_sms(self, *a, **kw): return True
        def send_whatsapp(self, *a, **kw): return fake_send_whatsapp(*a, **kw)
        def send_otp(self, *a, **kw): return "whatsapp"
        def verify_otp(self, *a, **kw): return True

    fake = _FakeTwilioLike()
    orig_get_provider = notif.get_provider
    notif.get_provider = lambda: fake
    try:
        notif.notify_rider_return_pickup("9800000000", **_RIDER_RETURN_PICKUP_KWARGS)
    finally:
        notif.get_provider = orig_get_provider

    assert _RIDER_RETURN_PICKUP_KWARGS["otp"] in sent["body"]
    assert "RET-8291" in sent["body"]


def test_rider_return_pickup_recipient_and_trigger_preserved():
    """Static check: still the shared RIDER_PHONE ops number, still only
    triggered from admin_return_action() on the 'assign' action."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    fn_start = src.index("async def admin_return_action")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    assert 'rider_phone = os.environ.get("RIDER_PHONE", "").strip()' in fn_src
    assert 'if status == "pickup_assigned":' in fn_src
    assert fn_src.count("notify_rider_return_pickup(") == 1


def test_rider_return_pickup_has_exactly_one_call_site_no_duplicate_path():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "notify_rider_return_pickup(", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = [l for l in out.splitlines() if "def notify_rider_return_pickup" not in l]
    assert len(call_lines) == 1, f"expected exactly one call site, found {len(call_lines)}: {call_lines}"
    assert "server.py" in call_lines[0]


def test_rider_return_pickup_gupshup_template_env_mapping():
    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_return_pickup") == "GUPSHUP_TEMPLATE_RIDER_RETURN_PICKUP"


def test_order_on_the_way_sends_exactly_one_param_the_short_order_id():
    """Confirmed live from the Gupshup template editor (2026-09): exactly
    ONE variable, the order's short id. No OTP, no rider phone, no
    tracking URL — the approved template's own static copy has no slot
    for any of them."""
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    try:
        params = _capture_send_with_fallback(
            notif.notify_order_on_the_way, "9876543210", "o-lokltest-orderUYDDB9",
            "4821", "9123456780",  # otp, rider_phone — must NOT reach Gupshup
        )
    finally:
        notif.send_with_fallback = orig

    assert calls == ["order_on_the_way"], "message_type must be exactly 'order_on_the_way'"
    assert params == ["UYDDB9"], "exactly one parameter, the short order id"
    assert len(params) == 1, "must be exactly one Gupshup template parameter, not more"
    assert "4821" not in params, "delivery OTP must never reach a Gupshup template parameter"
    assert "9123456780" not in params, "rider phone must never reach a Gupshup template parameter"
    assert not any(notif.APP_URL in p for p in params), "no tracking URL — the approved template has none"


def test_order_on_the_way_freeform_body_still_carries_otp_and_rider_phone():
    """The freeform body (Twilio/MSG91, or Gupshup with no template
    configured) is explicitly allowed to keep OTP/rider phone/tracking
    URL — only the Gupshup TEMPLATE send is restricted. This proves the
    restriction is scoped to the template params, not a change to what
    the function computes or to the delivery-OTP flow itself."""
    sent = {}
    def fake_send_whatsapp(to, message, *, template_id=None, template_params=None, message_type=None):
        sent["body"] = message
        sent["template_params"] = template_params
        return "msg-id"

    class _FakeTwilioLike(notif.NotificationProvider):
        def send_sms(self, *a, **kw): return True
        def send_whatsapp(self, *a, **kw): return fake_send_whatsapp(*a, **kw)
        def send_otp(self, *a, **kw): return "whatsapp"
        def verify_otp(self, *a, **kw): return True

    fake = _FakeTwilioLike()
    orig_get_provider = notif.get_provider
    notif.get_provider = lambda: fake
    try:
        notif.notify_order_on_the_way("9876543210", "o-lokltest-orderUYDDB9", "4821", "9123456780")
    finally:
        notif.get_provider = orig_get_provider

    assert "4821" in sent["body"], "freeform body must still carry the delivery OTP for non-Gupshup providers"
    assert "9123456780" in sent["body"], "freeform body must still carry the rider phone for non-Gupshup providers"
    assert notif.APP_URL in sent["body"], "freeform body must still carry the tracking URL for non-Gupshup providers"


def test_order_on_the_way_call_site_still_passes_otp_and_rider_phone_unchanged():
    """Static check that the ONE call site (server.py, inside the rider
    hand-off/delivery-confirmation flow) still passes my_otp and
    rider_phone exactly as before this change — i.e. the delivery OTP
    generation and rider handoff logic that produce those two values were
    never touched, only how notify_order_on_the_way() forwards them to
    Gupshup specifically."""
    server_py = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server.py")
    with open(server_py) as f:
        src = f.read()
    assert 'notify_order_on_the_way(cust_phone, oid, my_otp, rider_phone)' in src, \
        "the call site's own signature (order_id, otp, rider_phone all still passed in) must be unchanged"


def test_order_on_the_way_has_exactly_one_call_site():
    """Confirms no second Gupshup call path for this message exists
    anywhere in the application backend (excludes this tests/ directory,
    which legitimately calls notify_order_on_the_way() directly in the
    tests above)."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "notify_order_on_the_way(", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = [l for l in out.splitlines() if "def notify_order_on_the_way" not in l]
    assert len(call_lines) == 1, f"expected exactly one call site, found {len(call_lines)}: {call_lines}"
    assert "server.py" in call_lines[0]


# ============================================================================
# PART 2 — DB-backed wiring (admin KYC actions, payment-failure webhook,
# merchant_new_order duplicate protection)
# ============================================================================

def _test_merchant_doc(mid):
    now = datetime.now(timezone.utc).isoformat()
    phone_digits = f"9{int(time.time() * 1000 + hash(mid)) % 10 ** 9:09d}"
    return {
        "id": mid, "password_hash": "x", "store_name": f"Gupshup Test Store {mid[-6:]}",
        "owner_name": "Owner", "phone": phone_digits, "phone_canonical": phone_digits,
        "city": "Bhilai", "created_at": now, "role": "merchant",
        "kyc_status": "submitted", "kyc_submitted_at": now, "approved_at": None,
        "terms_accepted": True, "terms_version": "test", "terms_accepted_at": now,
        "published": False, "storefront": None, "notifications": [],
    }


def _test_order_doc(oid, mid, *, razorpay_order_id, payment_status, total=999.0):
    now = datetime.now(timezone.utc).isoformat()
    phone = f"9{int(time.time() * 1000 + hash(oid)) % 10 ** 9:09d}"
    return {
        "id": oid, "razorpay_order_id": razorpay_order_id, "payment_method": "razorpay",
        "payment_status": payment_status, "status": "awaiting_payment", "total": total,
        "merchant_ids": [mid], "items": [{"id": "p1", "name": "Test Item", "qty": 1, "merchant_id": mid}],
        "customer": {"name": "Test Customer", "phone": phone}, "address": {"phone": phone},
        "created_at": now,
    }


async def _admin_reject_wiring_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-gupshup-rej-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_test_merchant_doc(mid))

    orig = srv.notify_merchant_kyc_rejected
    calls = []
    srv.notify_merchant_kyc_rejected = lambda phone, store_name: calls.append((phone, store_name))
    try:
        result = await srv.admin_reject(mid, {"reason": "Documents unclear"}, admin={"id": "test-admin"})
        assert result["ok"] is True
        m = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m["kyc_status"] == "rejected"
        # In-app notification must be unchanged (still pushed, still carries the real reason).
        in_app = [n for n in m.get("notifications", []) if n["type"] == "kyc-rejected"]
        assert len(in_app) == 1 and in_app[0]["body"] == "Documents unclear"
        # New WhatsApp send must fire exactly once, with ONLY store_name.
        assert len(calls) == 1
        assert calls[0][0] == m["phone"]
        assert calls[0][1] == m["store_name"]
    finally:
        srv.notify_merchant_kyc_rejected = orig


async def _admin_hold_wiring_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-gupshup-hold-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_test_merchant_doc(mid))

    orig = srv.notify_merchant_kyc_on_hold
    calls = []
    srv.notify_merchant_kyc_on_hold = lambda phone, store_name, comment: calls.append((phone, store_name, comment))
    try:
        result = await srv.admin_hold(mid, {"reason": "PAN doc unclear"}, admin={"id": "test-admin"})
        assert result["ok"] is True
        m = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m["kyc_status"] == "on_hold"
        in_app = [n for n in m.get("notifications", []) if n["type"] == "kyc-on-hold"]
        assert len(in_app) == 1 and in_app[0]["body"] == "PAN doc unclear"
        assert len(calls) == 1
        assert calls[0][0] == m["phone"]
        assert calls[0][1] == m["store_name"]
        assert calls[0][2] == "PAN doc unclear"
    finally:
        srv.notify_merchant_kyc_on_hold = orig


async def _payment_failed_notify_and_dedup_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-gupshup-payfail-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_test_merchant_doc(mid))
    oid = f"o-gupshup-payfail-{uuid.uuid4().hex[:8]}"
    rp_order_id = f"order_test_{uuid.uuid4().hex[:12]}"
    # payment_status starts at a non-terminal value — this hand-seeded
    # shape (razorpay_order_id set, not yet paid/failed/refunded) mirrors
    # test_security_fixes.py's own _seed_paid_razorpay_order technique:
    # it simulates a state to test the HANDLER's logic in isolation, even
    # though (per the reconciliation audit) create_order()'s real
    # payment-first flow never actually produces this exact intermediate
    # state — see the final report's note on payment_failed reachability.
    await db.orders.insert_one(_test_order_doc(oid, mid, razorpay_order_id=rp_order_id, payment_status="created"))

    orig = srv.notify_payment_failed
    calls = []
    srv.notify_payment_failed = lambda phone, order_id: calls.append((phone, order_id))
    event = {"payload": {"payment": {"entity": {
        "order_id": rp_order_id, "id": "pay_test_fail", "error_description": "Card declined",
    }}}}
    try:
        await srv._handle_payment_failed(event)
        fresh = await db.orders.find_one({"id": oid}, {"_id": 0})
        assert fresh["payment_status"] == "failed"
        assert len(calls) == 1, "must notify on the genuine first transition into failed"
        assert calls[0][1] == oid

        # Simulate a webhook retry (a second, distinct event describing
        # the same failure) hitting the now-already-failed order.
        await srv._handle_payment_failed(event)
        assert len(calls) == 1, "must NOT notify again once the order is already payment_status=failed"
    finally:
        srv.notify_payment_failed = orig
        await db.orders.delete_one({"id": oid})


async def _merchant_new_order_no_duplicate_case(srv, cleanup):
    """Empirical confirmation (not just the static read in the
    reconciliation audit) that _handle_payment_captured's existing
    `if o.get("payment_status") == "paid": return` guard is sufficient:
    fires exactly once while the order transitions into paid, and never
    again once it's already paid."""
    db = srv.db
    mid = cleanup.track(f"m-gupshup-neworder-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_test_merchant_doc(mid))
    oid = f"o-gupshup-neworder-{uuid.uuid4().hex[:8]}"
    rp_order_id = f"order_test_{uuid.uuid4().hex[:12]}"
    rp_payment_id = f"pay_test_{uuid.uuid4().hex[:12]}"
    total = 500.0
    await db.orders.insert_one(_test_order_doc(oid, mid, razorpay_order_id=rp_order_id, payment_status="created", total=total))

    orig = srv.notify_merchant_new_order
    calls = []
    srv.notify_merchant_new_order = lambda merchant_phone, order_id, total, items_count: calls.append(order_id)
    event = {"payload": {"payment": {"entity": {
        "order_id": rp_order_id, "id": rp_payment_id, "amount": int(round(total * 100)),
        "created_at": time.time(),
    }}}}
    try:
        await srv._handle_payment_captured(event)
        fresh = await db.orders.find_one({"id": oid}, {"_id": 0})
        assert fresh["payment_status"] == "paid"
        assert calls == [oid], "must notify exactly once on the genuine transition into paid"

        # Same webhook event delivered again (Razorpay's own retry
        # behavior) — the order is already paid; must be a pure no-op.
        await srv._handle_payment_captured(event)
        assert calls == [oid], "must NOT notify again once the order is already paid — this is the D1 guard from the reconciliation audit"
    finally:
        srv.notify_merchant_new_order = orig
        await db.orders.delete_one({"id": oid})


async def _admin_return_action_notifies_raw_status_case(srv, cleanup):
    """End-to-end through admin_return_action() for all 4 statuses that
    should notify, in the only order _advance_return() permits (monotonic
    through RETURN_STATUS_FLOW), plus confirms the return's own creation
    state ("requested") never notifies."""
    db = srv.db
    mid = cleanup.track(f"m-gupshup-return-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_test_merchant_doc(mid))
    oid = f"o-gupshup-return-{uuid.uuid4().hex[:8]}"
    rid = f"RET-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    order = _test_order_doc(oid, mid, razorpay_order_id=f"order_test_unused_{uuid.uuid4().hex[:8]}", payment_status="paid")
    await db.orders.insert_one(order)
    await db.returns.insert_one({
        "id": rid, "order_id": oid, "customer_phone": order["customer"]["phone"],
        "merchant_ids": [mid], "items": [], "reason": "test", "status": "requested",
        "otp": "1234", "created_at": now,
        "timeline": [{"label": "Return requested", "time": now},
                     {"label": "Pickup partner assigned", "time": None},
                     {"label": "Pickup partner arriving", "time": None},
                     {"label": "Product picked up", "time": None},
                     {"label": "Return completed", "time": None}],
    })

    orig = srv.notify_return_status
    calls = []
    srv.notify_return_status = lambda phone, return_id, order_id, status: calls.append((return_id, order_id, status))
    try:
        # "requested" itself must never have triggered a call (create_return()
        # is not exercised here, but confirm the DB state alone proves nothing
        # already fired for it).
        assert calls == []

        for action, expected_status in [
            ("assign", "pickup_assigned"), ("arriving", "arriving"),
            ("picked_up", "picked_up"), ("complete", "completed"),
        ]:
            result = await srv.admin_return_action(rid, action, admin={"id": "test-admin"})
            assert result["status"] == expected_status
            assert calls[-1] == (rid, oid, expected_status), \
                f"notify_return_status must receive (return_id={rid!r}, order_id={oid!r}, status={expected_status!r}) — " \
                "the return id and order id must never be swapped"
        assert len(calls) == 4, "exactly one notify per admin action, never more"
        assert [c[2] for c in calls] == ["pickup_assigned", "arriving", "picked_up", "completed"]
        assert all(c[1] == oid for c in calls), "order_id passed must always be the real Lokl order id, unchanged across statuses"
    finally:
        srv.notify_return_status = orig
        await db.returns.delete_one({"id": rid})
        await db.orders.delete_one({"id": oid})


class _Cleanup:
    def __init__(self, db):
        self.db = db
        self.merchant_ids = []

    def track(self, merchant_id):
        self.merchant_ids.append(merchant_id)
        return merchant_id

    async def purge(self):
        for mid in self.merchant_ids:
            await self.db.merchants.delete_one({"id": mid})


async def _run_all_db_cases():
    import server as srv
    try:
        db = srv.db
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return

    cleanup = _Cleanup(db)
    try:
        await _admin_reject_wiring_case(srv, cleanup)
        await _admin_hold_wiring_case(srv, cleanup)
        await _payment_failed_notify_and_dedup_case(srv, cleanup)
        await _merchant_new_order_no_duplicate_case(srv, cleanup)
        await _admin_return_action_notifies_raw_status_case(srv, cleanup)
    finally:
        await cleanup.purge()


def test_gupshup_wiring_db_backed():
    asyncio.run(_run_all_db_cases())
