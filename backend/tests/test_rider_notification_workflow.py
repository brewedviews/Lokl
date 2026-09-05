"""Rider notification workflow redesign (2026-09).

Moves the shared RIDER_PHONE ops number's rider_pickup WhatsApp activation
from merchant acceptance to successful order creation (before any merchant
has acted), so a rider can call the merchant immediately and ask them to
start packing. Adds a NEW rider-cancellation WhatsApp (a brand-new Gupshup
template, GUPSHUP_TEMPLATE_RIDER_DELIVERY_CANCELLED — the existing approved
rider_pickup template is completely untouched, same 8 variables, same
wording) fired for any merchant leg that had already been activated when it
is subsequently cancelled/rejected by the customer, the merchant, an admin,
or the stale-order auto-cancel sweep. Also exposes the merchant's own
db.merchants.phone (never the customer's) via GET /rider/orders/{oid} so an
individually-assigned rider can call ahead.

Idempotency is tracked via a new per-merchant `rider_notified[mid]` marker
on the order document (mirrors the existing merchant_otps/merchant_states
per-mid dict pattern) — every cancellation path checks this before sending
the new cancellation template, so a leg that was never activated (e.g.
Gupshup was down at creation, or it's a pickup order with no rider leg)
never gets a spurious cancellation message.

PART 1 — pure notification-payload + source-structure tests (no DB).
PART 2 — DB-backed in-process tests, same asyncio.run()-per-test convention
as test_pay_at_delivery_and_location.py / test_gupshup_reconciliation.py —
calls server.py's route/helper functions directly, monkeypatching
srv.notify_rider_pickup / srv.notify_rider_cancelled to capture calls
instead of hitting the real Gupshup API.

Run with: cd backend && python3 -m pytest tests/test_rider_notification_workflow.py -v
Requires a reachable MONGO_URL for Part 2.
"""
import os
import sys
import uuid
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv
import notifications as notif


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


# ============================================================================
# PART 1 — pure / source-structure tests (no DB)
# ============================================================================

def _mock_post(captured):
    class _Resp:
        status_code = 202
        content = b"1"
        def json(self):
            return {"status": "success", "messageId": "test-msg-id"}

    def _post(url, data=None, headers=None, timeout=None):
        import json as _json
        captured.append(_json.loads(data["template"]))
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


def _capture(fn, *args, **kwargs):
    captured = []
    env = _gupshup_env(NOTIFICATION_PROVIDER="gupshup",
                        GUPSHUP_TEMPLATE_RIDER_PICKUP="tpl-rider-pickup",
                        GUPSHUP_TEMPLATE_RIDER_DELIVERY_CANCELLED="tpl-rider-cancelled")
    notif._provider_instances.clear()
    with patch.dict(os.environ, env, clear=False), \
         patch("requests.post", side_effect=_mock_post(captured)):
        fn(*args, **kwargs)
    notif._provider_instances.clear()
    return captured[0]["params"] if captured else None


def test_new_rider_cancellation_template_env_var():
    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_delivery_cancelled") == \
        "GUPSHUP_TEMPLATE_RIDER_DELIVERY_CANCELLED"


def test_rider_cancellation_sends_exactly_2_params_order_id_and_store_name():
    """Item 13: the new template carries ONLY the short order id and the
    store name — nothing else."""
    params = _capture(notif.notify_rider_cancelled, "9800000000",
                       order_id="o-lokltest-orderHT62VB", store_name="Sahoo Collection")
    assert params == ["HT62VB", "Sahoo Collection"]


def test_rider_cancellation_excludes_customer_phone_otp_and_refund_info():
    params = _capture(notif.notify_rider_cancelled, "9800000000",
                       order_id="o-lokltest-orderHT62VB", store_name="Sahoo Collection")
    joined = " ".join(params)
    assert "9800000000" not in joined, "rider phone (the recipient itself) must never appear as a param"
    for leaked in ("refund", "OTP", "reject"):
        assert leaked.lower() not in joined.lower()


def test_rider_cancellation_has_exactly_one_call_site():
    import subprocess
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(
        ["grep", "-rn", "send_rider_notification(notify_rider_cancelled, rider_phone,", backend_dir,
         "--include=*.py", "--exclude-dir=tests", "--exclude-dir=__pycache__"],
        capture_output=True, text=True,
    ).stdout
    call_lines = out.splitlines()
    assert len(call_lines) == 1, f"expected exactly one call site (the shared _notify_rider_leg_cancelled helper), found {len(call_lines)}: {call_lines}"
    assert "server.py" in call_lines[0]


