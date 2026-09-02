"""Outbound Gupshup WhatsApp delivery-tracking tests (2026-09).

Covers the two things added by this feature:

PART 1 — outbound submission persistence (notifications.py). Mocks
requests.post the same way test_gupshup_reconciliation.py's PART 1b does,
calls GupshupProvider.send_whatsapp() directly, and reads the resulting
row back from the real dev Mongo via notif._gupshup_notifications_collection()
(the same lazy sync pymongo handle the production code itself uses).

PART 2 — inbound message-event webhook processing (routes/whatsapp.py).
LIVE HTTP tests against a running local backend, same convention as
test_admin_product_creation.py's TestWhatsAppCreationUnaffected: seeds a
"submitted" row directly via pymongo (same physical collection the live
server's Motor connection reads/writes), POSTs a message-event envelope
to /api/webhooks/gupshup/inbound, and reads the row back to assert the
resulting status/timestamp/failure fields.

Run with: cd backend && python3 -m pytest tests/test_gupshup_delivery_tracking.py -v
Requires a reachable MONGO_URL and a live local server at localhost:8001
(or REACT_APP_BACKEND_URL/NEXT_PUBLIC_API_URL) with GUPSHUP_WEBHOOK_SECRET
configured — matching the requirements test_admin_product_creation.py's
WhatsApp class already has.
"""
import os
import sys
import time
import uuid
from contextlib import contextmanager
from unittest.mock import patch

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import notifications as notif

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("NEXT_PUBLIC_API_URL") or "http://localhost:8001"
API = f"{BASE_URL.rstrip('/')}/api"

_MONGO_URL = os.environ["MONGO_URL"]
_DB_NAME = os.environ.get("DB_NAME", "lokl_dev")
_WEBHOOK_SECRET = os.environ.get("GUPSHUP_WEBHOOK_SECRET", "")


def _mongo_db():
    return MongoClient(_MONGO_URL)[_DB_NAME]


def _notifications_coll():
    return _mongo_db().gupshup_notifications


def _gupshup_env(**extra):
    base = {
        "GUPSHUP_API_KEY": "test-key",
        "GUPSHUP_WHATSAPP_NUMBER": "919999999999",
        "GUPSHUP_APP_NAME": "LoklTest",
    }
    base.update(extra)
    return base


def _mock_resp(status_code, json_body):
    class _Resp:
        def __init__(self):
            self.status_code = status_code
            self.content = b"1" if json_body is not None else b""
        def json(self):
            return json_body or {}
    return _Resp()


def _send_direct(status_code, json_body, *, message_type="merchant_new_order", to="9876543210"):
    def _post(url, data=None, headers=None, timeout=None):
        return _mock_resp(status_code, json_body)
    provider = notif.GupshupProvider()
    with patch.dict(os.environ, _gupshup_env(), clear=False), \
         patch("requests.post", side_effect=_post):
        result = provider.send_whatsapp(
            to, "ignored", template_id="tpl-x",
            template_params={"1": "AAA"}, message_type=message_type,
        )
    return result, provider.last_result


