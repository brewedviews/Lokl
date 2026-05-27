"""Iter8 Phase2+Phase3: Admin returns analytics + Merchant returns analytics + AI enhance endpoint."""
import os, uuid, pytest, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASS = "Admin@2026"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_merchant():
    """Register a fresh merchant + KYC + admin-approve + publish. Returns auth dict."""
    email = f"phase2_{uuid.uuid4().hex[:8]}@lokl.in"
    pw = "Phase2@2026"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"Phase2 Store {uuid.uuid4().hex[:4]}",
        "owner_name": "P2 Owner", "phone": "+919999900008", "city": "Bhilai",
    }, timeout=10)
    assert reg.status_code in (200, 201), reg.text
    tok = reg.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    requests.post(f"{API}/merchant/kyc/submit", headers=h, json={
        "business_name": "P2 Biz", "business_type": "proprietorship",
        "business_category": "fashion", "business_address": "Sector 10, Bhilai",
        "pan_number": "ABCDE1234F", "gst_number": "22ABCDE1234F1Z5",
        "pan_doc_b64": "/9j/4AAQSk", "cancelled_cheque_b64": "/9j/4AAQSk",
        "bank_account_number": "123456789012", "bank_ifsc": "HDFC0000001",
        "account_holder_name": "P2 Owner",
    }, timeout=10)
    ahdr = {"Authorization": f"Bearer {requests.post(f'{API}/admin/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASS}).json()['token']}"}
    mers = requests.get(f"{API}/admin/merchants?status=submitted", headers=ahdr).json()
    me = next((m for m in mers if m["email"] == email), None)
    assert me, f"merchant {email} not found"
    requests.post(f"{API}/admin/merchants/{me['id']}/approve", headers=ahdr, timeout=10).raise_for_status()
    return {"email": email, "token": tok, "h": h, "merchant_id": me["id"]}


# ===== Admin Returns Analytics =====

def test_admin_returns_analytics_unauth():
    r = requests.get(f"{API}/admin/returns/analytics", timeout=10)
    assert r.status_code in (401, 403), r.text


def test_admin_returns_analytics_schema(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/admin/returns/analytics", headers=h, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    # Required top-level keys
    for k in ("total", "by_reason", "by_merchant", "by_status"):
        assert k in data, f"missing key: {k}"
    assert isinstance(data["total"], int)
    assert isinstance(data["by_reason"], list)
    assert isinstance(data["by_merchant"], list)
    assert isinstance(data["by_status"], list)
    # Element shape checks
    for it in data["by_reason"]:
        assert "reason" in it and "count" in it
    for it in data["by_merchant"]:
        assert "merchant_id" in it and "store_name" in it and "count" in it
    for it in data["by_status"]:
        assert "status" in it and "count" in it


# ===== Merchant Returns Analytics =====

def test_merchant_returns_analytics_unauth():
    r = requests.get(f"{API}/merchant/analytics/returns", timeout=10)
    assert r.status_code in (401, 403), r.text


def test_merchant_returns_analytics_zero_delivered(fresh_merchant):
    """Brand new merchant with 0 delivered orders => returns_rate_pct must be 0.0 (no div/0)."""
    r = requests.get(f"{API}/merchant/analytics/returns", headers=fresh_merchant["h"], timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("delivered_count", "returns_total", "returns_rate_pct", "by_reason"):
        assert k in d, f"missing key: {k}"
    assert d["delivered_count"] == 0
    assert d["returns_total"] == 0
    assert d["returns_rate_pct"] == 0.0
    assert isinstance(d["by_reason"], list)


# ===== AI Enhance =====

def test_ai_enhance_unauth():
    r = requests.post(f"{API}/merchant/ai/enhance-image", json={"image": "data:image/png;base64,AAAA"}, timeout=10)
    assert r.status_code in (401, 403), r.text


def test_ai_enhance_empty_image(fresh_merchant):
    r = requests.post(f"{API}/merchant/ai/enhance-image", headers=fresh_merchant["h"], json={"image": ""}, timeout=10)
    assert r.status_code == 400, r.text