def test_existing_rider_pickup_template_completely_unchanged():
    """Confirms the audit correction was honored: the existing APPROVED
    rider_pickup Gupshup template (env var, variable count, variable
    order, wording) is untouched by this redesign — only its TRIGGER
    POINT moved, not the template itself."""
    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_pickup") == "GUPSHUP_TEMPLATE_RIDER_PICKUP"
    kwargs = dict(
        order_id="o-lokltest-orderUH87HI", otp="4821", customer_name="Priya Sharma",
        store_name="Local Store", store_address="New Ruabandha",
        customer_address="Black Shirt", items_summary="1x Kurta",
        store_lat=21.19, store_lng=81.33, customer_lat=21.21, customer_lng=81.35,
    )
    params = _capture(notif.notify_rider_pickup, "9800000000", **kwargs)
    assert len(params) == 8, "approved template still takes exactly 8 variables"
    assert params[0] == "UH87HI"
    assert params[1] == "Local Store"
    assert params[3] == "Priya Sharma"


def test_rider_notified_marker_present_in_order_schema():
    """Source check: create_order's doc construction stamps a fresh, empty
    per-merchant rider_notified dict on every new order — the idempotency
    marker every cancellation path consults."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py")).read()
    assert '"rider_notified": {},' in src


def test_rider_activation_gated_on_non_pickup_order_type():
    """Item 2 (pickup orders have no rider leg): source check that the
    rider_pickup call inside create_order is gated on order_type != 'pickup',
    same guard the existing push-notification call already uses."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py")).read()
    fn_start = src.index("async def create_order")
    fn_end = src.index("\n@api.", fn_start)
    fn_src = src[fn_start:fn_end]
    idx = fn_src.index("notify_rider_pickup,")
    guard_window = fn_src[max(0, idx - 900):idx]
    assert 'order_type != "pickup" and rider_phone' in guard_window


