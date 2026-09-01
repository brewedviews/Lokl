"""Regression tests for the store autopublish reconciliation audit (2026-09,
"Sahoo Collection" investigation).

Same in-process convention as test_security_fixes.py (see that file's own
docstring for the full rationale — no admin login required, calls FastAPI
handler functions directly against the real DB connection server.py already
uses, one asyncio.run() for the whole file since Motor binds to whichever
event loop is running at construction time).

Root cause under test: `_maybe_autopublish_store()` is the ONLY place a
store's `published` flag ever flips True outside a manual merchant click,
and until this fix it was wired into product/storefront mutations only —
NOT into KYC approval, NOT into the merchant's fast pause/unpause toggle
(PATCH /merchant/products/{pid}), NOT into admin's unpause endpoint. A
merchant approved (or unpaused) after their storefront+products already
existed got permanently stuck at published=False. This file proves the
fix converges to the same correct state regardless of the ORDER events
happen in — that's the actual invariant being tested, not any one sequence.

Run with: cd backend && python3 -m pytest tests/test_autopublish_reconciliation.py -v
Requires a reachable MONGO_URL (same one server.py itself uses).
"""
import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

L1, L2 = "l1-men", "l2-men-tshirts"


def _merchant_doc(mid, kyc_status):
    now = datetime.now(timezone.utc).isoformat()
    suffix = mid.split("-")[-1]
    return {
        "id": mid, "password_hash": "x",
        "store_name": f"Autopublish Test {suffix}", "owner_name": "Owner",
        "phone": f"9{int(time.time() * 1000 + hash(mid)) % 10 ** 9:09d}",
        "phone_canonical": f"{int(time.time() * 1000 + hash(mid)) % 10 ** 10:010d}"[-10:],
        "city": "Bhilai", "created_at": now, "role": "merchant",
        "kyc_status": kyc_status, "kyc_submitted_at": now if kyc_status != "draft" else None,
        "approved_at": now if kyc_status == "approved" else None,
        "terms_accepted": True, "terms_version": "test", "terms_accepted_at": now,
        "published": False, "storefront": None, "notifications": [],
    }


def _storefront_payload(srv):
    return srv.StorefrontUpdate(
        tagline="t", story="A perfectly ordinary store description, long enough.",
        banner="", banners=[], specialties=[], locality="",
        opens_at="00:00", closes_at="23:59",
        lat=21.19, lng=81.33, area="sector-10", area_label="Sector 10",
        pincode="490006", upi_qr_url="", weekly_off=[],
    )


def _product_payload(srv, name, **kw):
    base = dict(name=name, price=500, mrp=700, l1_id=L1, l2_id=L2,
                sizes=["OS"], images=[], stock={"OS": 10})
    base.update(kw)
    return srv.ProductCreate(**base)


class _Cleanup:
    """Tracks everything a test seeded so it always gets removed, pass or fail."""
    def __init__(self, db):
        self.db = db
        self.merchant_ids = []

    def track(self, merchant_id):
        self.merchant_ids.append(merchant_id)
        return merchant_id

    async def purge(self):
        for mid in self.merchant_ids:
            store_id = f"store-m-{mid}"
            await self.db.products.delete_many({"merchant_id": mid})
            await self.db.stores.delete_one({"id": store_id})
            await self.db.merchants.delete_one({"id": mid})


# --------------------------------------------------------------------------
# Sequence A/D — KYC approved first, then storefront, then a merchant-added
# product. The "ordinary" order — must already have worked before this
# fix (product creation already called autopublish) and must still work.
# --------------------------------------------------------------------------
async def _sequence_kyc_first_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "approved"))

    store = await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid)
    assert store["published"] is False, "no products yet — must not publish on storefront creation alone"

    await srv._create_product_for_merchant(_product_payload(srv, "A Product"), mid)

    fresh = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
    assert fresh["published"] is True, "KYC approved + storefront + 1 unpaused product must autopublish"
    assert fresh["kyc_status"] == "approved"
    assert fresh["product_count"] == 1


