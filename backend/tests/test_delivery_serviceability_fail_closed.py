"""Phase 9B — delivery serviceability fail-closed fix.

Regression tests for the P0 finding from the read-only delivery
serviceability audit: `_address_is_serviceable()` (server.py) used to
FAIL OPEN — a delivery address with neither a pincode nor lat/lng was
treated as "serviceable" by default. Because `OrderCreate.address` is an
untyped dict with no required sub-fields, a direct API caller (bypassing
the frontend entirely — frontend validation is UX, not a security
boundary) could place a real delivery order for any address anywhere by
omitting pincode/lat/lng and only claiming `city: "bhilai"`.

This file proves, against a live local MongoDB, calling `server.create_order`
directly (same in-process convention as test_pay_at_delivery_and_location.py
Part 2 — a direct Python call, not an HTTP request, so this exercises the
exact same code a real API caller would hit while bypassing the frontend
entirely) that:

  1. The gate is now fail-CLOSED: missing/malformed/one-sided location
     information rejects the order rather than defaulting to serviceable.
  2. The legitimate pincode-only (no-GPS) path still works.
  3. The legitimate lat/lng-pin path still works, and a pin outside the
     delivery polygon is still rejected.
  4. `line1` is now required server-side for delivery orders (previously
     frontend-only).
  5. The store-reachability check (Phase 9B Rule 6) now runs per-store for
     multi-merchant carts, not just single-store carts.
  6. COD and Razorpay orders hit the identical gate, in the same place,
     before any payment-method branching.
  7. No prior /delivery/estimate or /delivery/check-serviceability result
     can substitute for the check `create_order` runs on the address
     actually submitted with the order.
  8. The gate rejects BEFORE `db.orders.insert_one` is ever called —
     Not just "the HTTP response is a 400" but "no order document exists".

Run with: cd backend && python3.11 -m pytest tests/test_delivery_serviceability_fail_closed.py -v
Requires a reachable MONGO_URL (local dev Mongo) — DB-backed tests skip
cleanly if unreachable, matching every other file in this suite.
"""
import os
import sys
import uuid
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


# Known-good fixture coordinates, verified directly against the running
# polygon/radius logic before being hardcoded here (see the audit-fix
# session notes) — not guessed:
#   - BHILAI_LAT/BHILAI_LNG (server.py) and (21.19, 81.33) are both inside
#     BHILAI_DELIVERY_POLYGON and within delivery_config's
#     max_delivery_radius_km (15km) of the centroid.
#   - (12.9716, 77.5946) — Bangalore — is outside the polygon.
#   - (22.5, 83.0) is outside the polygon AND ~224km from the centroid
#     (>> 15km max_delivery_radius_km), so it is unreachable by BOTH the
#     address-level polygon check and the store-radius check.
IN_ZONE_LAT, IN_ZONE_LNG = 21.190001, 81.330002
OUT_OF_ZONE_LAT, OUT_OF_ZONE_LNG = 12.9716, 77.5946
FAR_STORE_LAT, FAR_STORE_LNG = 22.5, 83.0
VALID_PINCODE = "490020"
INVALID_PINCODE = "560001"  # Bangalore pincode — not in BHILAI_PINCODES


async def _seed_merchant_and_store(db, mid, phone, *, lat=21.19, lng=81.33, name="Test Store"):
    """Same shape as test_pay_at_delivery_and_location.py's helper of the
    same name (kept self-contained here rather than cross-imported, so
    this file has no import-order dependency on another test module) —
    a real, KYC-approved, published, online store + product, required for
    create_order's own store-availability pre-check to ever let a request
    reach the serviceability logic under test."""
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    store_id = f"store-m-{mid}"
    pid = f"prod-svc-{mid}"
    await db.merchants.insert_one({
        "id": mid, "email": f"{mid}@test.lokl", "store_name": name,
        "owner_name": "Test Owner", "phone": phone, "city": "Bhilai",
        "kyc_status": "approved", "plan": "free", "created_at": now_iso,
    })
    await db.stores.insert_one({
        "id": store_id, "merchant_id": mid, "name": name,
        "kyc_status": "approved", "published": True, "paused": False, "is_deleted": False,
        "online": True, "lat": lat, "lng": lng,
    })
    await db.products.insert_one({
        "id": pid, "merchant_id": mid, "store_id": store_id, "store_name": name,
        "name": "Test Item", "price": 299.0, "mrp": 299.0, "l1_id": "l1-men",
        "stock": {"default": 100}, "is_deleted": False, "paused": False,
        "try_at_doorstep": True, "created_at": now_iso,
    })
    return store_id, pid


