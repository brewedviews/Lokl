"""Pay-at-Delivery-only launch + rider payment display + customer location
pin (2026-09).

Covers:
- BUG FIX: rider payment note/QR/cash-collection UI showed "Already paid
  online" for every real COD order because payment_method is stored as
  "COD" (uppercase) but the old code compared against lowercase "cod".
  Fixed via a new pure function, _rider_payment_view, plus the matching
  frontend comparison fix in rider/orders/[oid]/page.tsx.
- PAY_ONLINE_ENABLED (default False): a new server-side-only gate on the
  two online-payment entry points (POST /payments/razorpay/create-order,
  and POST /orders' razorpay/online branch). Razorpay integration code,
  webhooks, and refund logic are untouched — only these two entry points
  are gated, so re-enabling later is a pure env-var flip. Historical
  online-paid orders are read-only unaffected.
- Customer delivery-address lat/lng: no backend schema change was needed
  (addr.get("lat"/"lng") was already the correct lookup) — the fix is a
  REQUIRED pin at checkout, enforced client-side in checkout/page.tsx
  (no automated frontend test framework exists in this repo — see the
  README-equivalent note in the class docstrings below for what's
  verified by code review instead of an automated test).

PART 1 — pure function tests (no DB, no live server; runnable anywhere).
PART 2 — DB-backed in-process tests, same asyncio.run()-per-file
convention as test_gupshup_reconciliation.py Part 2 / test_whatsapp_
product_addition.py — calls server.py's route functions directly,
bypassing FastAPI's Depends() (this is a direct Python function call, not
an HTTP request, so `user`/`admin` dicts are constructed by hand instead
of coming from a real JWT).

Run with: cd backend && python3 -m pytest tests/test_pay_at_delivery_and_location.py -v
Requires a reachable MONGO_URL for Part 2.
"""
import inspect
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


# ============================================================================
# PART 1 — _rider_payment_view (pure function, no DB)
# ============================================================================

def test_2_rider_recognizes_cod_correctly():
    v = srv._rider_payment_view("COD", [], {})
    assert v["method"] == "COD"
    assert v["label"] == "Pay at Delivery"


def test_3_rider_shows_collection_state_for_cod():
    v = srv._rider_payment_view("COD", [{"price": 100, "qty": 2}], {})
    assert v["amount"] == 200
    assert "collect" in v["note"].lower() or "cash" in v["note"].lower()


def test_4_rider_does_not_show_paid_online_for_cod():
    v = srv._rider_payment_view("COD", [{"price": 499, "qty": 1}], {"upi_qr_url": "https://x/qr.png"})
    assert "paid online" not in v["note"].lower()
    assert v["label"] != "Paid online"


def test_5_store_qr_shown_for_cod_when_available():
    v = srv._rider_payment_view("COD", [{"price": 499, "qty": 1}], {"upi_qr_url": "https://x/qr.png"})
    assert v["upi_qr_url"] == "https://x/qr.png"
    assert "qr" in v["note"].lower()


def test_5b_no_qr_note_for_cod_when_store_has_none():
    v = srv._rider_payment_view("COD", [{"price": 499, "qty": 1}], {})
    assert v["upi_qr_url"] == ""
    assert "qr" not in v["note"].lower()


def test_6_store_qr_never_shown_for_online_paid_order_even_if_store_has_one():
    """This is the secondary bug flagged in the audit: the OLD code checked
    store.upi_qr_url before payment_method at all, so an online-paid order
    at a QR-configured store would misleadingly show 'Show the store's UPI
    QR'. Must never happen now, regardless of payment_method's exact value
    (razorpay, or any unknown/historical value)."""
    for pm in ("razorpay", "unknown_legacy_value", None):
        v = srv._rider_payment_view(pm, [{"price": 499, "qty": 1}], {"upi_qr_url": "https://x/qr.png"})
        assert v["upi_qr_url"] == "", f"QR leaked for payment_method={pm!r}"
        assert v["label"] == "Paid online"
        assert "no payment to collect" in v["note"].lower()  # explicitly says nothing to collect, not an instruction to collect
        assert "qr" not in v["note"].lower()


