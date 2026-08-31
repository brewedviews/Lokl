"""Phase A — Smart redirect + auto-publish + analytics trend gap-fill."""
import os, uuid, pytest, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASS = "Admin@2026"


def _admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    return r.json()["token"]


def _register_merchant():
    email = f"phaseA_{uuid.uuid4().hex[:8]}@lokl.in"
    phone = f"+9199{str(uuid.uuid4().int)[:8]}"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "PhaseA@2026",
        "store_name": f"PhaseA {uuid.uuid4().hex[:4]}",
        "owner_name": "PhaseA Owner", "phone": phone, "city": "Bhilai",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["merchant"]["id"]


def test_next_route_for_fresh_merchant_is_onboarding_hub():
    # A merchant who hasn't finished KYC always lands on the onboarding hub
    # now, never a raw jump into /merchant/kyc — the hub's own CTA is what
    # sends them into the verification form.
    tok, _ = _register_merchant()
    r = requests.get(f"{API}/merchant/next-route", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["route"] == "/merchant/onboarding"


def test_next_route_after_approval_storefront_products_publish():
    tok, mid = _register_merchant()
    # Submit KYC
    requests.post(f"{API}/merchant/kyc", headers={"Authorization": f"Bearer {tok}"},
                  json={"gst": "27ABCDE1234F1Z5", "pan": "ABCDE1234F",
                        "owner_name": "X", "store_address": "Bhilai",
                        "gst_doc_b64": "x", "pan_doc_b64": "x", "selfie_b64": "x"},
                  timeout=30)
    # Approve via admin
    atok = _admin_token()
    requests.post(f"{API}/admin/merchants/{mid}/approve",
                  headers={"Authorization": f"Bearer {atok}"}, timeout=30)
    # next-route after approval, no storefront → still the onboarding hub
    # (the hub's own CTA is what sends the merchant into /merchant/storefront)
    r = requests.get(f"{API}/merchant/next-route", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.json()["route"] == "/merchant/onboarding", r.text
    # set storefront
    requests.post(f"{API}/merchant/storefront", headers={"Authorization": f"Bearer {tok}"}, json={
        "tagline": "Fashion everyday", "story": "We make great stuff",
        "specialties": [], "banner": "x", "banners": ["x"],
        "address": "Bhilai", "area": "Sector 6", "locality": "Sector 6", "city": "Bhilai",
        "opens_at": "10:00", "closes_at": "18:00", "timing": "10:00 - 18:00",
    }, timeout=30)
    r = requests.get(f"{API}/merchant/next-route", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.json()["route"] == "/merchant/products", r.text
    # add a product (auto-published)
    p = requests.post(f"{API}/merchant/products", headers={"Authorization": f"Bearer {tok}"}, json={
        "name": "Test Tee", "description": "ok", "l1_id": "l1-men", "l2_id": "l2-m-tshirt",
        "gender": "men", "price": 599, "mrp": 999, "image": "x", "images": ["x"],
        "sizes": ["M"], "stock": {"M": 5},
    }, timeout=30)
    assert p.status_code == 200, p.text
    r = requests.get(f"{API}/merchant/next-route", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.json()["route"] == "/merchant/orders", r.text
    # confirm auto-publish flipped the store visible to customers
    stores = requests.get(f"{API}/stores?limit=200", timeout=30).json()
    sid = f"store-m-{mid}"
    assert any(s.get("id") == sid for s in stores), "auto-publish should make store visible"


def test_analytics_trend_is_gap_filled():
    tok, _ = _register_merchant()
    r = requests.get(f"{API}/merchant/analytics?period=30d",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    # Even for a brand-new merchant with 0 orders, trend must be a continuous 14-day array.
    assert isinstance(body["trend"], list) and len(body["trend"]) == 14
    # Every day must be a 0 (or positive) revenue stub
    for d in body["trend"]:
        assert "date" in d and "revenue" in d
        assert d["revenue"] == 0
