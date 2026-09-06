"""Rider web push audit fix (2026-09).

Covers the two things the audit found were completely untested:
  1. rider_push.py's VAPID gating, malformed-subscription guard, and
     pywebpush.webpush() call/error handling (send_to_subscription()).
  2. POST /rider/push/subscribe and /rider/push/unsubscribe — persistence,
     dedup-by-endpoint, multi-device support, and the active-rider gate.

Does NOT change the Web Push architecture (still pywebpush + VAPID, no
FCM) and does NOT send any real push — pywebpush.webpush() is mocked
throughout Part 1, and Part 2 only exercises the DB read/write side of
the subscribe/unsubscribe endpoints (never send_to_subscription()).

PART 1 — pure tests against rider_push.py (no DB, no real network).
PART 2 — DB-backed in-process tests, same asyncio.run()-per-test
convention as test_rider_notification_workflow.py — calls server.py's
route functions directly with a fake `user` dict, monkeypatching nothing
on the DB side (writes to/cleans up from the real local dev database).

Run with: cd backend && python3 -m pytest tests/test_rider_push.py -v
Part 2 requires a reachable MONGO_URL.
"""
import json
import os
import sys
import uuid
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rider_push
import server as srv


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


VALID_SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-abc",
    "keys": {"p256dh": "test-p256dh-key", "auth": "test-auth-key"},
}


# ============================================================================
# PART 1 — rider_push.py (pure — no DB, no real network)
# ============================================================================

class TestIsConfigured:
    def test_false_when_both_keys_missing(self, monkeypatch):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "")
        assert rider_push.is_configured() is False

    def test_false_when_only_public_key_set(self, monkeypatch):
        """Both keys are required — a half-configured deploy must not
        look 'configured' (this is exactly the audit's root-cause class
        of bug: a silently-half-set config that no one notices)."""
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "pub")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "")
        assert rider_push.is_configured() is False

    def test_true_when_both_keys_set(self, monkeypatch):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "pub")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "priv")
        assert rider_push.is_configured() is True


class TestSendToSubscriptionConfigGate:
    def test_skips_and_returns_clear_error_when_not_configured(self, monkeypatch):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "")
        result = rider_push.send_to_subscription(VALID_SUB, "title", "body")
        assert result == {"ok": False, "expired": False, "error": "VAPID not configured"}

    def test_logs_a_warning_when_not_configured(self, monkeypatch, caplog):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "")
        with caplog.at_level("WARNING", logger="lokl.push"):
            rider_push.send_to_subscription(VALID_SUB, "title", "body")
        assert any("not configured" in r.message for r in caplog.records), \
            "a misconfigured VAPID key must be loud in the logs, not silent"


class TestSendToSubscriptionMalformed:
    """These must all fail via the clean, logged guard — never reach
    pywebpush.webpush() and raise there instead."""

    def _configured(self, monkeypatch):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "pub")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "priv")

    def test_none_subscription_is_rejected_safely(self, monkeypatch):
        self._configured(monkeypatch)
        result = rider_push.send_to_subscription(None, "t", "b")
        assert result == {"ok": False, "expired": False, "error": "invalid subscription"}

    def test_missing_endpoint_is_rejected_safely(self, monkeypatch):
        self._configured(monkeypatch)
        result = rider_push.send_to_subscription({"keys": VALID_SUB["keys"]}, "t", "b")
        assert result == {"ok": False, "expired": False, "error": "invalid subscription"}

    def test_missing_p256dh_is_rejected_safely(self, monkeypatch):
        self._configured(monkeypatch)
        sub = {"endpoint": VALID_SUB["endpoint"], "keys": {"auth": "a"}}
        result = rider_push.send_to_subscription(sub, "t", "b")
        assert result == {"ok": False, "expired": False, "error": "invalid subscription"}

    def test_missing_auth_is_rejected_safely(self, monkeypatch):
        """Audit fix: the original guard only checked p256dh, so a
        subscription missing 'auth' (equally malformed/unusable by
        pywebpush) would previously fall through this guard entirely."""
        self._configured(monkeypatch)
        sub = {"endpoint": VALID_SUB["endpoint"], "keys": {"p256dh": "p"}}
        result = rider_push.send_to_subscription(sub, "t", "b")
        assert result == {"ok": False, "expired": False, "error": "invalid subscription"}


