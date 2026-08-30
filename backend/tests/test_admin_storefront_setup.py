"""Admin storefront setup — regression tests.

Covers the capability gap where admin had no way to create a merchant's
storefront on their behalf (only PUT /admin/stores/{id}, which requires one
to already exist). POST /admin/merchants/{merchant_id}/storefront reuses the
exact same `_create_or_setup_storefront_for_merchant` canonical helper
POST /merchant/storefront calls — see server.py — so these tests verify:
  - the new admin endpoint's own contract (auth, 404, 409-on-duplicate,
    field validation identical to the merchant flow),
  - that the merchant flow itself is unaffected by the refactor,
  - that an admin-created storefront behaves exactly like a merchant-created
    one afterward (admin PUT-editable, merchant GET/POST-accessible).

Same live-HTTP-against-local-backend convention as
test_admin_merchant_parity.py, including the self-sufficient admin_auth
fixture (creates its own admin_users record directly via Mongo).
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


def _valid_payload(*, area="sector-10", area_label="Sector 10", pincode="490006", lat=21.1998, lng=81.3387):
    """Mirrors exactly what the real StorefrontForm submits (see
    components/storefront/StorefrontForm.tsx's submit()) — every field the
    backend's StorefrontUpdate model accepts."""
    return {
        "tagline": "Handpicked ethnic wear", "story": "A small family-run boutique.",
        "banner": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/setup_b1.jpg",
        "banners": ["https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/setup_b1.jpg"],
        "banner_public_ids": ["lokl/banners/test_setup_b1"],
        "logo": "", "logo_public_id": "",
        "specialties": [], "locality": "", "timing": "",
        "opens_at": "10:00", "closes_at": "18:00",
        "lat": lat, "lng": lng,
        "area": area, "area_label": area_label, "pincode": pincode,
        "upi_qr_url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/setup_qr.jpg",
        "weekly_off": [],
    }


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-storefront-setup-tests@lokl.dev"
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
def fresh_merchant_no_store(session):
    """A freshly-registered merchant with NO storefront and NO KYC approval
    — the exact "admin onboarding a brand-new merchant" scenario this
    feature targets. /auth/register never auto-creates a stores document."""
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
    reg = session.post(f"{API}/auth/register", json={
        "email": f"sf_setup_{suffix}@lokl.in", "password": "SetupTest@2026",
        "store_name": f"Setup Test {suffix}", "owner_name": "Setup Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=15)
    assert reg.status_code in (200, 201), reg.text
    mid = reg.json()["merchant"]["id"]
    mtok = reg.json()["token"]
    store_id = f"store-m-{mid}"
    db = _mongo_db()
    assert db.stores.find_one({"id": store_id}) is None, "precondition: merchant must start with no storefront"
    yield {"merchant_id": mid, "store_id": store_id, "token": mtok}
    db.merchants.delete_one({"id": mid})
    db.stores.delete_one({"id": store_id})


class TestAdminCanCreateStorefront:
    def test_creates_storefront_for_merchant_with_none(self, admin_auth, fresh_merchant_no_store):
        mid = fresh_merchant_no_store["merchant_id"]
        r = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        store = body["store"]
        assert store["id"] == fresh_merchant_no_store["store_id"]
        assert store["merchant_id"] == mid
        assert store["tagline"] == "Handpicked ethnic wear"
        # Never publicly published just from being set up, regardless of
        # who created it or the merchant's KYC state.
        assert store["published"] is False
        # Provenance recorded — mirrors the `products` collection's own
        # creation_source/created_by fields.
        assert store["creation_source"] == "admin"
        assert store["created_by"]
        # KYC not approved yet — the store doc must reflect that truthfully
        # (not hardcoded "approved"), since _visible_store_filter() gates
        # customer visibility on this exact field.
        assert store["kyc_status"] != "approved"

    def test_valid_lat_lng_produces_expected_location(self, admin_auth, fresh_merchant_no_store):
        mid = fresh_merchant_no_store["merchant_id"]
        r = requests.post(
            f"{API}/admin/merchants/{mid}/storefront",
            json=_valid_payload(lat=21.2034, lng=81.3456), headers=admin_auth, timeout=15,
        )
        assert r.status_code == 200, r.text
        store = r.json()["store"]
        assert store["lat"] == 21.2034 and store["lng"] == 81.3456
        assert store["location"] == {"type": "Point", "coordinates": [81.3456, 21.2034]}

    def test_store_immediately_usable_for_admin_product_creation(self, admin_auth, fresh_merchant_no_store):
        """Confirms the operational flow the feature is built for: admin
        sets up the storefront, then immediately adds a product for that
        merchant — no separate "wait for merchant to log in" step."""
        mid = fresh_merchant_no_store["merchant_id"]
        r = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert r.status_code == 200, r.text

        cats = requests.get(f"{API}/categories", timeout=10).json()
        l1 = next((c for c in cats if c.get("id")), None)
        assert l1, "no categories seeded — cannot exercise product creation"
        product = {"name": "Setup Flow Product", "price": 499, "l1_id": l1["id"], "sizes": [], "images": []}
        if l1.get("l2"):
            product["l2_id"] = l1["l2"][0]["id"]
        else:
            product["gender"] = "unisex"
        pr = requests.post(
            f"{API}/admin/merchants/{mid}/products",
            json={"product": product, "admin_override": True},
            headers=admin_auth, timeout=15,
        )
        assert pr.status_code == 200, pr.text
        assert pr.json()["store_id"] == fresh_merchant_no_store["store_id"]


class TestAdminStorefrontAuthAndNotFound:
    def test_requires_admin_no_token(self, fresh_merchant_no_store):
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=_valid_payload(), timeout=10)
        assert r.status_code == 401

    def test_merchant_token_rejected(self, fresh_merchant_no_store):
        mh = {"Authorization": f"Bearer {fresh_merchant_no_store['token']}"}
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=_valid_payload(), headers=mh, timeout=10)
        assert r.status_code == 403

    def test_nonexistent_merchant_404(self, admin_auth):
        r = requests.post(f"{API}/admin/merchants/merchant-does-not-exist/storefront",
                           json=_valid_payload(), headers=admin_auth, timeout=10)
        assert r.status_code == 404


class TestAdminStorefrontDuplicatePrevention:
    def test_second_create_call_rejected(self, admin_auth, fresh_merchant_no_store):
        mid = fresh_merchant_no_store["merchant_id"]
        first = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert first.status_code == 200, first.text
        second = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert second.status_code == 409
        # Duplicate rejection must not have mutated the original document.
        db = _mongo_db()
        assert db.stores.count_documents({"id": fresh_merchant_no_store["store_id"]}) == 1


class TestAdminStorefrontValidation:
    def test_missing_pincode_rejected(self, admin_auth, fresh_merchant_no_store):
        payload = _valid_payload(pincode="")
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=payload, headers=admin_auth, timeout=10)
        assert r.status_code == 400

    def test_missing_area_rejected(self, admin_auth, fresh_merchant_no_store):
        # Mirrors the merchant flow's own validation exactly (server.py's
        # `_create_or_setup_storefront_for_merchant`): the backend checks
        # only for a non-empty area slug — there's no server-side check
        # against the BHILAI_AREAS list itself (that list is frontend-only,
        # used to populate the picker). "Invalid" here means empty/missing,
        # same as what a merchant hitting Save with no area selected gets.
        payload = _valid_payload(area="", area_label="")
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=payload, headers=admin_auth, timeout=10)
        assert r.status_code == 400

    def test_invalid_lat_lng_rejected(self, admin_auth, fresh_merchant_no_store):
        payload = _valid_payload(lat=999, lng=81.3)
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=payload, headers=admin_auth, timeout=10)
        assert r.status_code == 400

    def test_missing_lat_lng_rejected(self, admin_auth, fresh_merchant_no_store):
        payload = _valid_payload()
        payload["lat"] = None
        payload["lng"] = None
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=payload, headers=admin_auth, timeout=10)
        assert r.status_code == 400

    def test_missing_required_pydantic_field_rejected(self, admin_auth, fresh_merchant_no_store):
        """tagline/story/banner are non-optional on StorefrontUpdate — same
        Pydantic-level requirement the merchant flow's request body has."""
        payload = _valid_payload()
        del payload["tagline"]
        r = requests.post(f"{API}/admin/merchants/{fresh_merchant_no_store['merchant_id']}/storefront",
                           json=payload, headers=admin_auth, timeout=10)
        assert r.status_code == 422