# --------------------------------------------------------------------------
# Sequence B — storefront + product exist BEFORE KYC is approved (the
# exact shape that produced the Sahoo Collection bug). This is what
# admin_approve() calling _maybe_autopublish_store() actually fixes.
# --------------------------------------------------------------------------
async def _sequence_kyc_last_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "submitted"))

    store = await srv._create_or_setup_storefront_for_merchant(
        _storefront_payload(srv), mid, bypass_kyc_gate=True,
    )
    assert store["kyc_status"] == "submitted", "store's own kyc_status snapshot reflects reality at creation time"

    await srv._create_product_for_merchant(_product_payload(srv, "B Product"), mid, admin_override=True)

    stuck = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
    assert stuck["published"] is False, "not eligible yet — KYC still pending"

    # THE fix under test: approving KYC must, by itself, re-evaluate and
    # publish — nothing else touches this store afterward.
    await srv.admin_approve(mid, admin={"id": "test-admin"})

    fresh = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
    assert fresh["published"] is True, "KYC approval alone must trigger autopublish when already-eligible"
    assert fresh["kyc_status"] == "approved", "store's stale kyc_status snapshot must be resynced on approval"


# --------------------------------------------------------------------------
# Sequence C — admin adds a product BEFORE any storefront exists at all
# (admin_override, onboarding-prep), storefront created after, KYC
# approved last. Exercises admin-added products + the ffc0c2b storefront-
# creation fix + this fix's KYC-approval trigger together.
# --------------------------------------------------------------------------
async def _sequence_admin_product_first_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "submitted"))

    # No storefront document exists yet at all.
    assert await db.stores.find_one({"id": f"store-m-{mid}"}) is None
    await srv._create_product_for_merchant(_product_payload(srv, "C Product"), mid, admin_override=True)

    store = await srv._create_or_setup_storefront_for_merchant(
        _storefront_payload(srv), mid, bypass_kyc_gate=True,
    )
    assert store["product_count"] == 1, "storefront creation must recompute count from real products (ffc0c2b)"
    assert store["published"] is False, "KYC still not approved"

    await srv.admin_approve(mid, admin={"id": "test-admin"})

    fresh = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
    assert fresh["published"] is True
    assert fresh["product_count"] == 1


# --------------------------------------------------------------------------
# Sequence E — a store with zero eligible products (everything paused)
# stays unpublished; unpausing the only product must publish it. Tested
# via BOTH unpause entry points, since both had the same gap.
# --------------------------------------------------------------------------
async def _sequence_unpause_case(srv, cleanup):
    db = srv.db

    for label, via_admin in (("merchant-toggle", False), ("admin-unpause", True)):
        mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
        await db.merchants.insert_one(_merchant_doc(mid, "approved"))
        await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid)
        created = await srv._create_product_for_merchant(
            _product_payload(srv, f"E Product {label}"), mid, paused_override=True,
        )
        pid = created["id"]

        stuck = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
        assert stuck["published"] is False, f"[{label}] a store whose only product is paused must not be published"
        assert stuck["product_count"] == 0, f"[{label}] paused product must not count toward product_count"

        if via_admin:
            await srv.admin_unpause_product(pid, admin={"id": "test-admin"})
        else:
            await srv.quick_update_product(pid, {"paused": False}, user={"sub": mid, "role": "merchant"})

        fresh = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
        assert fresh["published"] is True, f"[{label}] unpausing the only product must trigger autopublish"
        assert fresh["product_count"] == 1, f"[{label}] product_count must be recomputed by the unpause path"


# --------------------------------------------------------------------------
# store.kyc_status sync must happen even when NOT (yet) eligible to
# publish — a store stuck unpublished for a real reason (0 products) must
# still not carry a stale kyc_status snapshot once it's resolved.
# --------------------------------------------------------------------------
async def _kyc_sync_without_publish_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "submitted"))
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid, bypass_kyc_gate=True)

    await srv.admin_approve(mid, admin={"id": "test-admin"})  # zero products — must not publish

    fresh = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0})
    assert fresh["published"] is False, "still 0 unpaused products — must not publish"
    assert fresh["kyc_status"] == "approved", "kyc_status sync must happen independent of publish eligibility"


