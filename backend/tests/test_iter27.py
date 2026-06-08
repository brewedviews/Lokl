"""
Iter-27 backend tests:
- Item 7: paused / non_clickable toggles on hero, L1 categories, L2 subcategories, offers.
- Item 5: merchant KYC poll (status changes from submitted -> approved via admin endpoint).
- Item 3: customer OTP request + verify -> token issued.
"""
import os
import re
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("NEXT_PUBLIC_API_URL") or os.environ.get("REACT_APP_BACKEND_URL")
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "BASE_URL not configured"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"email": "admin@lokl.in", "password": "Admin@2026"},
                      timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ===== Item 7 — Hero paused / non_clickable =====
class TestHeroToggles:
    def test_default_hero_has_flags(self):
        r = requests.get(f"{BASE_URL}/api/site/homepage-config", timeout=15)
        assert r.status_code == 200
        hero = r.json().get("hero") or {}
        # If hero exists at all, should have paused field surfaced (False) or strip {paused: True} when paused.
        assert "paused" in hero, f"hero missing 'paused' key: {hero}"

    def test_hero_paused_strips_to_just_paused(self, admin_headers):
        # set paused=true
        r = requests.put(f"{BASE_URL}/api/admin/site/homepage-config",
                         headers=admin_headers,
                         json={"hero": {"paused": True, "non_clickable": False}}, timeout=15)
        assert r.status_code == 200, r.text
        pub = requests.get(f"{BASE_URL}/api/site/homepage-config", timeout=15).json()
        hero = pub.get("hero") or {}
        assert hero == {"paused": True}, f"expected {{paused: True}} only, got {hero}"

    def test_hero_non_clickable_persists(self, admin_headers):
        r = requests.put(f"{BASE_URL}/api/admin/site/homepage-config",
                         headers=admin_headers,
                         json={"hero": {"paused": False, "non_clickable": True}}, timeout=15)
        assert r.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/site/homepage-config", timeout=15).json()
        hero = pub.get("hero") or {}
        assert hero.get("paused") in (False, None)
        assert hero.get("non_clickable") is True, f"non_clickable not persisted: {hero}"

    def test_hero_restore(self, admin_headers):
        r = requests.put(f"{BASE_URL}/api/admin/site/homepage-config",
                         headers=admin_headers,
                         json={"hero": {"paused": False, "non_clickable": False}}, timeout=15)
        assert r.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/site/homepage-config", timeout=15).json()
        hero = pub.get("hero") or {}
        assert hero.get("paused") in (False, None)
        assert hero.get("non_clickable") in (False, None)


# ===== Item 7 — Categories / Subcategories / Offers paused + non_clickable =====
class TestCategoryToggles:
    def test_category_pause_hides_from_list(self, admin_headers):
        # Pick the first L1 category
        cats = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        assert isinstance(cats, list) and cats, "no categories"
        cat = cats[0]
        cid = cat.get("id") or cat.get("slug") or cat.get("name")
        assert cid

        # Pause
        r = requests.put(f"{BASE_URL}/api/admin/categories/{cid}",
                         headers=admin_headers,
                         json={"paused": True, "non_clickable": False}, timeout=15)
        assert r.status_code in (200, 204), r.text

        public = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        ids = [c.get("id") or c.get("slug") or c.get("name") for c in public]
        assert cid not in ids, f"paused category {cid} still visible in {ids}"

        # Restore
        r = requests.put(f"{BASE_URL}/api/admin/categories/{cid}",
                         headers=admin_headers,
                         json={"paused": False, "non_clickable": False}, timeout=15)
        assert r.status_code in (200, 204)

        public2 = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        ids2 = [c.get("id") or c.get("slug") or c.get("name") for c in public2]
        assert cid in ids2

    def test_category_non_clickable_persists(self, admin_headers):
        cats = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        cat = cats[0]
        cid = cat.get("id") or cat.get("slug") or cat.get("name")
        r = requests.put(f"{BASE_URL}/api/admin/categories/{cid}",
                         headers=admin_headers,
                         json={"non_clickable": True}, timeout=15)
        assert r.status_code in (200, 204), r.text
        public = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        m = next((c for c in public if (c.get("id") or c.get("slug") or c.get("name")) == cid), None)
        assert m and m.get("non_clickable") is True
        # restore
        requests.put(f"{BASE_URL}/api/admin/categories/{cid}",
                     headers=admin_headers,
                     json={"non_clickable": False}, timeout=15)

    def test_subcategory_pause_hides_l2(self, admin_headers):
        cats = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        # find first L2 under any L1
        sub = None
        for c in cats:
            subs = c.get("subcategories") or c.get("l2") or []
            if subs:
                sub = subs[0]
                break
        if not sub:
            pytest.skip("no subcategories available")
        sid = sub.get("id") or sub.get("slug") or sub.get("name")
        assert sid

        r = requests.put(f"{BASE_URL}/api/admin/subcategories/{sid}",
                         headers=admin_headers, json={"paused": True}, timeout=15)
        assert r.status_code in (200, 204), r.text

        pub = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        all_subs = []
        for c in pub:
            for s in (c.get("subcategories") or c.get("l2") or []):
                all_subs.append(s.get("id") or s.get("slug") or s.get("name"))
        assert sid not in all_subs, f"paused subcat {sid} still visible: {all_subs}"

        # restore
        requests.put(f"{BASE_URL}/api/admin/subcategories/{sid}",
                     headers=admin_headers, json={"paused": False}, timeout=15)