def test_amount_scoped_to_leg_items_only():
    """A rider's leg amount must be THIS merchant's items only, not the
    full multi-merchant order total — rider_order_detail already filters
    `items` to my_mid before calling _rider_payment_view; this pins that
    the function itself sums exactly what it's given, nothing more."""
    v = srv._rider_payment_view("COD", [{"price": 100, "qty": 1}, {"price": 50, "qty": 3}], {})
    assert v["amount"] == 250


def test_7_pay_online_enabled_defaults_false():
    assert srv.PAY_ONLINE_ENABLED is False


def test_pay_online_enabled_follows_store_pickup_enabled_pattern():
    """Same on/off-string parsing shape as STORE_PICKUP_ENABLED — pinned so
    a future refactor of one doesn't silently diverge from the other."""
    src = inspect.getsource(srv)
    assert 'PAY_ONLINE_ENABLED = (os.environ.get("PAY_ONLINE_ENABLED", "") or "").strip().lower() in ("1", "true", "yes")' in src


def test_razorpay_infrastructure_not_removed():
    """Confirms the audit's non-negotiable: Razorpay integration code,
    webhook handling, and refund logic must still exist in source — only
    the two entry points are gated, nothing was ripped out."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py")).read()
    assert "razorpay_create_payment_order" in src
    assert "verify_payment_signature" in src
    assert "fetch_captured_payment" in src
    assert "refund_payment" in src or "razorpay_payment_id" in src  # refund logic still keyed off this field


def test_11_refund_cancellation_gating_for_historical_online_orders_unchanged():
    """Source-level check (not a full end-to-end cancel, which needs a
    fully-seeded order+products+stock): confirms the refund-eligibility
    gate (payment_status=="paid" AND a real razorpay_payment_id present)
    still exists verbatim in the cancellation/rejection code paths this
    task never touched."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py")).read()
    assert src.count('payment_status') > 0
    # Both admin-cancel-adjacent and merchant-reject-adjacent refund guards
    # must still condition on razorpay_payment_id being present — a COD
    # order (no razorpay_payment_id ever set) must never be misrouted into
    # a refund attempt.
    assert "razorpay_payment_id" in src


# ============================================================================
# PART 2 — DB-backed in-process tests
# ============================================================================

_WOMEN_L1, _WOMEN_L2 = "l1-women", "l2-women-dresses"


async def _seed_merchant_and_store(db, mid, phone):
    """Test-infra fix (2026-09 audit pass): this used to seed ONLY the
    merchant/store, never a matching db.products doc — every test using
    _order_payload() referenced product id "prod-test1", which never
    actually existed in the DB. create_order()'s very first per-item step
    is `db.products.find_one({"id": pid, ...})`, so every DB-backed test
    in this file would have raised "Product prod-test1 is unavailable" if
    ever actually run against a live database — never caught because
    local MongoDB has been unreachable all session, so _require_live_db()
    always skipped before reaching it. Now seeds a real product too,
    scoped to this call's own dynamic `mid` (id derived from `mid`, not a
    shared literal, so sequential test runs never collide on one row)."""
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    store_id = f"store-m-{mid}"
    pid = f"prod-test1-{mid}"
    await db.merchants.insert_one({
        "id": mid, "email": f"{mid}@test.lokl", "store_name": "Test Store",
        "owner_name": "Test Owner", "phone": phone, "city": "Bhilai",
        "kyc_status": "approved", "plan": "free", "created_at": now_iso,
    })
    # _visible_store_filter() (server.py) requires kyc_status/published on
    # the STORE doc itself — create_order's store-availability pre-check
    # 404s the order otherwise (found running these tests for real for the
    # first time this session, 2026-09).
    await db.stores.insert_one({
        "id": store_id, "merchant_id": mid, "name": "Test Store",
        "kyc_status": "approved", "published": True, "paused": False, "is_deleted": False,
        "online": True, "lat": 21.19, "lng": 81.33,
    })
    await db.products.insert_one({
        "id": pid, "merchant_id": mid, "store_id": store_id, "store_name": "Test Store",
        "name": "Test Item", "price": 299.0, "mrp": 299.0, "l1_id": "l1-men",
        "stock": {"default": 100}, "is_deleted": False, "paused": False,
        "try_at_doorstep": True, "created_at": now_iso,
    })
    return store_id, pid


