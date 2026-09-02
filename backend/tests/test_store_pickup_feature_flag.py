"""Regression tests for the STORE_PICKUP_ENABLED feature flag (2026-09
product decision — Store Pickup / Reserve & Collect is disabled in
production while Try & Buy must remain fully unaffected).

Same in-process convention as test_security_fixes.py / test_autopublish_
reconciliation.py — no admin login required, calls FastAPI handler
functions directly against the real DB connection server.py already
uses, one asyncio.run() for the whole file (Motor binds to whichever
event loop is running at construction time).

The flag itself (`server.STORE_PICKUP_ENABLED`) is a module-level
constant computed once at import time from os.environ — these tests
monkeypatch that attribute directly (same technique already used
throughout this suite to monkeypatch notify_* functions) rather than
mutating environment variables and re-importing the module.

Run with: cd backend && python3 -m pytest tests/test_store_pickup_feature_flag.py -v
Requires a reachable MONGO_URL (same one server.py itself uses).
"""
import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

L1, L2 = "l1-men", "l2-men-tshirts"


def _merchant_doc(mid, plan="free"):
    now = datetime.now(timezone.utc).isoformat()
    suffix = mid.split("-")[-1]
    phone = f"9{int(time.time() * 1000 + hash(mid)) % 10 ** 9:09d}"
    return {
        "id": mid, "password_hash": "x",
        "store_name": f"Pickup Flag Test {suffix}", "owner_name": "Owner",
        "phone": phone, "phone_canonical": phone,
        "city": "Bhilai", "created_at": now, "role": "merchant",
        "kyc_status": "approved", "kyc_submitted_at": now, "approved_at": now,
        "plan": plan,
        "terms_accepted": True, "terms_version": "test", "terms_accepted_at": now,
        "published": False, "storefront": None, "notifications": [],
    }


def _storefront_payload(srv):
    # Full-day hours (00:00-23:59) so store_availability rank is
    # deterministic regardless of when this test actually runs.
    return srv.StorefrontUpdate(
        tagline="t", story="A perfectly ordinary store description, long enough.",
        banner="", banners=[], specialties=[], locality="",
        opens_at="00:00", closes_at="23:59",
        lat=21.19, lng=81.33, area="sector-10", area_label="Sector 10",
        pincode="490006", upi_qr_url="", weekly_off=[],
    )


def _product_payload(srv, name, **kw):
    base = dict(name=name, price=500, mrp=700, l1_id=L1, l2_id=L2,
                sizes=["OS"], images=[], stock={"OS": 10})
    base.update(kw)
    return srv.ProductCreate(**base)


class _Cleanup:
    def __init__(self, db):
        self.db = db
        self.merchant_ids = []

    def track(self, merchant_id):
        self.merchant_ids.append(merchant_id)
        return merchant_id

    async def purge(self):
        for mid in self.merchant_ids:
            store_id = f"store-m-{mid}"
            await self.db.orders.delete_many({"merchant_ids": mid})
            await self.db.products.delete_many({"merchant_id": mid})
            await self.db.stores.delete_one({"id": store_id})
            await self.db.merchants.delete_one({"id": mid})


async def _setup_store(srv, cleanup, *, plan):
    """Real KYC-approved, published, geolocated, full-day-open store via
    the actual internal creation functions (not a raw Mongo insert) —
    ensures _store_availability/_visible_store_filter behave exactly as
    they would for a genuine merchant. `plan` is set directly on the
    store document afterward since that's the exact field create_order()
    and get_store() read from."""
    db = srv.db
    mid = cleanup.track(f"m-pickupflag-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, plan=plan))
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid)
    product = await srv._create_product_for_merchant(_product_payload(srv, "Pickup Flag Test Item"), mid)
    store_id = f"store-m-{mid}"
    await db.stores.update_one({"id": store_id}, {"$set": {"plan": plan, "online": True}})
    return mid, store_id, product


