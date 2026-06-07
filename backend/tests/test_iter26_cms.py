"""Iter-26 Homepage Asset CMS — backend integration tests.

Coverage:
- Rollback verification (hero asset, women category, summer fashion offer)
- Admin CMS read endpoints (categories L1, subcategories L2, offers, search-destinations)
- Admin CMS write endpoints (PUT category, subcategory, offer, redirect_url clear)
- Click analytics POST + top-clicks GET + asset_type validation
- Cloudinary upload via /admin/cms/upload (folder lokl/cms, 5MB rejection)
"""
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASSWORD = "Admin@2026"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in {r.json()}"
    return tok


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Rollback verification ----------
class TestRollback:
    def test_hero_image_bhilai_landmark(self):
        r = requests.get(f"{BASE_URL}/api/site/homepage-config", timeout=15)
        assert r.status_code == 200
        hero = r.json().get("hero") or {}
        img = hero.get("image", "")
        assert "customer-assets.emergentagent.com" in img, f"hero image was not rolled back: {img}"

    def test_women_category_image(self):
        r = requests.get(f"{BASE_URL}/api/categories/counts", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # data could be {women: {...}} or [{slug:'women',...}]
        women = None
        if isinstance(data, dict):
            women = data.get("women") or next((v for k, v in data.items() if "wom" in str(k).lower()), None)
        elif isinstance(data, list):
            women = next((c for c in data if str(c.get("slug", "")).lower() == "women"), None)
        assert women is not None, f"women category missing from {data}"
        img = women.get("image", "") if isinstance(women, dict) else ""
        assert "photo-1469334031218-e382a71b716b" in img, f"women image not rolled back: {img}"

    def test_summer_fashion_offer_image(self):
        r = requests.get(f"{BASE_URL}/api/offers", timeout=15)
        assert r.status_code == 200
        offers = r.json()
        summer = next((o for o in offers if "summer" in str(o.get("title", "")).lower()), None)
        assert summer is not None, f"Summer Fashion Sale missing from offers list"
        assert "photo-1618375601660-3e6842f5b791" in summer.get("image", ""), (
            f"summer offer image not rolled back: {summer.get('image')}"
        )


# ---------- Admin CMS reads ----------
class TestAdminReads:
    def test_list_categories(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/admin/categories", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) == 9, f"expected 9 L1 categories, got {len(rows)}"
        sample = rows[0]
        for k in ("id", "name", "slug", "image"):
            assert k in sample, f"category missing key {k}: {sample}"

    def test_list_subcategories(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/admin/subcategories", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) == 40, f"expected 40 L2 subcategories, got {len(rows)}"
        sample = rows[0]
        for k in ("id", "name", "slug", "image", "l1_id"):
            assert k in sample, f"subcategory missing {k}: {sample}"

    def test_list_offers_admin(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/admin/offers", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 4, f"expected >=4 offers, got {len(rows)}"

    def test_search_destinations(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/cms/search-destinations",
            headers=auth_headers,
            params={"q": "wom"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        for bucket in ("stores", "products", "categories", "subcategories", "offers"):
            assert bucket in data, f"bucket {bucket} missing"
            assert isinstance(data[bucket], list)
        # 'women' L1 should appear
        cat_labels = [c.get("label", "").lower() for c in data["categories"]]
        assert any("women" in lab for lab in cat_labels), f"women not found in categories bucket: {cat_labels}"


# ---------- Admin CMS writes ----------
class TestAdminWrites:
    def test_put_category_redirect_persist_and_clear(self, auth_headers):
        # set
        r = requests.put(
            f"{BASE_URL}/api/admin/categories/l1-women",
            headers=auth_headers,
            json={"redirect_url": "/offers/test"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("redirect_url") == "/offers/test"

        # consumer GET reflects
        r2 = requests.get(f"{BASE_URL}/api/categories", timeout=15)
        assert r2.status_code == 200
        cats = r2.json()
        women = next((c for c in cats if c.get("slug") == "women"), None)
        assert women is not None
        assert women.get("redirect_url") == "/offers/test"

        # clear with empty string
        r3 = requests.put(
            f"{BASE_URL}/api/admin/categories/l1-women",
            headers=auth_headers,
            json={"redirect_url": ""},
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json().get("redirect_url", "") == ""

    def test_put_subcategory(self, auth_headers):
        rows = requests.get(
            f"{BASE_URL}/api/admin/subcategories", headers=auth_headers, timeout=15
        ).json()
        sid = rows[0]["id"]
        original = rows[0].get("redirect_url", "")
        r = requests.put(
            f"{BASE_URL}/api/admin/subcategories/{sid}",
            headers=auth_headers,
            json={"redirect_url": "/c/test-sub"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("redirect_url") == "/c/test-sub"
        # restore
        requests.put(
            f"{BASE_URL}/api/admin/subcategories/{sid}",
            headers=auth_headers,
            json={"redirect_url": original},
            timeout=15,
        )

    def test_put_offer_all_fields(self, auth_headers):
        offers = requests.get(
            f"{BASE_URL}/api/admin/offers", headers=auth_headers, timeout=15
        ).json()
        oid = offers[0]["id"]
        orig = offers[0]
        new_payload = {
            "title": "TEST Updated",
            "subtitle": "TEST sub",
            "cta_label": "Go",
            "redirect_url": "/c/footwear",
            "rank": 999,
            "published": False,
        }
        r = requests.put(
            f"{BASE_URL}/api/admin/offers/{oid}",
            headers=auth_headers,
            json=new_payload,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == "TEST Updated"
        assert doc["published"] is False
        assert int(doc["rank"]) == 999

        # restore
        requests.put(
            f"{BASE_URL}/api/admin/offers/{oid}",
            headers=auth_headers,
            json={
                "title": orig.get("title", ""),
                "subtitle": orig.get("subtitle", ""),
                "cta_label": orig.get("cta_label", ""),
                "redirect_url": orig.get("redirect_url", ""),
                "rank": orig.get("rank", 100),
                "published": bool(orig.get("published", True)),
            },
            timeout=15,
        )


# ---------- Cloudinary upload ----------
class TestCloudinaryUpload:
    def test_upload_small_jpg(self, auth_headers):
        # 1x1 red jpeg
        jpeg = bytes.fromhex(
            "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd0ffd9"
        )
        files = {"file": ("test.jpg", io.BytesIO(jpeg), "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/admin/cms/upload",
            headers=auth_headers,
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Returns secure_url+public_id+format (or image_url alias)
        url = body.get("image_url") or body.get("secure_url") or body.get("url")
        assert url, f"missing image url in {body}"
        public_id = body.get("public_id", "")
        assert "lokl/cms" in (public_id + url), f"upload not in lokl/cms folder: {body}"

    def test_upload_oversize_rejected(self, auth_headers):
        # ~6MB blob
        big = b"\xff" * (6 * 1024 * 1024)
        files = {"file": ("big.jpg", io.BytesIO(big), "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/admin/cms/upload",
            headers=auth_headers,
            files=files,
            timeout=60,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ---------- Click analytics ----------
class TestAnalytics:
    def test_post_click_hero(self):
        r = requests.post(
            f"{BASE_URL}/api/analytics/click",
            json={"asset_type": "hero", "asset_id": "homepage", "redirect_url": "/c/women"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_post_click_rejected_bad_type(self):
        r = requests.post(
            f"{BASE_URL}/api/analytics/click",
            json={"asset_type": "bogus", "asset_id": "x", "redirect_url": "/y"},
            timeout=15,
        )
        # endpoint returns {ok:false} for bad type (200 status)
        assert r.status_code == 200
        assert r.json().get("ok") is False

    def test_top_clicks_hero(self, auth_headers):
        # ensure at least one event
        for _ in range(3):
            requests.post(
                f"{BASE_URL}/api/analytics/click",
                json={"asset_type": "hero", "asset_id": "homepage", "redirect_url": "/c/women"},
                timeout=10,
            )
        time.sleep(0.5)
        r = requests.get(
            f"{BASE_URL}/api/admin/analytics/top-clicks",
            headers=auth_headers,
            params={"asset_type": "hero", "days": 7},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data
        assert isinstance(data["rows"], list)
        assert data["asset_type"] == "hero"
        # rows sorted desc by count
        counts = [row["count"] for row in data["rows"]]
        assert counts == sorted(counts, reverse=True)

    def test_top_clicks_invalid_asset_type(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/analytics/top-clicks",
            headers=auth_headers,
            params={"asset_type": "weird"},
            timeout=15,
        )
        assert r.status_code == 400
