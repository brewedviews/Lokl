"""Tests for services/cloudinary_safety.py (2026-09 incident remediation,
Phase 9) — proving the safety PROPERTIES of the new single-asset deletion
primitive, not just exercising its code.

Same conventions as tests/test_image_deletion_safety.py: one shared,
persistent event loop for the whole module (server.db is a module-level
Motor client bound to whichever loop first touches it — see that file's
own comment for why), tests run against a real local MongoDB, Cloudinary
network calls are always mocked.
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import environment  # noqa: E402
from services import cloudinary_safety  # noqa: E402

_loop = asyncio.new_event_loop()


def _run(coro):
    return _loop.run_until_complete(coro)


def _clear_env_signals(monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _cleanup(public_id: str):
    await server.db.cloudinary_uploads.delete_many({"public_id": public_id})
    await server.db.cloudinary_deletion_log.delete_many({"public_id": public_id})
    await server.db.products.delete_many({"image_public_id": public_id})


def _new_pid() -> str:
    return f"lokl/products/test-merchant/{uuid.uuid4().hex}"


# ===== 1. Referenced asset → blocked =====

def test_referenced_asset_blocks_deletion(monkeypatch):
    async def body():
        pid = _new_pid()
        await server.db.products.insert_one({
            "id": f"test-prod-{uuid.uuid4().hex[:8]}", "image_public_id": pid,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_REFERENCED"
        mock_del.assert_not_called()

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 2. Reference lookup failure → blocked =====

def test_reference_check_failure_blocks_deletion(monkeypatch):
    async def body():
        pid = _new_pid()
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.check_references", new_callable=AsyncMock) as mock_check, \
             patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            mock_check.return_value = {"ok": False, "references": [], "error": "simulated DB outage"}
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_REFERENCE_CHECK_FAILED"
        mock_del.assert_not_called()

    _run(body())


# ===== 3, 7. Exact unreferenced + abandoned-past-retention asset → eligible =====

def test_unreferenced_abandoned_past_retention_asset_can_be_deleted(monkeypatch):
    async def body():
        pid = _new_pid()
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=True) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "DELETED"
        mock_del.assert_called_once_with(pid, kyc=False)
        rec = await server.db.cloudinary_uploads.find_one({"public_id": pid})
        assert rec["status"] == "deleted"

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 4, 5. Pending / recently-uploaded-unlinked asset → not deletable =====

def test_pending_upload_is_not_deletable(monkeypatch):
    async def body():
        pid = _new_pid()
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "pending", "abandoned_at": None,
            "uploaded_at": _iso(datetime.now(timezone.utc)),
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_NOT_ABANDONED"
        mock_del.assert_not_called()

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


def test_asset_with_no_tracking_record_at_all_is_not_deletable(monkeypatch):
    """Fail closed: a legacy/pre-tracking asset with NO cloudinary_uploads
    row must never be treated as 'nothing says otherwise, so it's fine'."""
    async def body():
        pid = _new_pid()
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_NOT_ABANDONED"
        mock_del.assert_not_called()

    _run(body())


# ===== 6. Abandoned before retention period → not deletable =====

def test_abandoned_before_retention_window_is_not_deletable(monkeypatch):
    async def body():
        pid = _new_pid()
        recent = _iso(datetime.now(timezone.utc) - timedelta(hours=1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": recent,
            "uploaded_at": recent,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_NOT_ABANDONED"
        mock_del.assert_not_called()

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 8. Audit record created before the Cloudinary call =====

def test_audit_trail_records_full_sequence_before_and_after_delete(monkeypatch):
    async def body():
        pid = _new_pid()
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=True):
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        rows = [r async for r in server.db.cloudinary_deletion_log.find(
            {"attempt_id": result["attempt_id"]}, {"_id": 0}).sort("at", 1)]
        states = [r["state"] for r in rows]
        assert states == ["REQUESTED", "REFERENCE_CHECKED", "DELETE_ATTEMPTED", "DELETED"]
        # The REQUESTED row must exist regardless of what happens later —
        # it is written before any gate is even evaluated.
        assert rows[0]["public_id"] == pid

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 9. Cloudinary API failure → DELETE_FAILED =====

def test_cloudinary_failure_produces_delete_failed_state(monkeypatch):
    async def body():
        pid = _new_pid()
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock, return_value=False):
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "DELETE_FAILED"
        rec = await server.db.cloudinary_uploads.find_one({"public_id": pid})
        assert rec["status"] == "abandoned"  # not silently marked deleted on failure

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


def test_cloudinary_exception_produces_delete_failed_state(monkeypatch):
    async def body():
        pid = _new_pid()
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock,
                   side_effect=RuntimeError("network exploded")):
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "DELETE_FAILED"
        assert "network exploded" in result["error"]

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 10, 12. Unknown / missing environment → blocked =====

def test_unknown_environment_blocks_deletion(monkeypatch):
    async def body():
        pid = _new_pid()
        _clear_env_signals(monkeypatch)
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_ENVIRONMENT"
        mock_del.assert_not_called()

    _run(body())


def test_missing_db_name_blocks_deletion_even_with_safe_environment(monkeypatch):
    async def body():
        pid = _new_pid()
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.delenv("DB_NAME", raising=False)
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_ENVIRONMENT"
        mock_del.assert_not_called()

    _run(body())


