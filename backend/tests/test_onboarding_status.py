"""Merchant onboarding-status + request-assistance — regression tests.

Covers the two new, purely-additive endpoints backing the onboarding UX
redesign:
  - GET  /merchant/onboarding-status  (richer state for the "Getting your
    shop ready" screen and the persistent dashboard banner — replaces the
    old checklist's hardcoded `done: false`)
  - POST /merchant/support/request-assistance  ("Need help?" — reuses the
    existing db.support_tickets / /admin/support/tickets* queue, no new
    ticketing system)

Neither endpoint changes any existing gate (`_merchant_next_route`,
`_create_or_setup_storefront_for_merchant`, `_create_product_for_merchant`,
`_maybe_autopublish_store`) — these tests only assert the new read/write
surface reports the SAME underlying state truthfully across every
onboarding state.

Same live-HTTP-against-local-backend convention as
test_admin_storefront_setup.py, including its self-sufficient admin_auth
fixture.
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
        "banner": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/onb_b1.jpg",
        "banners": ["https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/onb_b1.jpg"],
        "banner_public_ids": ["lokl/banners/onb_test_b1"],
        "logo": "", "logo_public_id": "",
        "specialties": [], "locality": "", "timing": "",
        "opens_at": "10:00", "closes_at": "18:00",
        "lat": lat, "lng": lng,
        "area": area, "area_label": area_label, "pincode": pincode,
        "upi_qr_url": "", "weekly_off": [],
    }


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    db = _mongo_db()
    email = "admin-onboarding-status-tests@lokl.dev"
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


def _register_merchant(session):
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time() * 1000) % 10 ** 9:09d}"
    r = session.post(f"{API}/auth/register", json={
        "store_name": f"Onboarding Status Test {suffix}", "owner_name": "Test Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    mid = body["merchant"]["id"]
    return {
        "id": mid,
        "store_id": f"store-m-{mid}",
        "headers": {"Authorization": f"Bearer {body['token']}"},
    }


@pytest.fixture()
def fresh_merchant(session):
    m = _register_merchant(session)
    yield m
    db = _mongo_db()
    db.merchants.delete_one({"id": m["id"]})
    db.stores.delete_one({"id": m["store_id"]})
    db.products.delete_many({"store_id": m["store_id"]})
    db.support_tickets.delete_many({"merchant_id": m["id"]})


def _submit_kyc(session, merchant):
    payload = {
        "pan_number": "ABCDE1234F", "gst_number": "",
        "business_name": "Test Boutique", "business_category": "Ethnic Wear",
        "business_address": "Sector 5, Bhilai, Chhattisgarh 490006",
    }
    r = session.post(f"{API}/merchant/kyc/submit", headers=merchant["headers"], json=payload, timeout=15)
    assert r.status_code == 200, r.text


class TestOnboardingStatusStates:
    def test_brand_new_merchant_is_verify_business_not_started(self, session, fresh_merchant):
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["step"] == "verify_business"
        assert body["verify_business"]["status"] == "not_started"
        assert body["setup_shop"]["status"] == "locked"
        assert body["add_products"]["status"] == "locked"
        assert body["published"] is False
        assert body["next_action"]["path"] == "/merchant/kyc"
        # Alignment check: next-route must never jump straight past the hub.
        rn = session.get(f"{API}/merchant/next-route", headers=fresh_merchant["headers"], timeout=10)
        assert rn.json()["route"] == "/merchant/onboarding"

    def test_kyc_submitted_is_in_review(self, session, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["step"] == "verify_business"
        assert body["verify_business"]["status"] == "in_review"
        assert body["setup_shop"]["status"] == "locked"
        rn = session.get(f"{API}/merchant/next-route", headers=fresh_merchant["headers"], timeout=10)
        assert rn.json()["route"] == "/merchant/onboarding"

    def test_kyc_on_hold_is_needs_changes_with_reason(self, session, admin_auth, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        rh = requests.post(f"{API}/admin/merchants/{fresh_merchant['id']}/hold",
                            json={"comment": "Please re-upload a clearer PAN photo."}, headers=admin_auth, timeout=10)
        assert rh.status_code == 200, rh.text
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["verify_business"]["status"] == "needs_changes"
        assert "PAN" in (body["verify_business"]["blocked_reason"] or "")

    def test_kyc_rejected_is_needs_changes_with_reason(self, session, admin_auth, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        rr = requests.post(f"{API}/admin/merchants/{fresh_merchant['id']}/reject",
                            json={"reason": "PAN does not match business name."}, headers=admin_auth, timeout=10)
        assert rr.status_code == 200, rr.text
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["verify_business"]["status"] == "needs_changes"
        assert "PAN" in (body["verify_business"]["blocked_reason"] or "")

    def test_approved_no_storefront_is_setup_shop_not_started(self, session, admin_auth, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        ra = requests.post(f"{API}/admin/merchants/{fresh_merchant['id']}/approve", headers=admin_auth, timeout=10)
        assert ra.status_code == 200, ra.text
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["step"] == "setup_shop"
        assert body["verify_business"]["status"] == "completed"
        assert body["setup_shop"]["status"] == "not_started"
        assert body["add_products"]["status"] == "locked"
        assert body["next_action"]["path"] == "/merchant/storefront"
        # Critical alignment check for the reported bug: next-route must
        # NOT send this merchant straight into /merchant/storefront on its
        # own — it lands on the hub, and the hub's own CTA (asserted above)
        # is what points at /merchant/storefront. If next-route disagreed
        # here, a login/refresh mid-onboarding could bypass the hub entirely.
        rn = session.get(f"{API}/merchant/next-route", headers=fresh_merchant["headers"], timeout=10)
        assert rn.json()["route"] == "/merchant/onboarding"

    def test_storefront_done_no_products_is_add_products_not_started(self, session, admin_auth, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        requests.post(f"{API}/admin/merchants/{fresh_merchant['id']}/approve", headers=admin_auth, timeout=10)
        rs = session.post(f"{API}/merchant/storefront", headers=fresh_merchant["headers"],
                           json=_valid_storefront_payload(), timeout=15)
        assert rs.status_code == 200, rs.text
        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["step"] == "add_products"
        assert body["setup_shop"]["status"] == "completed"
        assert body["add_products"]["status"] == "not_started"
        assert body["add_products"]["active_count"] == 0
        assert body["published"] is False
        assert body["next_action"]["path"] == "/merchant/products"
        # Once shop setup is done, next-route agrees exactly with next_action
        # — this is the point the merchant leaves the onboarding shell.
        rn = session.get(f"{API}/merchant/next-route", headers=fresh_merchant["headers"], timeout=10)
        assert rn.json()["route"] == "/merchant/products"

    def test_one_product_added_is_live_and_autopublished(self, session, admin_auth, fresh_merchant):
        _submit_kyc(session, fresh_merchant)
        requests.post(f"{API}/admin/merchants/{fresh_merchant['id']}/approve", headers=admin_auth, timeout=10)
        session.post(f"{API}/merchant/storefront", headers=fresh_merchant["headers"],
                     json=_valid_storefront_payload(), timeout=15)
        cats = requests.get(f"{API}/categories", timeout=10).json()
        l1 = cats[0]
        product = {"name": "Onboarding Status Test Product", "price": 499, "l1_id": l1["id"], "sizes": [], "images": []}
        if l1.get("l2"):
            product["l2_id"] = l1["l2"][0]["id"]
        else:
            product["gender"] = "unisex"
        rp = session.post(f"{API}/merchant/products", headers=fresh_merchant["headers"], json=product, timeout=15)
        assert rp.status_code == 200, rp.text

        r = session.get(f"{API}/merchant/onboarding-status", headers=fresh_merchant["headers"], timeout=10)
        body = r.json()
        assert body["step"] == "live"
        assert body["add_products"]["status"] == "completed"
        assert body["add_products"]["active_count"] == 1
        assert body["published"] is True
        assert body["store_id"] == fresh_merchant["store_id"]
        # Dashboard is out of the active merchant journey — a live merchant's
        # next action is managing orders, not analytics.
        assert body["next_action"]["path"] == "/merchant/orders"
        rn = session.get(f"{API}/merchant/next-route", headers=fresh_merchant["headers"], timeout=10)
        assert rn.json()["route"] == "/merchant/orders"

    def test_requires_merchant_auth(self, session):
        r = session.get(f"{API}/merchant/onboarding-status", timeout=10)
        assert r.status_code in (401, 403)


class TestRequestAssistance:
    def test_creates_a_ticket_visible_to_admin(self, session, admin_auth, fresh_merchant):
        r = session.post(
            f"{API}/merchant/support/request-assistance",
            headers=fresh_merchant["headers"],
            json={"message": "I don't have time to do this, please set it up for me."},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ticket = r.json()
        assert ticket["merchant_id"] == fresh_merchant["id"]
        assert ticket["source"] == "merchant_onboarding"
        assert ticket["status"] == "open"
        assert "please set it up for me" in ticket["message"]

        # Reuses the EXISTING admin ticket queue — no new admin surface.
        rl = requests.get(f"{API}/admin/support/tickets", headers=admin_auth, timeout=10)
        assert rl.status_code == 200
        ids = [t["id"] for t in rl.json()["tickets"]]
        assert ticket["id"] in ids

    def test_default_message_when_none_provided(self, session, fresh_merchant):
        r = session.post(
            f"{API}/merchant/support/request-assistance",
            headers=fresh_merchant["headers"], json={}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["message"]

    def test_requires_merchant_auth(self, session):
        r = session.post(f"{API}/merchant/support/request-assistance", json={}, timeout=10)
        assert r.status_code in (401, 403)

    def test_merchant_id_cannot_be_spoofed_via_payload(self, session, fresh_merchant):
        """merchant_id must come from the auth token, never the body — a
        malicious payload trying to attribute the ticket elsewhere is ignored."""
        r = session.post(
            f"{API}/merchant/support/request-assistance",
            headers=fresh_merchant["headers"],
            json={"merchant_id": "m-someone-else", "message": "hi"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["merchant_id"] == fresh_merchant["id"]
