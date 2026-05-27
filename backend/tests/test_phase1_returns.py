"""Iter7-Phase1: Returns + Complaints + 24h window + Twilio inbound for return pickup."""
import os, uuid, pytest, requests, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASS = "Admin@2026"

S = {}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def merchant():
    """Register + KYC submit + admin approve + publish store. Add 2 products: one return-eligible, one not."""
    email = f"phase1_{uuid.uuid4().hex[:8]}@lokl.in"
    pw = "Phase1@2026"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"Phase1 Store {uuid.uuid4().hex[:4]}",
        "owner_name": "Phase1 Owner", "phone": "+919999900007", "city": "Bhilai",
    }, timeout=10)
    assert reg.status_code in (200, 201), reg.text
    tok = reg.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    # KYC submit (minimal valid payload)
    kyc = requests.post(f"{API}/merchant/kyc/submit", headers=h, json={
        "business_name": "Phase1 Biz", "business_type": "proprietorship",
        "business_category": "fashion", "business_address": "Sector 10, Bhilai",
        "pan_number": "ABCDE1234F", "gst_number": "22ABCDE1234F1Z5",
        "pan_doc_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "cancelled_cheque_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "bank_account_number": "123456789012", "bank_ifsc": "HDFC0000001",
        "account_holder_name": "Phase1 Owner",
    }, timeout=10)
    assert kyc.status_code == 200, kyc.text

    # Admin approves
    ahdr = {"Authorization": f"Bearer {requests.post(f'{API}/admin/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASS}).json()['token']}"}
    mers = requests.get(f"{API}/admin/merchants?status=submitted", headers=ahdr).json()
    me = next((m for m in mers if m["email"] == email), None)
    assert me, f"merchant {email} not found in submitted list"
    requests.post(f"{API}/admin/merchants/{me['id']}/approve", headers=ahdr, timeout=10).raise_for_status()

    # Set up store (publish)
    requests.post(f"{API}/merchant/storefront", headers=h, json={
        "tagline": "Phase1 store", "story": "Test",
        "banner": "x", "banners": [],
        "specialties": ["casuals"], "opens_at": "09:00", "closes_at": "23:00",
        "locality": "Sector 10",
    }, timeout=10)
    requests.post(f"{API}/merchant/store/publish", headers=h, timeout=10)

    # Product A — return-eligible
    p1 = requests.post(f"{API}/merchant/products", headers=h, json={
        "name": "Phase1 Returnable Tee", "price": 599, "mrp": 999,
        "l1_id": "l1-men", "l2_id": "l2-m-shirt", "gender": "men",
        "sizes": ["M", "L"], "image": "data:image/jpeg;base64,/9j/AAAA",
        "stock": {"M": 5, "L": 5},
        "return_eligible": True,
    }, timeout=10)
    assert p1.status_code in (200, 201), p1.text
    # Publish
    pid1 = p1.json()["id"]
    requests.post(f"{API}/merchant/products/bulk-action", headers=h, json={"action": "publish", "ids": [pid1]}, timeout=10)

    # Product B — NOT return-eligible
    p2 = requests.post(f"{API}/merchant/products", headers=h, json={
        "name": "Phase1 NonReturnable Tee", "price": 499,
        "l1_id": "l1-men", "l2_id": "l2-m-shirt", "gender": "men",
        "sizes": ["M"], "image": "data:image/jpeg;base64,/9j/AAAA",
        "stock": {"M": 5}, "return_eligible": False,
    }, timeout=10)
    pid2 = p2.json()["id"]
    requests.post(f"{API}/merchant/products/bulk-action", headers=h, json={"action": "publish", "ids": [pid2]}, timeout=10)

    return {"email": email, "token": tok, "h": h, "p1": pid1, "p2": pid2, "merchant_id": me["id"]}


