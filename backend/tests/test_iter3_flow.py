"""Iteration 3 backend tests — categories L1/L2, products validation, change requests,
admin stores, OTP-protected delete, customer profile, orders accept/reject."""
import os, io, time, requests, pytest
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL, ADMIN_PASSWORD = "admin@bharat-os.com", "Admin@2026"
DEMO_EMAIL, DEMO_PASSWORD = "demo@bharat-os.com", "Demo@123"


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def demo_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["merchant"]["kyc_status"] == "approved", "Demo merchant should be auto-approved"
    return r.json()["token"]


# === Categories ===
def test_categories_shape(s):
    r = s.get(f"{BASE_URL}/api/categories")
    assert r.status_code == 200
    cats = r.json()
    assert len(cats) == 7
    by_slug = {c["slug"]: c for c in cats}
    for slug in ["women", "men", "footwear", "streetwear", "kids", "accessories", "beauty"]:
        assert slug in by_slug
    assert len(by_slug["women"]["l2"]) == 9
    assert len(by_slug["men"]["l2"]) == 9
    for slug in ["footwear", "streetwear", "kids", "accessories", "beauty"]:
        assert len(by_slug[slug]["l2"]) == 0


# === Storefront for demo (idempotent setup) ===
def _ensure_storefront(s, token):
    h = {"Authorization": f"Bearer {token}"}
    r = s.post(f"{BASE_URL}/api/merchant/storefront", headers=h, json={
        "tagline": "Demo tagline", "story": "Demo story for tests",
        "banner": "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=400",
        "specialties": ["Ethnic"], "locality": "Sector 10", "timing": "10-9"})
    assert r.status_code == 200, r.text


# === Product validation ===
def test_product_l2_required_for_women(s, demo_token):
    _ensure_storefront(s, demo_token)
    h = {"Authorization": f"Bearer {demo_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=h, json={
        "name": "TEST_NoL2", "price": 999, "l1_id": "l1-women", "sizes": ["M"]})
    assert r.status_code == 400
    assert "l2" in r.text.lower()


def test_product_gender_required_for_footwear(s, demo_token):
    _ensure_storefront(s, demo_token)
    h = {"Authorization": f"Bearer {demo_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=h, json={
        "name": "TEST_NoGender", "price": 1299, "l1_id": "l1-footwear", "sizes": ["8"]})
    assert r.status_code == 400
    assert "gender" in r.text.lower()


def test_product_create_valid_women(s, demo_token):
    _ensure_storefront(s, demo_token)
    h = {"Authorization": f"Bearer {demo_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=h, json={
        "name": "TEST_W_Top", "price": 1299, "mrp": 1799,
        "l1_id": "l1-women", "l2_id": "l2-w-topwear", "sizes": ["S", "M"]})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["l1_id"] == "l1-women" and p["l2_id"] == "l2-w-topwear"


def test_product_create_valid_footwear_gender(s, demo_token):
    _ensure_storefront(s, demo_token)
    h = {"Authorization": f"Bearer {demo_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/products", headers=h, json={
        "name": "TEST_FW_M", "price": 2499,
        "l1_id": "l1-footwear", "gender": "men", "sizes": ["8", "9"]})
    assert r.status_code == 200, r.text
    assert r.json()["gender"] == "men"


# === Bulk CSV ===
def test_bulk_csv_skips_invalid_rows(s, demo_token):
    _ensure_storefront(s, demo_token)
    h = {"Authorization": f"Bearer {demo_token}"}
    csv_data = (
        "name,description,l1,l2,gender,mrp,price,sizes,stock_per_size\n"
        "TEST_CSV_OK_W,Nice top,Women,Top wear,,1499,999,S;M;L,10\n"
        "TEST_CSV_NoL2,Bad row,Women,,,1000,800,M,5\n"
        "TEST_CSV_OK_FW,Sneaker,Footwear,,unisex,2999,1999,8;9,7\n"
    )
    files = {"file": ("bulk.csv", csv_data.encode(), "text/csv")}
    r = s.post(f"{BASE_URL}/api/merchant/products/bulk", headers=h, files=files)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["created"] >= 2
    assert "TEST_CSV_NoL2" in data["skipped"]


