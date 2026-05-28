"""Phase B — phone mandatory, KYC pre-fill, online toggle."""
import os, uuid, pytest, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"


def _new_merchant(phone="+919999900000"):
    email = f"phaseB_{uuid.uuid4().hex[:8]}@lokl.in"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "PhaseB@2026",
        "store_name": f"PhaseB {uuid.uuid4().hex[:4]}",
        "owner_name": "Owner", "phone": phone, "city": "Bhilai",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["merchant"]["id"], email


def _admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": "admin@lokl.in", "password": "Admin@2026"}, timeout=30)
    return r.json()["token"]


def test_register_without_phone_fails():
    r = requests.post(f"{API}/auth/register", json={
        "email": f"nophone_{uuid.uuid4().hex[:6]}@lokl.in",
        "password": "X@2026", "store_name": "X", "owner_name": "X",
    }, timeout=30)
    assert r.status_code == 422, r.text


def test_register_short_phone_fails():
    r = requests.post(f"{API}/auth/register", json={
        "email": f"shortphone_{uuid.uuid4().hex[:6]}@lokl.in",
        "password": "X@2026", "store_name": "X", "owner_name": "X",
        "phone": "12345",
    }, timeout=30)
    assert r.status_code == 400


def test_duplicate_phone_fails():
    phone = f"+9199{str(uuid.uuid4().int)[:8]}"
    _new_merchant(phone=phone)
    # Same phone, different email → must reject
    r = requests.post(f"{API}/auth/register", json={
        "email": f"dup_{uuid.uuid4().hex[:6]}@lokl.in",
        "password": "X@2026", "store_name": "X", "owner_name": "X",
        "phone": phone,
    }, timeout=30)
    assert r.status_code == 400, r.text


def test_kyc_status_returns_docs_present_flags():
    tok, _, _ = _new_merchant(phone=f"+9199{str(uuid.uuid4().int)[:8]}")
    # Submit with docs
    requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "ABCDE1234F", "gst_number": "27ABCDE1234F1Z5",
        "business_name": "B", "business_category": "Multi-category",
        "business_type": "Proprietorship", "business_address": "Bhilai",
        "bank_account_number": "12345678", "bank_ifsc": "SBIN0001234",
        "account_holder_name": "X", "pan_doc_b64": "PANDOC", "gst_doc_b64": "GSTDOC",
        "cancelled_cheque_b64": "CHEQUEDOC",
    }, timeout=30)
    r = requests.get(f"{API}/merchant/kyc/status", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["docs_present"]["pan_doc"] is True
    assert body["docs_present"]["gst_doc"] is True
    assert body["docs_present"]["cancelled_cheque"] is True
    # The base64 blobs must NOT be in `merchant` payload (kept lean)
    assert "pan_doc_b64" not in body["merchant"]


def test_kyc_resubmission_preserves_docs():
    tok, _, _ = _new_merchant(phone=f"+9199{str(uuid.uuid4().int)[:8]}")
    requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "AAAAA1111A", "business_name": "B",
        "business_category": "Multi-category", "business_type": "Proprietorship",
        "business_address": "Bhilai", "bank_account_number": "1", "bank_ifsc": "S",
        "account_holder_name": "X", "pan_doc_b64": "ORIGINALPANDOC",
        "cancelled_cheque_b64": "ORIGINALCHEQUE",
    }, timeout=30)
    # Resubmit with empty docs but updated text → must keep original docs
    requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "AAAAA1111A", "business_name": "B UPDATED",
        "business_category": "Multi-category", "business_type": "Proprietorship",
        "business_address": "Bhilai", "bank_account_number": "1", "bank_ifsc": "S",
        "account_holder_name": "X",
    }, timeout=30)
    r = requests.get(f"{API}/merchant/kyc/status", headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    body = r.json()
    assert body["docs_present"]["pan_doc"] is True, "PAN doc should be preserved across resubmission"
    assert body["docs_present"]["cancelled_cheque"] is True, "Cheque should be preserved across resubmission"
    assert body["merchant"]["business_name"] == "B UPDATED"


def test_online_toggle_requires_full_launch():
    tok, _, _ = _new_merchant(phone=f"+9199{str(uuid.uuid4().int)[:8]}")
    r = requests.post(f"{API}/merchant/store/online",
                      headers={"Authorization": f"Bearer {tok}"}, json={"online": False}, timeout=30)
    assert r.status_code == 400  # storefront not set
