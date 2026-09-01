"""Bharat Fashion OS backend regression tests."""
import os
import io
import time
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

DEMO_EMAIL = "demo@bharat-os.com"
DEMO_PASS = "Demo@123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def merchant_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    if r.status_code != 200:
        pytest.skip(f"Demo merchant login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_headers(merchant_token):
    return {"Authorization": f"Bearer {merchant_token}", "Content-Type": "application/json"}


# ===== Health =====
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ===== Catalog =====
def test_categories(session):
    r = session.get(f"{API}/categories")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0


def test_stores_list(session):
    r = session.get(f"{API}/stores")
    assert r.status_code == 200
    stores = r.json()
    assert isinstance(stores, list)
    assert len(stores) >= 6, f"Expected 6+ stores, got {len(stores)}"
    # Verify sorted by distance ascending
    distances = [s.get("distance_km", 0) for s in stores]
    assert distances == sorted(distances), "Stores not sorted by distance"


def test_store_detail(session):
    stores = session.get(f"{API}/stores").json()
    sid = stores[0]["id"]
    r = session.get(f"{API}/stores/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert "store" in body and "products" in body
    assert body["store"]["id"] == sid


def test_store_not_found(session):
    r = session.get(f"{API}/stores/does-not-exist")
    assert r.status_code == 404


def test_products_list(session):
    r = session.get(f"{API}/products")
    assert r.status_code == 200
    products = r.json()
    assert isinstance(products, list)
    assert len(products) >= 12, f"Expected 12+ products, got {len(products)}"


def test_products_sort_price_asc(session):
    r = session.get(f"{API}/products?sort=price_asc")
    assert r.status_code == 200
    prices = [p["price"] for p in r.json()]
    assert prices == sorted(prices)


def test_product_detail(session):
    products = session.get(f"{API}/products").json()
    pid = products[0]["id"]
    r = session.get(f"{API}/products/{pid}")
    assert r.status_code == 200
    body = r.json()
    assert body["product"]["id"] == pid
    assert "similar" in body and isinstance(body["similar"], list)


def test_product_not_found(session):
    r = session.get(f"{API}/products/nope")
    assert r.status_code == 404


# ===== Orders =====
def test_create_and_fetch_order(session):
    payload = {
        "items": [{"id": "prod-1", "name": "Test Kurta", "price": 1899, "qty": 1, "size": "M"}],
        "address": {"name": "Test", "phone": "9999999999", "line1": "1, MI Rd", "pincode": "302001"},
        "total": 1899,
        "payment_method": "COD",
    }
    r = session.post(f"{API}/orders", json=payload)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["id"].startswith("BFO-")
    assert order["status"] == "confirmed"
    assert len(order["timeline"]) == 4
    # GET back
    r2 = session.get(f"{API}/orders/{order['id']}")
    assert r2.status_code == 200
    assert r2.json()["id"] == order["id"]


def test_order_not_found(session):
    r = session.get(f"{API}/orders/BFO-XXXX")
    assert r.status_code == 404


# ===== Auth =====
def test_demo_login(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and "merchant" in body
    assert "password_hash" not in body["merchant"]


def test_login_invalid(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_register_and_me(session):
    email = f"test_{int(time.time())}@bharat-test.com"
    payload = {"terms_accepted": True, 
        "email": email,
        "password": "Pass@123",
        "store_name": "Test Boutique",
        "owner_name": "Tester",
        "phone": "9876543210",
        "city": "Jaipur",
    }
    r = session.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    # me
    r2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == email
    # duplicate
    r3 = session.post(f"{API}/auth/register", json=payload)
    assert r3.status_code == 400


def test_me_requires_auth(session):
    r = requests.get(f"{API}/auth/me")
    assert r.status_code in (401, 403)


# ===== Merchant protected =====
def test_merchant_dashboard(auth_headers):
    r = requests.get(f"{API}/merchant/dashboard", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    for k in ("revenue", "orders", "repeat_rate", "conversion", "trends", "top_products"):
        assert k in body


def test_merchant_products_list_and_create(auth_headers):
    r = requests.get(f"{API}/merchant/products", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    cats = requests.get(f"{API}/categories").json()
    cat_id = cats[0]["id"]
    new = {
        "name": "TEST_AutoProduct",
        "price": 1499,
        "mrp": 1999,
        "category_id": cat_id,
        "description": "Test",
        "sizes": ["S", "M"],
        "image": "https://example.com/img.jpg",
        "ai_enhanced": True,
        "try_at_doorstep": False,
    }
    rc = requests.post(f"{API}/merchant/products", headers=auth_headers, json=new)
    assert rc.status_code == 200, rc.text
    assert rc.json()["name"] == "TEST_AutoProduct"


def test_merchant_routes_unauth():
    r = requests.get(f"{API}/merchant/dashboard")
    assert r.status_code in (401, 403)


# ===== AI =====
def test_ai_copy(auth_headers):
    r = requests.post(
        f"{API}/merchant/ai/copy",
        headers=auth_headers,
        json={"product_name": "Hand-block Indigo Kurta", "category": "Ethnic Wear", "notes": "cotton"},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("title", "description", "tags", "highlights", "campaign_copy"):
        assert k in body, f"missing key {k}"
    assert isinstance(body["tags"], list)


def test_ai_enhance_image(merchant_token):
    # 1x1 PNG
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
           b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00"
           b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
    files = {"file": ("test.png", io.BytesIO(png), "image/png")}
    r = requests.post(
        f"{API}/merchant/ai/enhance-image",
        headers={"Authorization": f"Bearer {merchant_token}"},
        files=files,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "source" in body
    assert body["source"] in ("gemini-nano-banana", "fallback")
