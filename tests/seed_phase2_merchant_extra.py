"""Add another delivered order + open return + open complaint on the SAME merchant from seed_phase2."""
import os, json, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"

seed = json.loads(Path("/tmp/phase2_seed.json").read_text())
ADMIN = {"email": "admin@lokl.in", "password": "Admin@2026"}

atok = requests.post(f"{API}/admin/login", json=ADMIN).json()["token"]
ahdr = {"Authorization": f"Bearer {atok}"}
mtok = requests.post(f"{API}/auth/login", json={
    "email": seed["merchant_email"], "password": seed["merchant_password"]
}).json()["token"]
mhdr = {"Authorization": f"Bearer {mtok}"}

pid = seed["product_id"]
# Place fresh order
payload = {
    "items": [{"id": pid, "name": "UI8 Returnable Tee", "price": 599, "qty": 1,
               "size": "L", "image": "x", "key": f"{pid}-L"}],
    "total": 599,
    "customer": {"name": "UI8 Tester2", "phone": "+919999922288"},
    "address": {"name": "UI8 Tester2", "line1": "Sector 9", "city": "Bhilai", "pincode": "490020",
                "phone": "+919999922288"},
}
o = requests.post(f"{API}/orders", json=payload, timeout=15).json()
oid = o["id"]
requests.post(f"{API}/merchant/orders/{oid}/accept", headers=mhdr).raise_for_status()
requests.post(f"{API}/merchant/orders/{oid}/handed-to-rider", headers=mhdr).raise_for_status()
requests.post(f"{API}/admin/orders/{oid}/mark-delivered", headers=ahdr).raise_for_status()

ret = requests.post(f"{API}/orders/{oid}/returns", json={
    "reason": "Wrong item received", "customer_phone": "+919999922288",
}).json()
cmp = requests.post(f"{API}/orders/{oid}/complaints", json={
    "type": "missing_item", "message": "Item was missing in my package.", "customer_phone": "+919999922288",
}).json()

seed["second_order_id"] = oid
seed["second_return_id"] = ret["id"]
seed["second_return_otp"] = ret["otp"]
seed["second_complaint_id"] = cmp["id"]
Path("/tmp/phase2_seed.json").write_text(json.dumps(seed, indent=2))
print(json.dumps({"oid": oid, "rid": ret["id"], "otp": ret["otp"], "cid": cmp["id"]}, indent=2))
