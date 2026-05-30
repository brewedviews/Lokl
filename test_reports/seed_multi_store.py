"""Seeds 2 merchants + 1 multi-store order for E2E UI testing.
Outputs a JSON to /tmp/multi_store_seed.json containing merchant A email/password,
merchant B email/password, order_id, and merchant_ids.
"""
import os, uuid, json, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"
PW = "Multi@2026"


def admin_token():
    return requests.post(f"{API}/admin/login", json={"email": "admin@lokl.in", "password": "Admin@2026"}, timeout=10).json()["token"]


def seed(label):
    email = f"mmui_{label}_{uuid.uuid4().hex[:6]}@lokl.in"
    reg = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PW, "store_name": f"MMUI {label} {uuid.uuid4().hex[:4]}",
        "owner_name": f"MMUI {label}", "phone": f"+9199{str(uuid.uuid4().int)[:8]}", "city": "Bhilai",
    }, timeout=15)
    reg.raise_for_status()
    tok = reg.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    requests.post(f"{API}/merchant/kyc/submit", headers=h, json={
        "business_name": f"MMUI {label} Biz", "business_type": "proprietorship",
        "business_category": "fashion", "business_address": "Sector 10, Bhilai",
        "pan_number": "ABCDE1234F", "gst_number": "22ABCDE1234F1Z5",
        "pan_doc_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "cancelled_cheque_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "bank_account_number": "123456789012", "bank_ifsc": "HDFC0000001",
        "account_holder_name": f"MMUI {label}",
    }, timeout=15).raise_for_status()
    ahdr = {"Authorization": f"Bearer {admin_token()}"}
    mers = requests.get(f"{API}/admin/merchants?status=submitted", headers=ahdr, timeout=15).json()
    me = next(m for m in mers if m["email"] == email)
    requests.post(f"{API}/admin/merchants/{me['id']}/approve", headers=ahdr, timeout=15).raise_for_status()
    requests.post(f"{API}/merchant/storefront", headers=h, json={
        "tagline": "Test", "story": "x", "banner": "x", "banners": [],
        "specialties": ["casuals"], "opens_at": "09:00", "closes_at": "23:00",
        "locality": "Sector 10", "lat": 21.21, "lng": 81.38,
    }, timeout=15).raise_for_status()
    requests.post(f"{API}/merchant/store/publish", headers=h, timeout=15)
    p = requests.post(f"{API}/merchant/products", headers=h, json={
        "name": f"MMUI {label} Tee", "price": 599, "mrp": 999,
        "l1_id": "l1-men", "l2_id": "l2-m-shirt", "gender": "men",
        "sizes": ["M"], "image": "data:image/jpeg;base64,/9j/AAAA",
        "stock": {"M": 10}, "return_eligible": True,
    }, timeout=15)
    pid = p.json()["id"]
    requests.post(f"{API}/merchant/products/bulk-action", headers=h,
                  json={"action": "publish", "ids": [pid]}, timeout=15)
    return {"merchant_id": me["id"], "email": email, "password": PW, "pid": pid, "label": label}


mA, mB = seed("A"), seed("B")
items = [
    {"id": mA["pid"], "name": "MMUI A Tee", "price": 599, "qty": 1,
     "size": "M", "image": "x", "key": f"{mA['pid']}-M"},
    {"id": mB["pid"], "name": "MMUI B Tee", "price": 599, "qty": 2,
     "size": "M", "image": "x", "key": f"{mB['pid']}-M"},
]
order = requests.post(f"{API}/orders", json={
    "items": items, "total": sum(i["price"]*i["qty"] for i in items),
    "customer": {"name": "MMUI Test", "phone": f"+9199{str(uuid.uuid4().int)[:8]}"},
    "address": {"name": "MMUI Test", "line1": "Sector 10", "city": "Bhilai",
                "pincode": "490020", "phone": "+919999900099"},
}, timeout=15).json()

out = {"mA": mA, "mB": mB, "order_id": order["id"], "is_multi_store": order.get("is_multi_store")}
Path("/tmp/multi_store_seed.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