# --------------------------------------------------------------------------
# Visibility: hidden stores never leak into _visible_store_filter(), and
# a newly-published store (+ its product) is immediately visible through
# it — this is the exact filter every customer feed/listing/PDP uses.
# --------------------------------------------------------------------------
async def _visibility_filter_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "submitted"))
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid, bypass_kyc_gate=True)
    created = await srv._create_product_for_merchant(
        _product_payload(srv, "Visibility Product"), mid, admin_override=True,
    )
    store_id = f"store-m-{mid}"

    hidden = await db.stores.find_one({"id": store_id, **srv._visible_store_filter()})
    assert hidden is None, "an unpublished store must not match _visible_store_filter()"

    await srv.admin_approve(mid, admin={"id": "test-admin"})

    visible = await db.stores.find_one({"id": store_id, **srv._visible_store_filter()})
    assert visible is not None, "a store meeting every condition must be visible immediately after approval"
    assert visible["published"] is True

    visible_product = await db.products.find_one({
        "id": created["id"], **srv._visible_product_filter(),
    })
    assert visible_product is not None, "the product itself must also pass the product visibility filter"


# --------------------------------------------------------------------------
# KYC revocation — the reverse direction. A live store must stop being
# customer-visible the moment its merchant's KYC is no longer approved,
# via EVERY endpoint that can cause that transition, and must fully
# reconverge (re-publish) on a later re-approval. Product/store documents
# must never be touched by any of this.
# --------------------------------------------------------------------------
async def _revocation_case(srv, cleanup):
    db = srv.db

    for label, revoke in (
        ("admin_hold", lambda mid: srv.admin_hold(mid, {"reason": "Please re-verify PAN"}, admin={"id": "test-admin"})),
        ("admin_reject", lambda mid: srv.admin_reject(mid, {"reason": "Documents unclear"}, admin={"id": "test-admin"})),
        ("kyc_submit_resubmission", None),  # handled specially below — different call shape
    ):
        mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
        await db.merchants.insert_one(_merchant_doc(mid, "approved"))
        await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid)
        created = await srv._create_product_for_merchant(_product_payload(srv, f"Revoke Product {label}"), mid)
        store_id = f"store-m-{mid}"

        live = await db.stores.find_one({"id": store_id}, {"_id": 0})
        assert live["published"] is True, f"[{label}] setup must start from a genuinely live store"
        assert (await db.stores.find_one({"id": store_id, **srv._visible_store_filter()})) is not None, (
            f"[{label}] setup must start visible to customers"
        )

        # ---- Revoke ----
        if label == "kyc_submit_resubmission":
            payload = srv.KycSubmit(pan_number="ABCDE1234F", business_name="X", business_category="Fashion", business_address="X")
            await srv.kyc_submit(payload, user={"sub": mid, "role": "merchant"})
        else:
            await revoke(mid)

        revoked = await db.stores.find_one({"id": store_id}, {"_id": 0})
        assert revoked["published"] is False, f"[{label}] store must stop being published once KYC leaves approved"
        assert revoked["kyc_status"] != "approved", f"[{label}] store's kyc_status snapshot must be resynced"
        assert (await db.stores.find_one({"id": store_id, **srv._visible_store_filter()})) is None, (
            f"[{label}] store must no longer match the customer-facing visibility filter"
        )

        # ---- Data integrity: nothing about the product/store content itself changed ----
        product_after = await db.products.find_one({"id": created["id"]}, {"_id": 0})
        assert product_after["name"] == f"Revoke Product {label}", f"[{label}] product document must be untouched"
        assert product_after.get("is_deleted") is not True, f"[{label}] product must not be deleted by a KYC change"
        assert product_after.get("paused") is not True, f"[{label}] product must not be paused by a KYC change"
        store_content_after = await db.stores.find_one({"id": store_id}, {"_id": 0})
        assert store_content_after.get("is_deleted") is not True, f"[{label}] store must not be deleted by a KYC change"
        assert store_content_after.get("name"), f"[{label}] store content (name etc.) must survive untouched"
        assert store_content_after.get("product_count") == 1, f"[{label}] product_count must be unaffected by the visibility flip"

        # ---- Re-approval must fully reconverge: eligible store publishes again ----
        await srv.admin_approve(mid, admin={"id": "test-admin"})
        reapproved = await db.stores.find_one({"id": store_id}, {"_id": 0})
        assert reapproved["published"] is True, f"[{label}] re-approval of an otherwise-eligible store must re-publish it"
        assert reapproved["kyc_status"] == "approved"
        assert (await db.stores.find_one({"id": store_id, **srv._visible_store_filter()})) is not None, (
            f"[{label}] store must be customer-visible again after re-approval"
        )


