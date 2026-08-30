"""Offer-led discovery — discount_percent, campaign filtering, and store
offer rollup regression tests.

Live-HTTP tests against a running local backend, same convention as
test_admin_product_creation.py / test_admin_storefront_setup.py. Covers:
  - every product create/update path recomputes discount_percent via the
    single canonical server.py `_calculate_discount_percent` helper
    (merchant manual, admin manual, merchant bulk, admin bulk, full
    update, quick price update)
  - GET /products & /products/all min_discount/max_discount filtering +
    validation, and sort=discount actually sorting
  - the store offer rollup (max_discount_percent/starting_price/
    product_count/primary_category) — paused/deleted exclusion, "no
    qualifying offer" honesty, deterministic category tie-breaking

Pure formula edge cases (floor-not-round, missing mrp/price, mrp<=price)
are covered separately in test_discount_percent_unit.py (no HTTP needed).
"""
from __future__ import annotations

import io
import os
import time
import uuid

import bcrypt
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("NEXT_PUBLIC_API_URL") or "http://localhost:8001"
API = f"{BASE_URL.rstrip('/')}/api"

_MONGO_URL = os.environ["MONGO_URL"]
_DB_NAME = os.environ.get("DB_NAME", "lokl_dev")


def _mongo_db():
    return MongoClient(_MONGO_URL)[_DB_NAME]


