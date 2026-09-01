"""Admin Add Product <-> autopublish/visibility consistency — regression
tests for the "Modeladdress" bug class.

Root cause traced and fixed in server.py:
  1. `_create_or_setup_storefront_for_merchant` (the ONE place a `stores`
     document is created) hardcoded `product_count: 0` on first creation
     and never called `_maybe_autopublish_store()` afterward. Admin can
     create products for a merchant BEFORE a storefront exists at all
     (`admin_override=True` bypasses that gate — an intentional onboarding-
     prep feature) — `_create_product_for_merchant` correctly skips its own
     `product_count` update in that case (`if store: ...`) since there's no
     store doc yet, but nothing ever went back and reconciled once the
     storefront doc finally came into existence. A merchant with 7
     admin-created products and a storefront created afterward was stuck at
     `product_count: 0`, `published: False` forever — exactly "Admin
     Products tab: 7, Storefront tab: Products: 0, status: Pending" — until
     some unrelated later product mutation happened to touch that store.
     Fixed: storefront creation now always recomputes `product_count` from
     `db.products` and calls `_maybe_autopublish_store()` itself.
  2. `GET /feed/home-products` (powers TrendingBestDealsRails.tsx's
     "Trending now"/"Best deals") scoped its store query to
     `{"is_deleted": {"$ne": True}}` only — every other product feed
     (`/feed/trending`, `/feed/new-arrivals`, `/feed/best-sellers`,
     `/feed/popular-in-city`, `/feed/selling-fast`, `GET /products`) scopes
     to `_visible_store_filter()`/`_availability_map()` (kyc approved +
     published + not paused/deleted). This was the exact route by which a
     hidden store's products surfaced in Best deals/Trending now while the
     store itself was invisible everywhere else. Fixed to match every other
     feed.
  3. `GET /products/{pid}` (the PDP data source) fetched a product
     unconditionally by id and only used `_visible_store_filter()` to
     decide whether to attach availability badges — an invisible store's
     product was still returned in full. Fixed to 404 for anyone except the
     owning merchant or an admin (best-effort optional-auth check — the
     SAME endpoint is also how the merchant/admin product-edit forms fetch
     a product to populate for editing, which must keep working before a
     store is live).

These three, together, are why a product could be "visible" (PDP,
Trending/Best-deals) while its store was simultaneously "hidden"
(store/category discovery, storefront count, admin status badge).
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


def _valid_storefront_payload(*, area="sector-10", area_label="Sector 10", pincode="490006", lat=21.1998, lng=81.3387):
    return {
        "tagline": "Handpicked ethnic wear", "story": "A small family-run boutique.",
        "banner": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/apc_b1.jpg",
        "banners": ["https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/apc_b1.jpg"],
        "banner_public_ids": ["lokl/banners/apc_test_b1"],
        "logo": "", "logo_public_id": "",
        "specialties": [], "locality": "", "timing": "",
        "opens_at": "10:00", "closes_at": "18:00",
        "lat": lat, "lng": lng,
        "area": area, "area_label": area_label, "pincode": pincode,
        "upi_qr_url": "", "weekly_off": [],
    }


def _product_payload(name, l1_id, l2_id=None):
    p = {"name": name, "price": 499, "mrp": 999, "l1_id": l1_id, "sizes": [], "images": []}
    if l2_id:
        p["l2_id"] = l2_id
    else:
        p["gender"] = "unisex"
    return p


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-autopublish-consistency-tests@lokl.dev"
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
    return {"Authorization": f"Bearer {r.json().get('token')}"}


@pytest.fixture()
def fresh_kyc_approved_merchant(session, admin_auth):
    """A freshly-registered, KYC-approved merchant with NO storefront and NO
    products yet — the exact starting point for every scenario below."""
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
    reg = session.post(f"{API}/auth/register", json={"terms_accepted": True, 
        "store_name": f"Autopublish Test {suffix}", "owner_name": "Test Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=15)
    assert reg.status_code == 200, reg.text
    mid = reg.json()["merchant"]["id"]
    token = reg.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    ks = session.post(f"{API}/merchant/kyc/submit", headers=headers, json={
        "pan_number": "ABCDE1234F", "gst_number": "",
        "business_name": f"Autopublish Test {suffix}", "business_category": "Women",
        "business_address": "Sector 5, Bhilai, Chhattisgarh 490006",
    }, timeout=15)
    assert ks.status_code == 200, ks.text
    ap = requests.post(f"{API}/admin/merchants/{mid}/approve", headers=admin_auth, timeout=15)
    assert ap.status_code == 200, ap.text
    store_id = f"store-m-{mid}"
    yield {"id": mid, "token": token, "headers": headers, "store_id": store_id}
    db = _mongo_db()
    db.merchants.delete_one({"id": mid})
    db.stores.delete_one({"id": store_id})
    db.products.delete_many({"store_id": store_id})


def _first_category(session):
    cats = session.get(f"{API}/categories", timeout=10).json()
    assert cats, "no categories seeded — cannot exercise product creation"
    l1 = cats[0]
    l2_id = l1["l2"][0]["id"] if l1.get("l2") else None
    return l1["id"], l2_id


class TestAdminProductsBeforeStorefrontExists:
    """The exact "Modeladdress" reproduction: admin creates products for a
    KYC-approved merchant BEFORE that merchant has a storefront at all
    (admin_override=True — an intentional onboarding-prep capability), then
    a storefront is created afterward."""

    def test_admin_can_create_products_with_no_storefront_yet(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        assert _mongo_db().stores.find_one({"id": m["store_id"]}) is None, "precondition: no storefront yet"
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Pre-storefront Product", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["merchant_id"] == m["id"]
        assert doc["store_id"] == m["store_id"]
        assert doc["paused"] is False
        assert doc["creation_source"] == "admin_manual"

    def test_seven_products_then_storefront_reconciles_count_and_autopublishes(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        for i in range(7):
            r = requests.post(
                f"{API}/admin/merchants/{m['id']}/products",
                json={"product": _product_payload(f"Modeladdress Repro Product {i}", l1_id, l2_id), "admin_override": True},
                headers=admin_auth, timeout=15,
            )
            assert r.status_code == 200, r.text

        # ADMIN PRODUCTS TAB — direct db.products query by merchant_id,
        # deliberately independent of store visibility (server.py's own
        # documented contract for this endpoint).
        admin_products = requests.get(f"{API}/admin/products", params={"merchant_id": m["id"]}, headers=admin_auth, timeout=15).json()
        assert len(admin_products) == 7, f"admin products tab should show 7, got {len(admin_products)}"

        # No storefront yet -> this is the exact "Storefront tab: Products: 0,
        # status: Pending" state, but it's not a bug YET (nothing to count).
        assert _mongo_db().stores.find_one({"id": m["store_id"]}) is None

        # Now the storefront gets created (admin onboarding it, or the
        # merchant logging in and finishing it themselves — same endpoint
        # either way).
        sf = requests.post(f"{API}/admin/merchants/{m['id']}/storefront", json=_valid_storefront_payload(), headers=admin_auth, timeout=15)
        assert sf.status_code == 200, sf.text
        store = sf.json()["store"]

        # THE BUG: this must be 7, not 0.
        assert store["product_count"] == 7, f"storefront product_count must match the 7 real products, got {store['product_count']}"
        # THE BUG: this must be True — KYC approved + storefront + >=1 active
        # product is the autopublish condition, already satisfied the
        # instant the storefront exists.
        assert store["published"] is True, "store must autopublish the moment its storefront is created with existing active products"

        # Re-fetch independently to make sure this isn't just an artifact of
        # the response body — the actual persisted document must agree.
        persisted = _mongo_db().stores.find_one({"id": m["store_id"]}, {"_id": 0})
        assert persisted["product_count"] == 7
        assert persisted["published"] is True

    def test_store_and_products_become_customer_visible_together(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Customer Visibility Product", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]
        requests.post(f"{API}/admin/merchants/{m['id']}/storefront", json=_valid_storefront_payload(), headers=admin_auth, timeout=15)

        # Store discovery.
        stores = session.get(f"{API}/stores", params={"limit": 500}, timeout=15).json()
        assert any(s.get("id") == m["store_id"] for s in stores), "store must appear in customer store discovery"

        # Product listing (category/search-style query).
        products = session.get(f"{API}/products", params={"l1": l1_id, "limit": 500}, timeout=15).json()
        assert any(p["id"] == pid for p in products), "product must appear in normal product listing"

        # PDP, anonymous.
        pdp = session.get(f"{API}/products/{pid}", timeout=15)
        assert pdp.status_code == 200
        assert pdp.json()["product"]["id"] == pid


class TestMerchantVsAdminProductParity:
    """For the SAME final state, merchant-created and admin-created products
    must be indistinguishable in ownership/counting/autopublish."""

    def test_admin_created_product_matches_merchant_created_shape(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        # Storefront first this time (the "normal" merchant order).
        sf = requests.post(f"{API}/admin/merchants/{m['id']}/storefront", json=_valid_storefront_payload(), headers=admin_auth, timeout=15)
        assert sf.status_code == 200, sf.text
        assert sf.json()["store"]["published"] is False  # 0 products yet — must NOT be live

        merchant_created = session.post(f"{API}/merchant/products", headers=m["headers"], json=_product_payload("Merchant Made", l1_id, l2_id), timeout=15)
        assert merchant_created.status_code == 200, merchant_created.text
        mc = merchant_created.json()

        admin_created = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Admin Made", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        assert admin_created.status_code == 200, admin_created.text
        ac = admin_created.json()

        for key in ("merchant_id", "store_id", "paused", "is_deleted"):
            assert mc.get(key) == ac.get(key), f"{key} differs between merchant-created and admin-created: {mc.get(key)!r} vs {ac.get(key)!r}"

        store = _mongo_db().stores.find_one({"id": m["store_id"]}, {"_id": 0})
        assert store["product_count"] == 2
        assert store["published"] is True


class TestCustomerVisibilityRespectsStoreState:
    """A product's own paused/deleted flags are necessary but NOT sufficient
    — its parent store must also be customer-visible, everywhere."""

    def test_hidden_store_product_absent_from_home_products_feed(self, session, admin_auth, fresh_kyc_approved_merchant):
        """Reproduces 'hidden-store products in Best Deals/Trending Now':
        a product that exists, is unpaused, but whose store was never
        published (no storefront yet) must not appear in
        /feed/home-products (Trending now / Best deals)."""
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": {**_product_payload("Hidden Store Rail Leak", l1_id, l2_id), "mrp": 1999, "price": 999}, "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]
        # Deliberately do NOT create a storefront — store stays nonexistent/unpublished.
        assert _mongo_db().stores.find_one({"id": m["store_id"]}) is None

        feed = session.get(f"{API}/feed/home-products", timeout=15).json()
        all_ids = {p["id"] for p in feed.get("trending", [])} | {p["id"] for p in feed.get("best_deals", [])} | {p["id"] for p in feed.get("premium_picks", [])}
        assert pid not in all_ids, "product from a store with no storefront must not leak into Trending/Best deals/Premium picks"

    def test_hidden_store_product_absent_from_product_listing_and_search(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Hidden Store Listing Leak", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]
        products = session.get(f"{API}/products", params={"l1": l1_id, "limit": 500}, timeout=15).json()
        assert not any(p["id"] == pid for p in products), "product from an invisible store must not appear in product listings"

    def test_pdp_hides_product_from_hidden_store_for_anonymous(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Hidden Store PDP Leak", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]
        anon = session.get(f"{API}/products/{pid}", timeout=15)
        assert anon.status_code == 404, "a direct PDP URL must not expose a product whose store isn't customer-visible"

    def test_pdp_still_reachable_by_owning_merchant_and_admin(self, session, admin_auth, fresh_kyc_approved_merchant):
        """The exact fix must not break the merchant/admin's own product-edit
        prefetch, which hits this same GET /products/{pid} endpoint."""
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Owner Still Sees This", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]

        owner = session.get(f"{API}/products/{pid}", headers=m["headers"], timeout=15)
        assert owner.status_code == 200, "the owning merchant must still be able to fetch their own not-yet-live product"

        as_admin = requests.get(f"{API}/products/{pid}", headers=admin_auth, timeout=15)
        assert as_admin.status_code == 200, "admin must still be able to fetch any product regardless of store visibility"

    def test_other_merchant_cannot_see_hidden_store_product(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        r = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Not Yours To See", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = r.json()["id"]

        suffix = uuid.uuid4().hex[:8]
        other_reg = session.post(f"{API}/auth/register", json={"terms_accepted": True, 
            "store_name": f"Other Merchant {suffix}", "owner_name": "Other",
            "phone": f"8{int(time.time() * 1000) % 10 ** 9:09d}", "city": "Bhilai",
        }, timeout=15)
        other_headers = {"Authorization": f"Bearer {other_reg.json()['token']}"}
        other_r = session.get(f"{API}/products/{pid}", headers=other_headers, timeout=15)
        assert other_r.status_code == 404, "an unrelated merchant must not see another merchant's hidden-store product either"
        _mongo_db().merchants.delete_one({"id": other_reg.json()["merchant"]["id"]})


class TestPauseOnlyProductVisibility:
    def test_pausing_the_only_active_product_removes_it_from_listings_but_store_stays_live(self, session, admin_auth, fresh_kyc_approved_merchant):
        m = fresh_kyc_approved_merchant
        l1_id, l2_id = _first_category(session)
        pr = requests.post(
            f"{API}/admin/merchants/{m['id']}/products",
            json={"product": _product_payload("Only Product", l1_id, l2_id), "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        pid = pr.json()["id"]
        requests.post(f"{API}/admin/merchants/{m['id']}/storefront", json=_valid_storefront_payload(), headers=admin_auth, timeout=15)
        store_before = _mongo_db().stores.find_one({"id": m["store_id"]}, {"_id": 0})
        assert store_before["published"] is True
        assert store_before["product_count"] == 1

        pause = session.put(f"{API}/merchant/products/{pid}", headers=m["headers"], json={"paused": True}, timeout=15)
        assert pause.status_code == 200, pause.text

        store_after = _mongo_db().stores.find_one({"id": m["store_id"]}, {"_id": 0})
        assert store_after["product_count"] == 0, "pausing the only product must bring product_count back to 0"
        # A store that has already gone live stays live (an intentional,
        # pre-existing design choice — see _visible_store_filter()'s own
        # doc comment distinguishing "online" from "published") — pausing
        # its only product is a legitimate "temporarily nothing for sale"
        # state, not an un-publish event.
        assert store_after["published"] is True

        anon = session.get(f"{API}/products/{pid}", timeout=15)
        assert anon.status_code == 404, "a paused product's PDP must be hidden from anonymous visitors, consistent with every listing rail"
        owner = session.get(f"{API}/products/{pid}", headers=m["headers"], timeout=15)
        assert owner.status_code == 200, "the owning merchant must still see their own paused product (e.g. to un-pause it)"
        products = session.get(f"{API}/products", params={"l1": l1_id, "limit": 500}, timeout=15).json()
        assert not any(p["id"] == pid for p in products), "a paused product must not appear in product listings"
