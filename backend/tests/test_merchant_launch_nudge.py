"""Payload-shape tests for the Merchant Launch Nudge campaign (2026-09).

Same convention as test_gupshup_reconciliation.py PART 1: monkeypatches
requests.post and asserts the EXACT `params` array notify_merchant_launch_nudge
sends to Gupshup for the approved template (id
cebe40ee-c726-402f-849e-872c8b974fa1, Marketing category, 3 variables).

Run with: cd backend && python3 -m pytest tests/test_merchant_launch_nudge.py -v
"""
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifications as notif


def _mock_post(captured):
    class _Resp:
        status_code = 202
        content = b"1"
        def json(self):
            return {"status": "submitted", "messageId": "test-msg-id"}

    def _post(url, data=None, headers=None, timeout=None):
        captured.append(json.loads(data["template"]))
        return _Resp()

    return _post


def _gupshup_env(**extra):
    base = {
        "GUPSHUP_API_KEY": "test-key",
        "GUPSHUP_WHATSAPP_NUMBER": "919999999999",
        "GUPSHUP_APP_NAME": "LoklTest",
        "NOTIFICATION_PROVIDER": "gupshup",
        "GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE": "cebe40ee-c726-402f-849e-872c8b974fa1",
    }
    base.update(extra)
    return base


def test_merchant_launch_nudge_template_env_mapping():
    assert notif.GupshupProvider._TEMPLATE_ENV.get("merchant_launch_nudge") == "GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE"


def test_merchant_launch_nudge_sends_exactly_3_params_in_approved_order():
    captured = []
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post(captured)):
            result = notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()

    assert result == "whatsapp"
    assert len(captured) == 1
    params = captured[0]["params"]
    assert len(params) == 3, "must be exactly 3 Gupshup template parameters"
    assert params == ["Ramesh Sahoo", "https://www.shoplokl.in", notif.SUPPORT_PHONE]
    assert params[0] == "Ramesh Sahoo", "{{1}} must be the merchant/owner name"
    assert params[1] == "https://www.shoplokl.in", "{{2}} must be the approved template's fixed site URL"
    assert params[2] == notif.SUPPORT_PHONE, "{{3}} must be the existing configured support phone"


def test_merchant_launch_nudge_url_is_independent_of_app_url_variable():
    """{{2}} (https://www.shoplokl.in, 2026-09 correction) happens to equal
    APP_URL's own default today, but must be a fixed literal INDEPENDENT of
    the APP_URL variable — not read from it — so this Marketing template's
    approved copy can never silently drift if APP_URL is changed for an
    unrelated (e.g. tracking-link) reason. Proven by monkeypatching APP_URL
    to a different value and confirming {{2}} is unaffected."""
    captured = []
    notif._provider_instances.clear()
    orig_app_url = notif.APP_URL
    notif.APP_URL = "https://some-other-domain.example"
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post(captured)):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif.APP_URL = orig_app_url
        notif._provider_instances.clear()
    assert captured[0]["params"][1] == "https://www.shoplokl.in", \
        "{{2}} must stay the fixed approved-template literal even when APP_URL changes"


def test_merchant_launch_nudge_uses_correct_template_id():
    captured = []
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post(captured)):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()
    assert captured[0]["id"] == "cebe40ee-c726-402f-849e-872c8b974fa1"


def test_merchant_launch_nudge_message_type_is_correct():
    calls = []
    orig = notif.send_with_fallback
    def spy(*a, **kw):
        calls.append(kw.get("message_type"))
        return orig(*a, **kw)
    notif.send_with_fallback = spy
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post([])):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif.send_with_fallback = orig
        notif._provider_instances.clear()
    assert calls == ["merchant_launch_nudge"]


def test_merchant_launch_nudge_returns_send_with_fallback_result():
    """Unlike the other notify_* functions, this one must return the
    "whatsapp"/"sms"/"none" result so the sending script can report
    per-merchant success/failure."""
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post([])):
            result = notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()
    assert result == "whatsapp"


def test_merchant_launch_nudge_shares_order_placed_support_phone_source():
    """One canonical support-phone configuration, not one per template:
    order_placed's {{4}} and merchant_launch_nudge's {{3}} must both come
    from the exact same notif.SUPPORT_PHONE module constant (notifications.py,
    `SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "+917719052107")`) — not
    two independently-configured values that merely happen to match today."""
    env = _gupshup_env(GUPSHUP_TEMPLATE_ORDER_PLACED="tpl-order-placed")
    order_placed_captured = []
    launch_nudge_captured = []
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, env, clear=False), \
             patch("requests.post", side_effect=_mock_post(order_placed_captured)):
            notif.notify_order_placed("9876543210", "o-lokltest-orderABC123", 999.0)
        notif._provider_instances.clear()
        with patch.dict(os.environ, env, clear=False), \
             patch("requests.post", side_effect=_mock_post(launch_nudge_captured)):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()

    order_placed_support_phone = order_placed_captured[0]["params"][3]
    launch_nudge_support_phone = launch_nudge_captured[0]["params"][2]
    assert order_placed_support_phone == launch_nudge_support_phone == notif.SUPPORT_PHONE, \
        "both templates must display the identical support phone, sourced from the same config"


def test_merchant_launch_nudge_missing_template_id_fails_loudly_not_silently():
    """If GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE is unset, the send must
    fail (never silently succeed or fall back to a freeform message)."""
    env = _gupshup_env()
    del env["GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE"]
    notif._provider_instances.clear()
    with patch.dict(os.environ, env, clear=True):
        os.environ.pop("GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE", None)
        with patch("requests.post") as mock_post:
            result = notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    notif._provider_instances.clear()
    assert result == "none"
    mock_post.assert_not_called()