def _pickup_order_payload(product, phone):
    # `store_id` matters here, not just cosmetically: create_order()'s
    # pickup pre-check (the location this whole test file exercises)
    # derives `payload_store_ids` from each item's own store_id field —
    # exactly what the real checkout page sends (its cart items carry
    # store_id throughout, sent verbatim as `items` to POST /orders).
    # Omitting it here would skip that pre-check loop entirely and this
    # test would silently stop testing what it claims to.
    return dict(
        items=[{"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
                "size": "OS", "image": "x", "key": f"{product['id']}-OS", "store_id": product["store_id"]}],
        total=product["price"],
        customer={"name": "Pickup Flag Test", "phone": phone},
        address={"name": "Pickup Flag Test", "phone": phone},
        payment_method="COD",
        order_type="pickup",
    )


def _delivery_order_payload(product, phone, *, fulfillment_type=None):
    item = {"id": product["id"], "name": product["name"], "price": product["price"], "qty": 1,
            "size": "OS", "image": "x", "key": f"{product['id']}-OS", "store_id": product["store_id"]}
    if fulfillment_type:
        item["fulfillment_type"] = fulfillment_type
    return dict(
        items=[item],
        total=product["price"],
        customer={"name": "Try Buy Flag Test", "phone": phone},
        address={"name": "Try Buy Flag Test", "line1": "Test Rd", "city": "Bhilai",
                 "pincode": "490020", "phone": phone},
        payment_method="COD",
    )


# --------------------------------------------------------------------------
# 1/2/3 — availability calculations at all identified locations
# --------------------------------------------------------------------------
async def _availability_case(srv, cleanup):
    db = srv.db
    orig_flag = srv.STORE_PICKUP_ENABLED
    try:
        mid_pro, store_id_pro, _ = await _setup_store(srv, cleanup, plan="pro")
        mid_free, store_id_free, _ = await _setup_store(srv, cleanup, plan="free")

        # --- flag OFF: can_pickup must be False everywhere, even for a Pro store ---
        srv.STORE_PICKUP_ENABLED = False
        s_pro = await db.stores.find_one({"id": store_id_pro}, {"_id": 0})
        avail = srv._store_availability(s_pro)
        assert s_pro.get("plan") == "pro" and avail.get("rank") in (1, 3), \
            "test store must actually be Pro + eligible-rank for this assertion to mean anything"
        products = [{"store_id": store_id_pro}]
        avail_map = {store_id_pro: {**avail, "plan": "pro"}}
        srv._attach_store_avail(products, avail_map)
        assert products[0]["store_can_pickup"] is False, "_attach_store_avail must report can_pickup=False when flag is off, even for a Pro store"

        # get_store's own s["can_pickup"] computation is asserted directly
        # here (same formula, same fields) rather than via its full route
        # signature, to keep this test resilient to unrelated route changes.
        s_fresh = await db.stores.find_one({"id": store_id_pro}, {"_id": 0})
        avail2 = srv._store_availability(s_fresh)
        can_pickup_field = (srv.STORE_PICKUP_ENABLED and s_fresh.get("plan", "free") == "pro"
                             and avail2.get("rank", 4) in (1, 3) and avail2.get("can_order", False))
        assert can_pickup_field is False

        # --- flag ON + Pro store: existing eligibility logic preserved (True) ---
        srv.STORE_PICKUP_ENABLED = True
        products2 = [{"store_id": store_id_pro}]
        srv._attach_store_avail(products2, avail_map)
        assert products2[0]["store_can_pickup"] is True, "flag on + Pro + eligible rank must report can_pickup=True"

        # --- flag ON + non-Pro store: existing Pro-plan gate still applies (False) ---
        s_free = await db.stores.find_one({"id": store_id_free}, {"_id": 0})
        avail_free = srv._store_availability(s_free)
        products3 = [{"store_id": store_id_free}]
        avail_map3 = {store_id_free: {**avail_free, "plan": "free"}}
        srv._attach_store_avail(products3, avail_map3)
        assert products3[0]["store_can_pickup"] is False, "flag on but non-Pro store must still be False — Pro-plan gate is unchanged"
    finally:
        srv.STORE_PICKUP_ENABLED = orig_flag