def _place_order(merchant_fixt, *, include_returnable=True, include_nonreturnable=False):
    items = []
    if include_returnable:
        items.append({"id": merchant_fixt["p1"], "name": "Phase1 Returnable Tee", "price": 599, "qty": 1,
                      "size": "M", "image": "x", "key": f"{merchant_fixt['p1']}-M"})
    if include_nonreturnable:
        items.append({"id": merchant_fixt["p2"], "name": "Phase1 NonReturnable Tee", "price": 499, "qty": 1,
                      "size": "M", "image": "x", "key": f"{merchant_fixt['p2']}-M"})
    payload = {
        "items": items,
        "total": sum(i["price"] * i["qty"] for i in items),
        "customer": {"name": "Phase1 Tester", "phone": f"+9199{uuid.uuid4().hex[:8]}"},
        "address": {"name": "Phase1 Tester", "line1": "Sector 10", "city": "Bhilai", "pincode": "490020",
                    "phone": "+919999900099"},
    }
    r = requests.post(f"{API}/orders", json=payload, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_order_items_snapshot_return_eligible(merchant):
    """Order items must snapshot return_eligible from the product so historical orders aren't affected by later edits."""
    o = _place_order(merchant, include_returnable=True, include_nonreturnable=True)
    items = o["items"]
    assert any(it["return_eligible"] for it in items), "at least one item must be return-eligible"
    assert any(not it["return_eligible"] for it in items), "at least one item must NOT be return-eligible"
    S["order_with_both"] = o["id"]


def test_cannot_return_non_delivered(merchant):
    """Returns must require status='delivered'."""
    o = _place_order(merchant)
    r = requests.post(f"{API}/orders/{o['id']}/returns", json={
        "reason": "Damaged", "customer_phone": o["address"]["phone"],
    }, timeout=10)
    assert r.status_code == 400, r.text
    assert "delivered" in r.json()["detail"].lower()


def test_full_return_flow(admin_token, merchant):
    """Place order → admin accepts → mark delivered → customer raises return → admin transitions → completed."""
    o = _place_order(merchant)
    oid = o["id"]
    ahdr = {"Authorization": f"Bearer {admin_token}"}

    # Merchant accepts
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=merchant["h"], timeout=10).raise_for_status()
    # Merchant handed to rider
    requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=merchant["h"], timeout=10).raise_for_status()
    # Admin marks delivered
    r = requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr, timeout=10)
    assert r.status_code == 200, r.text

    # Customer raises return
    r = requests.post(f"{API}/orders/{oid}/returns", json={
        "reason": "Damaged product", "customer_phone": o["address"]["phone"],
    }, timeout=10)
    assert r.status_code == 200, r.text
    ret = r.json()
    assert ret["status"] == "requested"
    assert len(ret["otp"]) == 4 and ret["otp"].isdigit()
    assert ret["order_id"] == oid
    rid = ret["id"]

    # Admin advances: assign → arriving → picked_up → complete
    for action, expected in [("assign", "pickup_assigned"), ("arriving", "arriving"),
                              ("picked_up", "picked_up"), ("complete", "completed")]:
        r = requests.post(f"{API}/admin/returns/{rid}/{action}", headers=ahdr, timeout=10)
        assert r.status_code == 200, f"{action}: {r.text}"
        assert r.json()["status"] == expected

    # Order should now be 'returned'
    r = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert r["status"] == "returned"


def test_twilio_inbound_marks_return_picked_up(admin_token, merchant):
    """Twilio inbound webhook with '<OTP> - Picked Up' from RIDER_PHONE must flip return to picked_up."""
    o = _place_order(merchant)
    oid = o["id"]
    ahdr = {"Authorization": f"Bearer {admin_token}"}
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=merchant["h"]).raise_for_status()
    requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=merchant["h"]).raise_for_status()
    requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr).raise_for_status()
    ret = requests.post(f"{API}/orders/{oid}/returns", json={"reason": "Quality issue", "customer_phone": o["address"]["phone"]}, timeout=10).json()
    rid = ret["id"]
    otp = ret["otp"]
    # Admin assigns pickup
    requests.post(f"{API}/admin/returns/{rid}/assign", headers=ahdr).raise_for_status()

    # Rider WhatsApps back via Twilio inbound
    rider = os.environ.get("RIDER_PHONE", "+917719052107")
    r = requests.post(f"{API}/twilio/inbound", data={
        "From": f"whatsapp:{rider}",
        "Body": f"{otp} - Picked Up",
    }, timeout=10)
    assert r.status_code == 200, r.text
    # Return should now be picked_up
    state = requests.get(f"{API}/returns/{rid}", timeout=10).json()
    assert state["status"] == "picked_up"
    assert state.get("picked_via") == "rider-whatsapp"


def test_complaint_create_and_admin_list(admin_token):
    """Customer raises complaint → admin lists it → resolve."""
    # Use any existing order
    ahdr = {"Authorization": f"Bearer {admin_token}"}
    if "order_with_both" not in S:
        # Skip if previous test was skipped
        pytest.skip("no seed order")
    oid = S["order_with_both"]
    r = requests.post(f"{API}/orders/{oid}/complaints", json={
        "type": "damaged_item", "message": "The package arrived damaged.",
        "customer_phone": "+919999900099",
    }, timeout=10)
    assert r.status_code == 200, r.text
    cmp = r.json()
    cid = cmp["id"]
    assert cmp["status"] == "open"

    # Admin lists
    r = requests.get(f"{API}/admin/complaints", headers=ahdr, timeout=10)
    assert r.status_code == 200
    assert any(c["id"] == cid for c in r.json())

    # Customer lists
    r = requests.get(f"{API}/customer/+919999900099/complaints", timeout=10)
    assert r.status_code == 200
    assert any(c["id"] == cid for c in r.json())

    # Resolve
    r = requests.post(f"{API}/admin/complaints/{cid}/resolve", headers=ahdr, json={"note": "Refund offline."}, timeout=10)
    assert r.status_code == 200