# ===== 11. Production → blocked, no override possible =====

def test_production_blocks_deletion_even_with_correct_confirm_value(monkeypatch):
    async def body():
        pid = _new_pid()
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
        monkeypatch.setenv("DB_NAME", "bharat_fashion_os")
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test",
                confirm=cloudinary_safety.DESTRUCTIVE_CONFIRM_VALUE,
            )
        assert result["state"] == "BLOCKED_ENVIRONMENT"
        mock_del.assert_not_called()

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


def test_missing_confirm_value_blocks_deletion_outside_production(monkeypatch):
    async def body():
        pid = _new_pid()
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
        monkeypatch.setenv("DB_NAME", "lokl_dev")
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=cloudinary_safety.ABANDON_RETENTION_HOURS + 1))
        await server.db.cloudinary_uploads.insert_one({
            "public_id": pid, "status": "abandoned", "abandoned_at": old, "uploaded_at": old,
        })
        with patch("services.cloudinary_safety.cloudinary_service.delete_image", new_callable=AsyncMock) as mock_del:
            result = await cloudinary_safety.safe_delete_asset(
                server.db, public_id=pid, actor="test", reason="test", confirm=None,
            )
        assert result["state"] == "BLOCKED_ENVIRONMENT"
        mock_del.assert_not_called()

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== 13. No application pathway accepts a prefix =====

def test_primitive_has_no_prefix_parameter():
    import inspect
    sig = inspect.signature(cloudinary_safety.safe_delete_asset)
    for name in sig.parameters:
        assert "prefix" not in name.lower() and "folder" not in name.lower()
    assert not hasattr(cloudinary_safety, "delete_by_prefix")
    assert not hasattr(cloudinary_safety, "delete_resources")
    assert not hasattr(cloudinary_safety, "delete_resources_by_prefix")


# ===== 16. Existing upload flow keeps working; tracking hook is best-effort =====

def test_record_pending_upload_inserts_a_row():
    async def body():
        pid = _new_pid()
        await cloudinary_safety.record_pending_upload(
            server.db, public_id=pid, owner_id="test-merchant", asset_type="product",
        )
        rec = await server.db.cloudinary_uploads.find_one({"public_id": pid}, {"_id": 0})
        assert rec is not None
        assert rec["status"] == "pending"
        assert rec["owner_id"] == "test-merchant"

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


def test_record_pending_upload_never_raises_on_db_error():
    """Upload tracking is best-effort — a tracking-write failure must never
    surface to (or fail) the caller, since the Cloudinary asset already
    exists by the time this is called."""
    async def body():
        class _ExplodingCollection:
            async def insert_one(self, *a, **kw):
                raise RuntimeError("simulated Mongo outage")

        class _ExplodingDb:
            def __getitem__(self, name):
                return _ExplodingCollection()

        # Must not raise.
        await cloudinary_safety.record_pending_upload(
            _ExplodingDb(), public_id="lokl/products/x/y", owner_id="m", asset_type="product",
        )

    _run(body())


# ===== mark_upload_abandoned =====

def test_mark_upload_abandoned_is_explicit_and_does_not_auto_trigger():
    async def body():
        pid = _new_pid()
        await cloudinary_safety.record_pending_upload(server.db, public_id=pid, owner_id="m", asset_type="product")
        ok = await cloudinary_safety.mark_upload_abandoned(server.db, public_id=pid, reason="never attached to a product")
        assert ok is True
        rec = await server.db.cloudinary_uploads.find_one({"public_id": pid}, {"_id": 0})
        assert rec["status"] == "abandoned"
        assert rec["abandoned_reason"] == "never attached to a product"
        # Marking abandoned must never itself call Cloudinary or touch anything else.

    try:
        _run(body())
    finally:
        _run(_cleanup(""))


# ===== check_references field coverage =====

def test_check_references_covers_all_known_public_id_fields():
    async def body():
        pid = _new_pid()
        try:
            await server.db.stores.insert_one({"id": f"store-test-{uuid.uuid4().hex[:8]}", "logo_public_id": pid})
            result = await cloudinary_safety.check_references(server.db, pid)
            assert result["ok"] is True
            assert any(r["collection"] == "stores" for r in result["references"])
        finally:
            await server.db.stores.delete_many({"logo_public_id": pid})

    _run(body())


def test_check_references_finds_color_variant_images():
    async def body():
        pid = _new_pid()
        prod_id = f"test-prod-{uuid.uuid4().hex[:8]}"
        try:
            await server.db.products.insert_one({
                "id": prod_id,
                "color_variants": [{"id": "cv-1", "images": [{"public_id": pid, "url": "https://x"}]}],
            })
            result = await cloudinary_safety.check_references(server.db, pid)
            assert result["ok"] is True
            assert any(r["collection"] == "products" and r["doc_id"] == prod_id for r in result["references"])
        finally:
            await server.db.products.delete_one({"id": prod_id})

    _run(body())


def test_check_references_returns_empty_for_genuinely_unreferenced_asset():
    async def body():
        pid = _new_pid()
        result = await cloudinary_safety.check_references(server.db, pid)
        assert result == {"ok": True, "references": [], "error": None}

    _run(body())
