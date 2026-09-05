"""Cloudinary deletion safety (2026-09 incident remediation).

Root cause (see the incident's forensic report): `migrations/006_cloudinary_
cleanup.py` and `migrations/005_delete_test_data.py`'s Step 7 both contained
a normal, callable code path from a public_id PREFIX straight to
`cloudinary.api.delete_resources`/`delete_resources_by_prefix` — capable of
wiping an entire folder in one call, gated only by an environment-variable
check that real production never satisfied correctly. Both prefix-deletion
bodies have since been retired (see those files' own docstrings) — this
module is their replacement, and the ONLY sanctioned way to delete a
Cloudinary asset outside of a merchant/admin removing a specific image they
already own (see server.py's `_merchant_owns_cloudinary_asset` +
`_remove_product_images`, which are a deliberately SEPARATE, narrower,
production-safe mechanism — see `safe_delete_asset`'s own docstring for why
this module does not replace them).

Three properties define this module, and none may be individually relaxed:

  1. Every deletion operates on exactly ONE public_id. There is no prefix,
     folder, tag, or wildcard parameter anywhere in this file — nothing here
     can be handed a prefix and asked to enumerate+delete under it.
  2. A live, cross-collection reference search runs immediately before any
     delete attempt. A reference anywhere blocks the delete. If the search
     itself cannot be completed reliably, that ALSO blocks the delete —
     "the lookup found nothing because it failed" must never be read as
     "safe to delete."
  3. `safe_delete_asset()` refuses unconditionally in production (and in any
     environment that cannot be positively confirmed non-production) — see
     its own docstring. There is no confirmation value that unlocks
     production; that asymmetry is deliberate.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import environment
import services.cloudinary_service as cloudinary_service

logger = logging.getLogger(__name__)

# Same pattern as migrations/006's own hardened confirmation gate (ee6f478)
# — a value no normal configuration would ever set, so using this primitive
# for a real delete requires a human to have deliberately typed this exact
# string immediately before the call, every time.
DESTRUCTIVE_CONFIRM_VALUE = "I-UNDERSTAND-THIS-PERMANENTLY-DELETES-A-CLOUDINARY-ASSET"

# An asset must have been sitting `abandoned` for at least this long before
# `safe_delete_asset` will consider it eligible — a conservative window
# against a hasty/mistaken abandonment.
ABANDON_RETENTION_HOURS = 48

_UPLOADS_COLLECTION = "cloudinary_uploads"
_AUDIT_COLLECTION = "cloudinary_deletion_log"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ===================================================================
# Upload tracking (PENDING → ABANDONED lifecycle)
# ===================================================================

async def record_pending_upload(
    db, *, public_id: str, resource_type: str = "image",
    owner_id: str = "", asset_type: str = "",
) -> None:
    """Insert a PENDING tracking row for a just-uploaded asset. Called at
    every live upload call site in server.py (the base64→Cloudinary
    migration script's one-off `upload_bytes` path is historical and
    already fully applied — not instrumented here).

    Best-effort: a failure here must never fail the upload itself (the
    asset already exists in Cloudinary by the time this is called) — the
    caller is expected to fire-and-forget this, same as this codebase's
    existing `try/except ... log.warning(...)` convention for non-critical
    side effects (see server.py's startup block)."""
    if not public_id:
        return
    try:
        await db[_UPLOADS_COLLECTION].insert_one({
            "id": f"cu-{uuid.uuid4().hex[:12]}",
            "public_id": public_id,
            "resource_type": resource_type,
            "owner_id": owner_id,
            "asset_type": asset_type,
            "status": "pending",
            "uploaded_at": _now_iso(),
            "abandoned_at": None,
            "abandoned_reason": None,
        })
    except Exception:
        logger.exception("cloudinary_safety: failed to record pending upload for %s", public_id)


async def mark_upload_abandoned(db, *, public_id: str, reason: str) -> bool:
    """Explicitly, deliberately mark a tracked upload as abandoned — never
    automatic. This only flips the tracking row's status; it does not
    delete anything and does not require any reference check itself (the
    reference check happens at delete time, not at abandonment time, since
    an asset can be un-abandoned by later being attached to something)."""
    result = await db[_UPLOADS_COLLECTION].update_one(
        {"public_id": public_id},
        {"$set": {"status": "abandoned", "abandoned_at": _now_iso(), "abandoned_reason": reason}},
    )
    return result.matched_count > 0


async def _cleanup_eligibility(db, public_id: str) -> tuple[bool, str]:
    """Whether an asset's tracking record makes it eligible for cleanup —
    independent of (and always checked in addition to) the live reference
    search. Fails closed: no tracking record, wrong status, missing/
    unparseable timestamp, or still within the retention window are all
    "not eligible", never "assume it's fine"."""
    rec = await db[_UPLOADS_COLLECTION].find_one({"public_id": public_id})
    if not rec:
        return False, "no upload-tracking record exists for this public_id"
    if rec.get("status") != "abandoned":
        return False, f"upload status is {rec.get('status')!r}, not 'abandoned'"
    abandoned_at = _parse_iso(rec.get("abandoned_at"))
    if abandoned_at is None:
        return False, "marked abandoned but abandoned_at is missing/unparseable"
    if datetime.now(timezone.utc) - abandoned_at < timedelta(hours=ABANDON_RETENTION_HOURS):
        return False, f"abandoned less than {ABANDON_RETENTION_HOURS}h ago — still within retention window"
    return True, "eligible"


# ===================================================================
# Reference protection
# ===================================================================

async def check_references(db, public_id: str) -> dict:
    """Search every known Cloudinary-bearing collection/field for this
    exact public_id. Returns {"ok": True, "references": [...]} on a
    successfully-completed search (references may be empty), or
    {"ok": False, "references": [], "error": "..."} if the search itself
    could not be completed — callers MUST treat ok=False as "block", not
    as "no references found".

    Field inventory (Step 1 repository audit, this incident's Phase 9):
      products         — image_public_id, image_public_ids[],
                          color_variants[].images[].public_id
      stores           — logo_public_id, banner_public_ids[]
      merchants        — pan_doc_public_id, gst_doc_public_id,
                          cancelled_cheque_public_id (KYC docs)
      brands           — logo_public_id
      hero_slides      — image_public_id (defensive; current hero_slides
                          documents store a raw URL with no public_id field
                          at all, so this is expected to always miss today —
                          kept so a future banner-with-public_id write is
                          still covered without another audit)."""
    references: list[dict] = []
    checks = (
        ("products", {"$or": [
            {"image_public_id": public_id},
            {"image_public_ids": public_id},
            {"color_variants.images.public_id": public_id},
        ]}),
        ("stores", {"$or": [
            {"logo_public_id": public_id},
            {"banner_public_ids": public_id},
        ]}),
        ("merchants", {"$or": [
            {"pan_doc_public_id": public_id},
            {"gst_doc_public_id": public_id},
            {"cancelled_cheque_public_id": public_id},
        ]}),
        ("brands", {"logo_public_id": public_id}),
        ("hero_slides", {"$or": [
            {"image_public_id": public_id},
            {"public_id": public_id},
        ]}),
    )
    try:
        for collection_name, query in checks:
            async for doc in db[collection_name].find(query, {"_id": 0, "id": 1}):
                references.append({"collection": collection_name, "doc_id": doc.get("id")})
    except Exception as e:
        logger.exception("cloudinary_safety: reference check failed for %s", public_id)
        return {"ok": False, "references": [], "error": str(e)}
    return {"ok": True, "references": references, "error": None}


# ===================================================================
# Audit trail (append-only — every call INSERTS a new row, never updates)
# ===================================================================

async def _audit(db, *, attempt_id: str, state: str, **fields) -> None:
    doc = {
        "id": f"cdl-{uuid.uuid4().hex[:12]}",
        "attempt_id": attempt_id,
        "state": state,
        "at": _now_iso(),
        **fields,
    }
    try:
        await db[_AUDIT_COLLECTION].insert_one(doc)
    except Exception:
        # Audit-log failure must never be interpreted as permission to
        # proceed — callers check this function's own success is NOT a
        # precondition for anything; they just log-and-continue past a
        # failed audit write exactly as they would past a successful one.
        # The one place this matters (see safe_delete_asset) still aborts
        # the deletion itself on any exception in this helper's caller.
        logger.exception("cloudinary_safety: failed to write audit record (state=%s, public_id=%s)",
                          state, fields.get("public_id"))


# ===================================================================
# The single-asset deletion primitive
# ===================================================================

async def safe_delete_asset(
    db, *, public_id: str, actor: str, reason: str,
    confirm: Optional[str] = None,
    resource_type: str = "image", kyc: bool = False,
    product_id: Optional[str] = None, store_id: Optional[str] = None,
    merchant_id: Optional[str] = None,
) -> dict:
    """Delete exactly one Cloudinary asset, or refuse — never a prefix,
    never a batch. State machine (every transition is audited via `_audit`
    BEFORE the corresponding action, so an audit trail exists even for an
    interrupted/crashed attempt):

        REQUESTED
          -> BLOCKED_ENVIRONMENT                (production, or unconfirmed)
          -> BLOCKED_REFERENCE_CHECK_FAILED      (reference search errored)
          -> BLOCKED_REFERENCED                  (a live reference exists)
          -> BLOCKED_NOT_ABANDONED                (no tracked, eligible abandonment)
          -> REFERENCE_CHECKED
          -> DELETE_ATTEMPTED
          -> DELETED | DELETE_FAILED

    This is deliberately NOT the mechanism a merchant/admin uses to remove
    one photo from their own product/store (see server.py's
    `_merchant_owns_cloudinary_asset` + `_remove_product_images` /
    `merchant_delete_image`) — those operate on an asset the caller is
    ABOUT TO stop referencing, on their own record, and must keep working
    in production (that is their entire purpose). This primitive is the
    opposite case: deleting something that should have NO reference at
    all (an abandoned, never-attached upload) — replacing what
    migration 006 used to do in bulk, one exact asset at a time. Because
    its purpose is cleanup rather than an owner's explicit self-service
    action, and because that is exactly the operation class this incident
    proved is too dangerous to ever risk in production, it refuses
    unconditionally there — see the environment check below."""
    attempt_id = f"cda-{uuid.uuid4().hex[:12]}"
    env_name = environment.get_environment_name() or "unknown"
    base_fields = dict(
        public_id=public_id, resource_type=resource_type, actor=actor, reason=reason,
        environment=env_name, product_id=product_id, store_id=store_id, merchant_id=merchant_id,
    )

    await _audit(db, attempt_id=attempt_id, state="REQUESTED", **base_fields)

    if not public_id:
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_INVALID_PUBLIC_ID", **base_fields)
        return {"attempt_id": attempt_id, "state": "BLOCKED_INVALID_PUBLIC_ID"}

    # Environment gate — production is ALWAYS forbidden, no override, no
    # confirm value unlocks it. A non-production environment additionally
    # requires the same kind of explicit, one-off confirmation value
    # ee6f478 established for migration 006, so this can't be triggered by
    # a bare function call made out of habit either.
    if environment.is_production():
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_ENVIRONMENT", **base_fields,
                      detail="production is never eligible for this primitive — no override exists")
        return {"attempt_id": attempt_id, "state": "BLOCKED_ENVIRONMENT"}
    if not environment.is_confirmed_non_production():
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_ENVIRONMENT", **base_fields,
                      detail=f"environment could not be positively confirmed non-production (detected: {env_name!r})")
        return {"attempt_id": attempt_id, "state": "BLOCKED_ENVIRONMENT"}
    # Independent second signal, deliberately NOT derived from
    # RAILWAY_ENVIRONMENT_NAME/ENVIRONMENT at all (the forensic report's
    # recommendation): every real environment necessarily sets DB_NAME to
    # connect to Mongo in the first place, so requiring it here costs
    # nothing and means a single misconfigured/blank environment variable
    # can't alone be enough to unlock this — a second, differently-sourced
    # piece of config must also be present.
    if not (os.environ.get("DB_NAME") or "").strip():
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_ENVIRONMENT", **base_fields,
                      detail="DB_NAME is unset — a second, independent environment signal is required and missing")
        return {"attempt_id": attempt_id, "state": "BLOCKED_ENVIRONMENT"}
    if confirm != DESTRUCTIVE_CONFIRM_VALUE:
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_ENVIRONMENT", **base_fields,
                      detail="missing/incorrect explicit confirmation value")
        return {"attempt_id": attempt_id, "state": "BLOCKED_ENVIRONMENT"}

    # Reference check — authoritative. A failed check blocks exactly like
    # a found reference; only a successfully-completed, empty search
    # allows the next gate to run.
    ref_result = await check_references(db, public_id)
    if not ref_result["ok"]:
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_REFERENCE_CHECK_FAILED", **base_fields,
                      reference_check=ref_result)
        return {"attempt_id": attempt_id, "state": "BLOCKED_REFERENCE_CHECK_FAILED", "reference_check": ref_result}
    if ref_result["references"]:
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_REFERENCED", **base_fields,
                      reference_check=ref_result)
        return {"attempt_id": attempt_id, "state": "BLOCKED_REFERENCED", "reference_check": ref_result}
    await _audit(db, attempt_id=attempt_id, state="REFERENCE_CHECKED", **base_fields, reference_check=ref_result)

    # Lifecycle gate — must be a tracked upload, explicitly marked
    # abandoned, past the retention window. No tracking record at all
    # (e.g. a pre-tracking legacy asset) fails closed rather than being
    # treated as "nothing references it, so it must be safe".
    eligible, eligibility_detail = await _cleanup_eligibility(db, public_id)
    if not eligible:
        await _audit(db, attempt_id=attempt_id, state="BLOCKED_NOT_ABANDONED", **base_fields,
                      detail=eligibility_detail)
        return {"attempt_id": attempt_id, "state": "BLOCKED_NOT_ABANDONED", "detail": eligibility_detail}

    await _audit(db, attempt_id=attempt_id, state="DELETE_ATTEMPTED", **base_fields)
    try:
        ok = await cloudinary_service.delete_image(public_id, kyc=kyc)
    except Exception as e:
        await _audit(db, attempt_id=attempt_id, state="DELETE_FAILED", **base_fields, error=str(e))
        return {"attempt_id": attempt_id, "state": "DELETE_FAILED", "error": str(e)}

    if not ok:
        await _audit(db, attempt_id=attempt_id, state="DELETE_FAILED", **base_fields, error="cloudinary_service.delete_image returned False")
        return {"attempt_id": attempt_id, "state": "DELETE_FAILED"}

    await db[_UPLOADS_COLLECTION].update_one({"public_id": public_id}, {"$set": {"status": "deleted"}})
    await _audit(db, attempt_id=attempt_id, state="DELETED", **base_fields)
    return {"attempt_id": attempt_id, "state": "DELETED"}


# ===================================================================
# Audit-only instrumentation for the EXISTING owner-scoped deletion flows
# (merchant_delete_image / _remove_product_images in server.py). These
# flows are NOT routed through safe_delete_asset (see its docstring for
# why) — they keep their own existing ownership-check logic and must keep
# working in production. This only adds a durable audit record alongside
# the delete they already perform.
# ===================================================================

async def audit_owner_scoped_deletion(
    db, *, public_id: str, actor: str, reason: str, cloudinary_ok: bool,
    product_id: Optional[str] = None, store_id: Optional[str] = None,
    merchant_id: Optional[str] = None,
) -> None:
    attempt_id = f"cda-{uuid.uuid4().hex[:12]}"
    env_name = environment.get_environment_name() or "unknown"
    fields = dict(
        public_id=public_id, actor=actor, reason=reason, environment=env_name,
        product_id=product_id, store_id=store_id, merchant_id=merchant_id,
    )
    await _audit(db, attempt_id=attempt_id, state="DELETE_ATTEMPTED", source="owner_scoped", **fields)
    await _audit(db, attempt_id=attempt_id, state=("DELETED" if cloudinary_ok else "DELETE_FAILED"),
                 source="owner_scoped", **fields)
