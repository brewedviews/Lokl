"""Per-merchant state machine on multi-store orders.

Validates:
  - merchant_states + merchant_timelines created on order placement
  - Each merchant can accept independently; global status only flips to
    'accepted' when ALL merchants accept (derived from min state).
  - Each merchant can hand off independently; global flips to on_the_way
    only after all handed off.
  - Admin mark-delivered with merchant_id payload marks only that merchant's
    slice; without payload it marks all.
  - Merchant /orders endpoint returns merchant_subtotal != global total and
    my_state/my_timeline reflect that merchant's own slice.
  - Customer /orders/{id} returns store_breakdown for multi-store orders.
"""
import os, uuid, pytest, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASS = "Admin@2026"


def _admin_token():
    r = requests.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    r.raise_for_status()
    return r.json()["token"]


def _seed_merchant(label):
    email = f"mm_{label}_{uuid.uuid4().hex[:6]}@lokl.in"
    pw = "Multi@2026"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"MM {label} {uuid.uuid4().hex[:4]}",
        "owner_name": f"MM {label}", "phone": f"+9199{str(uuid.uuid4().int)[:8]}", "city": "Bhilai",
    }, timeout=10)
    assert reg.status_code in (200, 201), reg.text
    tok = reg.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    requests.post(f"{API}/merchant/kyc/submit", headers=h, json={
        "business_name": f"MM {label} Biz", "business_type": "proprietorship",
        "business_category": "fashion", "business_address": "Sector 10, Bhilai",
        "pan_number": "ABCDE1234F", "gst_number": "22ABCDE1234F1Z5",
        "pan_doc_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "cancelled_cheque_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "bank_account_number": "123456789012", "bank_ifsc": "HDFC0000001",
        "account_holder_name": f"MM {label}",
    }, timeout=10).raise_for_status()

    ahdr = {"Authorization": f"Bearer {_admin_token()}"}
    mers = requests.get(f"{API}/admin/merchants?status=submitted", headers=ahdr, timeout=10).json()
    me = next((m for m in mers if m["email"] == email), None)
    assert me, f"merchant {email} not found"
    requests.post(f"{API}/admin/merchants/{me['id']}/approve", headers=ahdr, timeout=10).raise_for_status()

    requests.post(f"{API}/merchant/storefront", headers=h, json={
        "tagline": "Test", "story": "x", "banner": "x", "banners": [],
        "specialties": ["casuals"], "opens_at": "09:00", "closes_at": "23:00",
        "locality": "Sector 10", "lat": 21.21, "lng": 81.38,
    }, timeout=10).raise_for_status()
    requests.post(f"{API}/merchant/store/publish", headers=h, timeout=10)

    p = requests.post(f"{API}/merchant/products", headers=h, json={
        "name": f"MM {label} Tee", "price": 599, "mrp": 999,
        "l1_id": "l1-men", "l2_id": "l2-m-shirt", "gender": "men",
        "sizes": ["M"], "image": "data:image/jpeg;base64,/9j/AAAA",
        "stock": {"M": 10}, "return_eligible": True,
    }, timeout=10)
    assert p.status_code in (200, 201), p.text
    pid = p.json()["id"]
    requests.post(f"{API}/merchant/products/bulk-action", headers=h,
                  json={"action": "publish", "ids": [pid]}, timeout=10)

    return {"merchant_id": me["id"], "h": h, "pid": pid, "label": label, "email": email}


@pytest.fixture(scope="module")
def two_merchants():
    return _seed_merchant("A"), _seed_merchant("B")


