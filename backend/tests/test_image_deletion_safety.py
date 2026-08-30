"""Regression tests for the product-image deletion safety fix (image
reliability incident).

Root cause: `_apply_product_update` used to diff the submitted
`image_public_ids` against whatever was already stored and auto-delete
from Cloudinary anything missing from the new payload. Since the merchant
frontend reconstructs `images`/`image_public_ids` independently on load,
those two arrays can end up different lengths for a legacy/misaligned
record — so saving ANY unrelated field (price, stock, name, category) on
such a product could silently delete a Cloudinary asset still referenced
by a URL sitting in that same product's `images` array.

These tests exercise `_apply_product_update`/`_remove_product_images`
directly (no HTTP, no auth — those concerns belong to the route, not this
shared update function) against a REAL local MongoDB, matching this
repo's existing "run against something real" convention. Cloudinary
itself is mocked here specifically because these tests need to assert
INTERNAL call counts (zero calls, exactly one call) — an outcome no
amount of live HTTP probing can observe from outside the process.

All tests share one persistent event loop for the module (see `_run`
below) rather than one `asyncio.run()` per test — `server.db` is a
module-level Motor client bound to whichever loop first touches it, and a
fresh loop per test makes every test after the first raise "Event loop is
closed".
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

# `server.db` is a module-level Motor client, created once at import time
# and bound to whichever event loop first uses it. Calling `asyncio.run()`
# per-test would create-and-close a NEW loop each time, and Motor then
# raises "Event loop is closed" on the second test onward. Every test in
# this file instead runs its coroutine on ONE persistent loop shared for
# the whole module.
_loop = asyncio.new_event_loop()


def _run(coro):
    return _loop.run_until_complete(coro)


def _make_product(**overrides) -> dict:
    now = "2026-01-01T00:00:00+00:00"
    doc = {
        "id": f"test-img-safety-{uuid.uuid4().hex[:10]}",
        "merchant_id": "test-merchant", "store_id": "store-m-test-merchant",
        "name": "Test Product", "price": 999, "mrp": 1299,
        "l1_id": "l1-men", "l2_id": "l2-men-tshirts", "gender": "men",
        "sizes": ["M", "L"], "stock": {"M": 2, "L": 3}, "total_stock": 5,
        "image": "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img1.jpg",
        "image_public_id": "lokl/products/img1",
        "images": [
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img1.jpg",
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img2.jpg",
        ],
        "image_public_ids": ["lokl/products/img1", "lokl/products/img2"],
        "paused": False, "created_at": now, "updated_at": now,
    }
    doc.update(overrides)
    return doc


async def _with_product(coro_fn, **overrides):
    """Inserts a fresh test product, awaits coro_fn(doc), always deletes
    the product afterward — one Motor client, one event loop, for the
    entire lifecycle of a single test."""
    doc = _make_product(**overrides)
    await server.db.products.insert_one(dict(doc))
    try:
        return await coro_fn(doc)
    finally:
        await server.db.products.delete_one({"id": doc["id"]})


# ===== Test 1 — price update must not delete images =====

def test_price_update_does_not_delete_images():
    async def body(doc):
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_delete:
            await server._apply_product_update(doc["id"], doc, {"price": 1099})
        mock_delete.assert_not_called()
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["images"] == doc["images"]
        assert updated["image_public_ids"] == doc["image_public_ids"]
        assert updated["price"] == 1099

    _run(_with_product(body))


# ===== Test 2 — missing public id in payload must not implicitly delete =====

def test_misaligned_legacy_payload_does_not_implicitly_delete():
    """Simulates the exact frontend bug from the audit: a legacy/misaligned
    record whose `image_public_ids` the client reconstructs shorter than
    `images`, sent back as part of an update unrelated to any image
    change."""
    async def body(doc):
        misaligned_payload = {
            "name": "Renamed Product",
            # Only ONE id sent back even though the product has two images.
            "image_public_ids": [doc["image_public_ids"][0]],
        }
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_delete:
            await server._apply_product_update(doc["id"], doc, misaligned_payload)
        mock_delete.assert_not_called()
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["name"] == "Renamed Product"
        # The underlying Cloudinary assets are untouched — nothing was
        # deleted — even though the DB now reflects the shorter array the
        # client happened to send (a plain data write, never destructive).
        assert updated["image_public_ids"] == [doc["image_public_ids"][0]]

    _run(_with_product(body))


# ===== Test 3 — explicit image deletion works =====

def test_explicit_removal_deletes_exactly_one_and_leaves_others():
    async def body(doc):
        target = doc["image_public_ids"][1]  # non-cover image
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=True) as mock_delete:
            await server._apply_product_update(doc["id"], doc, {"remove_image_public_ids": [target]})
        mock_delete.assert_awaited_once_with(target)
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["image_public_ids"] == [doc["image_public_ids"][0]]
        assert updated["images"] == [doc["images"][0]]
        # Cover untouched — only the second (non-cover) image was removed.
        assert updated["image_public_id"] == doc["image_public_id"]
        assert updated["image"] == doc["image"]

    _run(_with_product(body))


def test_explicit_removal_of_cover_promotes_next_image():
    async def body(doc):
        cover_pid = doc["image_public_id"]
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=True) as mock_delete:
            await server._apply_product_update(doc["id"], doc, {"remove_image_public_ids": [cover_pid]})
        mock_delete.assert_awaited_once_with(cover_pid)
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert cover_pid not in updated["image_public_ids"]
        assert updated["image_public_id"] == doc["image_public_ids"][1]
        assert updated["image"] == doc["images"][1]

    _run(_with_product(body))


def test_failed_cloudinary_delete_leaves_db_unchanged():
    """A failed Cloudinary delete must never make the DB claim an asset is
    gone when it might not be."""
    async def body(doc):
        target = doc["image_public_ids"][0]
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=False) as mock_delete:
            await server._apply_product_update(doc["id"], doc, {"remove_image_public_ids": [target]})
        mock_delete.assert_awaited_once_with(target)
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["image_public_ids"] == doc["image_public_ids"]
        assert updated["images"] == doc["images"]

    _run(_with_product(body))


# ===== Mixed-result explicit deletion (some ids succeed, some fail) =====

def test_mixed_result_deletion_partial_success_reported_and_db_consistent():
    """remove_image_public_ids=[id1, id2, id3] where Cloudinary succeeds for
    some and fails for others. Requires:
      - all ids validated before any deletion is attempted
      - successful deletions remove only their own DB references
      - failed deletions retain their DB references
      - an unrelated 4th image is left completely untouched
      - the API response clearly represents the partial outcome
      - the DB is never left inconsistent with what Cloudinary actually did
    """
    async def body(doc):
        id1, id2, id3, id4 = doc["image_public_ids"]
        # id1 succeeds, id2 fails, id3 succeeds — exercised in request order.
        outcomes = {id1: True, id2: False, id3: True}
        with patch(
            "server.cloudinary_service.delete_image", new_callable=AsyncMock,
            side_effect=lambda rid: outcomes[rid],
        ) as mock_delete:
            result = await server._apply_product_update(
                doc["id"], doc, {"remove_image_public_ids": [id1, id2, id3]}
            )
        # All 3 requested ids were validated up front (none raised — they
        # all belong to this product) and Cloudinary was asked about each.
        assert mock_delete.await_count == 3
        mock_delete.assert_any_await(id1)
        mock_delete.assert_any_await(id2)
        mock_delete.assert_any_await(id3)

        # The API response clearly represents the partial outcome.
        assert result["image_removal_result"] == {"deleted": [id1, id3], "failed": [id2]}

        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        # Successful deletions removed only their own DB references.
        assert id1 not in updated["image_public_ids"]
        assert id3 not in updated["image_public_ids"]
        assert id1 not in updated["images"] and doc["images"][2] not in updated["images"]
        # The failed deletion's DB reference is retained.
        assert id2 in updated["image_public_ids"]
        assert doc["images"][1] in updated["images"]
        # The unrelated 4th image is completely untouched.
        assert id4 in updated["image_public_ids"]
        assert doc["images"][3] in updated["images"]
        # Exactly the 2 successfully-deleted entries are gone; nothing else.
        assert len(updated["image_public_ids"]) == len(doc["image_public_ids"]) - 2
        assert len(updated["images"]) == len(doc["images"]) - 2

    _run(_with_product(
        body,
        image=None, image_public_id=None,  # avoid cover-promotion noise; test the array only
        images=[
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img1.jpg",
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img2.jpg",
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img3.jpg",
            "https://res.cloudinary.com/doojqkyff/image/upload/v1/lokl/products/img4.jpg",
        ],
        image_public_ids=[
            "lokl/products/img1", "lokl/products/img2", "lokl/products/img3", "lokl/products/img4",
        ],
    ))


def test_mixed_result_batch_still_rejected_atomically_if_one_id_is_invalid():
    """A batch mixing valid AND invalid ids must still fail atomically —
    zero Cloudinary calls, zero DB changes — even though some ids in the
    batch would otherwise have succeeded."""
    async def body(doc):
        valid1, valid2 = doc["image_public_ids"][0], doc["image_public_ids"][1]
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_delete:
            with pytest.raises(HTTPException) as exc_info:
                await server._apply_product_update(
                    doc["id"], doc, {"remove_image_public_ids": [valid1, "lokl/products/not-mine", valid2]}
                )
        assert exc_info.value.status_code == 400
        mock_delete.assert_not_called()
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["image_public_ids"] == doc["image_public_ids"]
        assert updated["images"] == doc["images"]

    _run(_with_product(body))


# ===== Test 4 — invalid deletion request =====

def test_invalid_public_id_is_rejected_and_nothing_changes():
    async def body(doc):
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_delete:
            with pytest.raises(HTTPException) as exc_info:
                await server._apply_product_update(
                    doc["id"], doc, {"remove_image_public_ids": ["lokl/products/not-mine"]}
                )
        assert exc_info.value.status_code == 400
        mock_delete.assert_not_called()
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["images"] == doc["images"]
        assert updated["image_public_ids"] == doc["image_public_ids"]

    _run(_with_product(body))


def test_partial_invalid_id_rejects_the_whole_batch():
    """One bad id in a multi-id removal request must fail atomically —
    never partially delete the valid ones first."""
    async def body(doc):
        valid = doc["image_public_ids"][0]
        with patch("server.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_delete:
            with pytest.raises(HTTPException):
                await server._apply_product_update(
                    doc["id"], doc, {"remove_image_public_ids": [valid, "lokl/products/not-mine"]}
                )
        mock_delete.assert_not_called()
        updated = await server.db.products.find_one({"id": doc["id"]}, {"_id": 0})
        assert updated["image_public_ids"] == doc["image_public_ids"]

    _run(_with_product(body))


# ===== DELETE /merchant/upload-image ownership hardening =====
#
# Root cause: this endpoint deleted ANY Cloudinary public_id a caller
# supplied, with no check it actually belonged to them — a merchant could
# delete another merchant's product/store image merely by knowing or
# guessing its public_id. `_merchant_owns_cloudinary_asset` is the fix;
# these tests exercise it directly against real product/store docs.

def test_cross_merchant_deletion_of_product_image_is_denied():
    async def body(doc):
        owned = await server._merchant_owns_cloudinary_asset("some-other-merchant", doc["image_public_id"])
        assert owned is False

    _run(_with_product(body, merchant_id="the-real-owner"))


def test_owner_can_delete_own_product_image_via_db_reference():
    async def body(doc):
        owned = await server._merchant_owns_cloudinary_asset(doc["merchant_id"], doc["image_public_id"])
        assert owned is True
        owned_array_entry = await server._merchant_owns_cloudinary_asset(doc["merchant_id"], doc["image_public_ids"][1])
        assert owned_array_entry is True

    _run(_with_product(body, merchant_id="the-real-owner"))


def test_freshly_uploaded_owner_scoped_asset_is_deletable_before_ever_being_saved():
    """The legitimate "upload a photo, then discard it before ever saving
    the form" flow: the asset was never attached to any product/store
    record, so the ONLY ownership signal is the owner-scoped public_id
    minted at upload time (see cloudinary_service.upload_image)."""
    async def body(_doc):
        fresh_public_id = f"lokl/products/merchant-abc/{uuid.uuid4().hex}"
        assert await server._merchant_owns_cloudinary_asset("merchant-abc", fresh_public_id) is True
        assert await server._merchant_owns_cloudinary_asset("someone-else", fresh_public_id) is False

    _run(_with_product(body))


def test_unrelated_random_public_id_is_denied_to_everyone():
    async def body(_doc):
        random_old_style_id = "lokl/products/qz8x7k2p9m4n1r6t"  # Cloudinary auto-generated, no owner embedded
        assert await server._merchant_owns_cloudinary_asset("any-merchant", random_old_style_id) is False

    _run(_with_product(body))


def test_admin_bypasses_ownership_check_on_delete_endpoint():
    """Admins already have unrestricted product edit access elsewhere in
    this codebase (admin_update_product) — the DELETE endpoint's ownership
    gate is merchant-only by design, verified via the endpoint's own role
    branch rather than `_merchant_owns_cloudinary_asset` (which has no
    concept of admin at all — that's intentional, the bypass lives in the
    route)."""
    import inspect
    src = inspect.getsource(server.merchant_delete_image)
    assert 'role") == "merchant"' in src, "admin bypass must be explicit in the route, not buried in the ownership helper"


# ===== Test 5 — production guard on destructive cleanup scripts =====

def test_006_cleanup_script_refuses_in_production(monkeypatch):
    import importlib
    mod = importlib.import_module("migrations.006_cloudinary_cleanup")
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(SystemExit):
        mod._refuse_if_production()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    mod._refuse_if_production()  # must not raise outside production
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    mod._refuse_if_production()  # must not raise when unset


def test_005_delete_test_data_is_a_safe_noop_in_production(monkeypatch):
    """005 must NEVER raise in production — see migrations/run.py's `_run()`
    for why a raised exception here would permanently block every
    migration queued after it. It must instead return a normal report
    (so the runner marks it applied) while touching NOTHING — passing
    `db=None` proves this: any attempt to actually touch the database
    would raise AttributeError on None before this assertion is reached."""
    import importlib
    mod = importlib.import_module("migrations.005_delete_test_data")
    monkeypatch.setenv("ENVIRONMENT", "production")
    report = _run(mod.up(None))
    assert "summary" in report
    assert "SKIPPED" in report["summary"][0]


def test_005_delete_test_data_still_runs_outside_production():
    import importlib
    mod = importlib.import_module("migrations.005_delete_test_data")
    assert mod._is_production() is False  # dev env for this test run


def test_006_cleanup_script_excluded_from_normal_migration_runner():
    """006 must never be picked up as a normal sequenced migration — it has
    no up(db) and is destructive by design."""
    import importlib
    run_mod = importlib.import_module("migrations.run")
    assert "006_cloudinary_cleanup" in run_mod._NOT_MIGRATIONS
    assert "006_cloudinary_cleanup" not in run_mod._discover()


def test_005_stays_wired_into_legitimate_migration_sequencing():
    """005 (unlike 006) is a real, legitimately-discovered migration — the
    production guard must not remove it from sequencing, only neutralize
    its destructive behavior when ENVIRONMENT=production."""
    import importlib
    run_mod = importlib.import_module("migrations.run")
    assert "005_delete_test_data" in run_mod._discover()
    assert "005_delete_test_data" not in run_mod._NOT_MIGRATIONS


# ===== Test covering migration-sequencing behaviour (runner isolation) =====

def test_runner_isolates_a_failing_migration_and_continues(monkeypatch):
    """A migration that raises must not abort the batch: migrations after
    it (in sort order) must still run and be marked applied, and the
    failing one must be left UNAPPLIED (not silently marked done) so it
    stays visible via --status and safe to retry once fixed."""
    import importlib
    run_mod = importlib.import_module("migrations.run")

    class _FakeFailing:
        VERSION = "997_fake_failing"

        @staticmethod
        async def up(db):
            raise RuntimeError("boom — simulated migration failure")

    class _FakeOk:
        VERSION = "998_fake_ok"

        @staticmethod
        async def up(db):
            return {"summary": ["ok"]}

    fake_modules = {"997_fake_failing": _FakeFailing, "998_fake_ok": _FakeOk}
    monkeypatch.setattr(run_mod, "_discover", lambda: ["997_fake_failing", "998_fake_ok"])
    monkeypatch.setattr(run_mod, "_applied", AsyncMock(return_value=set()))
    monkeypatch.setattr(
        run_mod.importlib, "import_module",
        lambda path: fake_modules[path.rsplit(".", 1)[-1]],
    )

    applied_docs = []

    class _FakeMigrationsColl:
        async def insert_one(self, doc):
            applied_docs.append(doc)

    class _FakeDB(dict):
        def __getitem__(self, key):
            return _FakeMigrationsColl()

    summary = _run(run_mod._run(_FakeDB()))

    applied_versions = [d["version"] for d in applied_docs]
    assert "998_fake_ok" in applied_versions, "migration after the failing one must still run and apply"
    assert "997_fake_failing" not in applied_versions, "a failing migration must never be marked applied"
    assert any(v == "998_fake_ok" for v, _ in summary)
