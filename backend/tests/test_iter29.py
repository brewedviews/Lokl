"""
Iter-29 regression tests:
- Item 1: Merchant phone OTP login (/api/auth/merchant/request-otp + verify-otp)
- Item 2: Storefront mandatory area + pincode + GeoJSON location
- Item 4: Product gender filter (/api/products?gender=...)
"""
import os
import re
import time
import pytest
import requests
import subprocess

BASE_URL = os.environ.get("NEXT_PUBLIC_API_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")

MERCHANT_EMAIL = "iter29_sf_test@lokl.in"
MERCHANT_PASSWORD = "Iter29@2026"
MERCHANT_PHONE = "9876500002"  # approved KYC merchant
DRAFT_MERCHANT_PHONE = "9876500001"  # draft (kyc) merchant
UNREGISTERED_PHONE = "9000000999"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _grep_merchant_otp(phone_10: str) -> str | None:
    """Grep the latest [MERCHANT-OTP-DEBUG] line for the given phone."""
    try:
        out = subprocess.check_output(
            ["tail", "-n", "400", "/var/log/supervisor/backend.err.log"],
            stderr=subprocess.DEVNULL,
        ).decode()
    except Exception:
        return None
    matches = re.findall(rf"\[MERCHANT-OTP-DEBUG\] phone=91{phone_10} otp=(\d{{6}})", out)
    return matches[-1] if matches else None


# ============ Item 1: Merchant OTP login ============

class TestItem1MerchantOtp:
    def test_request_otp_registered_phone(self, client):
        r = client.post(f"{BASE_URL}/api/auth/merchant/request-otp", json={"phone": MERCHANT_PHONE})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "OTP" in (data.get("message") or "")
        assert data.get("expires_in") == 600
        # OTP must be written to the err log
        time.sleep(0.5)
        otp = _grep_merchant_otp(MERCHANT_PHONE)
        assert otp is not None and len(otp) == 6, "MERCHANT-OTP-DEBUG line not found"

    def test_request_otp_unregistered_phone_404(self, client):
        r = client.post(f"{BASE_URL}/api/auth/merchant/request-otp", json={"phone": UNREGISTERED_PHONE})
        assert r.status_code == 404, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "no merchant account" in detail or "register" in detail

    def test_verify_otp_wrong_then_correct(self, client):
        # request fresh OTP
        r = client.post(f"{BASE_URL}/api/auth/merchant/request-otp", json={"phone": MERCHANT_PHONE})
        assert r.status_code == 200
        time.sleep(0.5)
        correct_otp = _grep_merchant_otp(MERCHANT_PHONE)
        assert correct_otp, "no debug OTP captured"

        # 1 wrong attempt
        r = client.post(f"{BASE_URL}/api/auth/merchant/verify-otp",
                        json={"phone": MERCHANT_PHONE, "otp": "000000" if correct_otp != "000000" else "111111"})
        assert r.status_code == 401, r.text
        detail = r.json().get("detail") or ""
        assert "Incorrect OTP" in detail
        assert "attempts remaining" in detail.lower()

        # correct OTP → token envelope
        r = client.post(f"{BASE_URL}/api/auth/merchant/verify-otp",
                        json={"phone": MERCHANT_PHONE, "otp": correct_otp})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "merchant" in data
        token = data["token"]
        assert isinstance(token, str) and token.startswith("ey")
        # Verify JWT subject is merchant_id starting m-
        import base64, json as _json
        payload_part = token.split(".")[1]
        payload_part += "=" * (-len(payload_part) % 4)
        payload = _json.loads(base64.urlsafe_b64decode(payload_part))
        assert payload.get("role") == "merchant"
        assert (payload.get("sub") or "").startswith("m-")

    def test_verify_too_many_wrong_attempts(self, client):
        r = client.post(f"{BASE_URL}/api/auth/merchant/request-otp", json={"phone": MERCHANT_PHONE})
        assert r.status_code == 200
        time.sleep(0.5)
        last_detail = ""
        for _ in range(6):
            r = client.post(f"{BASE_URL}/api/auth/merchant/verify-otp",
                            json={"phone": MERCHANT_PHONE, "otp": "000001"})
            last_detail = (r.json().get("detail") or "")
            if "Too many" in last_detail:
                break
        assert "Too many attempts" in last_detail, f"got: {last_detail}"