class TestSendToSubscriptionConfigured:
    def _configured(self, monkeypatch):
        monkeypatch.setattr(rider_push, "VAPID_PUBLIC_KEY", "pub")
        monkeypatch.setattr(rider_push, "VAPID_PRIVATE_KEY", "priv")
        monkeypatch.setattr(rider_push, "VAPID_SUBJECT", "mailto:test@example.com")

    def test_attempts_webpush_with_correct_args_when_configured(self, monkeypatch):
        self._configured(monkeypatch)
        with patch("pywebpush.webpush") as mock_webpush:
            result = rider_push.send_to_subscription(
                VALID_SUB, "New order available", "Pickup from Test Store",
                tag="lokl-order-o123", url="/rider",
            )
            mock_webpush.assert_called_once()
            _, kwargs = mock_webpush.call_args
            assert kwargs["subscription_info"] == VALID_SUB
            assert kwargs["vapid_private_key"] == "priv"
            assert kwargs["vapid_claims"] == {"sub": "mailto:test@example.com"}
            payload = json.loads(kwargs["data"])
            assert payload == {
                "title": "New order available", "body": "Pickup from Test Store",
                "tag": "lokl-order-o123", "url": "/rider",
            }
        assert result == {"ok": True, "expired": False, "error": None}

    def test_404_marks_subscription_expired(self, monkeypatch):
        from pywebpush import WebPushException
        self._configured(monkeypatch)

        class _Resp:
            status_code = 404

        with patch("pywebpush.webpush", side_effect=WebPushException("gone", response=_Resp())):
            result = rider_push.send_to_subscription(VALID_SUB, "t", "b")
        assert result["ok"] is False
        assert result["expired"] is True

    def test_410_marks_subscription_expired(self, monkeypatch):
        from pywebpush import WebPushException
        self._configured(monkeypatch)

        class _Resp:
            status_code = 410

        with patch("pywebpush.webpush", side_effect=WebPushException("gone", response=_Resp())):
            result = rider_push.send_to_subscription(VALID_SUB, "t", "b")
        assert result["expired"] is True

    def test_non_expiry_failure_is_not_marked_expired(self, monkeypatch):
        from pywebpush import WebPushException
        self._configured(monkeypatch)

        class _Resp:
            status_code = 500

        with patch("pywebpush.webpush", side_effect=WebPushException("server error", response=_Resp())):
            result = rider_push.send_to_subscription(VALID_SUB, "t", "b")
        assert result["ok"] is False
        assert result["expired"] is False
        assert "server error" in result["error"]

    def test_generic_exception_never_raises(self, monkeypatch):
        self._configured(monkeypatch)
        with patch("pywebpush.webpush", side_effect=RuntimeError("boom")):
            result = rider_push.send_to_subscription(VALID_SUB, "t", "b")
        assert result == {"ok": False, "expired": False, "error": "boom"}


# ============================================================================
# PART 2 — DB-backed: POST /rider/push/subscribe, /rider/push/unsubscribe
# ============================================================================

async def _seed_active_rider(db, rider_id, phone):
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    await db.riders.insert_one({
        "id": rider_id, "phone": phone, "name": "Test Rider",
        "status": "active", "online": True, "created_at": now_iso, "updated_at": now_iso,
    })


def _payload(endpoint, p256dh="p256dh-key", auth="auth-key"):
    return srv.PushSubscriptionPayload(
        endpoint=endpoint,
        keys=srv.PushSubscriptionKeys(p256dh=p256dh, auth=auth),
    )