def test_stale_auto_cancel_still_routes_through_shared_cancel_helper():
    """Item 10 (stale-order auto-cancel sweep): _auto_cancel_stale_orders
    is a `while True` background loop that can't be safely invoked
    directly in a test — verified instead by source check that its
    stale-COD-order branch still calls the shared _merchant_cancel_own_slice
    helper (which is what carries the rider-cancellation notify — see the
    DB-backed tests below), same honesty-over-fake-pass approach used
    elsewhere in this test suite for background loops."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py")).read()
    fn_start = src.index("async def _auto_cancel_stale_orders")
    fn_end = src.index("\nasync def fix_store_slugs", fn_start)
    fn_src = src[fn_start:fn_end]
    assert "_merchant_cancel_own_slice(oid, mid, reason)" in fn_src


# ============================================================================
# PART 2 — DB-backed in-process tests
# ============================================================================

async def _seed_merchant_and_store(db, mid, phone, *, store_name="Test Store"):
    """Test-infra fix (2026-09 audit pass): this used to seed ONLY the
    merchant/store, never a matching db.products doc for the item id
    _order_payload() below generates (f"prod-{mid}") — create_order()'s
    first per-item step is a db.products.find_one() lookup, so every
    DB-backed test in this file would have raised "Product unavailable"
    if ever actually run against a live database. Never caught because
    local MongoDB has been unreachable all session (_require_live_db()
    always skipped first). Now seeds a real, correctly-priced product
    too, using the exact same f"prod-{mid}" id _order_payload() already
    references — no call-site changes needed anywhere else in this file."""
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    store_id = f"store-m-{mid}"
    await db.merchants.insert_one({
        "id": mid, "email": f"{mid}@test.lokl", "store_name": store_name,
        "owner_name": "Test Owner", "phone": phone, "business_address": "Shop 1, Test Market",
        "city": "Bhilai", "kyc_status": "approved", "plan": "free", "created_at": now_iso,
    })
    # _visible_store_filter() (server.py) requires kyc_status/published on
    # the STORE doc itself — create_order's store-availability pre-check
    # 400s the order otherwise (found running these tests for real for the
    # first time this session, 2026-09).
    await db.stores.insert_one({
        "id": store_id, "merchant_id": mid, "name": store_name, "lat": 21.19, "lng": 81.33,
        "kyc_status": "approved", "published": True, "paused": False, "is_deleted": False, "online": True,
    })
    await db.products.insert_one({
        "id": f"prod-{mid}", "merchant_id": mid, "store_id": store_id, "store_name": store_name,
        "name": f"Item from {mid}", "price": 199.0, "mrp": 199.0, "l1_id": "l1-men",
        "stock": {"default": 100}, "is_deleted": False, "paused": False, "created_at": now_iso,
    })
    return store_id


def _order_payload(customer_phone, *, mids, payment_method="COD"):
    items = [{
        "id": f"prod-{mid}", "name": f"Item from {mid}", "price": 199.0, "qty": 1,
        "merchant_id": mid, "store_id": f"store-m-{mid}",
    } for mid in mids]
    return srv.OrderCreate(
        items=items,
        address={
            "name": "Tester", "line1": "Sector 10", "city": "Bhilai",
            "pincode": "490020", "phone": customer_phone, "lat": 21.20, "lng": 81.34,
        },
        total=float(199.0 * len(mids)),
        payment_method=payment_method,
        customer={"name": "Tester", "phone": customer_phone},
    )


class _NotifyCapture:
    """Monkeypatches srv.notify_rider_pickup / srv.notify_rider_cancelled
    (the module-level names server.py's own code calls) so no real Gupshup
    request is attempted; records every call for assertion."""

    def __init__(self):
        self.pickup_calls = []
        self.cancel_calls = []

    def __enter__(self):
        self._orig_pickup = srv.notify_rider_pickup
        self._orig_cancel = srv.notify_rider_cancelled
        srv.notify_rider_pickup = lambda rider_phone, **kw: self.pickup_calls.append((rider_phone, kw))
        srv.notify_rider_cancelled = lambda rider_phone, **kw: self.cancel_calls.append((rider_phone, kw))
        return self

    def __exit__(self, *exc):
        srv.notify_rider_pickup = self._orig_pickup
        srv.notify_rider_cancelled = self._orig_cancel


async def _cleanup_order(db, oid, mids):
    await db.orders.delete_one({"id": oid})
    for mid in mids:
        await db.merchants.delete_one({"id": mid})
        await db.stores.delete_one({"id": f"store-m-{mid}"})
        await db.products.delete_one({"id": f"prod-{mid}"})


class TestRiderActivationAtOrderCreation:
    def test_1_sends_rider_pickup_once_per_merchant_leg(self):
        """Item 1 + item 7 (multi-merchant): Store A + Store B → two
        separate rider_pickup activations, each with only that store's own
        data — no combined message, no accidental first-merchant-only bug."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid_a = f"m-ridertest-a-{uuid.uuid4().hex[:6]}"
            mid_b = f"m-ridertest-b-{uuid.uuid4().hex[:6]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid_a, f"9{str(uuid.uuid4().int)[:9]}", store_name="Store A")
            await _seed_merchant_and_store(db, mid_b, f"9{str(uuid.uuid4().int)[:9]}", store_name="Store B")
            with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(_order_payload(phone, mids=[mid_a, mid_b]), user=user)
                try:
                    assert len(cap.pickup_calls) == 2, f"expected exactly 2 activations, got {len(cap.pickup_calls)}"
                    store_names = sorted(kw["store_name"] for _, kw in cap.pickup_calls)
                    assert store_names == ["Store A", "Store B"]
                    for _, kw in cap.pickup_calls:
                        assert kw["order_id"] == order["id"]
                    fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0, "rider_notified": 1})
                    assert fresh["rider_notified"] == {mid_a: True, mid_b: True}
                finally:
                    await _cleanup_order(db, order["id"], [mid_a, mid_b])

        asyncio.run(_run())

    def test_2_merchant_accept_does_not_resend_activation(self):
        """Item 3: merchant acceptance must NOT trigger a second
        notify_rider_pickup for a leg already activated at creation."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-acc-{uuid.uuid4().hex[:6]}"
            phone = f"91900002{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(_order_payload(phone, mids=[mid]), user=user)
                try:
                    assert len(cap.pickup_calls) == 1
                    merchant_user_dict = {"sub": mid, "role": "merchant"}
                    await srv.merchant_accept_order(order["id"], user=merchant_user_dict)
                    assert len(cap.pickup_calls) == 1, "merchant accept must not send a second activation"
                finally:
                    await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_3_gupshup_failure_does_not_fail_order_creation(self):
        """Item 14: order creation itself must succeed even if the rider
        activation send raises."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-fail-{uuid.uuid4().hex[:6]}"
            phone = f"91900003{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            orig = srv.notify_rider_pickup
            srv.notify_rider_pickup = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("simulated Gupshup outage"))
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False):
                    user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                    order = await srv.create_order(_order_payload(phone, mids=[mid]), user=user)
                    assert order["id"], "order creation must succeed despite the notify failure"
                    fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0, "rider_notified": 1})
                    assert not fresh.get("rider_notified", {}).get(mid), \
                        "a failed send must not leave a stale rider_notified=True"
                    await _cleanup_order(db, order["id"], [mid])
            finally:
                srv.notify_rider_pickup = orig

        asyncio.run(_run())


