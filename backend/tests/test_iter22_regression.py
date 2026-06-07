"""Iter-22 smoke regression: product GET shape, admin 404 path, order id format."""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": "admin@lokl.in", "password": "Admin@2026"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


# --- Bug 3 contract: GET /api/products/{pid} returns {product, similar} ---
def test_product_detail_envelope_shape():
    lst = requests.get(f"{BASE_URL}/api/products?page=1&page_size=1", timeout=10).json()
    assert isinstance(lst, list) and len(lst) >= 1
    pid = lst[0]["id"]
    r = requests.get(f"{BASE_URL}/api/products/{pid}", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) >= {"product", "similar"}, f"keys={list(data.keys())}"
    assert isinstance(data["product"], dict)
    assert data["product"].get("id") == pid
    assert isinstance(data["similar"], list)


# --- Regression smoke: admin complaint 404 path ---
def test_admin_invalid_complaint_returns_404(admin_token):
    r = requests.post(
        f"{BASE_URL}/api/admin/complaints/INVALID/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    assert r.status_code == 404, r.text


# --- Regression smoke: newest order ids use LOKL-XXXXXXXX format ---
def test_recent_order_id_lokl_format(admin_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/orders?page_size=50",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", data.get("orders", []))
    assert items, "no orders"
    newest = items[0]
    oid = newest.get("id") or newest.get("order_id")
    assert re.match(r"^LOKL-[0-9A-F]{8}$", oid or ""), f"newest order id does not match LOKL pattern: {oid}"


# --- Merchant products endpoint is reachable + demo data populated ---
def test_demo_merchant_products_present():
    auth = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "menscape@lokl.demo", "password": "Demo@2026"},
        timeout=10,
    )
    assert auth.status_code == 200
    tok = auth.json()["token"]
    r = requests.get(
        f"{BASE_URL}/api/merchant/products",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=10,
    )
    assert r.status_code == 200
    products = r.json()
    assert isinstance(products, list) and len(products) >= 1
    # Verify a fully-populated product so the edit modal can pre-fill all fields
    p = products[0]
    assert p.get("name")
    assert p.get("price") is not None
    assert p.get("sizes")
    assert p.get("l1_id") and p.get("l2_id")
