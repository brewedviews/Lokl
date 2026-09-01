"""Admin Product Creation feature — end-to-end regression tests.

Covers the full feature built on top of the canonical `_create_product_for_merchant`
(server.py) extension: admin manual product creation, admin bulk detect/
preview/import/rollback, and non-regression of the pre-existing merchant
manual + merchant bulk + WhatsApp creation paths.

These are LIVE HTTP tests against a running local backend (same convention
as test_iter18_cloudinary_wiring.py), because most of what needs verifying
here is endpoint-level: admin-role enforcement, merchant-existence checks,
full request/response contracts, and the detect->import->rollback handoff
via the `bulk_imports` tracking collection — not just internal function
behavior. The one exception (canonical-function default-argument behavior
for existing callers) is verified directly at the DB level after each HTTP
call, since that's the actual thing at risk of an accidental regression.

The admin fixture creates its OWN test admin_users record directly via
Mongo (bcrypt hash, same shape backend/scripts/dev_reset_admin_password.py
writes) rather than depending on any pre-seeded admin account existing in
this environment — this file is self-sufficient against a fresh local
Mongo the way the rest of this session's new tests have been.
"""
from __future__ import annotations

import io
import os
import time
import uuid

import bcrypt
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("NEXT_PUBLIC_API_URL") or "http://localhost:8001"
API = f"{BASE_URL.rstrip('/')}/api"

_MONGO_URL = os.environ["MONGO_URL"]
_DB_NAME = os.environ.get("DB_NAME", "lokl_dev")


def _mongo_db():
    return MongoClient(_MONGO_URL)[_DB_NAME]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_auth(session):
    """Creates (or reuses) a dedicated test admin account directly in
    Mongo, then logs in over real HTTP for a real JWT. Skips the whole
    module if the backend isn't reachable at all — same convention
    conftest.py already uses for every other live-HTTP test file."""
    db = _mongo_db()
    email = "admin-product-creation-tests@lokl.dev"
    password = "AdminTests@2026"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()
    db.admin_users.update_one(
        {"email": email},
        {"$set": {"password_hash": pw_hash, "active": True, "role": "admin"},
         "$setOnInsert": {"id": f"adm-test-{uuid.uuid4().hex[:8]}", "name": "Test Admin", "created_at": "2026-01-01T00:00:00+00:00"}},
        upsert=True,
    )
    try:
        r = session.post(f"{API}/admin/login", json={"email": email, "password": password}, timeout=10)
    except requests.exceptions.ConnectionError:
        pytest.skip("Backend not reachable at " + API)
    if r.status_code != 200:
        pytest.skip(f"Test admin login failed unexpectedly: {r.status_code} {r.text[:200]}")
    token = r.json().get("token")
    return {"Authorization": f"Bearer {token}"}, r.json()["admin"]["id"]


@pytest.fixture(scope="module")
def approved_merchant(session):
    """An approved, storefront-ready demo merchant — same three candidates
    test_iter18_cloudinary_wiring.py already relies on existing locally."""
    for email in ("menscape@lokl.demo", "anjali-store@lokl.demo", "step-sole@lokl.demo"):
        r = session.post(f"{API}/auth/login", json={"email": email, "password": "Demo@2026"}, timeout=10)
        if r.status_code == 200:
            tok = r.json().get("access_token") or r.json().get("token")
            me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10).json()
            return {"id": me.get("sub") or me.get("id"), "token": tok}
    pytest.skip("No approved demo merchant available — run `python -m demo_seed`")


@pytest.fixture()
def fresh_unapproved_merchant(session):
    """A brand-new merchant with no KYC approval and no storefront — used
    to exercise admin_override. Cleaned up after the test."""
    suffix = uuid.uuid4().hex[:8]
    phone = f"9{int(time.time()) % 10**9:09d}"
    r = session.post(f"{API}/auth/register", json={"terms_accepted": True, 
        "email": f"admintest_fresh_{suffix}@lokl.in", "password": "Fresh@2026",
        "store_name": f"AdminTest Fresh {suffix}", "owner_name": "Fresh Owner",
        "phone": phone, "city": "Bhilai",
    }, timeout=10)
    assert r.status_code in (200, 201), r.text
    mid = r.json()["merchant"]["id"]
    yield mid
    db = _mongo_db()
    db.products.delete_many({"merchant_id": mid})
    db.stores.delete_one({"id": f"store-m-{mid}"})
    db.merchants.delete_one({"id": mid})