class TestOfferToggles:
    def test_offer_pause_hides_from_list(self, admin_headers):
        offers = requests.get(f"{BASE_URL}/api/offers", timeout=15).json()
        if not offers:
            pytest.skip("no offers seeded")
        offer = offers[0]
        oid = offer.get("id")
        assert oid

        r = requests.put(f"{BASE_URL}/api/admin/offers/{oid}",
                         headers=admin_headers, json={"paused": True}, timeout=15)
        assert r.status_code in (200, 204), r.text
        public = requests.get(f"{BASE_URL}/api/offers", timeout=15).json()
        assert oid not in [o.get("id") for o in public]

        # restore
        requests.put(f"{BASE_URL}/api/admin/offers/{oid}",
                     headers=admin_headers, json={"paused": False}, timeout=15)
        public2 = requests.get(f"{BASE_URL}/api/offers", timeout=15).json()
        assert oid in [o.get("id") for o in public2]

    def test_offer_non_clickable_persists(self, admin_headers):
        offers = requests.get(f"{BASE_URL}/api/offers", timeout=15).json()
        if not offers:
            pytest.skip("no offers seeded")
        oid = offers[0]["id"]
        r = requests.put(f"{BASE_URL}/api/admin/offers/{oid}",
                         headers=admin_headers, json={"non_clickable": True}, timeout=15)
        assert r.status_code in (200, 204), r.text
        public = requests.get(f"{BASE_URL}/api/offers", timeout=15).json()
        m = next((o for o in public if o.get("id") == oid), None)
        assert m and m.get("non_clickable") is True
        # restore
        requests.put(f"{BASE_URL}/api/admin/offers/{oid}",
                     headers=admin_headers, json={"non_clickable": False}, timeout=15)


# ===== Item 3 — Customer OTP =====
class TestCustomerOtp:
    def test_otp_request_and_verify(self):
        # 10-digit random phone
        phone = "98" + "".join(str((int(time.time() * 1000) >> i) & 7) for i in range(8))
        r = requests.post(f"{BASE_URL}/api/auth/customer/request-otp",
                          json={"phone": phone}, timeout=20)
        assert r.status_code == 200, r.text

        # tail log for [OTP-DEBUG] line
        time.sleep(1)
        # backend logs to /var/log/supervisor/backend.err.log
        try:
            with open("/var/log/supervisor/backend.err.log", "r") as f:
                lines = f.readlines()[-300:]
        except Exception as e:
            pytest.skip(f"cannot read backend log: {e}")

        otp = None
        pat = re.compile(r"\[OTP-DEBUG\]\s+phone=\S*" + re.escape(phone[-10:]) + r"\s+otp=(\d{6})")
        for line in reversed(lines):
            m = pat.search(line)
            if m:
                otp = m.group(1)
                break
        assert otp, f"OTP not found in log for phone {phone}"

        r2 = requests.post(f"{BASE_URL}/api/auth/customer/verify-otp",
                           json={"phone": phone, "otp": otp}, timeout=15)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("token"), f"no token: {body}"


# ===== Item 5 — KYC submit then admin approve =====
class TestKycFlow:
    def test_submit_then_approve(self, admin_headers):
        # register fresh
        email = f"TEST_iter27_{uuid.uuid4().hex[:6]}@lokl.in"
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Iter27@2026", "store_name": "Iter27 Store",
            "owner_name": "Iter27 Owner", "phone": "9" + str(int(time.time()))[-9:],
            "city": "Bhilai",
        }, timeout=15)
        assert reg.status_code == 200, reg.text
        body = reg.json()
        mtoken = body["token"]
        mid = body["merchant"]["id"]

        # submit kyc
        mh = {"Authorization": f"Bearer {mtoken}", "Content-Type": "application/json"}
        sub = requests.post(f"{BASE_URL}/api/merchant/kyc/submit", headers=mh, json={
            "pan_number": "ABCDE1234F", "gst_number": "",
            "business_name": "Iter27 Biz", "business_category": "Apparel",
            "business_type": "Proprietorship", "business_address": "Bhilai",
            "bank_account_number": "123456789012", "bank_ifsc": "HDFC0001234",
            "account_holder_name": "Iter27 Owner",
        }, timeout=15)
        assert sub.status_code == 200, sub.text
        assert sub.json().get("kyc_status") == "submitted"

        # poll status
        st = requests.get(f"{BASE_URL}/api/merchant/kyc/status", headers=mh, timeout=15)
        assert st.status_code == 200
        assert st.json().get("kyc_status") == "submitted"

        # admin approve
        ap = requests.post(f"{BASE_URL}/api/admin/merchants/{mid}/approve",
                           headers=admin_headers, timeout=15)
        assert ap.status_code == 200, ap.text

        # status flips to approved
        st2 = requests.get(f"{BASE_URL}/api/merchant/kyc/status", headers=mh, timeout=15)
        assert st2.status_code == 200
        assert st2.json().get("kyc_status") == "approved"
