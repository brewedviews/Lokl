"""Iteration 4 backend tests — focus areas:
- Fresh merchant register/login + admin KYC approval flow
- Storefront setup post-approval
- Product create with base64 dataURL image + stock dict
- Publish requires >=1 product
- Orders: Bhilai-only gating (city case-insensitive)
"""
import os
import uuid
import requests
import pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL, ADMIN_PASSWORD = "admin@bharat-os.com", "Admin@2026"

# 1x1 transparent PNG as a data URL (proxy for "base64 image upload")
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
DATA_URL = f"data:image/png;base64,{PNG_B64}"


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def fresh_merchant(s):
    """Register a fresh merchant per session."""
    suffix = uuid.uuid4().hex[:8]
    email = f"test_iter4_{suffix}@bharat-os.com"
    password = "TestPass@2026"
    r = s.post(f"{BASE_URL}/api/auth/register", json={"terms_accepted": True, 
        "email": email, "password": password,
        "store_name": f"TEST_Store_{suffix}", "owner_name": "Test Owner",
        "phone": "9000000001", "city": "Bhilai",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "email": email, "password": password,
        "token": data["token"], "id": data["merchant"]["id"],
    }


# === Admin login ===
def test_admin_login_ok(s):
    r = s.post(f"{BASE_URL}/api/admin/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    assert r.json()["token"]


def test_admin_login_bad_creds(s):
    r = s.post(f"{BASE_URL}/api/admin/login", json={
        "email": ADMIN_EMAIL, "password": "WRONG"})
    assert r.status_code == 401


# === Register + Login ===
def test_fresh_register_works(fresh_merchant):
    assert fresh_merchant["token"]
    assert fresh_merchant["id"].startswith("m-")


def test_login_after_register(s, fresh_merchant):
    r = s.post(f"{BASE_URL}/api/auth/login", json={
        "email": fresh_merchant["email"], "password": fresh_merchant["password"]})
    assert r.status_code == 200
    assert r.json()["merchant"]["email"] == fresh_merchant["email"]


# === KYC submit + admin approve ===
def test_kyc_submit_then_admin_approve(s, fresh_merchant, admin_token):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/kyc/submit", headers=hm, json={
        "pan_number": "ABCDE1234F", "gst_number": "", "business_name": "TEST Biz",
        "business_category": "Fashion", "business_type": "Sole Prop",
        "business_address": "Sector 10, Bhilai 490006",
        "bank_account_number": "1234567890", "bank_ifsc": "SBIN0001234",
        "account_holder_name": "Test Owner", "cancelled_cheque_b64": "ZmFrZQ==",
    })
    assert r.status_code == 200, r.text
    assert r.json()["kyc_status"] == "submitted"

    r = s.post(f"{BASE_URL}/api/admin/merchants/{fresh_merchant['id']}/approve", headers=ha)
    assert r.status_code == 200

    me = s.get(f"{BASE_URL}/api/auth/me", headers=hm).json()
    assert me["kyc_status"] == "approved"


# === Storefront (after approval) ===
def test_storefront_after_approval(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    r = s.post(f"{BASE_URL}/api/merchant/storefront", headers=hm, json={
        "tagline": "Test tagline", "story": "Test story",
        "banner": "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=400",
        "specialties": ["Ethnic"], "locality": "Sector 10", "timing": "10-9",
    })
    assert r.status_code == 200, r.text
    assert r.json()["store"]["id"] == f"store-m-{fresh_merchant['id']}"


# === Publish requires >=1 product (BEFORE product creation) ===
def test_publish_requires_product(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    r = s.post(f"{BASE_URL}/api/merchant/publish", headers=hm)
    assert r.status_code == 400
    assert "product" in r.text.lower()


# === Product create with base64 dataURL image AND stock dict ===
def test_create_product_with_data_url_image_and_stock_dict(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    payload = {
        "name": "TEST_DataURL_Top", "price": 1299, "mrp": 1799,
        "l1_id": "l1-women", "l2_id": "l2-w-topwear",
        "sizes": ["S", "M"],
        "stock": {"S": 5, "M": 3},
        "image": DATA_URL,
        "description": "Soft cotton top",
    }
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=hm, json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["image"].startswith("data:image/png;base64,"), "data URL image must roundtrip"
    assert body["stock"] == {"S": 5, "M": 3}, "stock dict must roundtrip"
    # Verify via list
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    created = next((p for p in prods if p["id"] == body["id"]), None)
    assert created is not None
    assert created["stock"] == {"S": 5, "M": 3}


def test_create_footwear_with_stock_dict(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    payload = {
        "name": "TEST_DataURL_Shoe", "price": 2499,
        "l1_id": "l1-footwear", "gender": "men",
        "sizes": ["8", "9", "10"],
        "stock": {"8": 2, "9": 4, "10": 1},
        "image": DATA_URL,
    }
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=hm, json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["stock"]["9"] == 4


# === Publish succeeds after product ===
def test_publish_succeeds_after_product(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    r = s.post(f"{BASE_URL}/api/merchant/publish", headers=hm)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


# === Orders: Bhilai-only gating ===
def test_order_bhilai_lowercase_ok(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    assert prods
    p = prods[0]
    r = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "X", "city": "bhilai", "pincode": "490006"},
        "total": p["price"], "payment_method": "COD",
        "customer": {"phone": "9000000001", "name": "TEST Buyer"},
    })
    assert r.status_code == 200, r.text
    assert r.json()["id"].startswith("BFO-")


def test_order_bhilai_titlecase_ok(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    p = prods[0]
    r = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "X", "city": "Bhilai", "pincode": "490006"},
        "total": p["price"], "payment_method": "COD",
    })
    assert r.status_code == 200, r.text


def test_order_mumbai_rejected(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    p = prods[0]
    r = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "X", "city": "Mumbai", "pincode": "400001"},
        "total": p["price"], "payment_method": "COD",
    })
    assert r.status_code == 400
    assert "bhilai" in r.text.lower()


def test_order_raipur_rejected(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    p = prods[0]
    r = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "X", "city": "Raipur", "pincode": "492001"},
        "total": p["price"], "payment_method": "COD",
    })
    assert r.status_code == 400


def test_order_empty_city_rejected(s, fresh_merchant):
    hm = {"Authorization": f"Bearer {fresh_merchant['token']}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    p = prods[0]
    r = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "X", "city": "", "pincode": "000000"},
        "total": p["price"], "payment_method": "COD",
    })
    assert r.status_code == 400
