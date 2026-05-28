"""Iter5: KYC hold/resubmit, Twilio inbound webhook, multi-image products, /admin/stores enrichment."""
import os, uuid, pytest, requests, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASS = "Admin@2026"

# Shared state across tests
S = {}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_merchant():
    """Register fresh merchant + KYC submit (status=submitted)."""
    email = f"iter5_{uuid.uuid4().hex[:8]}@lokl.in"
    pw = "Iter5@2026"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"Iter5 Store {uuid.uuid4().hex[:4]}",
        "owner_name": "Iter5 Owner", "phone": f"+9199{str(uuid.uuid4().int)[:8]}", "city": "Bhilai"
    }, timeout=15)
    assert reg.status_code == 200, reg.text
    tok = reg.json()["token"]
    mid = reg.json()["merchant"]["id"]
    # Submit KYC
    kyc = requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "ABCDE1234F", "gst_number": "",
        "business_name": "Iter5 Boutique", "business_category": "Apparel",
        "business_type": "Sole Prop", "business_address": "Sector 10, Bhilai",
        "bank_account_number": "1234567890", "bank_ifsc": "SBIN0000001",
        "account_holder_name": "Iter5 Owner",
        "pan_doc_b64": "data:application/pdf;base64,JVBERi0xLjQK",
        "gst_doc_b64": "",
        "cancelled_cheque_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    }, timeout=10)
    assert kyc.status_code == 200, kyc.text
    return {"email": email, "token": tok, "mid": mid}


# ===== KYC hold + resubmit =====

def test_admin_hold_requires_comment(admin_token, fresh_merchant):
    mid = fresh_merchant["mid"]
    # Empty comment → 400
    r = requests.post(f"{API}/admin/merchants/{mid}/hold",
                      headers={"Authorization": f"Bearer {admin_token}"}, json={"comment": ""}, timeout=10)
    assert r.status_code == 400
    # Missing field → 400
    r2 = requests.post(f"{API}/admin/merchants/{mid}/hold",
                       headers={"Authorization": f"Bearer {admin_token}"}, json={}, timeout=10)
    assert r2.status_code == 400


