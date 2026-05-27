"""Seed data for Phase 2 UI testing: a fresh merchant with a delivered order + open return + open complaint."""
import os, uuid, json, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"

ADMIN = {"email": "admin@lokl.in", "password": "Admin@2026"}


def main():
    out = {}
    # Admin token
    atok = requests.post(f"{API}/admin/login", json=ADMIN, timeout=15).json()["token"]
    ahdr = {"Authorization": f"Bearer {atok}"}
    out["admin_token"] = atok

    # Fresh merchant
    suffix = uuid.uuid4().hex[:8]
    email = f"ui8_{suffix}@lokl.in"
    pw = "Ui8@2026"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "store_name": f"UI8 Store {suffix}",
        "owner_name": "UI8 Owner", "phone": "+919999900088", "city": "Bhilai",
    }, timeout=15)
    r.raise_for_status()
    mtok = r.json()["token"]
    mhdr = {"Authorization": f"Bearer {mtok}"}

    # KYC
    requests.post(f"{API}/merchant/kyc/submit", headers=mhdr, json={
        "business_name": "UI8 Biz", "business_type": "proprietorship",
        "business_category": "fashion", "business_address": "Sector 10, Bhilai",
        "pan_number": "ABCDE1234F", "gst_number": "22ABCDE1234F1Z5",
        "pan_doc_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "cancelled_cheque_b64": "/9j/4AAQSkZJRgABAQAAAQABAAD",
        "bank_account_number": "123456789012", "bank_ifsc": "HDFC0000001",
        "account_holder_name": "UI8 Owner",
    }, timeout=15).raise_for_status()

    # Admin approves
    mers = requests.get(f"{API}/admin/merchants?status=submitted", headers=ahdr).json()
    me = next((m for m in mers if m["email"] == email), None)
    assert me, "merchant not in submitted list"
    mid = me["id"]
    requests.post(f"{API}/admin/merchants/{mid}/approve", headers=ahdr, timeout=15).raise_for_status()

    # Storefront
    requests.post(f"{API}/merchant/storefront", headers=mhdr, json={
        "tagline": "UI8", "story": "Test",
        "banner": "x", "banners": [],
        "specialties": ["casuals"], "opens_at": "09:00", "closes_at": "23:00",
        "locality": "Sector 10",
    }, timeout=15)
    requests.post(f"{API}/merchant/store/publish", headers=mhdr, timeout=15)

    # Return-eligible product
    p = requests.post(f"{API}/merchant/products", headers=mhdr, json={
        "name": "UI8 Returnable Tee", "price": 599, "mrp": 999,
        "l1_id": "l1-men", "l2_id": "l2-m-shirt", "gender": "men",
        "sizes": ["M", "L"], "image": "data:image/jpeg;base64,/9j/AAAA",
        "stock": {"M": 5, "L": 5},
        "return_eligible": True,
    }, timeout=15)
    p.raise_for_status()
    pid = p.json()["id"]
    requests.post(f"{API}/merchant/products/bulk-action", headers=mhdr, json={"action": "publish", "ids": [pid]}, timeout=15)

    # Place order
    payload = {
        "items": [{"id": pid, "name": "UI8 Returnable Tee", "price": 599, "qty": 1,
                   "size": "M", "image": "x", "key": f"{pid}-M"}],
        "total": 599,
        "customer": {"name": "UI8 Tester", "phone": "+919999911177"},
        "address": {"name": "UI8 Tester", "line1": "Sector 10", "city": "Bhilai", "pincode": "490020",
                    "phone": "+919999911177"},
    }
    o = requests.post(f"{API}/orders", json=payload, timeout=15).json()
    oid = o["id"]

    # Accept → handed-to-rider → delivered
    requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mhdr).raise_for_status()
    requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=mhdr).raise_for_status()
    requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr).raise_for_status()

    # Return (requested) - keep open for UI state-machine progression
    ret = requests.post(f"{API}/orders/{oid}/returns", json={
        "reason": "Damaged product", "customer_phone": "+919999911177",
    }, timeout=15).json()

    # Complaint (open)
    cmp = requests.post(f"{API}/orders/{oid}/complaints", json={
        "type": "damaged_item",
        "message": "Package arrived damaged — please refund.",
        "customer_phone": "+919999911177",
    }, timeout=15).json()

    out.update({
        "merchant_email": email, "merchant_password": pw, "merchant_id": mid,
        "order_id": oid, "return_id": ret["id"], "return_otp": ret["otp"],
        "complaint_id": cmp["id"], "product_id": pid,
    })

    Path("/tmp/phase2_seed.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