# --------------------------------------------------------------------------
# Revocation must not touch a store that was never published in the first
# place — nothing to un-publish, and it must not error.
# --------------------------------------------------------------------------
async def _revocation_noop_on_unpublished_store_case(srv, cleanup):
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "approved"))
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid)
    # No products — store is eligible-minus-one-condition, never published.
    store_id = f"store-m-{mid}"
    assert (await db.stores.find_one({"id": store_id}, {"_id": 0}))["published"] is False

    await srv.admin_reject(mid, {"reason": "test"}, admin={"id": "test-admin"})

    fresh = await db.stores.find_one({"id": store_id}, {"_id": 0})
    assert fresh["published"] is False
    assert fresh["kyc_status"] == "rejected", "kyc_status snapshot must still sync even with nothing to unpublish"


# --------------------------------------------------------------------------
# Migration 035 — directly reproduces the pre-fix "stuck" state (bypassing
# every code fix above by writing to Mongo directly, the way the OLD,
# buggy admin_approve() would have left things) and verifies the
# migration reconciles it. Run twice to prove idempotency.
# --------------------------------------------------------------------------
async def _migration_035_case(srv, cleanup):
    import importlib
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "approved"))

    store_id = f"store-m-{mid}"
    # Simulate the pre-fix broken state directly: a store whose kyc_status
    # snapshot is stale ("submitted", never resynced) and published=False,
    # with real unpaused products already sitting underneath it — exactly
    # what admin_approve() used to leave behind.
    await db.stores.insert_one({
        "id": store_id, "merchant_id": mid, "name": "Migration Test Store",
        "published": False, "paused": False, "product_count": 0,
        "kyc_status": "submitted", "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    p1 = await srv._create_product_for_merchant(
        _product_payload(srv, "Migration Product"), mid, admin_override=True,
    )
    # _create_product_for_merchant's own autopublish call would normally
    # fix this immediately — force the store back to the stuck state to
    # actually test the migration in isolation, not this fix's live path.
    await db.stores.update_one({"id": store_id}, {"$set": {
        "published": False, "kyc_status": "submitted", "product_count": 0,
    }})

    mod = importlib.import_module("migrations.035_reconcile_autopublish_and_kyc_sync")
    result = await mod.up(db)
    assert "reconcile_autopublish_and_kyc_sync" in result

    fresh = await db.stores.find_one({"id": store_id}, {"_id": 0})
    assert fresh["published"] is True, "migration must publish a genuinely-eligible stuck store"
    assert fresh["kyc_status"] == "approved"
    assert fresh["product_count"] == 1

    # Idempotency: re-run must be a clean no-op (no error, store unchanged).
    result2 = await mod.up(db)
    summary_line = next(l for l in result2["reconcile_autopublish_and_kyc_sync"] if l.startswith("SUMMARY"))
    assert "0 product_count fixes, 0 kyc_status syncs, 0 autopublished" in summary_line, (
        f"re-run must be a no-op once reconciled: {summary_line}"
    )

    unchanged = await db.stores.find_one({"id": store_id}, {"_id": 0})
    assert unchanged == fresh, "re-running the migration must not alter an already-consistent store"


# --------------------------------------------------------------------------
# Migration must NOT publish a paused or soft-deleted store even if it is
# otherwise fully eligible — the one-directional safety guarantee.
# --------------------------------------------------------------------------
async def _migration_035_never_publishes_ineligible_case(srv, cleanup):
    import importlib
    db = srv.db

    mid_paused = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid_paused, "approved"))
    store_id_paused = f"store-m-{mid_paused}"
    await db.stores.insert_one({
        "id": store_id_paused, "merchant_id": mid_paused, "name": "Paused Store",
        "published": False, "paused": True, "product_count": 0,
        "kyc_status": "submitted", "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await srv._create_product_for_merchant(_product_payload(srv, "Paused Store Product"), mid_paused, admin_override=True)
    await db.stores.update_one({"id": store_id_paused}, {"$set": {"published": False, "product_count": 0}})

    mid_deleted = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid_deleted, "approved"))
    store_id_deleted = f"store-m-{mid_deleted}"
    await db.stores.insert_one({
        "id": store_id_deleted, "merchant_id": mid_deleted, "name": "Deleted Store",
        "published": False, "paused": False, "product_count": 0,
        "kyc_status": "submitted", "is_deleted": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await srv._create_product_for_merchant(_product_payload(srv, "Deleted Store Product"), mid_deleted, admin_override=True)
    await db.stores.update_one({"id": store_id_deleted}, {"$set": {"published": False, "product_count": 0}})

    mod = importlib.import_module("migrations.035_reconcile_autopublish_and_kyc_sync")
    await mod.up(db)

    fresh_paused = await db.stores.find_one({"id": store_id_paused}, {"_id": 0})
    assert fresh_paused["published"] is False, "a paused store must never be auto-published by the migration"

    fresh_deleted = await db.stores.find_one({"id": store_id_deleted}, {"_id": 0})
    assert fresh_deleted["published"] is False, "a soft-deleted store must never be touched at all"
    assert fresh_deleted["kyc_status"] == "submitted", "soft-deleted stores are excluded entirely, incl. kyc_status sync"


# --------------------------------------------------------------------------
# Migration 035 — reverse direction. Directly reproduces a store stuck
# LIVE despite its merchant's KYC no longer being approved (the shape
# admin_reject()/admin_hold() used to leave behind before this fix), and
# verifies the migration un-publishes it without touching any content.
# --------------------------------------------------------------------------
async def _migration_035_unpublishes_revoked_kyc_case(srv, cleanup):
    import importlib
    db = srv.db
    mid = cleanup.track(f"m-apub-{uuid.uuid4().hex[:8]}")
    await db.merchants.insert_one(_merchant_doc(mid, "rejected"))

    store_id = f"store-m-{mid}"
    created = await srv._create_product_for_merchant(
        _product_payload(srv, "Stuck Live Product"), mid, admin_override=True,
    )
    await srv._create_or_setup_storefront_for_merchant(_storefront_payload(srv), mid, bypass_kyc_gate=True)
    # Force the exact pre-fix broken shape directly: live and stale-approved,
    # even though the merchant's real kyc_status is "rejected".
    await db.stores.update_one({"id": store_id}, {"$set": {
        "published": True, "kyc_status": "approved", "product_count": 1,
        "live_at": datetime.now(timezone.utc).isoformat(),
    }})

    mod = importlib.import_module("migrations.035_reconcile_autopublish_and_kyc_sync")
    result = await mod.up(db)
    summary_line = next(l for l in result["reconcile_autopublish_and_kyc_sync"] if l.startswith("SUMMARY"))
    assert "1 unpublished" in summary_line, f"expected exactly 1 unpublish: {summary_line}"

    fresh = await db.stores.find_one({"id": store_id}, {"_id": 0})
    assert fresh["published"] is False, "migration must un-publish a store whose merchant's KYC is no longer approved"
    assert fresh["kyc_status"] == "rejected", "kyc_status snapshot must be corrected to match reality"
    assert fresh["product_count"] == 1, "product_count is untouched by the unpublish step"

    product_after = await db.products.find_one({"id": created["id"]}, {"_id": 0})
    assert product_after["name"] == "Stuck Live Product", "the migration must never touch product content"
    assert product_after.get("is_deleted") is not True

    # Idempotent: re-run must be a no-op now that it's reconciled.
    result2 = await mod.up(db)
    summary_line2 = next(l for l in result2["reconcile_autopublish_and_kyc_sync"] if l.startswith("SUMMARY"))
    assert "0 product_count fixes, 0 kyc_status syncs, 0 autopublished, 0 unpublished" in summary_line2


# --------------------------------------------------------------------------
# Single entrypoint — see test_security_fixes.py's own comment for why one
# asyncio.run() covers the whole file.
# --------------------------------------------------------------------------
async def _run_all_cases():
    import server as srv
    try:
        db = srv.db
    except Exception as e:
        pytest.skip(f"MongoDB not reachable from this test runner: {e}")
        return

    cleanup = _Cleanup(db)
    try:
        await _sequence_kyc_first_case(srv, cleanup)
        await _sequence_kyc_last_case(srv, cleanup)
        await _sequence_admin_product_first_case(srv, cleanup)
        await _sequence_unpause_case(srv, cleanup)
        await _kyc_sync_without_publish_case(srv, cleanup)
        await _visibility_filter_case(srv, cleanup)
        await _revocation_case(srv, cleanup)
        await _revocation_noop_on_unpublished_store_case(srv, cleanup)
        await _migration_035_case(srv, cleanup)
        await _migration_035_unpublishes_revoked_kyc_case(srv, cleanup)
        await _migration_035_never_publishes_ineligible_case(srv, cleanup)
    finally:
        await cleanup.purge()


def test_store_autopublish_reconciliation():
    asyncio.run(_run_all_cases())