async def _cleanup(db, *, phones=(), mids=(), sids=(), pids=()):
    for phone in phones:
        await db.orders.delete_many({"customer.phone": srv._normalize_customer_phone(phone)})
    for mid in mids:
        await db.merchants.delete_one({"id": mid})
    for sid in sids:
        await db.stores.delete_one({"id": sid})
    for pid in pids:
        await db.products.delete_one({"id": pid})


def _order(*, phone, pid, mid, store_id, address, payment_method="COD"):
    return srv.OrderCreate(
        items=[{
            "id": pid, "name": "Test Item", "price": 299.0, "qty": 1,
            "merchant_id": mid, "store_id": store_id,
        }],
        address=address,
        total=299.0,
        payment_method=payment_method,
        customer={"name": address.get("name", "Tester"), "phone": phone},
    )


def _base_addr(**overrides):
    addr = {"name": "Tester", "line1": "Sector 10", "city": "Bhilai", "phone": "9199999999"}
    addr.update(overrides)
    return addr


class TestFailClosedGate:
    """Tests 1-13, 19: the core P0 fix — no address information that fails
    to positively establish serviceability may result in an order."""

    def _run_rejected(self, address, payment_method="COD"):
        """Shared driver: seed a real merchant/store/product, submit the
        given address, assert a 400 whose detail is the location/address
        gate (not some unrelated 400), and assert NO order document was
        ever inserted for this customer."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid,
                                  address=address, payment_method=payment_method)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                detail = exc.value.detail.lower()
                assert ("delivery" in detail or "pincode" in detail or "address" in detail), \
                    f"expected a location/address rejection, got: {exc.value.detail!r}"
                n = await db.orders.count_documents({"customer.phone": srv._normalize_customer_phone(phone)})
                assert n == 0, "an order was inserted despite an unserviceable/incomplete address"
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())

    def test_1_city_only_rejected(self):
        """Required test #1 — city only, nothing else identifying a
        location. Trips the new server-side line1 requirement first (both
        gates are fail-closed; either is a legitimate 400)."""
        self._run_rejected(_base_addr(line1=""))

    def test_2_city_and_line1_no_pincode_no_coords_rejected(self):
        """Required test #2 — THE core P0 regression case: a fully-formed-
        looking address (city + street line) with pincode and lat/lng both
        entirely absent. Pre-fix, this was the exact fail-open path."""
        self._run_rejected(_base_addr())  # no pincode, no lat, no lng keys at all

    def test_3_valid_bhilai_pincode_no_coordinates_allowed(self):
        """Required test #3 — the legitimate no-GPS path must keep working."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                addr = _base_addr(pincode=VALID_PINCODE)
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["id"]
                assert order["address"]["pincode"] == VALID_PINCODE
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())

    def test_4_invalid_pincode_rejected(self):
        """Required test #4."""
        self._run_rejected(_base_addr(pincode=INVALID_PINCODE))

    def test_5_valid_coordinates_inside_polygon_allowed(self):
        """Required test #5."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                addr = _base_addr(lat=IN_ZONE_LAT, lng=IN_ZONE_LNG)
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["id"]
                assert order["address"]["lat"] == IN_ZONE_LAT
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())

    def test_6_valid_coordinates_outside_polygon_rejected(self):
        """Required test #6."""
        self._run_rejected(_base_addr(lat=OUT_OF_ZONE_LAT, lng=OUT_OF_ZONE_LNG))

    def test_7_lat_without_lng_rejected(self):
        """Required test #7 — a one-sided pin must reject outright, never
        silently fall back to a pincode check (even though no pincode is
        supplied here either, this specifically proves the one-sided-pin
        branch itself rejects rather than falling through)."""
        self._run_rejected(_base_addr(lat=IN_ZONE_LAT))

    def test_8_lng_without_lat_rejected(self):
        """Required test #8."""
        self._run_rejected(_base_addr(lng=IN_ZONE_LNG))

    def test_9_null_coordinates_cannot_bypass(self):
        """Required test #9 — explicit None (as opposed to an absent key)
        must behave identically to an absent key, not be mistaken for a
        distinct 'attempted' value."""
        self._run_rejected(_base_addr(lat=None, lng=None, pincode=None))

    def test_10_empty_string_coordinates_cannot_bypass(self):
        """Required test #10."""
        self._run_rejected(_base_addr(lat="", lng=""))

    def test_11_malformed_coordinates_cannot_bypass(self):
        """Required test #11 — non-numeric strings."""
        self._run_rejected(_base_addr(lat="not-a-number", lng="also-not-a-number"))

    def test_12a_nan_string_coordinates_rejected(self):
        """Required test #12 (part a). `address` is an untyped dict, so an
        in-process caller (same trust level as a direct API caller — real
        JSON has no NaN/Infinity literals, but Python's own float() parses
        the strings "nan"/"inf", which is exactly what a raw HTTP body
        could contain as text and this endpoint must still reject) can
        hand these values exactly as a raw request body might.

        Split into three separate test methods (12a/12b/12c) rather than
        three calls in one test body — each `_run_rejected` call does its
        own `asyncio.run()`, and this suite's conftest rebinds the Motor
        client's event-loop-bound internals once per TEST FUNCTION (see
        conftest.py's docstring); calling it more than once per test hits
        that same 'Event loop is closed' issue conftest exists to avoid,
        just triggered intra-test instead of inter-test."""
        self._run_rejected(_base_addr(lat="nan", lng="inf"))

    def test_12b_nan_float_coordinates_rejected(self):
        """Required test #12 (part b) — actual Python float('nan')/inf."""
        self._run_rejected(_base_addr(lat=float("nan"), lng=float("inf")))

    def test_12c_out_of_range_coordinates_rejected(self):
        """Required test #12 (part c) — not NaN, but still must reject."""
        self._run_rejected(_base_addr(lat=100.0, lng=200.0))

    def test_13_direct_api_style_payload_bypassing_frontend_rejected(self):
        """Required test #13 — explicitly named to document that this is
        exactly what a curl/HTTP client hitting POST /api/orders directly
        (never touching checkout/page.tsx's own client-side checks) would
        send. Every other rejection test in this class already IS this
        scenario (create_order is called directly, with no frontend
        involved at all) — this one exists so that fact is asserted by
        name, not just implied."""
        self._run_rejected({"city": "bhilai", "line1": "Anywhere"})

    def test_19a_missing_line1_empty_string_rejected(self):
        """Required test #19 (part a) — line1 is required server-side now,
        verified independently of the pincode/coordinate logic (a fully
        valid pincode, but no street line, must still 400). Split from
        19b for the same intra-test event-loop reason as test_12 above."""
        self._run_rejected(_base_addr(line1="", pincode=VALID_PINCODE))

    def test_19b_missing_line1_none_rejected(self):
        """Required test #19 (part b) — line1 explicitly None, not just an
        empty string, must be treated identically."""
        self._run_rejected(_base_addr(line1=None, pincode=VALID_PINCODE))