def _place_multi_order(mA, mB):
    items = [
        {"id": mA["pid"], "name": "MM A Tee", "price": 599, "qty": 1,
         "size": "M", "image": "x", "key": f"{mA['pid']}-M"},
        {"id": mB["pid"], "name": "MM B Tee", "price": 599, "qty": 2,
         "size": "M", "image": "x", "key": f"{mB['pid']}-M"},
    ]
    payload = {
        "items": items,
        "total": sum(i["price"] * i["qty"] for i in items),
        "customer": {"name": "MM Tester", "phone": f"+9199{str(uuid.uuid4().int)[:8]}"},
        "address": {"name": "MM Tester", "line1": "Sector 10", "city": "Bhilai",
                    "pincode": "490020", "phone": "+919999900099"},
    }
    r = requests.post(f"{API}/orders", json=payload, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_multi_store_order_creates_per_merchant_state(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    assert o["is_multi_store"] is True
    assert set(o["merchant_ids"]) == {mA["merchant_id"], mB["merchant_id"]}
    states = o["merchant_states"]
    assert states[mA["merchant_id"]] == "pending"
    assert states[mB["merchant_id"]] == "pending"
    tl = o["merchant_timelines"]
    assert mA["merchant_id"] in tl and mB["merchant_id"] in tl
    # Placed stamped, others empty
    for mid in (mA["merchant_id"], mB["merchant_id"]):
        steps = tl[mid]
        assert len(steps) == 4
        assert steps[0]["label"] == "Order placed" and steps[0]["time"]
        assert steps[1]["time"] is None
        assert steps[2]["time"] is None
        assert steps[3]["time"] is None
    assert o["status"] == "pending_merchant"


def test_partial_accept_keeps_global_pending(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    # Only A accepts
    r = requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mA["h"], timeout=10)
    assert r.status_code == 200
    assert r.json()["all_accepted"] is False
    assert r.json()["my_state"] == "accepted"

    # Fetch order — global must still be pending_merchant (min state wins)
    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert o2["status"] == "pending_merchant"
    assert o2["merchant_states"][mA["merchant_id"]] == "accepted"
    assert o2["merchant_states"][mB["merchant_id"]] == "pending"


def test_all_accepted_flips_global(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mA["h"], timeout=10).raise_for_status()
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mB["h"], timeout=10).raise_for_status()
    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert o2["status"] == "accepted"
    for mid in (mA["merchant_id"], mB["merchant_id"]):
        assert o2["merchant_states"][mid] == "accepted"


def test_partial_hand_off_keeps_global_accepted(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mA["h"], timeout=10).raise_for_status()
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mB["h"], timeout=10).raise_for_status()
    # Only A hands off
    r = requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=mA["h"], timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["all_handed"] is False
    assert r.json()["my_state"] == "handed_off"

    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    # Global stays accepted because B is still accepted (min state wins)
    assert o2["status"] == "accepted"
    assert o2["merchant_states"][mA["merchant_id"]] == "handed_off"
    assert o2["merchant_states"][mB["merchant_id"]] == "accepted"


def test_all_handed_flips_global_on_the_way(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    for m in (mA, mB):
        requests.post(f"{API}/merchant/orders/{oid}/accept", headers=m["h"], timeout=10).raise_for_status()
    for m in (mA, mB):
        requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=m["h"], timeout=10).raise_for_status()
    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert o2["status"] == "on_the_way"


def test_per_merchant_admin_delivery(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    for m in (mA, mB):
        requests.post(f"{API}/merchant/orders/{oid}/accept", headers=m["h"], timeout=10).raise_for_status()
        requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=m["h"], timeout=10).raise_for_status()
    ahdr = {"Authorization": f"Bearer {_admin_token()}"}
    # Mark only A delivered
    r = requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr,
                      json={"merchant_id": mA["merchant_id"]}, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["all_delivered"] is False
    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert o2["merchant_states"][mA["merchant_id"]] == "delivered"
    assert o2["merchant_states"][mB["merchant_id"]] == "handed_off"
    assert o2["status"] == "on_the_way"  # B still handed_off

    # Mark B delivered → global delivered
    r2 = requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr,
                       json={"merchant_id": mB["merchant_id"]}, timeout=10)
    assert r2.status_code == 200
    assert r2.json()["all_delivered"] is True
    o3 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert o3["status"] == "delivered"
    assert o3.get("delivered_at")


def test_merchant_orders_returns_own_subtotal_and_state(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mA["h"], timeout=10).raise_for_status()
    # Fetch A's orders
    listA = requests.get(f"{API}/merchant/orders", headers=mA["h"], timeout=10).json()
    rowA = next(x for x in listA if x["id"] == oid)
    # A has 1 item × 599 = 599 subtotal, but order total is 599 + 2*599 = 1797
    assert rowA["merchant_subtotal"] == 599
    assert rowA["total"] == 1797
    assert rowA["my_state"] == "accepted"
    # A only sees their own item
    assert len(rowA["items"]) == 1
    assert rowA["items"][0]["merchant_id"] == mA["merchant_id"]
    # Per-merchant timeline returned for A
    assert "my_timeline" in rowA
    assert rowA["my_timeline"][1]["label"] == "Merchant accepted"
    assert rowA["my_timeline"][1]["time"], "Confirmed step must be stamped for A"

    # B has not accepted yet
    listB = requests.get(f"{API}/merchant/orders", headers=mB["h"], timeout=10).json()
    rowB = next(x for x in listB if x["id"] == oid)
    assert rowB["my_state"] == "pending"
    assert rowB["merchant_subtotal"] == 1198  # 2 × 599


def test_customer_order_returns_store_breakdown(two_merchants):
    mA, mB = two_merchants
    o = _place_multi_order(mA, mB)
    oid = o["id"]
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mA["h"], timeout=10).raise_for_status()
    o2 = requests.get(f"{API}/orders/{oid}", timeout=10).json()
    assert "store_breakdown" in o2
    bd = o2["store_breakdown"]
    assert len(bd) == 2
    by_mid = {b["merchant_id"]: b for b in bd}
    assert by_mid[mA["merchant_id"]]["state"] == "accepted"
    assert by_mid[mB["merchant_id"]]["state"] == "pending"
    assert by_mid[mA["merchant_id"]]["subtotal"] == 599
    assert by_mid[mB["merchant_id"]]["subtotal"] == 1198
