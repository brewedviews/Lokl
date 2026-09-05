"""Payload-shape tests for the Merchant Launch Nudge campaign (2026-09).

Same convention as test_gupshup_reconciliation.py PART 1: monkeypatches
requests.post and asserts the EXACT `params` array notify_merchant_launch_nudge
sends to Gupshup for the approved template (id
3ba590d2-8be9-4c57-8838-ea1a30c18790, Marketing category, 1 variable —
merchant/owner name; everything else in the template body is fixed copy).

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
        "GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE": "3ba590d2-8be9-4c57-8838-ea1a30c18790",
    }
    base.update(extra)
    return base


def test_merchant_launch_nudge_template_env_mapping():
    assert notif.GupshupProvider._TEMPLATE_ENV.get("merchant_launch_nudge") == "GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE"


def test_merchant_launch_nudge_sends_exactly_1_param():
    """2026-09 re-approval: the template now has exactly ONE variable
    (merchant/owner name) — everything else in the approved body is fixed
    copy. The prior template's {{2}} site-URL and {{3}} support-phone
    variables no longer exist and must not be sent."""
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
    assert len(params) == 1, "must be exactly 1 Gupshup template parameter"
    assert params == ["Ramesh Sahoo"]
    assert params[0] == "Ramesh Sahoo", "{{1}} must be the merchant/owner name"


def test_merchant_launch_nudge_sends_no_website_or_support_phone_params():
    """Explicit negative check: neither the old site-URL nor the support
    phone appear anywhere in the params array sent to Gupshup for the
    re-approved template."""
    captured = []
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post(captured)):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()
    params = captured[0]["params"]
    assert notif.SUPPORT_PHONE not in params
    assert "https://www.shoplokl.in" not in params
    assert "https://lokl.in" not in params
    assert not any(notif.APP_URL in p for p in params if isinstance(p, str))


def test_merchant_launch_nudge_uses_correct_template_id():
    captured = []
    notif._provider_instances.clear()
    try:
        with patch.dict(os.environ, _gupshup_env(), clear=False), \
             patch("requests.post", side_effect=_mock_post(captured)):
            notif.notify_merchant_launch_nudge("9876543210", "Ramesh Sahoo")
    finally:
        notif._provider_instances.clear()
    assert captured[0]["id"] == "3ba590d2-8be9-4c57-8838-ea1a30c18790"


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
