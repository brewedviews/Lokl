"""Regression tests for the pre-launch security audit fixes (G26).

Unlike the existing `test_*.py` integration suite (which drives the app
over real HTTP against a running server, using admin credentials from
`frontend/.env`), these tests call the FastAPI handler functions directly,
in-process, against the real database connection `server.py` already
uses. This is deliberate, not a shortcut:

  - It requires no admin login (the developer running these tests may
    legitimately not know/have the current admin password — these tests
    must still be runnable).
  - Testing `GET /returns/{rid}`'s per-role authorization branches, and
    the Razorpay amount-mismatch check's dependency on the *external*
    payment gateway's response, are both most precisely and reliably
    tested by constructing the exact `user` dict `get_current_user`/
    `customer_user` would have produced and by monkeypatching the one
    external boundary (`fetch_captured_payment`) rather than either
    trusting a real JWT's plumbing (already covered elsewhere) or
    attempting a real Razorpay sandbox checkout (impractical to automate
    and not necessary — the vulnerability and its fix live entirely in
    how the captured amount is used, not in obtaining one).

Plain synchronous test functions wrapping a single `asyncio.run()` each,
with `server` imported lazily from inside the coroutine — Motor's
AsyncIOMotorClient binds to whichever event loop is running at
construction time, so importing `server` (which constructs it at module
level) before `asyncio.run()` has started a loop breaks every DB call
with a cryptic "coroutine was expected, got Future" error. No
pytest-asyncio is used — it isn't configured (or used) anywhere else in
this suite; every other test file here is synchronous/HTTP-based.

Run with: cd backend && python3 -m pytest tests/test_security_fixes.py -v
Requires a reachable MONGO_URL (same one server.py itself uses) and at
least one approved merchant + one deliverable, in-stock product already
seeded — true of any dev DB that's been used to run the app at all.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# --------------------------------------------------------------------------
# GET /returns/{rid} — was completely unauthenticated (audit finding C-1).
# --------------------------------------------------------------------------

async def _returns_authorization_case():
    import server as srv
    from fastapi import HTTPException

    db = srv.db
    try:
        merchant = await db.merchants.find_one({"kyc_status": "approved"}, {"_id": 0, "id": 1})
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return
    assert merchant, "need at least one approved merchant in the dev DB to run this test"
    mid = merchant["id"]

    cust_phone_a = "9000000001"
    cust_phone_b = "9000000002"
    rider_id_assigned = f"rider-secfix-{uuid.uuid4().hex[:6]}"
    rider_id_other = f"rider-secfix-{uuid.uuid4().hex[:6]}"
    rider_phone_assigned = "9111111111"
    rider_phone_other = "9222222222"
    oid = f"LOKL-SECFIX-{uuid.uuid4().hex[:8].upper()}"
    ret_id = f"RET-SECFIX-{uuid.uuid4().hex[:6].upper()}"

    now = datetime.now(timezone.utc).isoformat()
    await db.orders.insert_one({
        "id": oid, "items": [], "address": {}, "total": 599.0,
        "customer": {"name": "Sec Test", "phone": cust_phone_a},
        "status": "delivered", "merchant_ids": [mid],
        "rider_assignments": {mid: {"rider_id": rider_id_assigned, "accepted_at": now}},
        "is_deleted": False, "created_at": now,
    })
    await db.returns.insert_one({
        "id": ret_id, "order_id": oid, "customer_phone": cust_phone_a,
        "merchant_ids": [mid], "items": [], "reason": "test", "status": "requested",
        "otp": "1234", "created_at": now, "timeline": [],
    })
    await db.riders.insert_one({"id": rider_id_assigned, "phone": rider_phone_assigned, "name": "Rider A", "status": "active"})
    await db.riders.insert_one({"id": rider_id_other, "phone": rider_phone_other, "name": "Rider B", "status": "active"})

    try:
        # Unauthenticated: FastAPI's own Depends(get_current_user) rejects
        # before the handler body ever runs.
        with pytest.raises(HTTPException) as exc:
            await srv.get_current_user(authorization=None)
        assert exc.value.status_code == 401

        # Cross-customer denied.
        with pytest.raises(HTTPException) as exc:
            await srv.get_return(ret_id, {"sub": cust_phone_b, "role": "customer"})
        assert exc.value.status_code == 403

        # Owning customer allowed, OTP stripped.
        r = await srv.get_return(ret_id, {"sub": cust_phone_a, "role": "customer"})
        assert r["id"] == ret_id
        assert "otp" not in r, "customer must never receive the reverse-pickup OTP"

        # Unrelated merchant denied.
        with pytest.raises(HTTPException) as exc:
            await srv.get_return(ret_id, {"sub": "m-unrelated-xyz", "role": "merchant"})
        assert exc.value.status_code == 403

        # Related merchant allowed, OTP stripped.
        r = await srv.get_return(ret_id, {"sub": mid, "role": "merchant"})
        assert r["id"] == ret_id
        assert "otp" not in r, "merchant must never receive the reverse-pickup OTP"

        # Unassigned rider denied.
        with pytest.raises(HTTPException) as exc:
            await srv.get_return(ret_id, {"sub": rider_phone_other, "role": "rider"})
        assert exc.value.status_code == 403

        # Genuinely-assigned rider allowed, OTP included (operationally required).
        r = await srv.get_return(ret_id, {"sub": rider_phone_assigned, "role": "rider"})
        assert r["id"] == ret_id
        assert r.get("otp") == "1234"

        # Admin allowed, OTP included.
        r = await srv.get_return(ret_id, {"sub": "adm-test", "role": "admin", "is_admin": True})
        assert r["id"] == ret_id
        assert r.get("otp") == "1234"
    finally:
        await db.orders.delete_one({"id": oid})
        await db.returns.delete_one({"id": ret_id})
        await db.riders.delete_many({"id": {"$in": [rider_id_assigned, rider_id_other]}})


# --------------------------------------------------------------------------
# POST /orders (razorpay branch) — amount tampering (audit finding C-2).
# --------------------------------------------------------------------------

async def _find_deliverable_product(srv):
    db = srv.db
    stores_geo = await db.stores.find({"lat": {"$ne": None}, "lng": {"$ne": None}}, {"_id": 0, "id": 1}).to_list(20)
    for s in stores_geo:
        p = await db.products.find_one(
            {"store_id": s["id"], "paused": {"$ne": True}, "is_deleted": {"$ne": True}},
            {"_id": 0, "id": 1, "name": 1, "price": 1, "stock": 1, "store_id": 1},
        )
        if p and any(int(q or 0) > 0 for q in (p.get("stock") or {}).values()):
            size = next(sz for sz, q in p["stock"].items() if int(q or 0) > 0)
            return p, size
    return None, None


def _razorpay_payload(srv, product, size, phone_raw):
    return srv.OrderCreate(
        items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
        total=product["price"],
        customer={"name": "Sec Test", "phone": phone_raw},
        address={"name": "Sec Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": phone_raw},
        payment_method="razorpay",
        razorpay_payment_id="pay_test_secfix",
        razorpay_order_id="order_test_secfix",
        razorpay_signature="fake_sig_for_test",
    )


async def _razorpay_amount_verification_case():
    import server as srv
    from fastapi import HTTPException

    try:
        product, size = await _find_deliverable_product(srv)
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return
    if not product:
        pytest.skip("no deliverable, in-stock product with a geolocated store in the dev DB")
        return

    phone_raw = "9000000099"
    user = {"sub": srv._normalize_customer_phone(phone_raw), "role": "customer"}
    orig_verify, orig_fetch = srv.verify_payment_signature, srv.fetch_captured_payment

    try:
        # ---- Scenario A: signature "passes" (mocked), but the captured
        # amount (₹1) doesn't match this real, higher-value cart. ----
        srv.verify_payment_signature = lambda *a, **k: True
        srv.fetch_captured_payment = lambda *a, **k: {"amount": 100, "order_id": "order_test_secfix", "status": "captured"}
        with pytest.raises(HTTPException) as exc:
            await srv.create_order(_razorpay_payload(srv, product, size, phone_raw), user)
        assert exc.value.status_code == 400
        assert "amount" in exc.value.detail.lower()
        assert await srv.db.orders.count_documents({"customer.phone": phone_raw, "payment_status": "paid"}) == 0
        p_after = await srv.db.products.find_one({"id": product["id"]}, {"_id": 0, "stock": 1})
        assert p_after["stock"][size] == product["stock"][size], "stock reservation must roll back on rejected payment"

        # ---- Scenario B: captured amount matches the server-computed
        # total exactly -> order succeeds and is marked paid. ----
        cod = await srv.create_order(srv.OrderCreate(
            items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                    "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
            total=product["price"],
            customer={"name": "Sec Test", "phone": phone_raw},
            address={"name": "Sec Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": phone_raw},
            payment_method="COD",
        ), user)
        expected_paise = int(round(cod["total"] * 100))
        await srv.db.orders.delete_one({"id": cod["id"]})
        await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

        srv.fetch_captured_payment = lambda *a, **k: {"amount": expected_paise, "order_id": "order_test_secfix", "status": "captured"}
        result = await srv.create_order(_razorpay_payload(srv, product, size, phone_raw), user)
        try:
            assert result["payment_status"] == "paid"
        finally:
            await srv.db.orders.delete_one({"id": result["id"]})
            await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

        # ---- Scenario C: Razorpay can't confirm the payment at all ->
        # never silently trust it. ----
        srv.fetch_captured_payment = lambda *a, **k: None
        with pytest.raises(HTTPException) as exc:
            await srv.create_order(_razorpay_payload(srv, product, size, phone_raw), user)
        assert exc.value.status_code == 400
        assert await srv.db.orders.count_documents({"customer.phone": phone_raw, "payment_status": "paid"}) == 0
    finally:
        srv.verify_payment_signature, srv.fetch_captured_payment = orig_verify, orig_fetch
        await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})
        # Scenario B's successful order claims "pay_test_secfix" in
        # processed_payments (reuse-prevention, added in the later
        # adversarial review below) — release it so re-running this test
        # doesn't spuriously fail against its own prior run's claim.
        await srv.db.processed_payments.delete_many({"payment_id": "pay_test_secfix"})


# --------------------------------------------------------------------------
# Deep adversarial re-review (final G26 pass) — found and fixed three
# additional real gaps beyond the original C-2 amount-mismatch fix:
#   1. fetch_captured_payment accepted "authorized" (funds reserved but
#      not yet actually moved) as good enough — an authorization can
#      still fail to capture or expire, meaning an order could be marked
#      paid (and shipped) for money never actually collected.
#   2. Nothing prevented the SAME razorpay_payment_id from being attached
#      to more than one Lokl order — a genuinely captured, amount-matched
#      payment could be replayed against multiple carts. Fixed by wiring
#      up `processed_payments` (a collection + unique index that already
#      existed in this codebase but was never actually used anywhere).
#   3. The reuse-prevention claim needed compensating cleanup: if the
#      claim succeeds but order creation fails afterward for an unrelated
#      reason, a legitimate retry with the same real payment must not be
#      permanently locked out by its own earlier failed attempt.
# --------------------------------------------------------------------------

async def _fetch_captured_payment_status_case():
    """Tests fetch_captured_payment's OWN status-checking logic directly
    (mocking the underlying Razorpay client, not the function itself) —
    mocking fetch_captured_payment as a whole would bypass the exact code
    path being verified here."""
    import services.payment_service as ps

    class FakeClient:
        def __init__(self, response):
            self.payment = self
            self._response = response

        def fetch(self, payment_id):
            return self._response

    orig_get_client = ps._get_client
    try:
        for status, should_pass in [("authorized", False), ("captured", True), ("failed", False), ("refunded", False)]:
            ps._get_client = lambda status=status: FakeClient({"order_id": "order_x", "status": status, "amount": 10000})
            result = ps.fetch_captured_payment("order_x", "pay_x")
            if should_pass:
                assert result is not None and result["amount"] == 10000, f"status={status} should have been accepted"
            else:
                assert result is None, f"status={status} must be rejected — got {result}"

        # order_id mismatch must also be rejected even with status=captured.
        ps._get_client = lambda: FakeClient({"order_id": "order_DIFFERENT", "status": "captured", "amount": 10000})
        assert ps.fetch_captured_payment("order_x", "pay_x") is None
    finally:
        ps._get_client = orig_get_client


async def _razorpay_payment_reuse_case():
    import server as srv
    from fastapi import HTTPException
    from motor.motor_asyncio import AsyncIOMotorCollection

    db = srv.db
    try:
        product, size = await _find_deliverable_product(srv)
    except Exception:
        pytest.skip("MongoDB not reachable from this test runner")
        return
    if not product:
        pytest.skip("no deliverable, in-stock product with a geolocated store in the dev DB")
        return

    phone_raw = "9000000299"
    user = {"sub": srv._normalize_customer_phone(phone_raw), "role": "customer"}
    rp_order_id = "order_test_reuse_final"
    pay_id = "pay_reuse_final"

    def cart_payload(pid=pay_id):
        return srv.OrderCreate(
            items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                    "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
            total=product["price"],
            customer={"name": "Sec Test", "phone": phone_raw},
            address={"name": "Sec Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": phone_raw},
            payment_method="razorpay",
            razorpay_payment_id=pid, razorpay_order_id=rp_order_id, razorpay_signature="fake",
        )

    # Derive the real server-computed total via a COD probe (includes delivery fee).
    cod = await srv.create_order(srv.OrderCreate(
        items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
        total=product["price"],
        customer={"name": "Sec Test", "phone": phone_raw},
        address={"name": "Sec Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": phone_raw},
        payment_method="COD",
    ), user)
    expected_paise = int(round(cod["total"] * 100))
    await db.orders.delete_one({"id": cod["id"]})
    await db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

    orig_verify, orig_fetch = srv.verify_payment_signature, srv.fetch_captured_payment
    srv.verify_payment_signature = lambda *a, **k: True
    srv.fetch_captured_payment = lambda *a, **k: {"amount": expected_paise, "order_id": rp_order_id, "status": "captured"}
    created_order_ids = []
    try:
        # First use succeeds.
        r1 = await srv.create_order(cart_payload(), user)
        created_order_ids.append(r1["id"])
        assert r1["payment_status"] == "paid"

        # Reusing the SAME payment_id for a second order must be rejected,
        # even though the amount still matches and the signature still
        # "verifies" — this is the actual replay/reuse protection, not the
        # amount check.
        with pytest.raises(HTTPException) as exc:
            await srv.create_order(cart_payload(), user)
        assert exc.value.status_code == 400
        assert "already been used" in exc.value.detail.lower()
        # Reused-attempt stock reservation must roll back too — r1 (the
        # first, legitimate order) still holds its own 1-unit decrement,
        # so the expected baseline here is original-minus-r1, not the
        # untouched original.
        p_after = await db.products.find_one({"id": product["id"]}, {"_id": 0, "stock": 1})
        assert p_after["stock"][size] == product["stock"][size] - 1

        # A legitimate retry after an UNRELATED failure (e.g. a transient
        # DB error after payment was already claimed) must not be
        # permanently blocked by its own earlier failed attempt.
        retry_pay_id = "pay_retry_after_failure_final"
        orig_insert_method = AsyncIOMotorCollection.insert_one

        async def boom(self, *a, **k):
            if self.name == "orders":
                raise RuntimeError("simulated unrelated DB failure")
            return await orig_insert_method(self, *a, **k)

        AsyncIOMotorCollection.insert_one = boom
        try:
            with pytest.raises(RuntimeError):
                await srv.create_order(cart_payload(retry_pay_id), user)
        finally:
            AsyncIOMotorCollection.insert_one = orig_insert_method
        assert await db.processed_payments.find_one({"payment_id": retry_pay_id}) is None, \
            "a failed attempt must release its payment-id claim"
        await db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

        r2 = await srv.create_order(cart_payload(retry_pay_id), user)
        created_order_ids.append(r2["id"])
        assert r2["payment_status"] == "paid", "the genuine retry must succeed once the earlier failed claim is released"
    finally:
        srv.verify_payment_signature, srv.fetch_captured_payment = orig_verify, orig_fetch
        for oid in created_order_ids:
            await db.orders.delete_one({"id": oid})
        await db.processed_payments.delete_many({"payment_id": {"$in": [pay_id, "pay_retry_after_failure_final"]}})
        await db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})


# --------------------------------------------------------------------------
# POST /merchant/subscription/activate — self-granted paid plan with no
# payment verification (audit High finding).
# --------------------------------------------------------------------------

async def _subscription_activation_case():
    import server as srv
    from fastapi import HTTPException

    db = srv.db
    mid = f"m-secfix-sub-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.insert_one({"id": mid, "store_name": "Sec Sub Test", "kyc_status": "approved", "created_at": now})
    user = {"sub": mid, "role": "merchant"}

    try:
        # A paid-plan request must not self-grant the plan.
        await srv.activate_subscription({"plan": "growth"}, user)
        m = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m.get("plan") in (None, "free"), f"paid plan was self-granted: {m.get('plan')}"
        assert m.get("requested_plan") == "growth"
        assert m.get("subscription_status") == "pending_verification"

        # Feature gating must ignore a stale/tampered `plan` value without a valid subscription.
        await db.merchants.update_one({"id": mid}, {"$set": {"plan": "pro"}})
        m2 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert srv._merchant_effective_plan(m2) == "free"

        # The Basic trial IS genuinely self-activatable — no payment involved.
        await db.merchants.update_one({"id": mid}, {"$set": {
            "plan": None, "subscription_status": None, "requested_plan": None, "trial_used": False,
        }})
        await srv.activate_subscription({"plan": "basic"}, user)
        m3 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m3.get("plan") == "basic" and m3.get("subscription_status") == "trial"
        assert srv._merchant_effective_plan(m3) == "basic"

        # The trial cannot be reused.
        with pytest.raises(HTTPException) as exc:
            await srv.activate_subscription({"plan": "basic"}, user)
        assert exc.value.status_code == 400

        # Admin activation is the only path that actually grants a paid plan.
        admin = {"sub": "adm-test", "role": "admin", "is_admin": True}
        await srv.admin_activate_plan(mid, {"plan": "growth"}, admin)
        m5 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m5.get("plan") == "growth" and m5.get("subscription_status") == "active"
        assert srv._merchant_effective_plan(m5) == "growth"
        assert m5.get("requested_plan") is None

        # An expired subscription is treated as free for gating even if status still says active.
        await db.merchants.update_one({"id": mid}, {"$set": {"plan_expires_at": "2000-01-01T00:00:00+00:00"}})
        m6 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert srv._merchant_effective_plan(m6) == "free"

        # Final-review addition: Premium ("coming soon") must never be
        # self-grantable via any client request — a request for it must
        # follow the exact same record-only/no-grant path as any other
        # paid tier, never actually setting `plan`.
        await db.merchants.update_one({"id": mid}, {"$set": {
            "plan": None, "subscription_status": None, "requested_plan": None,
        }})
        await srv.activate_subscription({"plan": "premium"}, user)
        m7 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m7.get("plan") in (None, "free"), f"premium was self-granted: {m7.get('plan')}"
        assert m7.get("requested_plan") == "premium"
        assert srv._merchant_effective_plan(m7) == "free"

        # Final-review addition: trial_used cannot be reset via any field
        # in the activate_subscription payload itself (the endpoint never
        # reads a client-supplied trial_used/plan_expires_at/etc. — only
        # `plan` is read from the body). Confirms there's no payload-field
        # smuggling path back into a second trial.
        await db.merchants.update_one({"id": mid}, {"$set": {
            "plan": None, "subscription_status": None, "requested_plan": None, "trial_used": True,
        }})
        with pytest.raises(HTTPException) as exc:
            await srv.activate_subscription(
                {"plan": "basic", "trial_used": False, "subscription_status": "trial",
                 "plan_expires_at": "2099-01-01T00:00:00+00:00"},
                user,
            )
        assert exc.value.status_code == 400
        m8 = await db.merchants.find_one({"id": mid}, {"_id": 0})
        assert m8.get("plan") in (None, "free"), "a second trial was granted despite trial_used=True"
    finally:
        await db.merchants.delete_one({"id": mid})


# --------------------------------------------------------------------------
# Auth hardening: customer/rider access-token TTL, merchant RBAC, rider
# active-status recheck (audit High/Medium findings).
# --------------------------------------------------------------------------

async def _auth_hardening_case():
    import jwt as _pyjwt
    import server as srv
    from fastapi import HTTPException

    # Customer/rider access tokens must be short-lived now (was 365 days —
    # never revocable, since access tokens carry no jti). exp is an
    # absolute unix timestamp; assert it's within ~24h of now.
    import time
    for role in ("customer", "rider"):
        token = srv.create_token("9000000001", role, "access")
        decoded = _pyjwt.decode(token, options={"verify_signature": False})
        remaining_hours = (decoded["exp"] - time.time()) / 3600
        assert 0 < remaining_hours <= 25, f"{role} access token TTL looks wrong: {remaining_hours}h remaining"

    # merchant_user must reject customer/rider tokens (RBAC hardening —
    # was Depends(get_current_user) on 46 merchant-only endpoints,
    # relying only on ID-namespace non-collision for protection).
    with pytest.raises(HTTPException) as exc:
        await srv.merchant_user(user={"sub": "9000000001", "role": "customer"})
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await srv.merchant_user(user={"sub": "9000000001", "role": "rider"})
    assert exc.value.status_code == 403
    result = await srv.merchant_user(user={"sub": "m-test", "role": "merchant"})
    assert result["role"] == "merchant"

    # A suspended rider's still-valid JWT must not pass active_rider (used
    # by PATCH /rider/status, the endpoint that was missing this check).
    db = srv.db
    rider_id = f"rider-secfix-auth-{uuid.uuid4().hex[:6]}"
    phone = "9333333333"
    await db.riders.insert_one({"id": rider_id, "phone": phone, "name": "Suspended Rider", "status": "suspended"})
    try:
        with pytest.raises(HTTPException) as exc:
            await srv.active_rider(user={"sub": phone, "role": "rider"})
        assert exc.value.status_code == 403
        await db.riders.update_one({"id": rider_id}, {"$set": {"status": "active"}})
        r = await srv.active_rider(user={"sub": phone, "role": "rider"})
        assert r["id"] == rider_id
    finally:
        await db.riders.delete_one({"id": rider_id})


# --------------------------------------------------------------------------
# Refund-on-cancel / refund-on-reject (audit fix, 2026-09). Both
# customer_cancel_order and merchant_reject_order call the SAME
# services.payment_service.refund_payment() for a paid Razorpay order —
# monkeypatched here rather than hitting the real Razorpay sandbox, same
# rationale as _razorpay_amount_verification_case's fetch_captured_payment
# mock above: the vulnerability/regression risk lives entirely in how the
# order/audit-log/notification state reacts to a refund outcome, not in
# re-proving Razorpay's own API (that's exercised for real, separately, by
# actually calling refund_payment() against real rzp_test_ credentials
# in a one-off manual check — see the audit report for that verification;
# it isn't repeatable here without live network + real captured payments).
#
# merchant_reject_order previously had NO refund logic at all — it assumed
# every order was COD ("no charge was ever taken"). A customer whose
# prepaid order got rejected was told "no amount was charged" while their
# money sat captured with nothing refunding it. Fixed to mirror
# customer_cancel_order's existing refund block exactly.
# --------------------------------------------------------------------------

def _fake_request():
    """A real (if minimal) starlette.requests.Request — both endpoints
    under test carry @_limit(...) (slowapi), which asserts its `request`
    arg is an actual Request instance, not just anything with `.client`."""
    from starlette.requests import Request
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "path": "/", "raw_path": b"/", "query_string": b"",
        "headers": [], "client": ("127.0.0.1", 0), "server": ("testserver", 80),
        "scheme": "http",
    }
    return Request(scope)


async def _seed_paid_razorpay_order(srv, product, size, phone_raw, merchant_id):
    """A real order (via the normal COD path, so it doesn't need a real
    signature/capture) then hand-flipped to look like it was actually
    paid online — same trick used to verify this fix manually against the
    live server, now codified as a fixture."""
    user = {"sub": srv._normalize_customer_phone(phone_raw), "role": "customer"}
    order = await srv.create_order(srv.OrderCreate(
        items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
        total=product["price"],
        customer={"name": "Refund Test", "phone": phone_raw},
        address={"name": "Refund Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": phone_raw},
        payment_method="COD",
    ), user)
    await srv.db.orders.update_one({"id": order["id"]}, {"$set": {
        "payment_status": "paid", "razorpay_payment_id": "pay_test_refundfix", "payment_method": "razorpay",
    }})
    return order, user


async def _refund_on_cancel_and_reject_case():
    import server as srv

    try:
        product, size = await _find_deliverable_product(srv)
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return
    if not product:
        pytest.skip("no deliverable, in-stock product with a geolocated store in the dev DB")
        return
    store = await srv.db.stores.find_one({"id": product["store_id"]}, {"_id": 0, "merchant_id": 1})
    merchant_id = (store or {}).get("merchant_id")
    if not merchant_id:
        pytest.skip("deliverable product's store has no merchant_id on record")
        return

    orig_refund = srv.refund_payment
    calls = []

    def fake_refund_payment(razorpay_payment_id, amount_inr, lokl_order_id):
        calls.append((razorpay_payment_id, amount_inr, lokl_order_id))
        return {"id": "rfnd_test_fixture", "status": "processed"}

    orig_notify = srv.notify_order_rejected
    notify_calls = []
    srv.notify_order_rejected = lambda phone, order_id, refund_initiated=False: notify_calls.append(
        (phone, order_id, refund_initiated)
    )

    try:
        srv.refund_payment = fake_refund_payment

        # ---- Scenario A: customer_cancel_order refunds a paid order ----
        order, user = await _seed_paid_razorpay_order(srv, product, size, "9000000098", merchant_id)
        try:
            await srv.customer_cancel_order(order["id"], _fake_request(), {"reason": "test"}, user)
            fresh = await srv.db.orders.find_one({"id": order["id"]}, {"_id": 0})
            assert fresh["status"] == "cancelled"
            assert fresh["payment_status"] == "refund_pending"
            assert fresh["razorpay_refund_id"] == "rfnd_test_fixture"
            assert any(c[0] == "pay_test_refundfix" for c in calls), "refund_payment must be called with the order's real razorpay_payment_id"
            audit = await srv.db.payment_audit_log.find_one(
                {"order_id": order["id"], "event_type": "refund_initiated"}, {"_id": 0}
            )
            assert audit is not None, "refund must be recorded in the payment audit log"
        finally:
            await srv.db.orders.delete_one({"id": order["id"]})
            await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

        # ---- Scenario B: merchant_reject_order refunds a paid order (the
        # actual bug this audit fixed — previously no refund attempt at all) ----
        calls.clear()
        order, _ = await _seed_paid_razorpay_order(srv, product, size, "9000000097", merchant_id)
        try:
            merchant_user = {"sub": merchant_id, "role": "merchant"}
            result = await srv.merchant_reject_order(order["id"], _fake_request(), {"reason": "test"}, merchant_user)
            assert result["ok"] is True
            fresh = await srv.db.orders.find_one({"id": order["id"]}, {"_id": 0})
            assert fresh["payment_status"] == "refund_pending", "merchant rejection of a paid order must trigger a refund, not silently do nothing"
            assert fresh["razorpay_refund_id"] == "rfnd_test_fixture"
            assert any(c[0] == "pay_test_refundfix" for c in calls)
            audit = await srv.db.payment_audit_log.find_one(
                {"order_id": order["id"], "event_type": "refund_initiated", "metadata.reason": "merchant_reject"}, {"_id": 0}
            )
            assert audit is not None
            assert notify_calls and notify_calls[-1][2] is True, "customer must be told a refund was initiated, not the stale COD 'no amount was charged' line"
        finally:
            await srv.db.orders.delete_one({"id": order["id"]})
            await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})

        # ---- Scenario C: a genuine COD order rejection must NOT attempt a
        # refund or claim one was initiated — the pre-existing behavior for
        # the common case must be unchanged by this fix. ----
        notify_calls.clear()
        calls.clear()
        user = {"sub": srv._normalize_customer_phone("9000000096"), "role": "customer"}
        cod_order = await srv.create_order(srv.OrderCreate(
            items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                    "size": size, "image": "x", "key": f"{product['id']}-{size}"}],
            total=product["price"],
            customer={"name": "Refund Test", "phone": "9000000096"},
            address={"name": "Refund Test", "line1": "Test Rd", "city": "Bhilai", "pincode": "490020", "phone": "9000000096"},
            payment_method="COD",
        ), user)
        try:
            merchant_user = {"sub": merchant_id, "role": "merchant"}
            await srv.merchant_reject_order(cod_order["id"], _fake_request(), {"reason": "test"}, merchant_user)
            assert not calls, "COD order rejection must never call refund_payment"
            assert notify_calls and notify_calls[-1][2] is False
        finally:
            await srv.db.orders.delete_one({"id": cod_order["id"]})
            await srv.db.products.update_one({"id": product["id"]}, {"$set": {f"stock.{size}": product["stock"][size]}})
    finally:
        srv.refund_payment = orig_refund
        srv.notify_order_rejected = orig_notify


# --------------------------------------------------------------------------
# Single entrypoint. Motor's AsyncIOMotorClient binds to whichever event
# loop is running when it's first constructed (on first `import server`);
# running each scenario under its own separate `asyncio.run()` call — even
# from different test functions in the same pytest process — breaks the
# second one with "Event loop is closed" once the first call's loop tears
# down. One `asyncio.run()` for the whole file avoids that entirely.
# --------------------------------------------------------------------------

async def _run_all_security_fix_cases():
    await _returns_authorization_case()
    await _razorpay_amount_verification_case()
    await _fetch_captured_payment_status_case()
    await _razorpay_payment_reuse_case()
    await _subscription_activation_case()
    await _auth_hardening_case()
    await _refund_on_cancel_and_reject_case()


def test_g26_critical_security_fixes():
    asyncio.run(_run_all_security_fix_cases())