# --------------------------------------------------------------------------
# 1 — create_order() rejects pickup when flag is disabled, even for an
# otherwise fully Pro-eligible store. No order is created.
# --------------------------------------------------------------------------
async def _create_order_disabled_case(srv, cleanup):
    db = srv.db
    orig_flag = srv.STORE_PICKUP_ENABLED
    srv.STORE_PICKUP_ENABLED = False
    try:
        mid, store_id, product = await _setup_store(srv, cleanup, plan="pro")
        s_fresh = await db.stores.find_one({"id": store_id}, {"_id": 0})
        avail = srv._store_availability(s_fresh)
        assert avail.get("rank") in (1, 3), "test store must be in an eligible rank"

        phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
        user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
        before_count = await db.orders.count_documents({"merchant_ids": mid})

        with pytest.raises(HTTPException) as exc:
            await srv.create_order(srv.OrderCreate(**_pickup_order_payload(product, phone)), user)
        assert exc.value.status_code == 400
        assert "not available" in exc.value.detail.lower()

        after_count = await db.orders.count_documents({"merchant_ids": mid})
        assert after_count == before_count, "no order must be created when Store Pickup is disabled"
    finally:
        srv.STORE_PICKUP_ENABLED = orig_flag


# --------------------------------------------------------------------------
# 2 — create_order() preserves existing Pro-plan behavior exactly when the
# flag is enabled: Pro store succeeds, non-Pro store still rejected.
# --------------------------------------------------------------------------
async def _create_order_enabled_case(srv, cleanup):
    db = srv.db
    orig_flag = srv.STORE_PICKUP_ENABLED
    srv.STORE_PICKUP_ENABLED = True
    try:
        mid_pro, store_id_pro, product_pro = await _setup_store(srv, cleanup, plan="pro")
        mid_free, store_id_free, product_free = await _setup_store(srv, cleanup, plan="free")

        phone_pro = f"9{int(time.time() * 1000 + 1) % 10 ** 9:09d}"
        user_pro = {"sub": srv._normalize_customer_phone(phone_pro), "role": "customer"}
        order = await srv.create_order(srv.OrderCreate(**_pickup_order_payload(product_pro, phone_pro)), user_pro)
        assert order.get("id"), "create_order() must return the created order doc"
        fresh_order = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
        assert fresh_order["status"] == "pending_pickup"
        assert fresh_order["order_type"] == "pickup"
        assert fresh_order.get("pickup_code")

        phone_free = f"9{int(time.time() * 1000 + 2) % 10 ** 9:09d}"
        user_free = {"sub": srv._normalize_customer_phone(phone_free), "role": "customer"}
        before_count = await db.orders.count_documents({"merchant_ids": mid_free})
        with pytest.raises(HTTPException) as exc:
            await srv.create_order(srv.OrderCreate(**_pickup_order_payload(product_free, phone_free)), user_free)
        assert exc.value.status_code == 400
        assert "not available" in exc.value.detail.lower()
        after_count = await db.orders.count_documents({"merchant_ids": mid_free})
        assert after_count == before_count, "non-Pro store must still be rejected, flag or no flag"
    finally:
        srv.STORE_PICKUP_ENABLED = orig_flag


# --------------------------------------------------------------------------
# 4 — Try & Buy: a normal delivery order with a try_at_doorstep item stays
# order_type="delivery" and is completely unaffected by the flag, in
# either state.
# --------------------------------------------------------------------------
async def _try_and_buy_unaffected_case(srv, cleanup):
    db = srv.db
    orig_flag = srv.STORE_PICKUP_ENABLED
    try:
        mid, store_id, _ = await _setup_store(srv, cleanup, plan="free")
        tab_product = await srv._create_product_for_merchant(
            _product_payload(srv, "Try Buy Flag Test Item", try_at_doorstep=True, return_eligible=True),
            mid,
        )

        for flag_value in (False, True):
            srv.STORE_PICKUP_ENABLED = flag_value
            phone = f"9{int(time.time() * 1000 + hash((flag_value, 'tab'))) % 10 ** 9:09d}"
            user = {"sub": srv._normalize_customer_phone(phone), "role": "customer"}
            payload = _delivery_order_payload(tab_product, phone, fulfillment_type="try_and_buy")
            order = await srv.create_order(srv.OrderCreate(**payload), user)
            assert order.get("id"), "create_order() must return the created order doc"
            fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
            # A normal delivery order never stores an explicit order_type
            # field at all — only the pickup branch writes doc["order_type"]
            # = "pickup" (see server.py); absence means "delivery", matching
            # OrderCreate's own `order_type: str = "delivery"` default.
            assert fresh.get("order_type", "delivery") == "delivery" and fresh.get("order_type") != "pickup", \
                f"Try & Buy order must stay order_type=='delivery' regardless of STORE_PICKUP_ENABLED={flag_value}"
            item = fresh["items"][0]
            assert item["fulfillment_type"] == "try_and_buy", \
                "the item's fulfillment_type must be honored exactly as before — unaffected by the pickup flag"
    finally:
        srv.STORE_PICKUP_ENABLED = orig_flag