# ============ Item 4: Products gender filter ============

class TestItem4GenderFilter:
    def test_products_filter_men_shirts(self, client):
        r = client.get(f"{BASE_URL}/api/products", params={"l1": "l1-men", "l2": "l2-m-shirt", "gender": "men"})
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        assert isinstance(items, list)
        # all returned items must be gender=men
        for p in items:
            g = (p.get("gender") or "").lower()
            assert g in ("men", ""), f"unexpected gender {g} for product {p.get('id')}"

    def test_products_no_gender_returns_results(self, client):
        # smoke: without gender, endpoint must not 500
        r = client.get(f"{BASE_URL}/api/products", params={"l1": "l1-men"})
        assert r.status_code == 200


# ============ Item 2: Storefront mandatory fields ============

@pytest.fixture(scope="module")
def merchant_token(client):
    r = client.post(f"{BASE_URL}/api/auth/login",
                    json={"email": MERCHANT_EMAIL, "password": MERCHANT_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"merchant login failed: {r.status_code} {r.text[:200]}")
    return r.json()["token"]


class TestItem2Storefront:
    BASE_PAYLOAD = {
        "tagline": "Iter29 tagline",
        "story": "Iter29 story narrative",
        "banner": "https://example.com/banner.jpg",
    }

    def test_missing_area_returns_400(self, client, merchant_token):
        h = {"Authorization": f"Bearer {merchant_token}"}
        body = {**self.BASE_PAYLOAD, "pincode": "490006", "lat": 21.21, "lng": 81.41}
        r = client.post(f"{BASE_URL}/api/merchant/storefront", json=body, headers=h)
        assert r.status_code == 400, r.text
        assert "area" in (r.json().get("detail") or "").lower()

    def test_missing_pincode_returns_400(self, client, merchant_token):
        h = {"Authorization": f"Bearer {merchant_token}"}
        body = {**self.BASE_PAYLOAD, "area": "sector_7", "lat": 21.21, "lng": 81.41}
        r = client.post(f"{BASE_URL}/api/merchant/storefront", json=body, headers=h)
        assert r.status_code == 400, r.text
        assert "pincode" in (r.json().get("detail") or "").lower()

    def test_missing_latlng_returns_400(self, client, merchant_token):
        h = {"Authorization": f"Bearer {merchant_token}"}
        body = {**self.BASE_PAYLOAD, "area": "sector_7", "pincode": "490006"}
        r = client.post(f"{BASE_URL}/api/merchant/storefront", json=body, headers=h)
        assert r.status_code == 400, r.text
        d = (r.json().get("detail") or "").lower()
        assert "pin" in d or "map" in d or "lat" in d

    def test_save_full_payload_persists_geojson(self, client, merchant_token):
        h = {"Authorization": f"Bearer {merchant_token}"}
        payload = {
            **self.BASE_PAYLOAD,
            "area": "sector_7",
            "area_label": "Sector 7",
            "pincode": "490006",
            "lat": 21.21,
            "lng": 81.41,
        }
        r = client.post(f"{BASE_URL}/api/merchant/storefront", json=payload, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        store = body.get("store") or {}
        assert store.get("area_slug") == "sector_7"
        assert store.get("pincode") == "490006"
        loc = store.get("location") or {}
        assert loc.get("type") == "Point"
        coords = loc.get("coordinates") or []
        assert len(coords) == 2
        assert abs(coords[0] - 81.41) < 0.01
        assert abs(coords[1] - 21.21) < 0.01
        # Read merchant via /api/auth/me and verify storefront persistence
        r2 = client.get(f"{BASE_URL}/api/auth/me", headers=h)
        assert r2.status_code == 200, r2.text
        me = r2.json()
        sf = (me.get("user") or me).get("storefront") or me.get("storefront") or {}
        assert sf.get("area_slug") == "sector_7"
        assert sf.get("pincode") == "490006"