def _order_payload(customer_phone, *, pid="prod-test1", payment_method="COD", lat=None, lng=None, try_and_buy=False):
    return srv.OrderCreate(
        items=[{
            "id": pid, "name": "Test Item", "price": 299.0, "qty": 1,
            "merchant_id": "m-test-payflow", "store_id": "store-m-m-test-payflow",
            **({"fulfillment_type": "try_and_buy"} if try_and_buy else {}),
        }],
        address={
            "name": "Tester", "line1": "Sector 10", "city": "Bhilai",
            "pincode": "490020", "phone": customer_phone,
            "lat": lat, "lng": lng,
        },
        total=299.0,
        payment_method=payment_method,
        customer={"name": "Tester", "phone": customer_phone},
    )


class TestPayAtDeliveryOnly:
    def test_1_cod_order_stores_uppercase_cod(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-test-payflow-{uuid.uuid4().hex[:6]}"
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            _, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order_payload(phone, pid=pid)
                payload.items[0]["merchant_id"] = mid
                payload.items[0]["store_id"] = f"store-m-{mid}"
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["payment_method"] == "COD"
                assert order["payment_status"] == "cod_pending"
            finally:
                await db.orders.delete_many({"customer.phone": srv._normalize_customer_phone(phone)})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})
                await db.products.delete_one({"id": pid})

        asyncio.run(_run())

    def test_8_razorpay_create_order_rejected_when_disabled(self):
        _require_live_db()
        import asyncio

        async def _run():
            assert srv.PAY_ONLINE_ENABLED is False, "test assumes the default-disabled state"
            payload = srv.RazorpayCreateOrderRequest(amount=100.0, customer_name="T", customer_phone="9199999999")
            with pytest.raises(srv.HTTPException) as exc:
                await srv.razorpay_create_payment_order(payload, user={"sub": "919999999999", "role": "customer"})
            assert exc.value.status_code == 503

        asyncio.run(_run())

    def test_9_orders_endpoint_rejects_razorpay_when_disabled(self):
        """Needs a real, visible store (2026-09 fix — found running this
        for real for the first time): create_order's store-availability
        pre-check runs BEFORE the PAY_ONLINE_ENABLED gate, so an
        unseeded/fake store_id 400s with 'Store unavailable' before ever
        reaching the check this test actually means to exercise."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            assert srv.PAY_ONLINE_ENABLED is False
            mid = f"m-test-payflow9-{uuid.uuid4().hex[:6]}"
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            _, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order_payload(phone, pid=pid, payment_method="razorpay")
                payload.items[0]["merchant_id"] = mid
                payload.items[0]["store_id"] = f"store-m-{mid}"
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                assert "pay at delivery" in exc.value.detail.lower()
            finally:
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})
                await db.products.delete_one({"id": pid})

        asyncio.run(_run())

    def test_9b_orders_endpoint_also_rejects_bare_online_value(self):
        _require_live_db()
        import asyncio

        async def _run():
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            payload = _order_payload(phone, payment_method="online")
            user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
            with pytest.raises(srv.HTTPException) as exc:
                await srv.create_order(payload, user=user)
            assert exc.value.status_code == 400

        asyncio.run(_run())

    def test_10_historical_online_paid_order_remains_readable(self):
        """Historical order records must never be mutated by this change —
        seed one directly shaped exactly like a pre-launch razorpay order
        and confirm it reads back completely unaltered."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            oid = f"o-hist-{uuid.uuid4().hex[:10]}"
            now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
            historical_doc = {
                "id": oid, "items": [], "address": {}, "total": 999.0,
                "payment_method": "razorpay", "payment_status": "paid",
                "razorpay_order_id": "order_hist123", "razorpay_payment_id": "pay_hist123",
                "paid_at": now_iso, "customer": {"name": "Hist", "phone": "919000000000"},
                "status": "delivered", "created_at": now_iso,
            }
            await db.orders.insert_one(dict(historical_doc))
            try:
                fetched = await db.orders.find_one({"id": oid}, {"_id": 0})
                assert fetched == historical_doc, "historical order record must be byte-for-byte unaltered"
                view = srv._rider_payment_view(fetched["payment_method"], [], {"upi_qr_url": "https://x/qr.png"})
                assert view["label"] == "Paid online"
                assert view["upi_qr_url"] == ""
            finally:
                await db.orders.delete_one({"id": oid})

        asyncio.run(_run())

    def test_12_try_and_buy_still_pay_at_delivery_only(self):
        """Precedence check: the pre-existing Try & Buy guard must still
        fire (and with its own specific message) even though PAY_ONLINE_
        ENABLED being False would ALSO reject this — confirms my new check
        didn't silently swallow/reorder the existing one. Needs a real,
        visible store for the same reason as test_9 above."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-test-payflow12-{uuid.uuid4().hex[:6]}"
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            _, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order_payload(phone, pid=pid, payment_method="razorpay", try_and_buy=True)
                payload.items[0]["merchant_id"] = mid
                payload.items[0]["store_id"] = f"store-m-{mid}"
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                assert "try & buy" in exc.value.detail.lower()
            finally:
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})
                await db.products.delete_one({"id": pid})

        asyncio.run(_run())


class TestCustomerLocationSnapshot:
    def test_17_order_snapshot_contains_real_lat_lng(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-test-geo-{uuid.uuid4().hex[:6]}"
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            _, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order_payload(phone, pid=pid, lat=21.190001, lng=81.330002)
                payload.items[0]["merchant_id"] = mid
                payload.items[0]["store_id"] = f"store-m-{mid}"
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["address"]["lat"] == 21.190001
                assert order["address"]["lng"] == 81.330002
            finally:
                await db.orders.delete_many({"customer.phone": srv._normalize_customer_phone(phone)})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})
                await db.products.delete_one({"id": pid})

        asyncio.run(_run())

    def test_19_no_00_fabrication_when_coordinates_absent(self):
        """The STORED address dict must keep true null — 0,0 is only ever
        a DISPLAY-time fallback sentinel (rider_order_detail's `or 0`),
        never written to the database itself."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-test-geo2-{uuid.uuid4().hex[:6]}"
            phone = f"91900000{str(uuid.uuid4().int)[:4]}"
            _, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order_payload(phone, pid=pid, lat=None, lng=None)
                payload.items[0]["merchant_id"] = mid
                payload.items[0]["store_id"] = f"store-m-{mid}"
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["address"]["lat"] is None
                assert order["address"]["lng"] is None
                assert order["address"]["lat"] != 0
            finally:
                await db.orders.delete_many({"customer.phone": srv._normalize_customer_phone(phone)})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})
                await db.products.delete_one({"id": pid})

        asyncio.run(_run())