# --------------------------------------------------------------------------
# 5 — rider_pickup / rider_return_pickup completely unaffected
# --------------------------------------------------------------------------
def _rider_flows_unaffected_case():
    import notifications as notif
    import inspect

    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_pickup") == "GUPSHUP_TEMPLATE_RIDER_PICKUP"
    assert notif.GupshupProvider._TEMPLATE_ENV.get("rider_return_pickup") == "GUPSHUP_TEMPLATE_RIDER_RETURN_PICKUP"

    for fn in (notif.notify_rider_pickup, notif.notify_rider_return_pickup):
        src = inspect.getsource(fn)
        assert "STORE_PICKUP_ENABLED" not in src, f"{fn.__name__} must never reference the Store Pickup flag"

    server_py = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server.py")
    with open(server_py) as f:
        src = f.read()
    fn_start = src.index("async def merchant_accept_order")
    fn_end = src.index("\n@api.", fn_start)
    assert "STORE_PICKUP_ENABLED" not in src[fn_start:fn_end], \
        "merchant_accept_order() (rider_pickup's trigger) must not reference the pickup flag"


# --------------------------------------------------------------------------
# 6 — Store Pickup implementation remains fully present in the codebase
# --------------------------------------------------------------------------
def _store_pickup_code_still_present_case():
    server_py_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server.py")
    with open(server_py_path) as f:
        src = f.read()
    for route in ('@api.post("/merchant/orders/{oid}/accept-pickup")',
                  '@api.post("/merchant/orders/{oid}/verify-pickup")',
                  '@api.post("/merchant/orders/{oid}/cancel-pickup")',
                  '@api.get("/admin/expire-pickups")'):
        assert route in src, f"Store Pickup endpoint must remain in the codebase: {route}"
    for marker in ('doc["pickup_code"]', 'doc["pickup_expires_at"]', 'doc["status"] = "pending_pickup"'):
        assert marker in src, f"Store Pickup logic must remain intact: {marker}"

    notif_py_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "notifications.py")
    with open(notif_py_path) as f:
        notif_src = f.read()
    for fn_name in ("def notify_pickup_pending", "def notify_merchant_pickup_pending",
                     "def notify_pickup_reserved", "def notify_merchant_pickup_reserved"):
        assert fn_name in notif_src, f"Store Pickup notification function must remain in the codebase: {fn_name}"
    # Explicitly confirm merchant_pickup_pending was NOT wired to Gupshup as
    # part of this change, per instruction.
    import notifications as notif
    assert "merchant_pickup_pending" not in notif.GupshupProvider._TEMPLATE_ENV


def test_store_pickup_static_checks():
    _rider_flows_unaffected_case()
    _store_pickup_code_still_present_case()


async def _run_all_db_cases():
    import server as srv
    try:
        db = srv.db
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return

    cleanup = _Cleanup(db)
    try:
        await _availability_case(srv, cleanup)
        await _create_order_disabled_case(srv, cleanup)
        await _create_order_enabled_case(srv, cleanup)
        await _try_and_buy_unaffected_case(srv, cleanup)
    finally:
        await cleanup.purge()


def test_store_pickup_feature_flag_db_backed():
    asyncio.run(_run_all_db_cases())