class TestMerchantFlowUnaffectedAndInteroperates:
    def test_merchant_storefront_post_still_works(self, session):
        """POST /merchant/storefront must behave exactly as before the
        refactor: KYC-approved merchant, valid payload -> 200 + upsert."""
        suffix = uuid.uuid4().hex[:8]
        phone = f"9{int(time.time() * 1000 + 1) % 10 ** 9:09d}"
        reg = session.post(f"{API}/auth/register", json={
            "email": f"sf_merchant_flow_{suffix}@lokl.in", "password": "MerchTest@2026",
            "store_name": f"Merchant Flow {suffix}", "owner_name": "Owner",
            "phone": phone, "city": "Bhilai",
        }, timeout=15)
        assert reg.status_code in (200, 201), reg.text
        mid = reg.json()["merchant"]["id"]
        mtok = reg.json()["token"]
        db = _mongo_db()
        try:
            db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved"}})
            mh = {"Authorization": f"Bearer {mtok}"}
            r = session.post(f"{API}/merchant/storefront", json=_valid_payload(), headers=mh, timeout=15)
            assert r.status_code == 200, r.text
            store = r.json()["store"]
            assert store["creation_source"] == "merchant"
            assert store["created_by"] is None
            assert store["kyc_status"] == "approved"
        finally:
            db.merchants.delete_one({"id": mid})
            db.stores.delete_one({"id": f"store-m-{mid}"})

    def test_merchant_kyc_still_gated_without_admin_bypass(self, fresh_merchant_no_store):
        """The merchant-authenticated path must remain gated on KYC exactly
        as before — bypass_kyc_gate is admin-only and never reachable from
        this endpoint."""
        mh = {"Authorization": f"Bearer {fresh_merchant_no_store['token']}"}
        r = requests.post(f"{API}/merchant/storefront", json=_valid_payload(), headers=mh, timeout=15)
        assert r.status_code == 403

    def test_admin_created_storefront_editable_via_admin_update(self, admin_auth, fresh_merchant_no_store):
        mid = fresh_merchant_no_store["merchant_id"]
        create = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert create.status_code == 200, create.text
        store_id = create.json()["store"]["id"]

        upd = requests.put(f"{API}/admin/stores/{store_id}", json={"tagline": "Updated by admin"}, headers=admin_auth, timeout=15)
        assert upd.status_code == 200, upd.text
        assert upd.json()["tagline"] == "Updated by admin"

    def test_merchant_can_access_admin_created_storefront(self, admin_auth, fresh_merchant_no_store):
        """GET /merchant/storefront has no KYC gate — the merchant must be
        able to see an admin-created storefront immediately."""
        mid = fresh_merchant_no_store["merchant_id"]
        create = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert create.status_code == 200, create.text

        mh = {"Authorization": f"Bearer {fresh_merchant_no_store['token']}"}
        got = requests.get(f"{API}/merchant/storefront", headers=mh, timeout=10)
        assert got.status_code == 200
        assert got.json().get("tagline") == "Handpicked ethnic wear"

    def test_merchant_can_edit_admin_created_storefront_once_kyc_approved(self, admin_auth, fresh_merchant_no_store):
        """Once KYC is later approved, the merchant's own POST
        /merchant/storefront must work on the admin-created document exactly
        like it would on a self-created one — same upsert path, same id."""
        mid = fresh_merchant_no_store["merchant_id"]
        create = requests.post(f"{API}/admin/merchants/{mid}/storefront", json=_valid_payload(), headers=admin_auth, timeout=15)
        assert create.status_code == 200, create.text

        db = _mongo_db()
        db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved"}})
        mh = {"Authorization": f"Bearer {fresh_merchant_no_store['token']}"}
        upd_payload = _valid_payload()
        upd_payload["tagline"] = "Updated by the merchant themselves"
        upd = requests.post(f"{API}/merchant/storefront", json=upd_payload, headers=mh, timeout=15)
        assert upd.status_code == 200, upd.text
        store = upd.json()["store"]
        assert store["id"] == fresh_merchant_no_store["store_id"]
        assert store["tagline"] == "Updated by the merchant themselves"
        # Original admin provenance is preserved across the merchant's edit.
        assert store["creation_source"] == "admin"