class TestSameGateForBothPaymentMethods:
    """Required tests #14, #15 — COD and Razorpay must hit the identical
    check, in the identical place (before any payment-method branching)."""

    def test_14_cod_enforces_serviceability(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                addr = _base_addr()  # no pincode/coords
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid,
                                  address=addr, payment_method="COD")
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())

    def test_15_razorpay_enforces_identical_serviceability_before_payment_gate(self):
        """The serviceability check runs BEFORE the PAY_ONLINE_ENABLED gate
        (server.py: the address block is at the very top of create_order;
        the `pm in ("razorpay","online") and not PAY_ONLINE_ENABLED` check
        is far later) — so an unserviceable razorpay order must fail with
        the SAME 400 or the location gate, not a payment-disabled 404/503,
        proving the location gate is truly first and universal."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                addr = _base_addr()  # no pincode/coords
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid,
                                  address=addr, payment_method="razorpay")
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                detail = exc.value.detail.lower()
                assert "pay at delivery" not in detail, \
                    "hit the payment-disabled gate instead of the location gate — ordering regressed"
                assert ("delivery" in detail or "pincode" in detail or "address" in detail)
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())


class TestNoStaleTrust:
    """Required tests #16, #17 — the final submitted address is always
    what's evaluated; nothing about an earlier serviceability/estimate
    result for a DIFFERENT address can carry over."""

    def test_16_address_changed_before_order_uses_final_address(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                # Customer's address WAS serviceable a moment ago...
                good_result = await srv.check_serviceability(lat=IN_ZONE_LAT, lng=IN_ZONE_LNG, pincode=None)
                assert good_result["serviceable"] is True
                # ...but the address actually submitted with the order is different and bad.
                addr = _base_addr(lat=OUT_OF_ZONE_LAT, lng=OUT_OF_ZONE_LNG)
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())

    def test_17_prior_deliverable_estimate_cannot_authorize_different_final_address(self):
        """A store-reachability 'deliverable' result computed for the
        legitimate flow (fixed Bhilai centroid, matching what
        /v1/delivery/estimate would have returned) must not leak into or
        substitute for the address-level check run against whatever
        address is actually in the order request."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                from decimal import Decimal
                fee = await srv._delivery_service.calculate_delivery_fee(
                    customer_lat=srv.BHILAI_LAT, customer_lng=srv.BHILAI_LNG,
                    store_lat=21.19, store_lng=81.33,
                    order_subtotal=Decimal("299.00"), city_slug="bhilai",
                )
                assert fee["deliverable"] is True  # the "prior good estimate"
                # The actual order address is unrelated and unserviceable.
                addr = _base_addr()  # no pincode, no coords
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())