class TestPushSubscribeEndpoint:
    def test_persists_a_new_subscription(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_active_rider(db, rider_id, phone)
            try:
                user = {"sub": phone, "role": "rider"}
                result = await srv.rider_push_subscribe(_payload(VALID_SUB["endpoint"]), user=user)
                assert result == {"ok": True}
                rider = await db.riders.find_one({"id": rider_id}, {"_id": 0, "push_subscriptions": 1})
                subs = rider["push_subscriptions"]
                assert len(subs) == 1
                assert subs[0]["endpoint"] == VALID_SUB["endpoint"]
                assert subs[0]["keys"] == {"p256dh": "p256dh-key", "auth": "auth-key"}
                assert "created_at" in subs[0]
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())

    def test_resubscribing_the_same_endpoint_replaces_not_duplicates(self):
        """A rider re-subscribing after a service-worker update (or a key
        rotation) sends the SAME endpoint with new keys — must replace the
        stored entry, never accumulate a second one for the same device."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_active_rider(db, rider_id, phone)
            try:
                user = {"sub": phone, "role": "rider"}
                await srv.rider_push_subscribe(_payload(VALID_SUB["endpoint"], p256dh="old-key"), user=user)
                await srv.rider_push_subscribe(_payload(VALID_SUB["endpoint"], p256dh="new-key"), user=user)
                rider = await db.riders.find_one({"id": rider_id}, {"_id": 0, "push_subscriptions": 1})
                subs = rider["push_subscriptions"]
                assert len(subs) == 1, f"expected dedup by endpoint, got {len(subs)} entries"
                assert subs[0]["keys"]["p256dh"] == "new-key"
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())

    def test_multiple_distinct_endpoints_are_all_kept(self):
        """One rider, two devices/browsers — both subscriptions must
        coexist so a push fans out to every device they're logged into."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_active_rider(db, rider_id, phone)
            try:
                user = {"sub": phone, "role": "rider"}
                await srv.rider_push_subscribe(_payload("https://push.example/device-a"), user=user)
                await srv.rider_push_subscribe(_payload("https://push.example/device-b"), user=user)
                rider = await db.riders.find_one({"id": rider_id}, {"_id": 0, "push_subscriptions": 1})
                endpoints = sorted(s["endpoint"] for s in rider["push_subscriptions"])
                assert endpoints == ["https://push.example/device-a", "https://push.example/device-b"]
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())

    def test_rejects_a_rider_who_is_not_active(self):
        """Authorization: a phone with no matching active rider doc (never
        registered, or suspended) must 403, matching every other rider
        endpoint's _active_rider() gate."""
        _require_live_db()
        import asyncio

        async def _run():
            phone = f"9{str(uuid.uuid4().int)[:9]}"  # never seeded
            user = {"sub": phone, "role": "rider"}
            with pytest.raises(srv.HTTPException) as exc_info:
                await srv.rider_push_subscribe(_payload(VALID_SUB["endpoint"]), user=user)
            assert exc_info.value.status_code == 403

        asyncio.run(_run())

    def test_rejects_a_suspended_rider(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
            await db.riders.insert_one({
                "id": rider_id, "phone": phone, "name": "Suspended Rider",
                "status": "suspended", "online": False, "created_at": now_iso, "updated_at": now_iso,
            })
            try:
                user = {"sub": phone, "role": "rider"}
                with pytest.raises(srv.HTTPException) as exc_info:
                    await srv.rider_push_subscribe(_payload(VALID_SUB["endpoint"]), user=user)
                assert exc_info.value.status_code == 403
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())


class TestPushUnsubscribeEndpoint:
    def test_removes_the_matching_subscription_only(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_active_rider(db, rider_id, phone)
            try:
                user = {"sub": phone, "role": "rider"}
                await srv.rider_push_subscribe(_payload("https://push.example/keep"), user=user)
                await srv.rider_push_subscribe(_payload("https://push.example/remove"), user=user)
                result = await srv.rider_push_unsubscribe(
                    srv.PushUnsubscribePayload(endpoint="https://push.example/remove"), user=user
                )
                assert result == {"ok": True}
                rider = await db.riders.find_one({"id": rider_id}, {"_id": 0, "push_subscriptions": 1})
                endpoints = [s["endpoint"] for s in rider["push_subscriptions"]]
                assert endpoints == ["https://push.example/keep"]
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())

    def test_is_idempotent_for_an_endpoint_that_was_never_subscribed(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            rider_id = f"rider-push-test-{uuid.uuid4().hex[:8]}"
            phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_active_rider(db, rider_id, phone)
            try:
                user = {"sub": phone, "role": "rider"}
                result = await srv.rider_push_unsubscribe(
                    srv.PushUnsubscribePayload(endpoint="https://push.example/never-subscribed"), user=user
                )
                assert result == {"ok": True}
            finally:
                await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())
