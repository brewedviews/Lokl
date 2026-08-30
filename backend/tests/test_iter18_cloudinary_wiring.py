"""Iter-18 tests — Cloudinary wiring + Phase 1-5 stabilization.

These tests verify endpoint CONTRACT only — they do NOT exercise an actual
upload to Cloudinary because the API secret is stale per the review request.
Expected upload responses: HTTP 502 with `Image upload failed:` body prefix.
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lokl-returns-dash.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASSWORD = "Admin@2026"


# ----- Fixtures -----

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def merchant_creds():
    suffix = uuid.uuid4().hex[:8]
    return {"email": f"iter18_{suffix}@lokl.in", "password": "Iter18@2026", "store_name": f"Iter18 Store {suffix}", "phone": f"9{int(time.time())%10**9:09d}"}


@pytest.fixture(scope="module")
def merchant_token(session, merchant_creds):
    payload = {**merchant_creds, "owner_name": "Iter18 Owner", "city": "Bhilai"}
    r = session.post(f"{API}/auth/register", json=payload, timeout=15)
    if r.status_code not in (200, 201):
        # try login if it already exists
        rl = session.post(f"{API}/auth/login", json={"email": merchant_creds["email"], "password": merchant_creds["password"]}, timeout=15)
        if rl.status_code != 200:
            pytest.skip(f"merchant register/login failed: reg={r.status_code} {r.text[:120]} login={rl.status_code} {rl.text[:120]}")
        return rl.json().get("access_token")
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def merchant_auth(merchant_token):
    return {"Authorization": f"Bearer {merchant_token}"}


@pytest.fixture(scope="module")
def approved_merchant_token(session):
    """Approved demo merchant (kyc_status=approved) for KYC-gated tests."""
    for email in ("menscape@lokl.demo", "anjali-store@lokl.demo", "step-sole@lokl.demo"):
        r = session.post(f"{API}/auth/login", json={"email": email, "password": "Demo@2026"}, timeout=15)
        if r.status_code == 200:
            return r.json().get("access_token") or r.json().get("token")
    pytest.skip("no approved demo merchant available — run `cd /app/backend && python -m demo_seed`")


@pytest.fixture(scope="module")
def approved_auth(approved_merchant_token):
    return {"Authorization": f"Bearer {approved_merchant_token}"}


@pytest.fixture(scope="module")
def admin_auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# Small in-memory PNG (1x1 transparent)
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01\x00\x00\x05\x00"
    b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ===== Upload endpoint contract =====

class TestUploadEndpointContract:
    def test_upload_requires_auth(self, session):
        files = {"file": ("a.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = session.post(f"{API}/merchant/upload-image", data={"asset_type": "product"}, files=files, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_upload_rejects_invalid_asset_type(self, session, merchant_auth):
        files = {"file": ("a.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = session.post(
            f"{API}/merchant/upload-image",
            data={"asset_type": "invalid_kind"},
            files=files,
            headers=merchant_auth,
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        assert "asset_type" in r.text.lower() or "unknown" in r.text.lower()

    def test_upload_rejects_non_image(self, session, merchant_auth):
        files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
        r = session.post(
            f"{API}/merchant/upload-image",
            data={"asset_type": "product"},
            files=files,
            headers=merchant_auth,
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_upload_returns_structured_502_on_cloudinary_failure(self, session, merchant_auth):
        """Cloudinary API secret is stale (per review_request) — expect 502."""
        files = {"file": ("ok.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = session.post(
            f"{API}/merchant/upload-image",
            data={"asset_type": "product"},
            files=files,
            headers=merchant_auth,
            timeout=30,
        )
        # If credentials happened to work, 200 is also fine; otherwise must be 502 with prefix
        if r.status_code == 200:
            body = r.json()
            assert "image_url" in body and "public_id" in body
        else:
            assert r.status_code == 502, f"expected 502, got {r.status_code}: {r.text[:300]}"
            assert "Image upload failed:" in r.text, f"missing prefix: {r.text[:300]}"


# ===== Delete endpoint contract =====

class TestDeleteEndpointContract:
    def test_delete_requires_auth(self, session):
        r = session.delete(f"{API}/merchant/upload-image", params={"public_id": "lokl/products/foo"}, timeout=10)
        assert r.status_code in (401, 403)

    def test_delete_rejects_a_public_id_the_caller_does_not_own(self, session, merchant_auth):
        """Incident fix: this endpoint used to delete ANY public_id a
        caller supplied with no ownership check at all — a merchant could
        delete another merchant's asset merely by knowing/guessing its
        public_id. An arbitrary id not embedding this merchant's own id and
        not referenced by anything they own must now be rejected outright,
        not silently treated as "ok: false" for a not-found asset."""
        r = session.delete(
            f"{API}/merchant/upload-image",
            params={"public_id": "lokl/products/does-not-exist"},
            headers=merchant_auth,
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_delete_allows_a_freshly_uploaded_owner_scoped_asset(self, session, merchant_auth):
        """The legitimate flow this endpoint must still support: a merchant
        uploads a photo, then discards it before ever saving it into a
        product/store record. The only ownership signal available for an
        asset that's never been persisted anywhere is the owner-scoped
        public_id minted at upload time."""
        me = session.get(f"{API}/auth/me", headers=merchant_auth, timeout=10).json()
        mid = me.get("sub") or me.get("id")
        r = session.delete(
            f"{API}/merchant/upload-image",
            params={"public_id": f"lokl/products/{mid}/{uuid.uuid4().hex}"},
            headers=merchant_auth,
            timeout=20,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "ok" in body and isinstance(body["ok"], bool)


# ===== Admin signed-url endpoint =====

class TestAdminSignedUrl:
    def test_requires_admin(self, session):
        r = session.get(f"{API}/admin/kyc/some-mid/signed-url", params={"doc": "pan_doc"}, timeout=10)
        assert r.status_code in (401, 403)

    def test_invalid_doc_kind(self, session, admin_auth):
        r = session.get(
            f"{API}/admin/kyc/some-mid/signed-url",
            params={"doc": "passport"},
            headers=admin_auth,
            timeout=15,
        )
        assert r.status_code == 400, f"got {r.status_code} {r.text[:200]}"

    def test_missing_returns_404(self, session, admin_auth):
        # merchant doesn't exist OR pan_doc not uploaded — both 404
        r = session.get(
            f"{API}/admin/kyc/nonexistent-merchant-id/signed-url",
            params={"doc": "pan_doc"},
            headers=admin_auth,
            timeout=15,
        )
        assert r.status_code == 404


# ===== Product persistence: image_url + image_public_id =====

class TestProductCloudinaryPersistence:
    def _create(self, session, merchant_auth, extra=None):
        body = {
            "name": f"TEST_iter18_{uuid.uuid4().hex[:6]}",
            "price": 999,
            "mrp": 1299,
            "l1_id": "l1-men",
            "l2_id": "l2-m-shirt",
            "gender": "men",
            # Backend schema field is `image` (not image_url); frontend ProductForm
            # is expected to map uploadImage()→ image. Send both to confirm round-trip.
            "image": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/test_img.jpg",
            "image_url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/test_img.jpg",
            "image_public_id": "lokl/products/test_img",
            "images": [
                "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/extra1.jpg",
            ],
            "image_public_ids": ["lokl/products/extra1"],
            "description": "iter18 test",
            "sizes": ["M", "L"],
        }
        if extra:
            body.update(extra)
        return session.post(f"{API}/merchant/products", json=body, headers=merchant_auth, timeout=20)

    def test_create_product_persists_cloudinary_fields(self, session, approved_auth):
        r = self._create(session, approved_auth)
        assert r.status_code in (200, 201), f"create failed {r.status_code}: {r.text[:300]}"
        prod = r.json()
        pid = prod.get("id")
        assert pid

        # Fetch back via public GET (wrapped in {product, similar})
        g = session.get(f"{API}/products/{pid}", timeout=15)
        assert g.status_code == 200, f"get failed {g.status_code}: {g.text[:200]}"
        envelope = g.json()
        got = envelope.get("product") or envelope
        # image field round-trips
        img = got.get("image") or ""
        assert "res.cloudinary.com" in img, f"image not persisted on product: {got!r}"
        assert got.get("image_public_id") == "lokl/products/test_img", f"image_public_id missing: {got!r}"
        assert "lokl/products/extra1" in (got.get("image_public_ids") or []), f"image_public_ids missing: {got!r}"
        assert not img.startswith("data:image"), "base64 blob persisted on product!"

    def test_update_product_image_returns_200(self, session, approved_auth):
        c = self._create(session, approved_auth)
        assert c.status_code in (200, 201)
        pid = c.json()["id"]

        upd = {
            "name": "TEST_iter18_updated",
            "price": 1099,
            "image_url": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/new_img.jpg",
            "image_public_id": "lokl/products/new_img",  # triggers delete attempt of old
        }
        r = session.put(f"{API}/merchant/products/{pid}", json=upd, headers=approved_auth, timeout=20)
        # Even if Cloudinary delete of OLD asset fails (stale secret), API must still 200
        assert r.status_code == 200, f"update failed {r.status_code}: {r.text[:300]}"

        g = session.get(f"{API}/products/{pid}", timeout=15)
        assert g.status_code == 200
        envelope = g.json()
        got = envelope.get("product") or envelope
        assert got.get("name") == "TEST_iter18_updated", f"name not updated: {got!r}"
        assert got.get("image_public_id") == "lokl/products/new_img", f"image_public_id not updated: {got!r}"


# ===== Storefront accepts banner_public_ids / logo / logo_public_id =====

class TestStorefrontPayload:
    def test_storefront_persists_cloudinary_shape(self, session, approved_auth):
        body = {
            "tagline": "iter18 tagline",
            "story": "iter18 story body",
            "banner": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/b1.jpg",
            "banners": [
                "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/b1.jpg",
                "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/banners/b2.jpg",
            ],
            "banner_public_ids": ["lokl/banners/b1_iter18", "lokl/banners/b2_iter18"],
            "logo": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/stores/logo.png",
            "logo_public_id": "lokl/stores/logo_iter18",
            "specialties": ["test"],
            "locality": "Bhilai",
            "lat": 21.1938,
            "lng": 81.3509,
        }
        r = session.post(f"{API}/merchant/storefront", json=body, headers=approved_auth, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        # Read back via admin stores list (bypasses publish filter)
        admin_token_resp = session.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15).json()
        admin_tk = admin_token_resp.get("access_token") or admin_token_resp.get("token")
        me = session.get(f"{API}/auth/me", headers=approved_auth, timeout=10).json()
        mid = me.get("sub") or me.get("id")
        g = session.get(f"{API}/admin/stores", headers={"Authorization": f"Bearer {admin_tk}"}, timeout=15)
        assert g.status_code == 200, f"admin stores failed {g.status_code}: {g.text[:200]}"
        stores = g.json()
        stores_list = stores if isinstance(stores, list) else stores.get("items") or stores.get("stores") or []
        sf = next((s for s in stores_list if s.get("id") == f"store-m-{mid}"), None)
        assert sf is not None, f"merchant store not found in admin list (mid={mid})"
        assert sf.get("logo_public_id") == "lokl/stores/logo_iter18", f"logo_public_id not persisted: {sf!r}"
        bpids = sf.get("banner_public_ids") or []
        assert "lokl/banners/b1_iter18" in bpids, f"banner_public_ids not persisted: {sf!r}"
        assert "lokl/banners/b2_iter18" in bpids


# ===== KYC submit accepts BOTH _public_id and legacy _b64 =====

class TestKycPayload:
    def test_kyc_accepts_public_id_fields(self, session, merchant_auth):
        body = {
            "pan_number": "ABCDE1234F",
            "gst_number": "22ABCDE1234F1Z5",
            "business_name": "Iter18 Biz",
            "business_category": "apparel",
            "business_type": "proprietorship",
            "business_address": "Iter18 Address, Bhilai",
            "pan_doc_public_id": "lokl/kyc/iter18/pan",
            "gst_doc_public_id": "lokl/kyc/iter18/gst",
            "cancelled_cheque_public_id": "lokl/kyc/iter18/cheque",
            "bank_account_number": "1234567890",
            "bank_ifsc": "HDFC0001234",
            "account_holder_name": "Iter18 Owner",
        }
        r = session.post(f"{API}/merchant/kyc/submit", json=body, headers=merchant_auth, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"

        s = session.get(f"{API}/merchant/kyc/status", headers=merchant_auth, timeout=15)
        assert s.status_code == 200
        st = s.json()
        dp = st.get("docs_present") or {}
        # docs_present should consider public_id fields
        assert dp.get("pan_doc") is True, f"docs_present not honoring public_id: {dp}"
        assert dp.get("gst_doc") is True, f"docs_present not honoring public_id: {dp}"


# ===== Regression sanity =====

class TestRegression:
    def test_auth_me(self, session, merchant_auth):
        r = session.get(f"{API}/auth/me", headers=merchant_auth, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("role") == "merchant"

    def test_merchant_products_list(self, session, merchant_auth):
        r = session.get(f"{API}/merchant/products", headers=merchant_auth, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Accept either list or dict envelope
        assert isinstance(body, (list, dict))

    def test_public_products_by_store(self, session):
        # Just confirm shape — no store_id needed errors out gracefully
        r = session.get(f"{API}/products", params={"store_id": "does-not-exist"}, timeout=15)
        assert r.status_code in (200, 400, 404)