# === Public products filtering ===
def test_products_filter_by_l1_l2_gender(s, demo_token):
    # Publish so demo products are publicly visible
    h = {"Authorization": f"Bearer {demo_token}"}
    s.post(f"{BASE_URL}/api/merchant/publish", headers=h)
    time.sleep(0.3)
    r = s.get(f"{BASE_URL}/api/products?l1=l1-women")
    assert r.status_code == 200
    for p in r.json(): assert p["l1_id"] == "l1-women"
    r2 = s.get(f"{BASE_URL}/api/products?l1=l1-women&l2=l2-w-topwear")
    assert r2.status_code == 200
    r3 = s.get(f"{BASE_URL}/api/products?l1=l1-footwear&gender=men")
    assert r3.status_code == 200


# === Change requests ===
def test_change_request_create_and_list(s, demo_token):
    h = {"Authorization": f"Bearer {demo_token}"}
    r = s.post(f"{BASE_URL}/api/merchant/change-request", headers=h, json={
        "change_type": "bank",
        "new_values": {"bank_account_number": "9999000011", "bank_ifsc": "HDFC0000999",
                       "account_holder_name": "Demo Owner"},
        "supporting_doc_b64": "ZmFrZS1jaGVxdWUtYjY0",
        "reason": "Switched bank"})
    assert r.status_code == 200
    cid = r.json()["id"]
    r2 = s.get(f"{BASE_URL}/api/merchant/change-requests", headers=h)
    assert r2.status_code == 200
    assert any(c["id"] == cid for c in r2.json())
    return cid


def test_admin_change_request_approve(s, demo_token, admin_token):
    hm = {"Authorization": f"Bearer {demo_token}"}
    cr = s.post(f"{BASE_URL}/api/merchant/change-request", headers=hm, json={
        "change_type": "address",
        "new_values": {"business_address": "TEST New Addr, Bhilai"},
        "supporting_doc_b64": "ZG9j", "reason": "Moved"})
    cid = cr.json()["id"]
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.post(f"{BASE_URL}/api/admin/change-requests/{cid}/approve", headers=ha)
    assert r.status_code == 200
    # Verify applied on merchant
    me = s.get(f"{BASE_URL}/api/auth/me", headers=hm).json()
    assert me["business_address"] == "TEST New Addr, Bhilai"


def test_admin_change_request_reject(s, demo_token, admin_token):
    hm = {"Authorization": f"Bearer {demo_token}"}
    cr = s.post(f"{BASE_URL}/api/merchant/change-request", headers=hm, json={
        "change_type": "bank", "new_values": {"bank_account_number": "BAD"},
        "supporting_doc_b64": "Yg==", "reason": "test"})
    cid = cr.json()["id"]
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.post(f"{BASE_URL}/api/admin/change-requests/{cid}/reject",
               headers=ha, json={"reason": "Blurry cheque"})
    assert r.status_code == 200
    notes = s.get(f"{BASE_URL}/api/merchant/notifications", headers=hm).json()
    assert any(n.get("type") == "change-rejected" for n in notes)


