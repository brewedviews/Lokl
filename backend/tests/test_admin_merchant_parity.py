"""Merchant/Admin capability-parity audit — regression tests.

Covers the gaps found when auditing exactly what fields/controls a
merchant has in KYC, Bank Details, Storefront, and Products, then giving
Admin the same capabilities for a selected merchant wherever appropriate:

  - Storefront: PUT /admin/stores/{id} gained banner_public_ids,
    logo_public_id, upi_qr_url, lat, lng, area_slug — every one of these
    is a field the merchant's own POST /merchant/storefront already lets
    them set; nothing invented. lat/lng must be updated together (mirrors
    storefront_update's own location-derivation requirement).
  - Bank/address change requests: POST /admin/change-requests/{id}/approve
    and /reject already existed and are UNCHANGED here — this just adds a
    regression guard confirming they still apply the change correctly,
    now that a frontend UI (ActivitySection) depends on them.
  - KYC: deliberately NOT extended — admin_update_merchant's own docstring
    explicitly excludes KYC/bank fields from free-text editing ("those are
    reviewed via the approve/reject/hold flow"), so admin already has
    full parity via the pre-existing approve/reject/hold + signed-doc-url
    flow. No test needed for a no-op — see the audit report instead.

Same live-HTTP-against-local-backend convention as
test_admin_product_creation.py, including the self-sufficient admin_auth
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


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-merchant-parity-tests@lokl.dev"
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
def fresh_merchant_with_store(session):
    """A freshly-registered merchant with a real storefront doc, so
    PUT /admin/stores/{id} has something to operate on without touching
    any shared demo data. Cleaned up after the test."""
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time()) % 10**9:09d}"
    reg = session.post(f"{API}/auth/register", json={
        "email": f"parity_test_{suffix}@lokl.in", "password": "ParityTest@2026",
        "store_name": f"Parity Test {suffix}", "owner_name": "Parity Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=15)
    assert reg.status_code in (200, 201), reg.text
    mid = reg.json()["merchant"]["id"]
    mtok = reg.json()["token"]
    db = _mongo_db()
    store_id = f"store-m-{mid}"
    db.stores.update_one(
        {"id": store_id},
        {"$set": {"id": store_id, "merchant_id": mid, "name": f"Parity Test {suffix}", "published": False}},
        upsert=True,
    )
    yield {"merchant_id": mid, "store_id": store_id, "token": mtok}
    db.merchants.delete_one({"id": mid})
    db.stores.delete_one({"id": store_id})
    db.change_requests.delete_many({"merchant_id": mid})


class TestAdminStorefrontParity:
    def test_lat_without_lng_rejected(self, admin_auth, fresh_merchant_with_store):
        r = requests.put(
            f"{API}/admin/stores/{fresh_merchant_with_store['store_id']}",
            json={"lat": 21.19}, headers=admin_auth, timeout=10,
        )
        assert r.status_code == 400
        assert "together" in r.text.lower()

    def test_invalid_coordinates_rejected(self, admin_auth, fresh_merchant_with_store):
        r = requests.put(
            f"{API}/admin/stores/{fresh_merchant_with_store['store_id']}",
            json={"lat": 999, "lng": 81.3}, headers=admin_auth, timeout=10,
        )
        assert r.status_code == 400

    def test_full_parity_fields_persist(self, admin_auth, fresh_merchant_with_store):
        store_id = fresh_merchant_with_store["store_id"]
        body = {
            "area_slug": "sector-10", "area_label": "Sector 10", "pincode": "490006",
            "lat": 21.1998, "lng": 81.3387,
            "upi_qr_url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/qr.jpg",
            "banners": ["https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/b1.jpg"],
            "banner_public_ids": ["lokl/banners/test_parity_b1"],
        }
        r = requests.put(f"{API}/admin/stores/{store_id}", json=body, headers=admin_auth, timeout=10)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["area_slug"] == "sector-10"
        assert doc["upi_qr_url"] == body["upi_qr_url"]
        assert doc["banner_public_ids"] == ["lokl/banners/test_parity_b1"]
        assert doc["lat"] == 21.1998 and doc["lng"] == 81.3387
        assert doc["location"] == {"type": "Point", "coordinates": [81.3387, 21.1998]}

    def test_requires_admin(self, fresh_merchant_with_store):
        r = requests.put(
            f"{API}/admin/stores/{fresh_merchant_with_store['store_id']}",
            json={"upi_qr_url": "https://example.com/x.jpg"}, timeout=10,
        )
        assert r.status_code == 401


class TestChangeRequestApproveReject:
    def test_approve_applies_bank_fields_to_merchant(self, admin_auth, fresh_merchant_with_store):
        mh = {"Authorization": f"Bearer {fresh_merchant_with_store['token']}"}
        new_values = {"bank_account_number": "1234567890", "bank_ifsc": "SBIN0001234", "account_holder_name": "Parity Owner"}
        sub = requests.post(f"{API}/merchant/change-request", json={
            "change_type": "bank", "new_values": new_values,
            "supporting_doc_b64": "", "reason": "test",
        }, headers=mh, timeout=15)
        assert sub.status_code == 200, sub.text
        cr_id = sub.json()["id"]

        r = requests.post(f"{API}/admin/change-requests/{cr_id}/approve", headers=admin_auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

        me = requests.get(f"{API}/auth/me", headers=mh, timeout=10).json()
        assert me.get("bank_account_number") == "1234567890"
        assert me.get("bank_ifsc") == "SBIN0001234"

    def test_reject_does_not_apply_changes(self, admin_auth, fresh_merchant_with_store):
        mh = {"Authorization": f"Bearer {fresh_merchant_with_store['token']}"}
        sub = requests.post(f"{API}/merchant/change-request", json={
            "change_type": "bank",
            "new_values": {"bank_account_number": "9999999999", "bank_ifsc": "HDFC0009999", "account_holder_name": "Should Not Apply"},
            "supporting_doc_b64": "", "reason": "test",
        }, headers=mh, timeout=15)
        cr_id = sub.json()["id"]

        r = requests.post(f"{API}/admin/change-requests/{cr_id}/reject", json={"reason": "unclear docs"}, headers=admin_auth, timeout=15)
        assert r.status_code == 200

        me = requests.get(f"{API}/auth/me", headers=mh, timeout=10).json()
        assert me.get("bank_account_number") != "9999999999"

    def test_requires_admin(self):
        r = requests.post(f"{API}/admin/change-requests/cr-does-not-exist/approve", timeout=10)
        assert r.status_code == 401
