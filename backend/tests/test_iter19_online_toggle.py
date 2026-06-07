"""Iter-19 / Phase-3: Merchant online/offline toggle backend contract.

Covers GET /api/merchant/store/state + POST /api/merchant/store/online
for the demo merchant `menscape@lokl.demo`.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "menscape@lokl.demo"
DEMO_PWD = "Demo@2026"


@pytest.fixture(scope="module")
def merchant_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PWD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"demo merchant login failed: {r.status_code} {r.text}")
    data = r.json()
    assert "token" in data and isinstance(data["token"], str)
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(merchant_token):
    return {"Authorization": f"Bearer {merchant_token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# GET /api/merchant/store/state
# ---------------------------------------------------------------------------
class TestStoreState:
    def test_state_returns_full_payload(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/merchant/store/state", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("published", "online", "can_toggle", "product_count"):
            assert k in d, f"missing key {k} in {d}"
        assert isinstance(d["published"], bool)
        assert isinstance(d["online"], bool)
        assert isinstance(d["can_toggle"], bool)
        assert isinstance(d["product_count"], int)

    def test_state_demo_merchant_can_toggle(self, auth_headers):
        d = requests.get(f"{BASE_URL}/api/merchant/store/state", headers=auth_headers, timeout=15).json()
        # Demo menscape is published + has >=1 product + not paused
        assert d["published"] is True
        assert d["product_count"] >= 1
        assert d["can_toggle"] is True

    def test_state_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/merchant/store/state", timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# POST /api/merchant/store/online  — toggles persist
# ---------------------------------------------------------------------------
class TestStoreOnlineToggle:
    def test_toggle_off_then_on_persists(self, auth_headers):
        # set OFFLINE
        r1 = requests.post(
            f"{BASE_URL}/api/merchant/store/online",
            headers=auth_headers, json={"online": False}, timeout=15,
        )
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1.get("ok") is True
        assert d1.get("online") is False

        # GET should reflect it
        g1 = requests.get(f"{BASE_URL}/api/merchant/store/state", headers=auth_headers, timeout=15).json()
        assert g1["online"] is False

        # set ONLINE again
        r2 = requests.post(
            f"{BASE_URL}/api/merchant/store/online",
            headers=auth_headers, json={"online": True}, timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json().get("online") is True

        # GET should reflect online again
        g2 = requests.get(f"{BASE_URL}/api/merchant/store/state", headers=auth_headers, timeout=15).json()
        assert g2["online"] is True

    def test_toggle_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/merchant/store/online",
            json={"online": True}, timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_toggle_payload_defaults_to_false_when_missing(self, auth_headers):
        # The endpoint uses bool(payload.get("online")); missing key → False
        r = requests.post(
            f"{BASE_URL}/api/merchant/store/online",
            headers=auth_headers, json={}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["online"] is False
        # Restore to online for downstream tests / UI
        requests.post(
            f"{BASE_URL}/api/merchant/store/online",
            headers=auth_headers, json={"online": True}, timeout=15,
        )
