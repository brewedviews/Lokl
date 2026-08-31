"""Color variants — regression tests.

Live-HTTP tests against a running local backend (same convention as
test_discount_percent.py). Covers:
  - existing non-color products are completely unaffected
  - color-variant creation (merchant + admin), full update
  - multiple colors with separate images/stock
  - GET /products/{id} returns the real per-color data
  - order creation persists the selected color and decrements the exact
    variant+size (not the wrong color, not the flat mirror alone)
  - two colors of the same size never collide in inventory validation
  - invalid/nonexistent color_variant_id is rejected
  - variant image ownership/deletion safety
  - admin/merchant creation parity
"""
from __future__ import annotations

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


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-color-variant-tests@lokl.dev"
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
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
    reg = session.post(f"{API}/auth/register", json={
        "email": f"colorvariant_test_{suffix}@lokl.in", "password": "ColorTest@2026",
        "store_name": f"Color Variant Test {suffix}", "owner_name": "Owner",
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


def _two_color_payload(name):
    return {
        "name": name, "price": 999, "mrp": 1499,
        "l1_id": "l1-men", "l2_id": "l2-men-tshirts",
        "color_variants": [
            {
                "id": "cv-black", "name": "Black", "hex": "#111111",
                "images": [{"url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/black1.jpg", "public_id": "lokl/products/black1"}],
                "sizes": [{"size": "M", "stock": 5}, {"size": "L", "stock": 8}],
            },
            {
                "id": "cv-white", "name": "White", "hex": "#FFFFFF",
                "images": [{"url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/white1.jpg", "public_id": "lokl/products/white1"}],
                "sizes": [{"size": "M", "stock": 3}, {"size": "L", "stock": 7}],
            },
        ],
    }


class TestExistingProductsUnaffected:
    def test_plain_product_has_no_color_variants(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        r = requests.post(f"{API}/merchant/products", json={
            "name": "PlainProduct_ColorRegression", "price": 499, "l1_id": "l1-men", "l2_id": "l2-men-tshirts",
            "sizes": ["M", "L"], "stock": {"M": 5, "L": 5}, "images": [],
        }, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc.get("color_variants") in (None, [])
        assert doc["sizes"] == ["M", "L"]
        assert doc["stock"] == {"M": 5, "L": 5}

    def test_plain_product_update_unaffected(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json={
            "name": "PlainUpdate_ColorRegression", "price": 499, "l1_id": "l1-men", "l2_id": "l2-men-tshirts",
            "sizes": ["M"], "stock": {"M": 5}, "images": [],
        }, headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        upd = requests.put(f"{API}/merchant/products/{pid}", json={"price": 599}, headers=m["headers"], timeout=15)
        assert upd.status_code == 200, upd.text
        assert upd.json().get("color_variants") in (None, [])
        assert upd.json()["price"] == 599


class TestColorVariantCreation:
    def test_merchant_creates_color_variant_product(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        r = requests.post(f"{API}/merchant/products", json=_two_color_payload("Merchant_TwoColors"), headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert len(doc["color_variants"]) == 2
        assert doc["creation_source"] == "merchant_manual"
        # Flat mirror derived from variants — first variant's image, union
        # of sizes, summed stock.
        assert doc["image"] == "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/black1.jpg"
        assert sorted(doc["sizes"]) == ["L", "M"]
        assert doc["stock"] == {"M": 8, "L": 15}  # 5+3, 8+7
        assert doc["total_stock"] == 23

    def test_admin_creates_color_variant_product(self, admin_auth, approved_merchant_with_store):
        h, admin_id = admin_auth
        m = approved_merchant_with_store
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _two_color_payload("Admin_TwoColors")},
            headers=h, timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert len(doc["color_variants"]) == 2
        assert doc["creation_source"] == "admin_manual"
        assert doc["created_by"] == admin_id
        assert doc["stock"] == {"M": 8, "L": 15}

    def test_each_color_has_its_own_images(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        r = requests.post(f"{API}/merchant/products", json=_two_color_payload("SeparateImages"), headers=m["headers"], timeout=15)
        doc = r.json()
        black = next(v for v in doc["color_variants"] if v["name"] == "Black")
        white = next(v for v in doc["color_variants"] if v["name"] == "White")
        assert black["images"][0]["url"].endswith("black1.jpg")
        assert white["images"][0]["url"].endswith("white1.jpg")
        assert black["images"] != white["images"]

    def test_different_stock_by_color_and_size(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        r = requests.post(f"{API}/merchant/products", json=_two_color_payload("StockByColor"), headers=m["headers"], timeout=15)
        doc = r.json()
        black = next(v for v in doc["color_variants"] if v["name"] == "Black")
        white = next(v for v in doc["color_variants"] if v["name"] == "White")
        assert {s["size"]: s["stock"] for s in black["sizes"]} == {"M": 5, "L": 8}
        assert {s["size"]: s["stock"] for s in white["sizes"]} == {"M": 3, "L": 7}

    def test_get_product_returns_full_variant_data(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("GetProductVariants"), headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        r = requests.get(f"{API}/products/{pid}", timeout=10)
        assert r.status_code == 200, r.text
        doc = r.json()["product"] if "product" in r.json() else r.json()
        assert len(doc["color_variants"]) == 2


class TestColorVariantUpdate:
    def test_full_update_replaces_variants(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("UpdateVariants"), headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        new_payload = _two_color_payload("UpdateVariants")
        new_payload["color_variants"][0]["sizes"] = [{"size": "M", "stock": 99}]
        upd = requests.put(f"{API}/merchant/products/{pid}", json={"color_variants": new_payload["color_variants"]}, headers=m["headers"], timeout=15)
        assert upd.status_code == 200, upd.text
        doc = upd.json()
        black = next(v for v in doc["color_variants"] if v["id"] == "cv-black")
        assert {s["size"]: s["stock"] for s in black["sizes"]} == {"M": 99}
        assert doc["stock"]["M"] == 99 + 3  # black M + white M

    def test_admin_update_parity(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("AdminUpdateVariants"), headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        payload = _two_color_payload("AdminUpdateVariants")["color_variants"]
        upd = requests.put(f"{API}/admin/products/{pid}", json={"color_variants": payload}, headers=h, timeout=15)
        assert upd.status_code == 200, upd.text
        assert len(upd.json()["color_variants"]) == 2

    def test_invalid_color_variants_payload_rejected(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("InvalidUpdate"), headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        upd = requests.put(f"{API}/merchant/products/{pid}", json={"color_variants": [{"not_a_valid": "shape"}]}, headers=m["headers"], timeout=15)
        assert upd.status_code == 400


class TestOrderPersistsColorAndValidatesInventory:
    """Places orders using the admin token — create_order's own
    customer_user dependency is require_role("customer", "admin"), and an
    admin-authenticated order explicitly skips the "phone must match the
    caller" check (see create_order's own comment: "Admins may place
    orders on behalf of any customer"). This is the same working pattern
    already used elsewhere in this test suite (e.g. admin-token order
    mutations) — the real customer OTP flow stores only a bcrypt hash of
    the OTP (never plaintext, never returned by the API), so it can't be
    read back for a test login the way a merchant/admin password can."""

    def _create_variant_product(self, m):
        r = requests.post(f"{API}/merchant/products", json=_two_color_payload("OrderFlowProduct"), headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def _order_body(self, product, m, *, size, color_variant_id=None, color_name=None, phone_seed=1):
        phone = f"8{int(time.time() * 1000 + phone_seed) % 10 ** 9:09d}"
        item = {"id": product["id"], "qty": 1, "size": size, "price": product["price"], "name": product["name"], "store_id": m["store_id"]}
        if color_variant_id:
            item["color_variant_id"] = color_variant_id
        if color_name:
            item["color_name"] = color_name
        return {
            "items": [item],
            "address": {"city": "Bhilai", "pincode": "490006", "line1": "Test", "name": "Test", "phone": phone},
            "total": product["price"], "payment_method": "COD",
            "customer": {"name": "Test Customer", "phone": phone},
        }

    def test_order_persists_selected_color(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        product = self._create_variant_product(m)
        body = self._order_body(product, m, size="M", color_variant_id="cv-black", color_name="Black", phone_seed=1)
        r = requests.post(f"{API}/orders", json=body, headers=h, timeout=20)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["items"][0]["color_variant_id"] == "cv-black"
        assert order["items"][0]["color_name"] == "Black"

        # Stock for Black/M decremented; White/M untouched.
        fresh = _mongo_db().products.find_one({"id": product["id"]}, {"_id": 0, "color_variants": 1})
        black = next(v for v in fresh["color_variants"] if v["id"] == "cv-black")
        white = next(v for v in fresh["color_variants"] if v["id"] == "cv-white")
        assert next(s["stock"] for s in black["sizes"] if s["size"] == "M") == 4  # 5 - 1
        assert next(s["stock"] for s in white["sizes"] if s["size"] == "M") == 3  # untouched

    def test_two_colors_same_size_do_not_collide(self, admin_auth, approved_merchant_with_store):
        """Ordering Black/M when White/M has plenty of stock but Black/M
        has exactly 1 left must succeed exactly once and then fail on a
        second attempt — proves the atomic check targets the SPECIFIC
        variant+size, not a cross-color sum."""
        h, _ = admin_auth
        m = approved_merchant_with_store
        product = self._create_variant_product(m)
        pid = product["id"]
        _mongo_db().products.update_one(
            {"id": pid, "color_variants.id": "cv-black"},
            {"$set": {"color_variants.$[v].sizes.$[s].stock": 1}},
            array_filters=[{"v.id": "cv-black"}, {"s.size": "M"}],
        )
        body = self._order_body(product, m, size="M", color_variant_id="cv-black", color_name="Black", phone_seed=2)
        first = requests.post(f"{API}/orders", json=body, headers=h, timeout=20)
        assert first.status_code == 200, first.text
        body2 = self._order_body(product, m, size="M", color_variant_id="cv-black", color_name="Black", phone_seed=3)
        second = requests.post(f"{API}/orders", json=body2, headers=h, timeout=20)
        assert second.status_code == 409

        # White/M (untouched, still has stock) can still be ordered fine.
        body3 = self._order_body(product, m, size="M", color_variant_id="cv-white", color_name="White", phone_seed=4)
        white_order = requests.post(f"{API}/orders", json=body3, headers=h, timeout=20)
        assert white_order.status_code == 200, white_order.text

    def test_invalid_color_variant_rejected(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        product = self._create_variant_product(m)
        body = self._order_body(product, m, size="M", color_variant_id="cv-does-not-exist", phone_seed=5)
        r = requests.post(f"{API}/orders", json=body, headers=h, timeout=20)
        assert r.status_code == 400

    def test_size_not_available_for_color_rejected(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        product = self._create_variant_product(m)
        body = self._order_body(product, m, size="XXL", color_variant_id="cv-black", phone_seed=6)
        r = requests.post(f"{API}/orders", json=body, headers=h, timeout=20)
        assert r.status_code == 400


class TestVariantImageOwnershipSafety:
    def test_merchant_can_delete_own_variant_image(self, approved_merchant_with_store):
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("VariantImageOwnership"), headers=m["headers"], timeout=15)
        pid = create.json()["id"]
        db = _mongo_db()
        doc = db.products.find_one({"id": pid}, {"_id": 0, "color_variants": 1})
        public_id = doc["color_variants"][0]["images"][0]["public_id"]
        r = requests.delete(f"{API}/merchant/upload-image", params={"public_id": public_id}, headers=m["headers"], timeout=15)
        assert r.status_code == 200, r.text

    def test_other_merchant_cannot_delete_variant_image(self, approved_merchant_with_store, session):
        """Ownership check must scan color_variants.images.public_id, not
        just the flat image fields — a second merchant must not be able to
        delete the first merchant's variant photo by public_id alone."""
        m = approved_merchant_with_store
        create = requests.post(f"{API}/merchant/products", json=_two_color_payload("VariantImageProtected"), headers=m["headers"], timeout=15)
        db = _mongo_db()
        doc = db.products.find_one({"id": create.json()["id"]}, {"_id": 0, "color_variants": 1})
        public_id = doc["color_variants"][0]["images"][0]["public_id"]

        suffix = uuid.uuid4().hex[:8]
        phone = f"9{int(time.time() * 1000 + 2) % 10 ** 9:09d}"
        reg2 = session.post(f"{API}/auth/register", json={
            "email": f"other_merchant_{suffix}@lokl.in", "password": "Other@2026",
            "store_name": f"Other {suffix}", "owner_name": "Other", "phone": phone, "city": "Bhilai",
        }, timeout=15)
        assert reg2.status_code in (200, 201), reg2.text
        other_mid = reg2.json()["merchant"]["id"]
        other_token = reg2.json()["token"]
        try:
            r = requests.delete(
                f"{API}/merchant/upload-image", params={"public_id": public_id},
                headers={"Authorization": f"Bearer {other_token}"}, timeout=15,
            )
            assert r.status_code == 403
        finally:
            db.merchants.delete_one({"id": other_mid})


class TestAdminMerchantParityForColorVariants:
    def test_admin_and_merchant_creation_produce_same_shape(self, admin_auth, approved_merchant_with_store):
        h, _ = admin_auth
        m = approved_merchant_with_store
        merchant_doc = requests.post(f"{API}/merchant/products", json=_two_color_payload("ParityMerchant"), headers=m["headers"], timeout=15).json()
        admin_doc = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _two_color_payload("ParityAdmin")}, headers=h, timeout=15,
        ).json()
        assert sorted(merchant_doc["color_variants"][0].keys()) == sorted(admin_doc["color_variants"][0].keys())
        assert merchant_doc["stock"] == admin_doc["stock"]
        assert merchant_doc["sizes"] == admin_doc["sizes"]