def _cleanup_products_by_name_prefix(prefix: str):
    db = _mongo_db()
    db.products.delete_many({"name": {"$regex": f"^{prefix}"}})


def _make_bulk_xlsx(rows: list[list]) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["product name", "product description", "l1 category", "l2 category", "gender",
               "mrp", "selling price", "sizes", "stock_per_size", "returnable",
               "return window (hours)", "try & buy", "brand"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ============================================================================
# Canonical creation — admin manual
# ============================================================================

class TestAdminManualCreation:
    def test_unauthorized_without_token(self, approved_merchant):
        r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products",
                           json={"product": {"name": "x", "price": 1, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"}},
                           timeout=10)
        assert r.status_code == 401

    def test_merchant_token_rejected(self, approved_merchant):
        h = {"Authorization": f"Bearer {approved_merchant['token']}"}
        r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products",
                           json={"product": {"name": "x", "price": 1, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"}},
                           headers=h, timeout=10)
        assert r.status_code == 403

    def test_nonexistent_merchant_404(self, admin_auth):
        h, _admin_id = admin_auth
        r = requests.post(f"{API}/admin/merchants/does-not-exist/products",
                           json={"product": {"name": "x", "price": 1, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"}},
                           headers=h, timeout=10)
        assert r.status_code == 404

    def test_admin_creates_product_for_merchant(self, admin_auth, approved_merchant):
        h, admin_id = admin_auth
        try:
            r = requests.post(
                f"{API}/admin/merchants/{approved_merchant['id']}/products",
                json={"product": {
                    "name": "AdminManualTest_Regression", "price": 799, "mrp": 999,
                    "l1_id": "l1-men", "l2_id": "l2-men-tshirts", "gender": "men",
                    "sizes": ["M", "L"], "stock": {"M": 3, "L": 4},
                }},
                headers=h, timeout=15,
            )
            assert r.status_code == 200, r.text
            doc = r.json()
            assert doc["merchant_id"] == approved_merchant["id"]
            assert doc["store_id"] == f"store-m-{approved_merchant['id']}"
            assert doc["creation_source"] == "admin_manual"
            assert doc["created_by"] == admin_id
            assert doc["bulk_import_id"] is None
            assert doc["paused"] is False  # publish_immediately defaults True

            # Appears in the merchant's own catalogue (existing merchant list endpoint).
            mh = {"Authorization": f"Bearer {approved_merchant['token']}"}
            listing = requests.get(f"{API}/merchant/products", headers=mh, timeout=10)
            names = [p["name"] for p in (listing.json() if isinstance(listing.json(), list) else listing.json().get("items", []))]
            assert "AdminManualTest_Regression" in names
        finally:
            _cleanup_products_by_name_prefix("AdminManualTest_Regression")

    def test_admin_override_bypasses_onboarding_gates_not_taxonomy(self, admin_auth, fresh_unapproved_merchant):
        h, _ = admin_auth
        mid = fresh_unapproved_merchant
        # Without admin_override: unapproved merchant -> 403 KYC.
        r = requests.post(f"{API}/admin/merchants/{mid}/products",
                           json={"product": {"name": "x", "price": 1, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"}},
                           headers=h, timeout=10)
        assert r.status_code == 403
        assert "KYC" in r.text

        # admin_override=True bypasses the gate but NOT taxonomy validation.
        r = requests.post(f"{API}/admin/merchants/{mid}/products",
                           json={"product": {"name": "x", "price": 1, "l1_id": "l1-men"}, "admin_override": True},
                           headers=h, timeout=10)
        assert r.status_code == 400
        assert "l2_id" in r.text

        # admin_override=True with valid taxonomy succeeds.
        r = requests.post(f"{API}/admin/merchants/{mid}/products",
                           json={"product": {"name": "OverrideOk", "price": 499, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"},
                                 "admin_override": True},
                           headers=h, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["creation_source"] == "admin_manual"

    def test_bypass_plan_limit_is_a_separate_explicit_flag(self, admin_auth, fresh_unapproved_merchant):
        h, _ = admin_auth
        mid = fresh_unapproved_merchant
        for i in range(10):
            r = requests.post(f"{API}/admin/merchants/{mid}/products",
                               json={"product": {"name": f"Filler{i}", "price": 100, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"},
                                     "admin_override": True},
                               headers=h, timeout=10)
            assert r.status_code == 200, r.text
        # 11th without bypass -> plan limit.
        r = requests.post(f"{API}/admin/merchants/{mid}/products",
                           json={"product": {"name": "OverLimit", "price": 100, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"},
                                 "admin_override": True},
                           headers=h, timeout=10)
        assert r.status_code == 400
        assert "limit" in r.text.lower()
        # 11th WITH bypass_plan_limit -> succeeds.
        r = requests.post(f"{API}/admin/merchants/{mid}/products",
                           json={"product": {"name": "OverLimitBypassed", "price": 100, "l1_id": "l1-men", "l2_id": "l2-men-tshirts"},
                                 "admin_override": True, "bypass_plan_limit": True},
                           headers=h, timeout=10)
        assert r.status_code == 200, r.text


# ============================================================================
# Regression — existing creation paths unaffected
# ============================================================================

class TestExistingCreationPathsUnaffected:
    def test_merchant_manual_creation_still_works_and_defaults_metadata(self, approved_merchant):
        mh = {"Authorization": f"Bearer {approved_merchant['token']}"}
        try:
            r = requests.post(f"{API}/merchant/products", json={
                "name": "MerchantManualTest_Regression", "price": 599, "mrp": 799,
                "l1_id": "l1-men", "l2_id": "l2-men-tshirts", "gender": "men",
                "sizes": ["M"], "stock": {"M": 2},
            }, headers=mh, timeout=15)
            assert r.status_code == 200, r.text
            doc = r.json()
            # Canonical function's new kwargs must default exactly as before
            # for this existing caller — no behavior change.
            assert doc["creation_source"] == "merchant_manual"
            assert doc["created_by"] is None
            assert doc["bulk_import_id"] is None
            assert doc["paused"] is False
        finally:
            _cleanup_products_by_name_prefix("MerchantManualTest_Regression")

    def test_merchant_bulk_upload_unchanged_behavior(self, approved_merchant):
        mh = {"Authorization": f"Bearer {approved_merchant['token']}"}
        try:
            xlsx = _make_bulk_xlsx([["MerchantBulkTest_Regression", "d", "Men", "T-Shirts", "", 999, 499, "M;L", "5;10", "No", "", "No", ""]])
            files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            r = requests.post(f"{API}/merchant/products/bulk", files=files, headers=mh, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["created"] == 1
            assert "created_ids" in body and "names" in body and "skipped" in body  # exact existing response shape

            db = _mongo_db()
            doc = db.products.find_one({"id": body["created_ids"][0]})
            assert doc["paused"] is True
            assert doc["needs_image"] is True
            assert doc["image"] == ""
            assert doc["creation_source"] == "merchant_bulk"  # new additive metadata
            assert doc["created_by"] is None
            assert doc["bulk_import_id"] is None
            assert "total_stock" not in doc  # unchanged pre-existing quirk — must NOT be introduced
        finally:
            _cleanup_products_by_name_prefix("MerchantBulkTest_Regression")


# ============================================================================
# Admin bulk — template / detect / preview
# ============================================================================

class TestAdminBulkDetect:
    def test_template_download(self, admin_auth):
        h, _ = admin_auth
        r = requests.get(f"{API}/admin/products/template.xlsx", headers=h, timeout=15)
        assert r.status_code == 200
        assert len(r.content) > 0

    def test_template_requires_admin(self):
        r = requests.get(f"{API}/admin/products/template.xlsx", timeout=10)
        assert r.status_code == 401

    def test_detect_classifies_rows_and_creates_zero_products(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        before = _mongo_db().products.count_documents({"name": {"$regex": "^DetectTest_"}})
        xlsx = _make_bulk_xlsx([
            ["DetectTest_Valid", "d", "Men", "T-Shirts", "", 999, 499, "M;L", "5;10", "No", "", "No", ""],
            ["DetectTest_Valid", "d2", "Men", "T-Shirts", "", 999, 599, "M", "5", "No", "", "No", ""],  # dup name
            ["DetectTest_NoPrice", "d", "Men", "T-Shirts", "", 999, "", "M", "5", "No", "", "No", ""],  # error
            ["DetectTest_BadBrand", "d", "Men", "T-Shirts", "", 999, 399, "M", "5", "No", "", "No", "NotARealBrandXYZ"],  # warning
        ])
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/detect",
                           files=files, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_rows"] == 4
        assert body["valid_count"] == 1
        assert body["warning_count"] == 2
        assert body["error_count"] == 1
        statuses = {row["row"]: row["status"] for row in body["rows"]}
        assert statuses[2] == "valid"
        assert statuses[3] == "warning"
        assert statuses[4] == "error"
        assert statuses[5] == "warning"

        after = _mongo_db().products.count_documents({"name": {"$regex": "^DetectTest_"}})
        assert after == before, "detect must never create products"

        db = _mongo_db()
        imp = db.bulk_imports.find_one({"id": body["import_id"]})
        assert imp["status"] == "pending_review"
        assert imp["creation_source"] == "admin_bulk"
        db.bulk_imports.delete_one({"id": body["import_id"]})

    def test_row_cap_enforced(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        rows = [[f"CapTest{i}", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""] for i in range(501)]
        xlsx = _make_bulk_xlsx(rows)
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/detect",
                           files=files, headers=h, timeout=30)
        assert r.status_code == 400
        assert "500" in r.text


# ============================================================================
# Admin bulk — confirm import
# ============================================================================

class TestAdminBulkImport:
    def _detect(self, h, merchant_id, rows):
        xlsx = _make_bulk_xlsx(rows)
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/admin/merchants/{merchant_id}/products/bulk/detect", files=files, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_confirm_creates_only_selected_rows_with_correct_metadata(self, admin_auth, approved_merchant):
        h, admin_id = admin_auth
        try:
            detect = self._detect(h, approved_merchant["id"], [
                ["ImportTest_A", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""],
                ["ImportTest_B", "d", "Men", "T-Shirts", "", 999, 599, "M", "5", "No", "", "No", ""],
            ])
            import_id = detect["import_id"]
            r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/import",
                               json={"import_id": import_id}, headers=h, timeout=30)
            assert r.status_code == 200, r.text
            result = r.json()
            assert result["status"] == "completed"
            assert result["successful_rows"] == 2
            assert result["failed_rows"] == 0
            assert len(result["created_product_ids"]) == 2

            db = _mongo_db()
            for pid in result["created_product_ids"]:
                doc = db.products.find_one({"id": pid})
                assert doc["merchant_id"] == approved_merchant["id"]
                assert doc["paused"] is True
                assert doc["needs_image"] is True
                assert doc["image"] == ""
                assert doc["creation_source"] == "admin_bulk"
                assert doc["created_by"] == admin_id
                assert doc["bulk_import_id"] == import_id

            imp = db.bulk_imports.find_one({"id": import_id})
            assert imp["status"] == "completed"
            db.bulk_imports.delete_one({"id": import_id})
        finally:
            _cleanup_products_by_name_prefix("ImportTest_")

    def test_partial_selection_and_invalid_row_produce_completed_with_errors(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        try:
            detect = self._detect(h, approved_merchant["id"], [
                ["PartialTest_Good", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""],
                ["PartialTest_Skip", "d", "Men", "T-Shirts", "", 999, 599, "M", "5", "No", "", "No", ""],
                ["PartialTest_Bad", "d", "Men", "T-Shirts", "", 999, "", "M", "5", "No", "", "No", ""],
            ])
            import_id = detect["import_id"]
            good_row = next(r["row"] for r in detect["rows"] if r["name"] == "PartialTest_Good")
            r = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/import",
                               json={"import_id": import_id, "row_numbers": [good_row]}, headers=h, timeout=30)
            assert r.status_code == 200, r.text
            result = r.json()
            assert result["status"] == "completed_with_errors"
            assert result["successful_rows"] == 1
            assert result["failed_rows"] == 2  # 1 deselected + 1 genuine validation error
            assert detect["total_rows"] == result["successful_rows"] + result["failed_rows"]

            db = _mongo_db()
            db.bulk_imports.delete_one({"id": import_id})
        finally:
            _cleanup_products_by_name_prefix("PartialTest_")

    def test_cannot_import_the_same_pending_review_twice(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        try:
            detect = self._detect(h, approved_merchant["id"], [
                ["DoubleImportTest", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""],
            ])
            import_id = detect["import_id"]
            r1 = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/import",
                                json={"import_id": import_id}, headers=h, timeout=30)
            assert r1.status_code == 200
            r2 = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/import",
                                json={"import_id": import_id}, headers=h, timeout=30)
            assert r2.status_code == 400
            _mongo_db().bulk_imports.delete_one({"id": import_id})
        finally:
            _cleanup_products_by_name_prefix("DoubleImportTest")


# ============================================================================
# Rollback
# ============================================================================

class TestAdminBulkRollback:
    def test_rollback_soft_deletes_only_this_imports_products(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        # An UNRELATED product must survive the rollback untouched.
        unrelated = requests.post(f"{API}/merchant/products", json={
            "name": "RollbackTest_Unrelated", "price": 111, "l1_id": "l1-men", "l2_id": "l2-men-tshirts",
        }, headers={"Authorization": f"Bearer {approved_merchant['token']}"}, timeout=15)
        assert unrelated.status_code == 200
        unrelated_id = unrelated.json()["id"]
        try:
            xlsx = _make_bulk_xlsx([
                ["RollbackTest_A", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""],
                ["RollbackTest_B", "d", "Men", "T-Shirts", "", 999, 599, "M", "5", "No", "", "No", ""],
            ])
            files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            detect = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/detect",
                                    files=files, headers=h, timeout=30).json()
            import_id = detect["import_id"]
            imported = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/import",
                                      json={"import_id": import_id}, headers=h, timeout=30).json()
            created_ids = imported["created_product_ids"]

            r = requests.post(f"{API}/admin/bulk-imports/{import_id}/rollback", headers=h, timeout=15)
            assert r.status_code == 200, r.text
            summary = r.json()
            assert summary["status"] == "rolled_back"
            assert summary["products_soft_deleted"] == 2

            db = _mongo_db()
            for pid in created_ids:
                doc = db.products.find_one({"id": pid})
                assert doc is not None, "rollback must soft-delete, never hard-delete"
                assert doc["is_deleted"] is True
                assert doc["deleted_at"] is not None

            unrelated_doc = db.products.find_one({"id": unrelated_id})
            assert unrelated_doc.get("is_deleted") is not True, "rollback must never touch products outside this import"

            # Second rollback rejected.
            r2 = requests.post(f"{API}/admin/bulk-imports/{import_id}/rollback", headers=h, timeout=15)
            assert r2.status_code == 400

            db.bulk_imports.delete_one({"id": import_id})
        finally:
            _cleanup_products_by_name_prefix("RollbackTest_")

    def test_rollback_nonexistent_import_404(self, admin_auth):
        h, _ = admin_auth
        r = requests.post(f"{API}/admin/bulk-imports/bimp-does-not-exist/rollback", headers=h, timeout=10)
        assert r.status_code == 404


# ============================================================================
# Bulk import status endpoint
# ============================================================================

class TestBulkImportStatusEndpoint:
    def test_requires_admin(self):
        r = requests.get(f"{API}/admin/bulk-imports/bimp-anything", timeout=10)
        assert r.status_code == 401

    def test_returns_404_for_unknown_import(self, admin_auth):
        h, _ = admin_auth
        r = requests.get(f"{API}/admin/bulk-imports/bimp-does-not-exist", headers=h, timeout=10)
        assert r.status_code == 404

    def test_internal_parsing_cache_not_exposed(self, admin_auth, approved_merchant):
        h, _ = admin_auth
        xlsx = _make_bulk_xlsx([["StatusTest_A", "d", "Men", "T-Shirts", "", 999, 499, "M", "5", "No", "", "No", ""]])
        files = {"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        detect = requests.post(f"{API}/admin/merchants/{approved_merchant['id']}/products/bulk/detect",
                                files=files, headers=h, timeout=30).json()
        r = requests.get(f"{API}/admin/bulk-imports/{detect['import_id']}", headers=h, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "_parsed_rows" not in body
        assert "_preview_rows" not in body
        assert body["status"] == "pending_review"
        _mongo_db().bulk_imports.delete_one({"id": detect["import_id"]})


# ============================================================================
# WhatsApp creation path — must still work and now tags creation_source
# ============================================================================

class TestWhatsAppCreationUnaffected:
    """Drives an actual product through the real Gupshup webhook, same
    payload shape/pattern used throughout this session's WhatsApp work, to
    confirm the ONE line changed in routes/whatsapp.py (passing
    creation_source="whatsapp" into the canonical function) didn't disturb
    the flow and the new metadata field is actually recorded."""

    def _send(self, phone10_with_cc: str, inner_type: str, inner: dict):
        secret = os.environ.get("GUPSHUP_WEBHOOK_SECRET", "")
        body = {
            "app": "Shoplokl", "timestamp": 1, "version": 2, "type": "message",
            "payload": {
                "id": uuid.uuid4().hex, "source": phone10_with_cc, "type": inner_type, "payload": inner,
                "sender": {"phone": phone10_with_cc, "name": "T", "country_code": "91",
                           "dial_code": phone10_with_cc[-10:]},
            },
        }
        return requests.post(f"{API}/webhooks/gupshup/inbound", json=body,
                              headers={"X-Lokl-Webhook-Secret": secret}, timeout=15)

    def test_whatsapp_product_creation_still_works_and_tags_source(self):
        if not os.environ.get("GUPSHUP_WEBHOOK_SECRET"):
            pytest.skip("GUPSHUP_WEBHOOK_SECRET not configured in this environment")
        db = _mongo_db()
        suffix = uuid.uuid4().hex[:8]
        phone10 = f"9{int(time.time()) % 10**9:09d}"
        phone_with_cc = f"91{phone10}"

        reg = requests.post(f"{API}/auth/register", json={"terms_accepted": True, 
            "email": f"wa_regression_{suffix}@lokl.in", "password": "WaTest@2026",
            "store_name": f"WA Regression {suffix}", "owner_name": "WA Owner",
            "phone": phone10, "city": "Bhilai",
        }, timeout=15)
        assert reg.status_code in (200, 201), reg.text
        mid = reg.json()["merchant"]["id"]

        # Test setup only (not exercising the KYC/storefront UI flow itself,
        # which is covered elsewhere) — promote directly so the WhatsApp
        # flow's own unconditional gates (no admin_override involved here)
        # pass, matching a real approved+storefronted merchant.
        db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved"}})
        store_id = f"store-m-{mid}"
        db.stores.update_one(
            {"id": store_id},
            {"$set": {"id": store_id, "merchant_id": mid, "name": f"WA Regression {suffix}",
                      "published": True, "paused": False, "product_count": 0}},
            upsert=True,
        )
        try:
            self._send(phone_with_cc, "text", {"text": "ADD PRODUCT"})
            r = self._send(phone_with_cc, "image", {
                "url": "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400",
                "caption": "Black Mens Hoodie, MRP 1299, SP 999, stock M2 L3 XL1",
            })
            assert r.status_code == 200
            self._send(phone_with_cc, "text", {"text": "Yes, 24 hours, No"})
            self._send(phone_with_cc, "text", {"text": "YES"})

            product = db.products.find_one({"merchant_id": mid, "name": {"$regex": "Hoodie"}})
            assert product is not None, "WhatsApp product creation did not produce a product"
            assert product["creation_source"] == "whatsapp"
            assert product["created_by"] is None
            assert product["bulk_import_id"] is None
        finally:
            db.products.delete_many({"merchant_id": mid})
            db.stores.delete_one({"id": store_id})
            db.merchants.delete_one({"id": mid})
            db.whatsapp_product_drafts.delete_many({"whatsapp_phone": phone10})
            db.whatsapp_webhook_events.delete_many({})