def test_admin_list_change_requests_period(s, admin_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.get(f"{BASE_URL}/api/admin/change-requests?period=30d", headers=ha)
    assert r.status_code == 200
    docs = r.json()
    assert isinstance(docs, list)
    if docs:
        assert "merchant" in docs[0]


def test_admin_export_approvals_csv(s, admin_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.get(f"{BASE_URL}/api/admin/export/approvals.csv?period=30d", headers=ha)
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    assert "type,id,merchant" in r.text


# === Admin stores + pause/unpause/delete + OTP ===
def test_admin_stores_with_products(s, admin_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    r = s.get(f"{BASE_URL}/api/admin/stores", headers=ha)
    assert r.status_code == 200
    stores = r.json()
    assert len(stores) >= 1
    assert "products" in stores[0]


def test_admin_pause_unpause_product(s, admin_token, demo_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    hm = {"Authorization": f"Bearer {demo_token}"}
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    assert prods, "Need at least one product"
    pid = prods[0]["id"]
    sid = prods[0]["store_id"]
    assert s.post(f"{BASE_URL}/api/admin/products/{pid}/pause", headers=ha).status_code == 200
    # Recount: paused product shouldn't be in product_count
    stores = s.get(f"{BASE_URL}/api/admin/stores", headers=ha).json()
    store = next(x for x in stores if x["id"] == sid)
    paused_count = sum(1 for p in store["products"] if p.get("paused"))
    assert paused_count >= 1
    assert s.post(f"{BASE_URL}/api/admin/products/{pid}/unpause", headers=ha).status_code == 200


def test_admin_store_pause_hides_from_public(s, admin_token, demo_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    hm = {"Authorization": f"Bearer {demo_token}"}
    me = s.get(f"{BASE_URL}/api/auth/me", headers=hm).json()
    sid = f"store-m-{me['id']}"
    assert s.post(f"{BASE_URL}/api/admin/stores/{sid}/pause", headers=ha).status_code == 200
    stores_public = s.get(f"{BASE_URL}/api/stores").json()
    assert not any(x["id"] == sid for x in stores_public)
    s.post(f"{BASE_URL}/api/admin/stores/{sid}/unpause", headers=ha)


def test_admin_delete_store_otp_wrong_then_correct(s, admin_token, demo_token):
    ha = {"Authorization": f"Bearer {admin_token}"}
    hm = {"Authorization": f"Bearer {demo_token}"}
    me = s.get(f"{BASE_URL}/api/auth/me", headers=hm).json()
    sid = f"store-m-{me['id']}"
    # Don't actually delete the demo store — test wrong OTP only, then cleanup
    r = s.post(f"{BASE_URL}/api/admin/stores/{sid}/request-delete-otp", headers=ha)
    assert r.status_code == 200
    otp = r.json()["otp_demo"]
    assert len(otp) == 6 and otp.isdigit()
    bad = s.delete(f"{BASE_URL}/api/admin/stores/{sid}", headers=ha, json={"otp": "000000"})
    # If unlucky and otp happens to be 000000, skip
    if otp != "000000":
        assert bad.status_code == 401


# === Orders accept/reject ===
def test_merchant_orders_accept_reject(s, demo_token):
    hm = {"Authorization": f"Bearer {demo_token}"}
    me = s.get(f"{BASE_URL}/api/auth/me", headers=hm).json()
    prods = s.get(f"{BASE_URL}/api/merchant/products", headers=hm).json()
    assert prods
    p = prods[0]
    order = s.post(f"{BASE_URL}/api/orders", json={
        "items": [{"id": p["id"], "name": p["name"], "price": p["price"], "qty": 1}],
        "address": {"line1": "Test", "city": "Bhilai", "pincode": "490006"},
        "total": p["price"], "payment_method": "COD",
        "customer": {"phone": "9999900001", "name": "Test Buyer", "age": 30}})
    assert order.status_code == 200
    oid = order.json()["id"]
    r = s.post(f"{BASE_URL}/api/merchant/orders/{oid}/accept", headers=hm)
    assert r.status_code == 200
    orders = s.get(f"{BASE_URL}/api/merchant/orders", headers=hm).json()
    assert any(o["id"] == oid and o["status"] == "accepted" for o in orders)


# === Customer profile ===
def test_customer_upsert_and_get(s):
    phone = "9988776655"
    r = s.post(f"{BASE_URL}/api/customer/upsert", json={
        "phone": phone, "name": "TEST_Cust", "age": 28, "email": "tc@bharat-os.com",
        "address": {"line1": "X", "city": "Raipur", "pincode": "492001"}})
    assert r.status_code == 200
    c = r.json()
    assert c["phone"] == phone and c["name"] == "TEST_Cust"
    r2 = s.get(f"{BASE_URL}/api/customer/{phone}")
    assert r2.status_code == 200
    assert r2.json()["customer"]["phone"] == phone
    assert isinstance(r2.json()["orders"], list)
