"""Phase 2: Returns Dashboard - admin state machine, analytics, merchant redaction."""
import os, json, requests, pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = BASE + "/api"

SEED = json.loads(Path("/tmp/phase2_seed.json").read_text())
ADMIN_HDR = {"Authorization": f"Bearer {SEED['admin_token']}"}


@pytest.fixture(scope="module")
def merchant_token():
    r = requests.post(f"{API}/auth/login", json={
        "email": SEED["merchant_email"], "password": SEED["merchant_password"],
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# Admin returns list
def test_admin_returns_list():
    r = requests.get(f"{API}/admin/returns", headers=ADMIN_HDR, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(x["id"] == SEED["return_id"] for x in data), "seeded return missing"


def test_admin_returns_status_filter():
    r = requests.get(f"{API}/admin/returns?status=requested", headers=ADMIN_HDR, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert all(x["status"] == "requested" for x in data)


# Admin returns analytics
def test_admin_returns_analytics_shape():
    r = requests.get(f"{API}/admin/returns/analytics", headers=ADMIN_HDR, timeout=15)
    assert r.status_code == 200
    data = r.json()
    for k in ("total", "by_reason", "by_merchant", "by_status"):
        assert k in data, f"missing key {k}"
    assert isinstance(data["by_status"], list)
    statuses = {s["status"] for s in data["by_status"]}
    assert {"requested", "pickup_assigned", "arriving", "picked_up", "completed"}.issubset(statuses)


# Admin complaints
def test_admin_complaints_list_and_filter():
    r = requests.get(f"{API}/admin/complaints?status=open", headers=ADMIN_HDR, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert any(c["id"] == SEED["complaint_id"] for c in data), "seeded complaint missing in 'open'"


# Merchant redaction
def test_merchant_returns_phone_redacted(merchant_token):
    h = {"Authorization": f"Bearer {merchant_token}"}
    r = requests.get(f"{API}/merchant/returns", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data) >= 1, "merchant should see at least one return"
    for ret in data:
        assert ret.get("customer_phone") == "(hidden)", f"expected redacted phone, got {ret.get('customer_phone')}"
        # Must still surface reason + otp + items
        assert ret.get("reason")
        assert ret.get("otp")
        assert isinstance(ret.get("items"), list) and len(ret["items"]) >= 1


def test_merchant_complaints_phone_redacted(merchant_token):
    h = {"Authorization": f"Bearer {merchant_token}"}
    r = requests.get(f"{API}/merchant/complaints", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert any(c["id"] == SEED["complaint_id"] for c in data)
    for c in data:
        assert c.get("customer_phone") == "(hidden)"


def test_merchant_returns_analytics(merchant_token):
    h = {"Authorization": f"Bearer {merchant_token}"}
    r = requests.get(f"{API}/merchant/analytics/returns", headers=h, timeout=15)
    assert r.status_code == 200
    data = r.json()
    for k in ("delivered_count", "returns_total", "returns_rate_pct", "by_reason"):
        assert k in data
    assert data["returns_total"] >= 1


# End-to-end admin state machine
def test_admin_state_machine_progression():
    rid = SEED["return_id"]
    for action, expected in [("assign", "pickup_assigned"), ("arriving", "arriving"),
                              ("picked_up", "picked_up"), ("complete", "completed")]:
        r = requests.post(f"{API}/admin/returns/{rid}/{action}", headers=ADMIN_HDR, timeout=15)
        assert r.status_code == 200, f"{action}: {r.text}"
        assert r.json()["status"] == expected

    # Parent order should now be status='returned'
    r = requests.get(f"{API}/orders/{SEED['order_id']}", timeout=15).json()
    assert r["status"] == "returned", f"expected returned, got {r['status']}"
    assert r.get("return_status") == "completed"


def test_admin_complaint_resolve():
    cid = SEED["complaint_id"]
    r = requests.post(f"{API}/admin/complaints/{cid}/resolve", headers=ADMIN_HDR,
                      json={"note": "Refund issued offline."}, timeout=15)
    assert r.status_code == 200

    # Now appears in resolved filter
    rr = requests.get(f"{API}/admin/complaints?status=resolved", headers=ADMIN_HDR, timeout=15).json()
    assert any(c["id"] == cid and c["status"] == "resolved" for c in rr)
