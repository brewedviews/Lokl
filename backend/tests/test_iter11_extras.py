"""Iter11 — additional coverage: online toggle full flow, /api/products & /api/stores
filtering when offline, AI 2-output, AI per-kind invalid-kind."""
import os, uuid, requests, pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN = ("admin@lokl.in", "Admin@2026")


def _admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN[0], "password": ADMIN[1]}, timeout=30)
    return r.json()["token"]


@pytest.fixture(scope="module")
def launched_merchant():
    """Register → KYC → approve → storefront → 1 live product → returns (tok, mid)."""
    email = f"iter11_{uuid.uuid4().hex[:8]}@lokl.in"
    phone = f"+9199{str(uuid.uuid4().int)[:8]}"
    r = requests.post(f"{API}/auth/register", json={"terms_accepted": True, 
        "email": email, "password": "Iter11@2026",
        "store_name": f"Iter11 {uuid.uuid4().hex[:4]}",
        "owner_name": "Owner", "phone": phone, "city": "Bhilai",
    }, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]; mid = r.json()["merchant"]["id"]
    requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "ABCDE1234F", "business_name": "B", "business_category": "Multi-category",
        "business_type": "Proprietorship", "business_address": "Bhilai",
        "bank_account_number": "1", "bank_ifsc": "S", "account_holder_name": "X",
        "pan_doc_b64": "x", "cancelled_cheque_b64": "y",
    }, timeout=30)
    atok = _admin_token()
    requests.post(f"{API}/admin/merchants/{mid}/approve",
                  headers={"Authorization": f"Bearer {atok}"}, timeout=30)
    requests.post(f"{API}/merchant/storefront", headers={"Authorization": f"Bearer {tok}"}, json={
        "tagline": "x", "story": "x", "specialties": [], "banner": "x", "banners": ["x"],
        "address": "Bhilai", "area": "Sec", "locality": "Sec", "city": "Bhilai",
        "opens_at": "10:00", "closes_at": "18:00", "timing": "10:00 - 18:00",
    }, timeout=30)
    p = requests.post(f"{API}/merchant/products", headers={"Authorization": f"Bearer {tok}"}, json={
        "name": "Iter11 Tee", "description": "ok", "l1_id": "l1-men", "l2_id": "l2-m-tshirt",
        "gender": "men", "price": 599, "mrp": 999, "image": "x", "images": ["x"],
        "sizes": ["M"], "stock": {"M": 5},
    }, timeout=30)
    assert p.status_code == 200, p.text
    return tok, mid


def test_online_toggle_offline_then_online(launched_merchant):
    tok, mid = launched_merchant
    sid = f"store-m-{mid}"
    # Go offline
    r = requests.post(f"{API}/merchant/store/online",
                      headers={"Authorization": f"Bearer {tok}"}, json={"online": False}, timeout=30)
    assert r.status_code == 200, r.text
    # /api/products must NOT include this merchant's products
    items = requests.get(f"{API}/products?limit=500", timeout=30).json()
    assert not any(p.get("merchant_id") == mid for p in items), "offline merchant should be filtered out of /api/products"
    # /api/stores must still include the store but online:false
    stores = requests.get(f"{API}/stores?limit=500", timeout=30).json()
    matching = [s for s in stores if s.get("id") == sid]
    assert matching, "store should still be in /api/stores even when offline"
    s = matching[0]
    assert s.get("online") is False
    assert "Offline" in (s.get("next_open_label") or "") or "back soon" in (s.get("next_open_label") or "")
    # Toggle back online
    r = requests.post(f"{API}/merchant/store/online",
                      headers={"Authorization": f"Bearer {tok}"}, json={"online": True}, timeout=30)
    assert r.status_code == 200, r.text
    items = requests.get(f"{API}/products?limit=500", timeout=30).json()
    assert any(p.get("merchant_id") == mid for p in items), "products should reappear when back online"


def test_ai_enhance_returns_two_outputs(launched_merchant):
    """Legacy /enhance-image endpoint should now return only 2 outputs (outdoor_1, studio_1)."""
    tok, _ = launched_merchant
    # 1x1 transparent PNG data URI – tiny payload to keep server response fast
    tiny_png = ("data:image/png;base64,"
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
    r = requests.post(f"{API}/merchant/ai/enhance-image",
                      headers={"Authorization": f"Bearer {tok}"},
                      json={"image": tiny_png, "category": "apparel"}, timeout=120)
    if r.status_code in (502, 504):
        pytest.skip(f"AI gateway timeout (status {r.status_code}) — infra cap, not a backend bug")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("outputs"), list)
    assert len(body["outputs"]) == 2, f"expected 2 outputs got {len(body['outputs'])}"
    kinds = {o.get("kind") for o in body["outputs"]}
    assert kinds == {"outdoor_1", "studio_1"}, f"unexpected kinds: {kinds}"


def test_ai_enhance_one_invalid_kind_rejected(launched_merchant):
    tok, _ = launched_merchant
    tiny_png = ("data:image/png;base64,"
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
    r = requests.post(f"{API}/merchant/ai/enhance-image/one",
                      headers={"Authorization": f"Bearer {tok}"},
                      json={"image": tiny_png, "category": "apparel", "kind": "outdoor_2"}, timeout=30)
    assert r.status_code == 400, f"invalid kind should 400, got {r.status_code} {r.text[:200]}"