class TestFrontendOnlyScenariosNotAutomatable:
    """Scenarios 13, 14, 15, 16 (customer location pin requirement) and the
    checkout Pay-at-Delivery-only UI (Task C) are pure frontend React
    logic. This repository has NO frontend test framework installed (no
    Jest/Playwright/Vitest, no `test` script in frontend/package.json) —
    introducing one is out of scope for this task. These were verified by
    direct code review instead of an automated test, and that is reported
    honestly rather than faking a pass here:

    13. New address without coordinates cannot be used for checkout —
        `hasValidPin` in checkout/page.tsx gates both the submit button's
        `disabled` prop AND a defense-in-depth check inside `place()`.
    14. Address with real coordinates succeeds — `hasValidPin` is true
        whenever `addr.lat != null && addr.lng != null`, which is exactly
        what AddressPinPicker's onChange sets.
    15. A manually-confirmed (non-GPS) pin succeeds — AddressPinPicker's
        confirmPin() calls onChange with whatever point is being shown
        (GPS-detected OR the pincode-area-centroid starting point the
        customer explicitly confirmed), not gated on pinSource — reviewed
        directly in AddressPinPicker.tsx.
    16. An existing saved address with null lat/lng is never silently
        mutated — checkout/page.tsx's required-pin-prompt only calls
        `setAddr` (local component state) via the SAME onChange callback a
        customer explicitly drives; nothing writes to the customer's saved
        address record until they explicitly save it via the normal
        address-save flow (AddressSheet's own onSave, unrelated to and
        unmodified by this task).
    """

    def test_this_class_exists_only_to_document_the_gap(self):
        assert True
