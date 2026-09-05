"""Rider notification CC recipient (2026-09).

Covers send_rider_notification() in notifications.py — a thin wrapper
around the three existing rider notify_* functions that additionally
sends to RIDER_NOTIFICATION_CC_PHONE (an optional, fixed operational
observer number) alongside the existing RIDER_PHONE recipient. Does not
touch db.riders, does not broadcast to every rider, and is not part of
the inbound "OTP DELIVERED" WhatsApp-reply authorization check.

Run with: cd backend && python3 -m pytest tests/test_rider_notification_cc.py -v
"""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifications as notif


def test_primary_and_cc_both_receive_the_notification():
    calls = []

    def fake_notify(phone, **kwargs):
        calls.append(phone)

    with patch.dict(os.environ, {"RIDER_NOTIFICATION_CC_PHONE": "7719052107"}, clear=False):
        notif.send_rider_notification(fake_notify, "9800000000", order_id="o-1")

    assert len(calls) == 2, "primary and CC must both be called"
    assert calls[0] == "9800000000", "primary must be sent first, unchanged"
    assert calls[1] == "7719052107", "CC must be sent second, to the configured number"


def test_cc_unset_leaves_existing_single_send_behavior_unchanged():
    calls = []

    def fake_notify(phone, **kwargs):
        calls.append(phone)

    env = dict(os.environ)
    env.pop("RIDER_NOTIFICATION_CC_PHONE", None)
    with patch.dict(os.environ, env, clear=True):
        notif.send_rider_notification(fake_notify, "9800000000", order_id="o-1")

    assert calls == ["9800000000"], "with no CC configured, behavior must be identical to calling notify_fn directly"


def test_primary_and_cc_identical_number_sends_only_once():
    """RIDER_PHONE and RIDER_NOTIFICATION_CC_PHONE normalizing to the same
    number (even in different formats, e.g. with/without +91) must not
    duplicate the send."""
    calls = []

    def fake_notify(phone, **kwargs):
        calls.append(phone)

    with patch.dict(os.environ, {"RIDER_NOTIFICATION_CC_PHONE": "+91 98000 00000"}, clear=False):
        notif.send_rider_notification(fake_notify, "9800000000", order_id="o-1")

    assert len(calls) == 1, "identical primary/CC numbers must result in exactly one send"
    assert calls == ["9800000000"]


def test_cc_failure_does_not_suppress_or_affect_primary_notification():
    """The primary call must succeed and its own exception-propagation
    behavior must be completely untouched by a CC-side failure — a caller
    relying on the primary call raising (or not raising) must see the same
    behavior with or without a broken CC number configured."""
    calls = []

    def flaky_notify(phone, **kwargs):
        calls.append(phone)
        if phone != "9800000000":
            raise RuntimeError("simulated CC provider failure")

    with patch.dict(os.environ, {"RIDER_NOTIFICATION_CC_PHONE": "7719052107"}, clear=False):
        # Must not raise — the CC failure must be swallowed internally.
        notif.send_rider_notification(flaky_notify, "9800000000", order_id="o-1")

    assert calls == ["9800000000", "7719052107"], "primary must still have been attempted and CC still attempted"


def test_primary_failure_propagates_exactly_as_a_direct_call_would():
    """A primary-side failure must raise through send_rider_notification
    exactly as it would from calling notify_fn(primary_phone, ...) directly
    — existing call sites' own try/except (e.g. order creation's
    rider_notified DB write only happening on primary success) depends on
    this being unchanged by the CC wrapper."""
    def failing_notify(phone, **kwargs):
        raise RuntimeError("simulated primary provider failure")

    with patch.dict(os.environ, {"RIDER_NOTIFICATION_CC_PHONE": "7719052107"}, clear=False):
        try:
            notif.send_rider_notification(failing_notify, "9800000000", order_id="o-1")
            assert False, "primary failure must propagate, not be swallowed"
        except RuntimeError as e:
            assert "simulated primary provider failure" in str(e)


def test_inbound_otp_delivered_authorization_is_not_extended_to_cc():
    """Static source check: the inbound Twilio 'OTP DELIVERED'/'picked up'
    reply authorization gate (server.py, restricting who can trigger it to
    RIDER_PHONE) must reference only RIDER_PHONE, never
    RIDER_NOTIFICATION_CC_PHONE — the CC number is a send-side observer
    only, never an authorized sender of inbound commands."""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_py = os.path.join(backend_dir, "server.py")
    with open(server_py) as f:
        src = f.read()
    marker = 'rider_env = (os.environ.get("RIDER_PHONE")'
    assert marker in src, "inbound rider-phone authorization check must still exist and read RIDER_PHONE"
    idx = src.index(marker)
    # Look at a tight window around the check (the enclosing if-block) —
    # RIDER_NOTIFICATION_CC_PHONE must not appear anywhere in it.
    window = src[idx:idx + 400]
    assert "RIDER_NOTIFICATION_CC_PHONE" not in window, \
        "the CC number must never be authorized to trigger inbound rider commands"