@contextmanager
def _seeded_row(gs_id, *, notification_type="merchant_new_order", phone="9876543210",
                 order_id=None, status="submitted"):
    """Inserts a row shaped exactly like _record_gupshup_submission's own
    insert, so _handle_message_event's downstream find_one/update_one see
    a realistic document. Always deletes it on exit."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    coll = _notifications_coll()
    coll.insert_one({
        "provider": "gupshup",
        "gupshup_message_id": gs_id,
        "notification_type": notification_type,
        "recipient_phone": phone,
        "status": status,
        "order_id": order_id,
        "failure_code": None,
        "failure_reason": None,
        "sent_at": None,
        "delivered_at": None,
        "read_at": None,
        "failed_at": None,
        "created_at": now,
        "updated_at": now,
    })
    try:
        yield gs_id
    finally:
        coll.delete_one({"gupshup_message_id": gs_id})


def _send_message_event(*, event_type, gs_id=None, id_=None, detail=None, secret=None):
    payload = {"type": event_type, "destination": "919876543210"}
    if gs_id is not None:
        payload["gsId"] = gs_id
    if id_ is not None:
        payload["id"] = id_
    if detail is not None:
        payload["payload"] = detail
    body = {"app": "Shoplokl", "timestamp": 1, "version": 2, "type": "message-event", "payload": payload}
    hdr_secret = _WEBHOOK_SECRET if secret is None else secret
    return requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                          headers={"X-Lokl-Webhook-Secret": hdr_secret}, timeout=15)


def _requires_live_server():
    if not _WEBHOOK_SECRET:
        pytest.skip("GUPSHUP_WEBHOOK_SECRET not configured in this environment")
    try:
        requests.get(f"{API.rsplit('/api', 1)[0]}/", timeout=3)
    except Exception:
        pass  # health path may not exist; the actual webhook POST below is the real check


# ============================================================================
# PART 1 — outbound submission persistence (notifications.py)
# ============================================================================

def test_a_successful_submission_creates_notification_record():
    result, last = _send_direct(202, {"status": "submitted", "messageId": f"t-{uuid.uuid4().hex}"})
    assert result is not None
    coll = notif._gupshup_notifications_collection()
    doc = coll.find_one({"gupshup_message_id": last["message_id"]})
    try:
        assert doc is not None
        assert doc["provider"] == "gupshup"
        assert doc["status"] == "submitted"
        assert doc["notification_type"] == "merchant_new_order"
        assert doc["recipient_phone"] == "919876543210"
        assert doc["order_id"] is None
        assert doc["created_at"] is not None
        assert doc["updated_at"] is not None
        for field in ("sent_at", "delivered_at", "read_at", "failed_at", "failure_code", "failure_reason"):
            assert doc[field] is None
    finally:
        coll.delete_one({"gupshup_message_id": last["message_id"]})


def test_b_missing_message_id_does_not_create_record():
    before = _notifications_coll().count_documents({})
    result, last = _send_direct(202, {"status": "submitted"})
    assert result is None
    after = _notifications_coll().count_documents({})
    assert after == before


def test_c_http_error_does_not_create_record():
    before = _notifications_coll().count_documents({})
    result, last = _send_direct(500, {"status": "error", "message": "internal error"})
    assert result is None
    after = _notifications_coll().count_documents({})
    assert after == before


def test_notification_type_and_phone_preserved_no_message_body_persisted():
    gs_id = f"t-{uuid.uuid4().hex}"
    result, last = _send_direct(202, {"status": "submitted", "messageId": gs_id}, message_type="order_placed", to="9123456789")
    coll = notif._gupshup_notifications_collection()
    doc = coll.find_one({"gupshup_message_id": gs_id})
    try:
        assert doc["notification_type"] == "order_placed"
        assert doc["recipient_phone"] == "919123456789"
        for forbidden in ("body", "message", "params", "template_params", "template_id"):
            assert forbidden not in doc, f"unexpected field persisted: {forbidden}"
    finally:
        coll.delete_one({"gupshup_message_id": gs_id})


# ============================================================================
# PART 2 — inbound message-event webhook processing (routes/whatsapp.py)
# ============================================================================

def setup_module(module):
    _requires_live_server()


def test_e_sent_event_updates_submitted_to_sent():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="sent", gs_id=gs_id, detail={"ts": 1700000000000})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "sent"
        assert doc["sent_at"] is not None


def test_f_delivered_event_updates_sent_to_delivered():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="sent"):
        resp = _send_message_event(event_type="delivered", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered"
        assert doc["delivered_at"] is not None


def test_g_delivered_event_updates_submitted_to_delivered():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="delivered", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered"


def test_h_read_event_updates_delivered_to_read():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="delivered"):
        resp = _send_message_event(event_type="read", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read"
        assert doc["read_at"] is not None


def test_i_read_event_updates_submitted_to_read():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="read", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read"


def test_j_out_of_order_sent_after_delivered_does_not_downgrade():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="delivered"):
        resp = _send_message_event(event_type="sent", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered", "a late 'sent' must never downgrade an already-delivered status"
        assert doc["sent_at"] is not None, "the sent_at timestamp is still recorded even though status doesn't change"


def test_k_out_of_order_delivered_after_read_does_not_downgrade():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="read"):
        resp = _send_message_event(event_type="delivered", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read", "a late 'delivered' must never downgrade an already-read status"
        assert doc["delivered_at"] is not None


def test_l_failed_event_stores_failure_code_and_reason():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1002", "reason": "INVALID_NUMBER"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"
        assert doc["failure_code"] == "1002"
        assert doc["failure_reason"] == "INVALID_NUMBER"
        assert doc["failed_at"] is not None


def test_m_async_failed_event_uses_gsid():
    gs_id = f"t-{uuid.uuid4().hex}"
    other_id = f"other-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, id_=other_id, detail={"reason": "async-fail"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed", "must correlate via gsId, not id, when both are present"


def test_n_sync_failed_event_uses_id():
    sync_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(sync_id, status="submitted"):
        resp = _send_message_event(event_type="failed", id_=sync_id, detail={"reason": "sync-fail"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": sync_id})
        assert doc["status"] == "failed", "must fall back to id when gsId is absent (sync failure)"


# ============================================================================
# PART 2b — failed-event semantics (2026-09 final-review addendum).
#
# The review asked to pin down exactly what happens to status + failure
# metadata across every submitted/sent/delivered/read -> failed sequence,
# and the reverse (failed -> a later sent/delivered/read). That second
# direction surfaced a real bug: "failed" was absent from _STATUS_RANK, so
# `.get(status, 0)` treated an already-failed record as rank 0 (same as
# "submitted"), letting a late delivered/read event silently flip status
# back to "delivered"/"read" while failure_code/failure_reason/failed_at
# stayed populated underneath it. Fixed by ranking "failed" above "read"
# (terminal). These tests pin both directions.
# ============================================================================

def test_sequence_a_submitted_then_failed():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"
        assert doc["failure_code"] == "1" and doc["failure_reason"] == "r" and doc["failed_at"] is not None


def test_sequence_b_sent_then_failed():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="sent"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"
        assert doc["failure_code"] == "1" and doc["failure_reason"] == "r" and doc["failed_at"] is not None


def test_sequence_c_delivered_then_failed_stays_delivered_no_metadata_written():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="delivered"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered", "a failed event must never overwrite an already-delivered status"
        assert doc["failure_code"] is None and doc["failure_reason"] is None and doc["failed_at"] is None, \
            "no failure metadata should be written once status has reached delivered — would be misleading"


def test_sequence_d_read_then_failed_stays_read_no_metadata_written():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="read"):
        resp = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read", "a failed event must never overwrite an already-read status"
        assert doc["failure_code"] is None and doc["failure_reason"] is None and doc["failed_at"] is None


def test_sequence_e_submitted_delivered_then_failed():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        assert _send_message_event(event_type="delivered", gs_id=gs_id).status_code == 200
        assert _send_message_event(event_type="failed", gs_id=gs_id, detail={"reason": "r"}).status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered"
        assert doc["failure_reason"] is None


def test_sequence_f_submitted_read_then_failed():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        assert _send_message_event(event_type="delivered", gs_id=gs_id).status_code == 200
        assert _send_message_event(event_type="read", gs_id=gs_id).status_code == 200
        assert _send_message_event(event_type="failed", gs_id=gs_id, detail={"reason": "r"}).status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read"
        assert doc["failure_reason"] is None


def test_duplicate_failed_events_are_idempotent():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        r1 = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        r2 = _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"})
        assert r1.status_code == 200 and r2.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"
        assert doc["failure_code"] == "1" and doc["failure_reason"] == "r"


def test_failed_then_delivered_does_not_revert_status_or_clear_failure():
    """The bug this review turn found and fixed: once failed, a later
    (out-of-order/duplicate-webhook) delivered event must not flip status
    back to 'delivered' while leaving failure_code/reason/failed_at set."""
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        assert _send_message_event(event_type="failed", gs_id=gs_id, detail={"code": "1", "reason": "r"}).status_code == 200
        assert _send_message_event(event_type="delivered", gs_id=gs_id).status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed", "failed must be terminal — a later delivered event must not revert it"
        assert doc["failure_code"] == "1" and doc["failure_reason"] == "r"


def test_failed_then_read_does_not_revert_status():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        assert _send_message_event(event_type="failed", gs_id=gs_id, detail={"reason": "r"}).status_code == 200
        assert _send_message_event(event_type="read", gs_id=gs_id).status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"


def test_failed_then_sent_does_not_revert_status():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        assert _send_message_event(event_type="failed", gs_id=gs_id, detail={"reason": "r"}).status_code == 200
        assert _send_message_event(event_type="sent", gs_id=gs_id).status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "failed"


def test_o_unknown_message_id_returns_200_and_creates_no_record():
    gs_id = f"t-unknown-{uuid.uuid4().hex}"
    before = _notifications_coll().count_documents({})
    resp = _send_message_event(event_type="delivered", gs_id=gs_id)
    assert resp.status_code == 200
    after = _notifications_coll().count_documents({})
    assert after == before
    assert _notifications_coll().find_one({"gupshup_message_id": gs_id}) is None


def test_p_duplicate_delivered_event_is_idempotent():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        resp1 = _send_message_event(event_type="delivered", gs_id=gs_id)
        resp2 = _send_message_event(event_type="delivered", gs_id=gs_id)
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "delivered"


def test_q_delivered_followed_by_read_both_process():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted"):
        r1 = _send_message_event(event_type="delivered", gs_id=gs_id)
        r2 = _send_message_event(event_type="read", gs_id=gs_id)
        assert r1.status_code == 200 and r2.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["status"] == "read"
        assert doc["delivered_at"] is not None
        assert doc["read_at"] is not None


def test_order_id_preserved_where_available():
    gs_id = f"t-{uuid.uuid4().hex}"
    with _seeded_row(gs_id, status="submitted", order_id="o-test-order-xyz"):
        resp = _send_message_event(event_type="delivered", gs_id=gs_id)
        assert resp.status_code == 200
        doc = _notifications_coll().find_one({"gupshup_message_id": gs_id})
        assert doc["order_id"] == "o-test-order-xyz"


def test_r_existing_message_type_flow_still_works():
    """Not a full re-test of the product-addition flow (already covered by
    TestWhatsAppCreationUnaffected in test_admin_product_creation.py) —
    just confirms the type=="message" branch is still reachable and still
    200s after the new message-event branch was added above it."""
    body = {
        "app": "Shoplokl", "timestamp": 1, "version": 2, "type": "message",
        "payload": {
            "id": uuid.uuid4().hex, "source": "919999900001", "type": "text",
            "payload": {"text": "hello"},
            "sender": {"phone": "919999900001", "name": "T", "country_code": "91", "dial_code": "9999900001"},
        },
    }
    resp = requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                          headers={"X-Lokl-Webhook-Secret": _WEBHOOK_SECRET}, timeout=15)
    assert resp.status_code == 200


def test_s_unknown_top_level_type_returns_200():
    body = {"app": "Shoplokl", "timestamp": 1, "version": 2, "type": "user-event", "payload": {}}
    resp = requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                          headers={"X-Lokl-Webhook-Secret": _WEBHOOK_SECRET}, timeout=15)
    assert resp.status_code == 200


@pytest.mark.parametrize("bad_payload", [None, "not-an-object", 42, ["a", "list"]])
def test_t_malformed_message_event_returns_200_without_crashing(bad_payload):
    body = {"app": "Shoplokl", "timestamp": 1, "version": 2, "type": "message-event", "payload": bad_payload}
    resp = requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                          headers={"X-Lokl-Webhook-Secret": _WEBHOOK_SECRET}, timeout=15)
    assert resp.status_code == 200


def test_u_missing_webhook_secret_returns_403():
    body = {"app": "Shoplokl", "timestamp": 1, "version": 2, "type": "message-event",
            "payload": {"type": "delivered", "gsId": "irrelevant"}}
    resp = requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                          headers={"X-Lokl-Webhook-Secret": "wrong-secret"}, timeout=15)
    assert resp.status_code == 403


def test_v_message_event_processing_never_calls_notify_or_send_functions():
    """Structural check (source-level, matching this test file's own
    'single call site' pattern elsewhere in this suite): the delivery-
    tracking block must never call any notify_*/send_whatsapp/send_sms/
    send_with_fallback function — no retries, no SMS fallback, no other-
    channel notification of any kind for a delivery-status event."""
    src_path = os.path.join(os.path.dirname(__file__), "..", "routes", "whatsapp.py")
    with open(src_path) as f:
        src = f.read()
    start = src.index("# Outbound message-event (delivery-status) handling")
    end = src.index('@router.post("/inbound")')
    block = src[start:end]
    for forbidden in ("notify_", "send_whatsapp(", "send_sms(", "send_with_fallback("):
        assert forbidden not in block, f"delivery-status handling must never call {forbidden} — found a reference"
