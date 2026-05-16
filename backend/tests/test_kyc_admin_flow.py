"""Bharat Fashion OS — end-to-end KYC + Admin + Storefront + Publish + Analytics test suite.

Covers the new merchant onboarding flow for the Bhilai+Raipur pilot:
register -> KYC submit -> admin approve -> storefront -> products -> publish -> analytics.
"""
import os
import io
import time
import base64
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://bharat-fashion-os.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@bharat-os.com"
ADMIN_PASSWORD = "Admin@2026"

TINY_PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00"
            b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
TINY_PNG_B64 = base64.b64encode(TINY_PNG).decode()


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["admin"]["role"] == "admin"
    return body["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def new_merchant():
    """Register a brand-new merchant and return (email, password, token, id)."""
    email = f"test_kyc_{int(time.time())}@bharat-test.com"
    pwd = "Pass@123"
    payload = {
        "email": email,
        "password": pwd,
        "store_name": "TEST Bhilai Boutique",
        "owner_name": "Test Owner",
        "phone": "9876543210",
        "city": "Bhilai",
    }
    r = requests.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, f"register failed: {r.text}"
    body = r.json()
    assert body["merchant"]["kyc_status"] == "draft"
    return {
        "email": email,
        "password": pwd,
        "token": body["token"],
        "id": body["merchant"]["id"],
        "headers": {"Authorization": f"Bearer {body['token']}", "Content-Type": "application/json"},
    }


# ---------- Admin login ----------
def test_admin_login_success():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body
    assert body["admin"]["email"] == ADMIN_EMAIL
    assert body["admin"]["role"] == "admin"


def test_admin_login_invalid():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_admin_endpoint_requires_token():
    r = requests.get(f"{API}/admin/merchants")
    assert r.status_code == 401


# ---------- Register & KYC submit ----------
def test_register_sets_kyc_draft(new_merchant):
    r = requests.get(f"{API}/merchant/kyc/status", headers=new_merchant["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["kyc_status"] == "draft"


def test_kyc_submit(new_merchant):
    payload = {
        "pan_number": "ABCDE1234F",
        "gst_number": "22ABCDE1234F1Z5",
        "business_name": "Test Bhilai Boutique",
        "business_category": "Ethnic Wear",
        "business_type": "Proprietorship",
        "business_address": "Sector 5, Bhilai, Chhattisgarh 490006",
        "bank_account_number": "1234567890",
        "bank_ifsc": "HDFC0001234",
        "account_holder_name": "Test Owner",
        "pan_doc_b64": TINY_PNG_B64,
        "gst_doc_b64": TINY_PNG_B64,
        "cancelled_cheque_b64": TINY_PNG_B64,
    }
    r = requests.post(f"{API}/merchant/kyc/submit", headers=new_merchant["headers"], json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["kyc_status"] == "submitted"

    # Verify status persisted via GET
    rs = requests.get(f"{API}/merchant/kyc/status", headers=new_merchant["headers"])
    assert rs.status_code == 200
    assert rs.json()["kyc_status"] == "submitted"


def test_storefront_blocked_before_approval(new_merchant):
    payload = {"tagline": "Hi", "story": "S", "banner": "https://x/y.jpg", "specialties": ["Kurtas"]}
    r = requests.post(f"{API}/merchant/storefront", headers=new_merchant["headers"], json=payload)
    assert r.status_code == 403


def test_product_blocked_before_approval(new_merchant):
    payload = {"name": "Blocked Product", "price": 999, "category_id": "cat-women"}
    r = requests.post(f"{API}/merchant/products", headers=new_merchant["headers"], json=payload)
    assert r.status_code == 403


# ---------- Admin: list & approve ----------
def test_admin_list_submitted(admin_headers, new_merchant):
    r = requests.get(f"{API}/admin/merchants?status=submitted", headers=admin_headers)
    assert r.status_code == 200
    docs = r.json()
    assert isinstance(docs, list)
    ids = [d["id"] for d in docs]
    assert new_merchant["id"] in ids, "Newly submitted merchant not in admin list"


def test_admin_approve(admin_headers, new_merchant):
    r = requests.post(f"{API}/admin/merchants/{new_merchant['id']}/approve", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Merchant should now see kyc_status=approved
    rs = requests.get(f"{API}/merchant/kyc/status", headers=new_merchant["headers"])
    assert rs.status_code == 200
    assert rs.json()["kyc_status"] == "approved"


def test_notification_pushed_on_approve(new_merchant):
    r = requests.get(f"{API}/merchant/notifications", headers=new_merchant["headers"])
    assert r.status_code == 200
    notes = r.json()
    assert isinstance(notes, list) and len(notes) >= 1
    types = [n.get("type") for n in notes]
    assert "kyc-approved" in types


# ---------- Storefront ----------
def test_storefront_create(new_merchant):
    payload = {
        "tagline": "Handcrafted in Bhilai",
        "story": "Three generations of weavers.",
        "banner": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=800",
        "specialties": ["Kurtas", "Sarees"],
        "locality": "Sector 5",
        "timing": "10am - 9pm",
    }
    r = requests.post(f"{API}/merchant/storefront", headers=new_merchant["headers"], json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    store = body["store"]
    assert store["id"] == f"store-m-{new_merchant['id']}"
    assert store["tagline"] == payload["tagline"]
    assert store["published"] is False
    assert store["product_count"] == 0


def test_store_hidden_before_publish(new_merchant):
    """New merchant store must NOT appear in public /stores until publish + product."""
    r = requests.get(f"{API}/stores")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert f"store-m-{new_merchant['id']}" not in ids


# ---------- Products ----------
def test_create_single_product(new_merchant):
    payload = {
        "name": "TEST Indigo Kurta",
        "price": 1899,
        "mrp": 2499,
        "category_id": "cat-women",
        "description": "Hand-block indigo cotton kurta",
        "sizes": ["S", "M", "L"],
        "image": "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=600",
        "ai_enhanced": False,
        "stock": {"S": 5, "M": 8, "L": 4},
    }
    r = requests.post(f"{API}/merchant/products", headers=new_merchant["headers"], json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == payload["name"]
    assert body["store_id"] == f"store-m-{new_merchant['id']}"
    new_merchant["product_id"] = body["id"]


def test_update_product(new_merchant):
    pid = new_merchant.get("product_id")
    assert pid
    r = requests.put(
        f"{API}/merchant/products/{pid}",
        headers=new_merchant["headers"],
        json={"image": "https://example.com/new.jpg", "ai_enhanced": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ai_enhanced"] is True
    assert body["image"] == "https://example.com/new.jpg"


def test_bulk_upload_csv(new_merchant):
    csv_data = (
        "name,description,category,mrp,price,sizes,stock_per_size\n"
        "TEST Bandhani Anarkali,Bright bandhani anarkali,Ethnic Wear,4299,3499,S;M;L,3\n"
        "TEST Linen Co-ord,Breathable linen co-ord set,Women,3599,2899,M;L,5\n"
    )
    files = {"file": ("bulk.csv", io.BytesIO(csv_data.encode()), "text/csv")}
    r = requests.post(
        f"{API}/merchant/products/bulk",
        headers={"Authorization": new_merchant["headers"]["Authorization"]},
        files=files,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 2
    assert "TEST Bandhani Anarkali" in body["names"]


# ---------- AI Try-On ----------
def test_ai_tryon_response_shape(new_merchant):
    files = {"file": ("p.png", io.BytesIO(TINY_PNG), "image/png")}
    r = requests.post(
        f"{API}/merchant/ai/tryon",
        headers={"Authorization": new_merchant["headers"]["Authorization"]},
        files=files,
        timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "source" in body
    assert body["source"] in ("gemini-nano-banana", "fallback")
    # Either real image_base64 OR fallback_url must be present
    assert body.get("image_base64") or body.get("fallback_url")


# ---------- Publish ----------
def test_publish_succeeds(new_merchant):
    r = requests.post(f"{API}/merchant/publish", headers=new_merchant["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["go_live_eta_minutes"] == 60


def test_store_visible_after_publish(new_merchant):
    r = requests.get(f"{API}/stores")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert f"store-m-{new_merchant['id']}" in ids, "Store still hidden after publish"


def test_store_detail_after_publish(new_merchant):
    sid = f"store-m-{new_merchant['id']}"
    r = requests.get(f"{API}/stores/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert body["store"]["id"] == sid
    assert len(body["products"]) >= 3  # 1 single + 2 bulk


# ---------- Analytics ----------
@pytest.mark.parametrize("period", ["yesterday", "7d", "30d", "quarter"])
def test_analytics_periods(new_merchant, period):
    r = requests.get(f"{API}/merchant/analytics?period={period}", headers=new_merchant["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("revenue", "orders", "avg_order_value", "repeat_rate", "trend", "top_products", "demo_mode"):
        assert k in body, f"missing {k}"
    # New merchant has no real orders -> must be demo_mode
    assert body["demo_mode"] is True
    assert isinstance(body["trend"], list)
    assert isinstance(body["top_products"], list)


def test_analytics_csv_download(new_merchant):
    r = requests.get(f"{API}/merchant/analytics/report.csv?period=30d", headers=new_merchant["headers"])
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    text = r.text
    assert "date,order_id,product,qty,amount,payment" in text.splitlines()[0]
    # at least a header + 1 data row
    assert len(text.strip().splitlines()) >= 2


# ---------- Admin reject flow (separate merchant) ----------
def test_admin_reject_flow(admin_headers):
    email = f"test_reject_{int(time.time())}@bharat-test.com"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "Pass@123",
        "store_name": "TEST Reject Store", "owner_name": "RJ", "city": "Raipur",
    })
    assert reg.status_code == 200
    token = reg.json()["token"]
    mid = reg.json()["merchant"]["id"]
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Submit minimal KYC
    requests.post(f"{API}/merchant/kyc/submit", headers=h, json={
        "pan_number": "AAAAA1111A", "business_name": "X",
        "business_category": "Women", "business_type": "Proprietorship",
        "business_address": "Raipur", "bank_account_number": "1",
        "bank_ifsc": "HDFC0", "account_holder_name": "X",
        "cancelled_cheque_b64": TINY_PNG_B64,
    })

    rr = requests.post(
        f"{API}/admin/merchants/{mid}/reject",
        headers=admin_headers,
        json={"reason": "Address proof unclear."},
    )
    assert rr.status_code == 200

    # Confirm notification + status
    notes = requests.get(f"{API}/merchant/notifications", headers=h).json()
    assert any(n.get("type") == "kyc-rejected" for n in notes)
    st = requests.get(f"{API}/merchant/kyc/status", headers=h).json()
    assert st["kyc_status"] == "rejected"