class TestMultiMerchantServiceabilityRule:
    """Required test #18 — Phase 9B Rule 6: the store-reachability check is
    a real eligibility gate (it already 400'd single-store orders before
    this fix), so it must now run for every store in a multi-merchant
    cart, not be silently skipped. This does NOT change the free-delivery
    fee policy for multi-store carts — only the reachability gate."""

    def test_18_multi_merchant_cart_with_one_unreachable_store_rejected(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid_a = f"m-svcgate-a-{uuid.uuid4().hex[:8]}"
            mid_b = f"m-svcgate-b-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid_a, pid_a = await _seed_merchant_and_store(db, mid_a, phone, lat=21.19, lng=81.33, name="Near Store")
            sid_b, pid_b = await _seed_merchant_and_store(
                db, mid_b, f"{phone}b", lat=FAR_STORE_LAT, lng=FAR_STORE_LNG, name="Far Store")
            try:
                addr = _base_addr(pincode=VALID_PINCODE)
                payload = srv.OrderCreate(
                    items=[
                        {"id": pid_a, "name": "A", "price": 299.0, "qty": 1, "merchant_id": mid_a, "store_id": sid_a},
                        {"id": pid_b, "name": "B", "price": 299.0, "qty": 1, "merchant_id": mid_b, "store_id": sid_b},
                    ],
                    address=addr, total=598.0, payment_method="COD",
                    customer={"name": "Tester", "phone": phone},
                )
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                n = await db.orders.count_documents({"customer.phone": srv._normalize_customer_phone(phone)})
                assert n == 0, "multi-merchant order was created despite one store being unreachable"
            finally:
                await _cleanup(db, phones=[phone], mids=[mid_a, mid_b], sids=[sid_a, sid_b], pids=[pid_a, pid_b])

        asyncio.run(_run())

    def test_18b_multi_merchant_cart_with_both_stores_reachable_still_allowed_and_free(self):
        """Positive counterpart — proves Rule 6 didn't overcorrect into
        blocking legitimate multi-store carts, and that the existing
        free-delivery-for-multi-store fee policy is untouched."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid_a = f"m-svcgate-c-{uuid.uuid4().hex[:8]}"
            mid_b = f"m-svcgate-d-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid_a, pid_a = await _seed_merchant_and_store(db, mid_a, phone, lat=21.19, lng=81.33, name="Store A")
            sid_b, pid_b = await _seed_merchant_and_store(
                db, mid_b, f"{phone}b", lat=21.20, lng=81.34, name="Store B")
            try:
                addr = _base_addr(pincode=VALID_PINCODE)
                payload = srv.OrderCreate(
                    items=[
                        {"id": pid_a, "name": "A", "price": 299.0, "qty": 1, "merchant_id": mid_a, "store_id": sid_a},
                        {"id": pid_b, "name": "B", "price": 299.0, "qty": 1, "merchant_id": mid_b, "store_id": sid_b},
                    ],
                    address=addr, total=598.0, payment_method="COD",
                    customer={"name": "Tester", "phone": phone},
                )
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["id"]
                assert set(order["merchant_ids"]) == {mid_a, mid_b}
                assert order["delivery_fee"] == 0.0, "multi-store free-delivery policy must be unchanged"
            finally:
                await _cleanup(db, phones=[phone], mids=[mid_a, mid_b], sids=[sid_a, sid_b], pids=[pid_a, pid_b])

        asyncio.run(_run())


class TestExistingLegitimateOrderStillWorks:
    """Required test #20 — sanity check that the fix didn't break the
    ordinary happy path (this mirrors test_1_cod_order_stores_uppercase_cod
    in test_pay_at_delivery_and_location.py, kept here too so this file is
    self-contained and its own pass/fail isn't dependent on another file)."""

    def test_20_legitimate_pincode_order_still_succeeds(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-svcgate-{uuid.uuid4().hex[:8]}"
            phone = f"91900001{str(uuid.uuid4().int)[:4]}"
            sid, pid = await _seed_merchant_and_store(db, mid, phone)
            try:
                addr = _base_addr(pincode=VALID_PINCODE)
                payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
                user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
                order = await srv.create_order(payload, user=user)
                assert order["status"] == "pending_merchant"
                assert order["payment_method"] == "COD"
            finally:
                await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

        asyncio.run(_run())


# ============================================================================
# THE security test
# ============================================================================

def test_order_creation_cannot_fail_open_when_delivery_location_is_missing():
    """Proves the full chain, not just the HTTP-level symptom:

        missing location (direct API-style payload, no frontend involved)
            -> serviceability rejection (HTTPException 400)
            -> db.orders.insert_one is NEVER called

    Patches AsyncIOMotorCollection.insert_one at the CLASS level (motor
    hands back a fresh AsyncIOMotorCollection wrapper on every `db.orders`
    attribute access — confirmed by direct experiment — so an instance-
    level monkeypatch of `db.orders.insert_one` silently does nothing;
    only a class-level patch reliably intercepts the call create_order
    actually makes)."""
    _require_live_db()
    import asyncio
    import motor.motor_asyncio

    async def _run():
        db = srv.db
        mid = f"m-svcgate-sec-{uuid.uuid4().hex[:8]}"
        phone = f"91900001{str(uuid.uuid4().int)[:4]}"
        sid, pid = await _seed_merchant_and_store(db, mid, phone)
        try:
            # Exactly the shape a direct API caller could send — no
            # pincode, no lat/lng, only a city that happens to be valid.
            addr = {"name": "Tester", "line1": "Somewhere", "city": "bhilai", "phone": "9199999999"}
            payload = _order(phone=phone, pid=pid, mid=mid, store_id=sid, address=addr)
            user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
            with patch.object(
                motor.motor_asyncio.AsyncIOMotorCollection, "insert_one", new_callable=AsyncMock
            ) as mock_insert:
                with pytest.raises(srv.HTTPException) as exc:
                    await srv.create_order(payload, user=user)
                assert exc.value.status_code == 400
                mock_insert.assert_not_called(), \
                    "db.orders.insert_one was called despite an unserviceable/incomplete delivery address"
        finally:
            await _cleanup(db, phones=[phone], mids=[mid], sids=[sid], pids=[pid])

    asyncio.run(_run())