def _make_bulk_xlsx(rows: list) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["product name", "product description", "l1 category", "l2 category", "gender",
               "mrp", "selling price", "sizes", "stock_per_size", "returnable",
               "return window (hours)", "try & buy", "brand"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-discount-tests@lokl.dev"
    password = "AdminTests@2026"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()
    db.admin_users.update_one(
        {"email": email},
        {"$set": {"password_hash": pw_hash, "active": True, "role": "admin"},
         "$setOnInsert": {"id": f"adm-test-{uuid.uuid4().hex[:8]}", "name": "Test Admin", "created_at": "2026-01-01T00:00:00+00:00"}},
        upsert=True,
    )
    try:
        r = session.post(f"{API}/admin/login", json={"email": email, "password": password}, timeout=10)
    except requests.exceptions.ConnectionError:
        pytest.skip("Backend not reachable at " + API)
    if r.status_code != 200:
        pytest.skip(f"Test admin login failed unexpectedly: {r.status_code} {r.text[:200]}")
    return {"Authorization": f"Bearer {r.json().get('token')}"}, r.json()["admin"]["id"]


@pytest.fixture()
def approved_merchant_with_store(session):
    """A freshly-registered, KYC-approved merchant with a real storefront —
    everything discount create/update/bulk/rollup tests need, isolated per
    test (not a shared demo account) so product counts/discounts are exact
    and predictable. Cleaned up after the test."""
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
    reg = session.post(f"{API}/auth/register", json={
        "email": f"discount_test_{suffix}@lokl.in", "password": "DiscTest@2026",
        "store_name": f"Discount Test {suffix}", "owner_name": "Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=15)
    assert reg.status_code in (200, 201), reg.text
    mid = reg.json()["merchant"]["id"]
    token = reg.json()["token"]
    db = _mongo_db()
    db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved"}})
    mh = {"Authorization": f"Bearer {token}"}
    sf = requests.post(f"{API}/merchant/storefront", json={
        "tagline": "t", "story": "s", "banner": "", "banners": [],
        "specialties": [], "locality": "", "opens_at": "10:00", "closes_at": "20:00",
        "lat": 21.19, "lng": 81.33, "area": "sector-10", "area_label": "Sector 10",
        "pincode": "490006", "upi_qr_url": "", "weekly_off": [],
    }, headers=mh, timeout=15)
    assert sf.status_code == 200, sf.text
    yield {"id": mid, "token": token, "store_id": f"store-m-{mid}", "headers": mh}
    db.products.delete_many({"merchant_id": mid})
    db.stores.delete_one({"id": f"store-m-{mid}"})
    db.merchants.delete_one({"id": mid})


def _create_product(mh, *, name, mrp=None, price=999, l1_id="l1-men", l2_id="l2-men-tshirts", paused=False):
    body = {"name": name, "price": price, "l1_id": l1_id, "l2_id": l2_id, "sizes": [], "images": []}
    if mrp is not None:
        body["mrp"] = mrp
    r = requests.post(f"{API}/merchant/products", json=body, headers=mh, timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    if paused:
        requests.put(f"{API}/merchant/products/{doc['id']}", json={"paused": True}, headers=mh, timeout=15)
        doc["paused"] = True
    return doc


# ============================================================================
# Discount recomputation on every create/update path
# ============================================================================

class TestDiscountOnCreationPaths:
    def test_merchant_manual_creation_gets_discount_percent(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="MerchantManual_Disc", mrp=1000, price=501)
        assert doc["discount_percent"] == 49  # floors, not rounds

    def test_merchant_manual_creation_no_mrp_gives_zero(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="MerchantManual_NoMrp", mrp=None, price=501)
        assert doc["discount_percent"] == 0

    def test_admin_manual_creation_gets_discount_percent(self, admin_auth, approved_merchant_with_store):
        h, admin_id = admin_auth
        m = approved_merchant_with_store
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": {"name": "AdminManual_Disc", "price": 501, "mrp": 1000,
                               "l1_id": "l1-men", "l2_id": "l2-men-tshirts", "sizes": [], "images": []}},
            headers=h, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["discount_percent"] == 49

    def test_merchant_bulk_creation_gets_discount_percent(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        xlsx = _make_bulk_xlsx([["MerchBulk_Disc", "d", "Men", "T-Shirts", "", 1000, 501, "M", "5", "No", "", "No", ""]])
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/merchant/products/bulk", files=files, headers=m["headers"], timeout=20)
        assert r.status_code == 200, r.text
        db = _mongo_db()
        doc = db.products.find_one({"merchant_id": m["id"], "name": "MerchBulk_Disc"})
        assert doc is not None
        assert doc["discount_percent"] == 49

    def test_admin_bulk_creation_gets_discount_percent(self, admin_auth, approved_merchant_with_store):
        h, _admin_id = admin_auth
        m = approved_merchant_with_store
        xlsx = _make_bulk_xlsx([["AdminBulk_Disc", "d", "Men", "T-Shirts", "", 1000, 501, "M", "5", "No", "", "No", ""]])
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        detect = requests.post(f"{API}/admin/merchants/{m['id']}/products/bulk/detect", files=files, headers=h, timeout=30)
        assert detect.status_code == 200, detect.text
        import_id = detect.json()["import_id"]
        imp = requests.post(f"{API}/admin/merchants/{m['id']}/products/bulk/import",
                             json={"import_id": import_id}, headers=h, timeout=30)
        assert imp.status_code == 200, imp.text
        db = _mongo_db()
        doc = db.products.find_one({"merchant_id": m["id"], "name": "AdminBulk_Disc"})
        assert doc is not None
        assert doc["discount_percent"] == 49
        db.bulk_imports.delete_one({"id": import_id})


class TestDiscountOnUpdatePaths:
    def test_updating_only_price_recalculates_discount(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="UpdatePrice_Disc", mrp=1000, price=900)
        assert doc["discount_percent"] == 10
        r = requests.put(f"{API}/merchant/products/{doc['id']}", json={"price": 501}, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["discount_percent"] == 49

    def test_updating_only_mrp_recalculates_discount(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="UpdateMrp_Disc", mrp=None, price=501)
        assert doc["discount_percent"] == 0
        r = requests.put(f"{API}/merchant/products/{doc['id']}", json={"mrp": 1000}, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["discount_percent"] == 49

    def test_admin_full_update_recalculates_discount(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="AdminUpdate_Disc", mrp=1000, price=900)
        r = requests.put(f"{API}/admin/products/{doc['id']}", json={"price": 501}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["discount_percent"] == 49

    def test_quick_price_update_recalculates_discount(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="QuickUpdate_Disc", mrp=1000, price=900)
        r = requests.patch(f"{API}/merchant/products/{doc['id']}", json={"price": 501}, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        stored = _mongo_db().products.find_one({"id": doc["id"]}, {"_id": 0, "discount_percent": 1})
        assert stored["discount_percent"] == 49

    def test_quick_mrp_only_update_recalculates_discount(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        doc = _create_product(m["headers"], name="QuickUpdateMrp_Disc", mrp=None, price=501)
        r = requests.patch(f"{API}/merchant/products/{doc['id']}", json={"mrp": 1000}, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        stored = _mongo_db().products.find_one({"id": doc["id"]}, {"_id": 0, "discount_percent": 1})
        assert stored["discount_percent"] == 49

    def test_existing_products_are_backfilled(self):
        """Migration 030 backfill — every product in the DB must have a
        discount_percent field (0 default), never missing."""
        db = _mongo_db()
        missing = db.products.count_documents({"discount_percent": {"$exists": False}})
        assert missing == 0


# ============================================================================
# Campaign filtering
# ============================================================================

class TestDiscountFiltering:
    def test_min_discount_excludes_product_just_under_threshold(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        under = _create_product(m["headers"], name="Filter_49_Only", mrp=1000, price=501)  # 49%
        assert under["discount_percent"] == 49
        r = requests.get(f"{API}/products/all", params={"min_discount": 50, "search": "Filter_49_Only"}, timeout=10)
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json()["products"]}
        assert under["id"] not in ids

    def test_min_discount_50_includes_exact_50(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        exact = _create_product(m["headers"], name="Filter_Exact_50", mrp=1000, price=500)
        assert exact["discount_percent"] == 50
        r = requests.get(f"{API}/products/all", params={"min_discount": 50, "search": "Filter_Exact_50"}, timeout=10)
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json()["products"]}
        assert exact["id"] in ids

    def test_discount_range_min_and_max(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        low = _create_product(m["headers"], name="Filter_Range_20", mrp=1000, price=800)   # 20%
        mid = _create_product(m["headers"], name="Filter_Range_35", mrp=1000, price=650)   # 35%
        high = _create_product(m["headers"], name="Filter_Range_60", mrp=1000, price=400)  # 60%
        r = requests.get(f"{API}/products/all", params={"min_discount": 30, "max_discount": 49, "search": "Filter_Range"}, timeout=10)
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json()["products"]}
        assert mid["id"] in ids
        assert low["id"] not in ids
        assert high["id"] not in ids

    def test_invalid_discount_value_rejected(self):
        r = requests.get(f"{API}/products/all", params={"min_discount": 150}, timeout=10)
        assert r.status_code == 400
        r2 = requests.get(f"{API}/products", params={"min_discount": -5}, timeout=10)
        assert r2.status_code == 400

    def test_min_greater_than_max_rejected(self):
        r = requests.get(f"{API}/products/all", params={"min_discount": 60, "max_discount": 30}, timeout=10)
        assert r.status_code == 400
        r2 = requests.get(f"{API}/products", params={"min_discount": 60, "max_discount": 30}, timeout=10)
        assert r2.status_code == 400

    def test_bare_products_endpoint_also_filters(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        prod = _create_product(m["headers"], name="Bare_Products_Disc", mrp=1000, price=500)
        r = requests.get(f"{API}/products", params={"min_discount": 50, "store": m["store_id"]}, timeout=10)
        assert r.status_code == 200, r.text
        ids = {p["id"] for p in r.json()}
        assert prod["id"] in ids


class TestDiscountSorting:
    def test_sort_discount_orders_by_discount_percent_desc(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        low = _create_product(m["headers"], name="Sort_Low", mrp=1000, price=900)    # 10%
        high = _create_product(m["headers"], name="Sort_High", mrp=1000, price=200)  # 80%
        r = requests.get(f"{API}/products/all", params={"sort": "discount", "search": "Sort_"}, timeout=10)
        assert r.status_code == 200, r.text
        ids_in_order = [p["id"] for p in r.json()["products"]]
        assert ids_in_order.index(high["id"]) < ids_in_order.index(low["id"])

    def test_sort_discount_on_bare_products_endpoint(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        low = _create_product(m["headers"], name="Sort2_Low", mrp=1000, price=900)
        high = _create_product(m["headers"], name="Sort2_High", mrp=1000, price=200)
        r = requests.get(f"{API}/products", params={"sort": "discount", "store": m["store_id"]}, timeout=10)
        assert r.status_code == 200, r.text
        ids_in_order = [p["id"] for p in r.json()]
        assert ids_in_order.index(high["id"]) < ids_in_order.index(low["id"])


# ============================================================================
# Store offer rollup
# ============================================================================

class TestStoreOfferRollup:
    def _get_store(self, store_id: str) -> dict:
        r = requests.get(f"{API}/stores", params={"limit": 500}, timeout=15)
        assert r.status_code == 200, r.text
        match = next((s for s in r.json() if s["id"] == store_id), None)
        assert match is not None, f"store {store_id} not in GET /stores response"
        return match

    def test_paused_and_deleted_products_excluded_from_rollup(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        # Visible, unpaused — triggers autopublish and is the only product
        # that should count.
        visible = _create_product(m["headers"], name="Rollup_Visible", mrp=1000, price=500)  # 50%, unpaused
        paused = _create_product(m["headers"], name="Rollup_Paused", mrp=1000, price=100, paused=True)  # 90%, paused
        deleted = _create_product(m["headers"], name="Rollup_Deleted", mrp=1000, price=50)  # 95%
        _mongo_db().products.update_one({"id": deleted["id"]}, {"$set": {"is_deleted": True}})

        s = self._get_store(m["store_id"])
        assert s["max_discount_percent"] == 50  # not 90 (paused) or 95 (deleted)
        assert s["starting_price"] == 500
        assert s["product_count"] == 1

    def test_store_with_no_qualifying_discount_reports_accurate_low_value(self, approved_merchant_with_store):
        """No product on this store clears a meaningful discount threshold
        — the rollup must report the true (low) number, never a fabricated
        or rounded-up claim. The >=20% "show an offer" gate is a frontend
        display decision (StoreListCard's MEANINGFUL_DISCOUNT_THRESHOLD);
        this asserts backend correctness of the raw value."""
        m = approved_merchant_with_store
        _create_product(m["headers"], name="Rollup_SmallDiscount", mrp=1000, price=900)  # 10%
        s = self._get_store(m["store_id"])
        assert s["max_discount_percent"] == 10
        assert s["max_discount_percent"] < 20

    def test_store_with_zero_products_has_no_offer(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        # No products created at all for this merchant/store.
        r = requests.get(f"{API}/stores", params={"limit": 500}, timeout=15)
        assert r.status_code == 200, r.text
        match = next((s for s in r.json() if s["id"] == m["store_id"]), None)
        # A store with zero products never autopublishes (see
        # _maybe_autopublish_store), so it's correctly absent from the
        # public listing entirely — not shown with a fabricated offer.
        assert match is None

    def test_primary_category_tie_break_is_deterministic(self, approved_merchant_with_store):
        """One product in Men, one in Women — an exact tie. Must always
        resolve to Women (seed_data.L1_CATEGORIES order=1) over Men
        (order=2), regardless of aggregation/insertion order."""
        m = approved_merchant_with_store
        _create_product(m["headers"], name="Tie_Men", mrp=1000, price=900, l1_id="l1-men", l2_id="l2-men-tshirts")
        _create_product(m["headers"], name="Tie_Women", mrp=1000, price=900, l1_id="l1-women", l2_id="l2-women-dresses")
        s = self._get_store(m["store_id"])
        assert s["primary_category"] == "Women"