class TestMerchantPhoneInRiderApp:
    def test_4_merchant_phone_returned_by_rider_order_detail(self):
        """Item 4: GET /rider/orders/{oid} exposes the merchant's own
        db.merchants.phone in the pickup section for an assigned rider."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-phone-{uuid.uuid4().hex[:6]}"
            merchant_phone = f"9{str(uuid.uuid4().int)[:9]}"
            cust_phone = f"91900004{str(uuid.uuid4().int)[:4]}"
            rider_id = f"rider-test-{uuid.uuid4().hex[:8]}"
            rider_phone = f"9{str(uuid.uuid4().int)[:9]}"
            await _seed_merchant_and_store(db, mid, merchant_phone)
            now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
            await db.riders.insert_one({
                "id": rider_id, "phone": rider_phone, "name": "Test Rider",
                "status": "active", "online": True, "created_at": now_iso, "updated_at": now_iso,
            })
            with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture():
                cust_user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
                order = await srv.create_order(_order_payload(cust_phone, mids=[mid]), user=cust_user)
                try:
                    rider_user_dict = {"sub": rider_phone, "role": "rider"}
                    await srv.rider_accept_leg(order["id"], mid, user=rider_user_dict)
                    detail = await srv.rider_order_detail(order["id"], user=rider_user_dict)
                    assert detail["pickup"]["phone"] == merchant_phone
                finally:
                    await _cleanup_order(db, order["id"], [mid])
                    await db.riders.delete_one({"id": rider_id})

        asyncio.run(_run())


class TestRiderCancellationTriggers:
    async def _activated_order(self, db, mid, cust_phone, rider_phone_env="919000011111"):
        with patch.dict(os.environ, {"RIDER_PHONE": rider_phone_env}, clear=False), _NotifyCapture() as cap:
            user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
            order = await srv.create_order(_order_payload(cust_phone, mids=[mid]), user=user)
            assert len(cap.pickup_calls) == 1, "precondition: leg must have been activated"
        return order

    def test_5_merchant_rejection_sends_cancellation_if_activated(self):
        """Item 6 (merchant rejects before accepting)."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-rej-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900005{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}", store_name="Reject Store")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    merchant_user_dict = {"sub": mid, "role": "merchant"}
                    await srv.merchant_reject_order(order["id"], _FakeRequest(), payload={"reason": "Out of stock"}, user=merchant_user_dict)
                    assert len(cap.cancel_calls) == 1
                    _, kw = cap.cancel_calls[0]
                    assert kw["order_id"] == order["id"]
                    assert kw["store_name"] == "Reject Store"
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_6_merchant_cancel_after_accept_sends_cancellation_if_activated(self):
        """Item 7 (merchant cancels after accepting, before handoff) — this
        was a PRE-EXISTING gap even before this redesign (the rider was
        already notified on accept, yet never told about a later cancel);
        now fixed as part of moving the trigger."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-mcancel-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900006{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}", store_name="Cancel Store")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                merchant_user_dict = {"sub": mid, "role": "merchant"}
                await srv.merchant_accept_order(order["id"], user=merchant_user_dict)
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    await srv.merchant_cancel_order(order["id"], _FakeRequest(), payload={"reason": "Store closed"}, user=merchant_user_dict)
                    assert len(cap.cancel_calls) == 1
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_7_customer_cancel_before_acceptance_sends_cancellation_if_activated(self):
        """Item 8: order placed → rider activated → customer cancels before
        any merchant accepts — the exact scenario the audit flagged as the
        new gap this redesign introduces if left unhandled."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-ccancel-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900007{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    cust_user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
                    await srv.customer_cancel_order(order["id"], _FakeRequest(), payload={"reason": "Changed my mind"}, user=cust_user)
                    assert len(cap.cancel_calls) == 1
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_8_customer_cancel_after_acceptance_sends_cancellation_if_activated(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-ccancel2-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900008{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                merchant_user_dict = {"sub": mid, "role": "merchant"}
                await srv.merchant_accept_order(order["id"], user=merchant_user_dict)
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    cust_user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
                    await srv.customer_cancel_order(order["id"], _FakeRequest(), payload={"reason": "Changed my mind"}, user=cust_user)
                    assert len(cap.cancel_calls) == 1
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_9_admin_cancel_whole_order_sends_cancellation_if_activated(self):
        """Item 9, whole-order branch."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-admin1-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900009{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    await srv.admin_cancel_order(order["id"], payload={"reason": "Support requested"}, admin={"id": "test-admin"})
                    assert len(cap.cancel_calls) == 1
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_10_admin_cancel_single_merchant_slice_sends_cancellation_if_activated(self):
        """Item 9, target_mid branch — and item 12 (multi-merchant
        isolation): only the targeted leg is notified, the other is not."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid_a = f"m-ridertest-admin2a-{uuid.uuid4().hex[:6]}"
            mid_b = f"m-ridertest-admin2b-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900010{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid_a, f"9{str(uuid.uuid4().int)[:9]}", store_name="Admin Store A")
            await _seed_merchant_and_store(db, mid_b, f"9{str(uuid.uuid4().int)[:9]}", store_name="Admin Store B")
            with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
                order = await srv.create_order(_order_payload(cust_phone, mids=[mid_a, mid_b]), user=user)
                assert len(cap.pickup_calls) == 2
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    await srv.admin_cancel_order(order["id"], payload={"reason": "Store A out of stock", "merchant_id": mid_a}, admin={"id": "test-admin"})
                    assert len(cap.cancel_calls) == 1, "only Store A's leg should be notified"
                    _, kw = cap.cancel_calls[0]
                    assert kw["store_name"] == "Admin Store A"
            finally:
                await _cleanup_order(db, order["id"], [mid_a, mid_b])

        asyncio.run(_run())

    def test_11_leg_never_activated_gets_no_cancellation(self):
        """Negative control: a leg where rider_notified was never set (e.g.
        RIDER_PHONE unset at creation time) must NOT get a cancellation —
        avoids confusing the rider about a delivery they were never told
        about."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-noact-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900011{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            with patch.dict(os.environ, {"RIDER_PHONE": ""}, clear=False), _NotifyCapture() as cap:
                user = {"sub": srv._normalize_customer_phone(cust_phone), "role": "customer"}
                order = await srv.create_order(_order_payload(cust_phone, mids=[mid]), user=user)
                assert len(cap.pickup_calls) == 0, "precondition: no RIDER_PHONE configured, no activation sent"
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    merchant_user_dict = {"sub": mid, "role": "merchant"}
                    await srv.merchant_reject_order(order["id"], _FakeRequest(), payload={"reason": "Busy"}, user=merchant_user_dict)
                    assert len(cap.cancel_calls) == 0, "a never-activated leg must not receive a cancellation notice"
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())

    def test_12_repeated_cancellation_attempt_does_not_duplicate_notification(self):
        """Item 11: the state-transition guards already in
        merchant_reject_order/merchant_cancel_order/customer_cancel_order
        (states.get(mid) != "pending"/"accepted" -> 400) prevent a second
        cancel call on the same leg from ever reaching the notify code —
        confirmed empirically here, not just by static read."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-ridertest-repeat-{uuid.uuid4().hex[:6]}"
            cust_phone = f"91900012{str(uuid.uuid4().int)[:4]}"
            await _seed_merchant_and_store(db, mid, f"9{str(uuid.uuid4().int)[:9]}")
            order = await self._activated_order(db, mid, cust_phone)
            try:
                with patch.dict(os.environ, {"RIDER_PHONE": "919000011111"}, clear=False), _NotifyCapture() as cap:
                    merchant_user_dict = {"sub": mid, "role": "merchant"}
                    await srv.merchant_reject_order(order["id"], _FakeRequest(), payload={"reason": "Busy"}, user=merchant_user_dict)
                    assert len(cap.cancel_calls) == 1
                    with pytest.raises(srv.HTTPException):
                        await srv.merchant_reject_order(order["id"], _FakeRequest(), payload={"reason": "Busy again"}, user=merchant_user_dict)
                    assert len(cap.cancel_calls) == 1, "a rejected-already-cancelled leg must not be double-notified"
            finally:
                await _cleanup_order(db, order["id"], [mid])

        asyncio.run(_run())


def _FakeRequest():
    """A genuine (if minimal) starlette.requests.Request — found running
    these tests for real for the first time (2026-09): customer_cancel_
    order's @_limit(...) rate-limit decorator (slowapi) does an isinstance
    check against starlette.requests.Request, which a duck-typed stand-in
    class fails ('parameter `request` must be an instance of
    starlette.requests.Request'). A bare ASGI scope is enough for both
    slowapi's check and every route function's own request.client.host
    read."""
    from starlette.requests import Request
    return Request({
        "type": "http", "method": "POST", "path": "/",
        "headers": [], "client": ("127.0.0.1", 0), "query_string": b"",
    })
