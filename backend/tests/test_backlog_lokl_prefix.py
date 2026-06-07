"""
Backlog phase test — Lokl stabilization
========================================
Covers two backend deliverables:

  1. Order ID prefix migration BFO- → LOKL-
     - New orders placed via POST /api/orders must have an `id` matching
       ^LOKL-[0-9A-F]{8}$.
     - Pre-existing BFO- orders must still be retrievable via
       GET /api/orders/{id}.

  2. Complaint resolve must 404 on unknown id
     - POST /api/admin/complaints/INVALID-ID-XYZ/resolve → 404
     - Valid complaint id still resolves with 200.

The order-placement leg uses the live OTP-debug flow (CUSTOMER_OTP_DEBUG=true
scrapes /var/log/supervisor/backend.err.log) and the demo product feed from
GET /api/products. We pick the first product with positive stock so we don't
need to seed anything ourselves.
"""
import os
import re
import subprocess
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASSWORD = "Admin@2026"

ORDER_ID_RE = re.compile(r"^LOKL-[0-9A-F]{8}$")


# ---------- Fixtures ----------------------------------------------------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in admin login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def admin_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def customer_session():
    """Drive the OTP flow once and reuse for the rest of the module."""
    phone = "9876501234"
    r = requests.post(f"{API}/auth/customer/request-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, f"request-otp failed: {r.status_code} {r.text}"
    time.sleep(0.6)
    try:
        line = subprocess.check_output(
            "grep 'OTP-DEBUG' /var/log/supervisor/backend.err.log | tail -1",
            shell=True,
        ).decode().strip()
    except subprocess.CalledProcessError:
        pytest.skip("OTP-DEBUG not enabled in backend logs — cannot scrape OTP")
    m = re.search(r"otp=(\d+)", line)
    assert m, f"could not parse OTP from log line: {line!r}"
    otp = m.group(1)
    r = requests.post(
        f"{API}/auth/customer/verify-otp",
        json={"phone": phone, "otp": otp},
        timeout=15,
    )
    assert r.status_code == 200, f"verify-otp failed: {r.status_code} {r.text}"
    body = r.json()
    return {"phone": body["phone"], "token": body["token"]}


@pytest.fixture(scope="module")
def live_product():
    """Pick the first published product with stock > 0 from the public feed."""
    r = requests.get(f"{API}/products", timeout=15)
    assert r.status_code == 200, f"products feed failed: {r.status_code}"
    products = r.json()
    assert isinstance(products, list) and products, "no products in feed"
    for p in products:
        if p.get("is_deleted") or p.get("paused"):
            continue
        sizes = p.get("sizes") or []
        stock = p.get("stock") or {}
        for sz in sizes:
            if int(stock.get(sz, 0)) > 0:
                return {"product": p, "size": sz}
    pytest.skip("no product with positive stock available in feed")


# ---------- Tests: LOKL- order-id prefix --------------------------------------

class TestLoklOrderIdPrefix:
    """Order ID prefix migration BFO- → LOKL- (server.py:1534)"""

    def test_place_order_returns_lokl_prefixed_id(self, customer_session, live_product):
        prod = live_product["product"]
        size = live_product["size"]
        payload = {
            "items": [{
                "id": prod["id"],
                "name": prod["name"],
                "price": prod["price"],
                "qty": 1,
                "size": size,
                "image": prod.get("image", "x") or "x",
                "key": f"{prod['id']}-{size}",
            }],
            "total": prod["price"],
            "customer": {"name": "Backlog Tester", "phone": customer_session["phone"]},
            "address": {
                "name": "Backlog Tester",
                "line1": "Sector 10, Bhilai",
                "city": "Bhilai",
                "pincode": "490020",
                "phone": customer_session["phone"],
            },
        }
        r = requests.post(
            f"{API}/orders",
            json=payload,
            headers={"Authorization": f"Bearer {customer_session['token']}"},
            timeout=20,
        )
        assert r.status_code in (200, 201), f"order create failed: {r.status_code} {r.text}"
        body = r.json()
        oid = body.get("id")
        assert oid, f"no id on response: {body}"
        assert ORDER_ID_RE.match(oid), \
            f"order id {oid!r} does not match LOKL- pattern ^LOKL-[0-9A-F]{{8}}$"
        # Stash for downstream tests
        TestLoklOrderIdPrefix._lokl_id = oid

    def test_get_new_lokl_order_by_id(self, customer_session):
        oid = getattr(TestLoklOrderIdPrefix, "_lokl_id", None)
        if not oid:
            pytest.skip("upstream order create test did not run")
        r = requests.get(
            f"{API}/orders/{oid}",
            headers={"Authorization": f"Bearer {customer_session['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, f"GET {oid} failed: {r.status_code} {r.text}"
        assert r.json().get("id") == oid

    def test_legacy_bfo_orders_still_retrievable(self, admin_hdr):
        """Find a legacy BFO- order in admin feed and confirm GET still works."""
        r = requests.get(
            f"{API}/admin/orders",
            headers=admin_hdr,
            params={"filter": "all"},
            timeout=15,
        )
        assert r.status_code == 200, f"admin orders failed: {r.status_code}"
        orders = r.json()
        if isinstance(orders, dict):
            orders = orders.get("orders") or orders.get("items") or []
        bfo = next((o for o in orders if str(o.get("id", "")).startswith("BFO-")), None)
        if not bfo:
            pytest.skip("no BFO- legacy orders in DB — cannot verify lookup compat")
        oid = bfo["id"]
        r = requests.get(f"{API}/orders/{oid}", headers=admin_hdr, timeout=15)
        assert r.status_code == 200, f"legacy BFO lookup {oid} failed: {r.status_code} {r.text}"
        assert r.json().get("id") == oid


# ---------- Tests: complaint resolve 404 --------------------------------------

class TestComplaintResolve404:
    """POST /api/admin/complaints/{cid}/resolve must 404 on unknown id."""

    def test_unknown_id_returns_404(self, admin_hdr):
        r = requests.post(
            f"{API}/admin/complaints/INVALID-ID-XYZ/resolve",
            headers=admin_hdr,
            json={"note": "test 404"},
            timeout=15,
        )
        assert r.status_code == 404, \
            f"expected 404 for unknown complaint id, got {r.status_code}: {r.text}"

    def test_valid_id_still_resolves(self, admin_hdr):
        # Find a complaint that's still open. If none, the contract is trivially
        # satisfied — we only need to confirm the 404 path isn't a blanket regression.
        r = requests.get(
            f"{API}/admin/complaints",
            headers=admin_hdr,
            params={"status": "open"},
            timeout=15,
        )
        assert r.status_code == 200, f"complaints list failed: {r.status_code}"
        rows = r.json()
        if not isinstance(rows, list) or not rows:
            pytest.skip("no open complaints in DB to exercise the 200 path")
        cid = rows[0]["id"]
        rr = requests.post(
            f"{API}/admin/complaints/{cid}/resolve",
            headers=admin_hdr,
            json={"note": "auto-resolved by backlog test"},
            timeout=15,
        )
        assert rr.status_code == 200, f"valid complaint resolve failed: {rr.status_code} {rr.text}"
        assert rr.json().get("ok") is True


# ---------- City config endpoint sanity (powers useDeliveryEta) ---------------

class TestCityConfig:
    """GET /api/v1/cities/bhilai must surface eta_config + max_delivery_radius_km
    used by the new useDeliveryEta hook."""

    def test_bhilai_config_present(self):
        r = requests.get(f"{API}/v1/cities/bhilai", timeout=15)
        assert r.status_code == 200, f"city config failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("city_slug") == "bhilai"
        eta = body.get("eta_config") or {}
        assert "base_prep_minutes" in eta, f"missing base_prep_minutes in {body}"
        assert "per_km_minutes" in eta, f"missing per_km_minutes in {body}"
        assert isinstance(body.get("max_delivery_radius_km"), (int, float)), \
            f"missing/non-numeric max_delivery_radius_km: {body}"

    def test_detect_endpoint_classifies_delhi_vs_bhilai(self):
        # Delhi → not bhilai
        rd = requests.get(f"{API}/v1/cities/detect", params={"lat": 28.61, "lng": 77.21}, timeout=15)
        assert rd.status_code == 200, f"detect failed: {rd.status_code}"
        slug_delhi = rd.json().get("city_slug")
        assert slug_delhi != "bhilai", f"Delhi coords classified as bhilai: {rd.json()}"
        # Bhilai → bhilai
        rb = requests.get(f"{API}/v1/cities/detect", params={"lat": 21.21, "lng": 81.38}, timeout=15)
        assert rb.status_code == 200, f"detect failed: {rb.status_code}"
        assert rb.json().get("city_slug") == "bhilai", f"Bhilai coords not classified: {rb.json()}"