def test_admin_hold_with_comment_succeeds(admin_token, fresh_merchant):
    mid = fresh_merchant["mid"]
    cm = "Please re-upload a clearer PAN photo."
    r = requests.post(f"{API}/admin/merchants/{mid}/hold",
                      headers={"Authorization": f"Bearer {admin_token}"}, json={"comment": cm}, timeout=10)
    assert r.status_code == 200, r.text
    # Verify status flipped to on_hold via admin merchants list
    listr = requests.get(f"{API}/admin/merchants?status=on_hold",
                        headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
    assert listr.status_code == 200
    ids = [m["id"] for m in listr.json()]
    assert mid in ids
    # Confirm notification pushed
    target = next(m for m in listr.json() if m["id"] == mid)
    notif_types = [n.get("type") for n in (target.get("notifications") or [])]
    assert "kyc-on-hold" in notif_types
    assert target.get("hold_comment") == cm


def test_kyc_status_exposes_hold_comment(fresh_merchant):
    r = requests.get(f"{API}/merchant/kyc/status",
                     headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["kyc_status"] == "on_hold"
    assert data["merchant"].get("hold_comment")


def test_admin_merchants_filters(admin_token):
    for s in ("submitted", "approved", "rejected", "on_hold"):
        r = requests.get(f"{API}/admin/merchants?status={s}",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
        assert r.status_code == 200, f"{s}: {r.text}"
        # All returned must match the filter
        for m in r.json():
            assert m.get("kyc_status") == s


def test_merchant_resubmit_from_on_hold(fresh_merchant):
    r = requests.post(f"{API}/merchant/kyc/resubmit",
                      headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, timeout=10)
    assert r.status_code == 200, r.text
    # Verify flipped back to submitted and cleared
    st = requests.get(f"{API}/merchant/kyc/status",
                      headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, timeout=10).json()
    assert st["kyc_status"] == "submitted"
    assert not st["merchant"].get("hold_comment")
    assert not st["merchant"].get("hold_at")


def test_resubmit_rejected_when_not_on_hold(fresh_merchant):
    # Currently 'submitted' — second resubmit should 400
    r = requests.post(f"{API}/merchant/kyc/resubmit",
                      headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, timeout=10)
    assert r.status_code == 400


def test_kyc_resubmit_via_submit_clears_hold(admin_token, fresh_merchant):
    # Put back on hold, then resubmit via /merchant/kyc/submit
    mid = fresh_merchant["mid"]
    requests.post(f"{API}/admin/merchants/{mid}/hold",
                  headers={"Authorization": f"Bearer {admin_token}"}, json={"comment": "second hold"}, timeout=10)
    sub = requests.post(f"{API}/merchant/kyc/submit",
                        headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, json={
        "pan_number": "ABCDE1234F", "gst_number": "",
        "business_name": "Iter5 Boutique", "business_category": "Apparel",
        "business_type": "Sole Prop", "business_address": "Sector 10, Bhilai",
        "bank_account_number": "1234567890", "bank_ifsc": "SBIN0000001",
        "account_holder_name": "Iter5 Owner",
        "pan_doc_b64": "data:application/pdf;base64,JVBERi0xLjQK",
        "gst_doc_b64": "",
        "cancelled_cheque_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    }, timeout=10)
    assert sub.status_code == 200
    st = requests.get(f"{API}/merchant/kyc/status",
                      headers={"Authorization": f"Bearer {fresh_merchant['token']}"}, timeout=10).json()
    assert st["kyc_status"] == "submitted"
    assert not st["merchant"].get("hold_comment")
    assert not st["merchant"].get("hold_at")


# ===== /admin/stores enrichment =====

def test_admin_stores_exposes_hold_and_b64(admin_token):
    r = requests.get(f"{API}/admin/stores", headers={"Authorization": f"Bearer {admin_token}"}, timeout=20)
    assert r.status_code == 200
    stores = r.json()
    # Find at least one with a merchant block to inspect schema
    with_merchant = [s for s in stores if s.get("merchant")]
    assert with_merchant, "expected at least one store with merchant snapshot"
    sample = with_merchant[0]["merchant"]
    for k in ("hold_comment", "hold_at", "pan_doc_b64", "gst_doc_b64", "cancelled_cheque_b64"):
        assert k in sample, f"missing key {k} in merchant snapshot"


# ===== Multi-image products =====

@pytest.fixture(scope="module")
def approved_merchant(admin_token):
    """Register + KYC submit + admin approve + storefront set up."""
    email = f"iter5p_{uuid.uuid4().hex[:8]}@lokl.in"
    pw = "Iter5@2026"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"Iter5 ImgStore {uuid.uuid4().hex[:4]}",
        "owner_name": "ImgOwner", "phone": f"+9199{str(uuid.uuid4().int)[:8]}", "city": "Bhilai"
    }, timeout=10).json()
    tok = reg["token"]; mid = reg["merchant"]["id"]
    requests.post(f"{API}/merchant/kyc/submit", headers={"Authorization": f"Bearer {tok}"}, json={
        "pan_number": "AAAAA1111A", "gst_number": "",
        "business_name": "Img Biz", "business_category": "Apparel",
        "business_type": "Sole Prop", "business_address": "Sector 10, Bhilai",
        "bank_account_number": "1111", "bank_ifsc": "SBIN0000001",
        "account_holder_name": "ImgOwner",
        "pan_doc_b64": "data:application/pdf;base64,JVBERi0xLjQK",
        "gst_doc_b64": "",
        "cancelled_cheque_b64": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    }, timeout=10)
    assert requests.post(f"{API}/admin/merchants/{mid}/approve",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=10).status_code == 200
    # Storefront
    sf = requests.post(f"{API}/merchant/storefront", headers={"Authorization": f"Bearer {tok}"}, json={
        "tagline": "T", "story": "S", "banner": "",
        "banners": ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="],
        "specialties": ["A"], "locality": "Sector 10",
        "timing": "", "opens_at": "10:00", "closes_at": "20:00"
    }, timeout=10)
    assert sf.status_code == 200, sf.text
    return {"token": tok, "mid": mid}


def test_create_product_with_multiple_images(approved_merchant):
    tok = approved_merchant["token"]
    imgs = [
        "data:image/jpeg;base64,AAA1",
        "data:image/jpeg;base64,AAA2",
        "data:image/jpeg;base64,AAA3",
    ]
    r = requests.post(f"{API}/merchant/products", headers={"Authorization": f"Bearer {tok}"}, json={
        "name": "TEST_MultiImg Tee", "price": 499, "mrp": 799,
        "l1_id": "fashion", "l2_id": "tshirts", "gender": "men",
        "description": "multi img", "sizes": ["M", "L"],
        "image": imgs[0], "images": imgs, "stock": {"M": 5, "L": 5}
    }, timeout=10)
    # If l1/l2 ids differ in this seed, the call may 400 — surface it loudly
    if r.status_code == 400 and "Invalid l1_id" in r.text:
        # Fallback: fetch first valid l1
        cats = requests.get(f"{API}/categories", timeout=10).json()
        l1 = cats[0]["id"]
        l2_list = cats[0].get("l2", [])
        l2 = l2_list[0]["id"] if l2_list else ""
        body = {
            "name": "TEST_MultiImg Tee", "price": 499, "mrp": 799,
            "l1_id": l1, "l2_id": l2, "gender": "" if l2 else "men",
            "description": "multi img", "sizes": ["M", "L"],
            "image": imgs[0], "images": imgs, "stock": {"M": 5, "L": 5}
        }
        r = requests.post(f"{API}/merchant/products", headers={"Authorization": f"Bearer {tok}"}, json=body, timeout=10)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p.get("images") == imgs, f"images mismatch: {p.get('images')}"
    S["pid"] = p["id"]


def test_get_merchant_products_returns_images(approved_merchant):
    tok = approved_merchant["token"]
    r = requests.get(f"{API}/merchant/products", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    p = next((x for x in r.json() if x["id"] == S.get("pid")), None)
    assert p is not None
    assert isinstance(p.get("images"), list) and len(p["images"]) == 3


def test_update_product_images_array(approved_merchant):
    tok = approved_merchant["token"]
    new_imgs = ["data:image/jpeg;base64,NEW1", "data:image/jpeg;base64,NEW2"]
    r = requests.put(f"{API}/merchant/products/{S['pid']}",
                     headers={"Authorization": f"Bearer {tok}"},
                     json={"images": new_imgs, "image": new_imgs[0]}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("images") == new_imgs


# ===== Twilio inbound webhook =====

@pytest.fixture(scope="module")
def live_order(admin_token, approved_merchant):
    """Place a real order against the approved merchant's store/product, accept it so OTP is active."""
    # Need a real product in the merchant's store (created above). Publish store first.
    tok = approved_merchant["token"]
    pub = requests.post(f"{API}/merchant/publish", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert pub.status_code == 200, pub.text
    # Place order
    order = requests.post(f"{API}/orders", json={
        "items": [{"id": S["pid"], "name": "TEST_MultiImg Tee", "price": 499, "qty": 1, "size": "M"}],
        "address": {"name": "Buyer", "phone": "+919998887776", "line1": "10 Main", "city": "Bhilai", "pincode": "490001"},
        "total": 499, "payment_method": "COD",
        "customer": {"name": "Buyer", "phone": "+919998887776"}
    }, timeout=10)
    assert order.status_code == 200, order.text
    oid = order.json()["id"]
    # Accept
    acc = requests.post(f"{API}/merchant/orders/{oid}/accept",
                        headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert acc.status_code == 200, acc.text
    otp = acc.json().get("otp")
    assert otp and len(otp) == 4
    return {"oid": oid, "otp": otp}


def test_twilio_inbound_gibberish_empty_twiml(live_order):
    r = requests.post(f"{API}/twilio/inbound",
                      data={"Body": "hello there", "From": "whatsapp:+919999900099"}, timeout=10)
    assert r.status_code == 200
    assert "<Response></Response>" in r.text


def test_twilio_inbound_wrong_otp_empty_twiml(live_order):
    r = requests.post(f"{API}/twilio/inbound",
                      data={"Body": "0000 - Delivered", "From": "whatsapp:+919999900099"}, timeout=10)
    assert r.status_code == 200
    assert "<Response></Response>" in r.text


def test_twilio_inbound_correct_otp_delivers(live_order):
    body = f"{live_order['otp']} - Delivered"
    # Sender must be RIDER_PHONE (+917719052107) per env var. Non-rider senders are silently dropped.
    r = requests.post(f"{API}/twilio/inbound",
                      data={"Body": body, "From": "whatsapp:+917719052107"}, timeout=10)
    assert r.status_code == 200
    assert "marked delivered" in r.text.lower()
    # Verify in DB
    o = requests.get(f"{API}/orders/{live_order['oid']}", timeout=10).json()
    assert o["status"] == "delivered"
    assert o.get("delivered_via") == "rider-whatsapp"
