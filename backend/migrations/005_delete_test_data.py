"""Migration 005 — test-data wipe + CMS-ready clean slate.

PRE-LAUNCH content management session. Drops every transactional / catalogue
collection so Lokl starts production with zero seed/test pollution, while
preserving the admin account and structural collections (delivery_config,
categories, _migrations).

Idempotent: re-running is a no-op once the DB is already empty.
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import environment  # noqa: E402

VERSION = "005_delete_test_data"


def _is_production() -> bool:
    """Kept for backward compatibility with existing call sites/tests that
    ask specifically "is this production" — delegates to the shared
    environment.py helper (2026-09 incident fix) rather than reading
    `ENVIRONMENT` directly. NOT what the guard below actually checks — see
    `up()`'s own comment for why "not production" isn't a strict enough
    condition for a migration this destructive."""
    return environment.is_production()


async def up(db) -> dict:
    # Production guard (incident fix), implemented as a SAFE NO-OP rather
    # than raising. This migration wipes essentially every transactional/
    # catalogue collection AND every Cloudinary asset under lokl/products,
    # lokl/stores, lokl/banners (Step 7 below) — a one-shot pre-launch
    # "clean slate" operation with no environment check of its own.
    #
    # An earlier version of this guard raised RuntimeError here instead.
    # migrations/run.py's runner has no per-migration exception isolation
    # around `await mod.up(db)` — a raised exception here would leave this
    # migration permanently unmarked as "applied" in `_migrations`, so
    # EVERY future `migrations.run` invocation in production would hit
    # this exact migration again (lexical ordering puts it before 007+)
    # and abort before ever reaching them — silently blocking all
    # production migrations forever. This is the exact same incident class
    # already documented twice in this codebase's history (see migration
    # 013's own writeup of the 007/008 duplicate-key crash, and
    # migrations/run.py's _NOT_MIGRATIONS comment on 006).
    #
    # Returning a normal (non-raising) report instead means: the runner's
    # ordinary `db["_migrations"].insert_one(...)` still fires exactly as
    # it would for any successful migration, so this decision is recorded
    # ONCE, permanently, honestly (the report says exactly what happened
    # and why) — migration sequencing is never blocked, and this is never
    # silently re-evaluated on a later run. `migrations/run.py`'s `_run()`
    # also now isolates any migration's exception per-item as a second,
    # independent layer of defense — see its own comment.
    #
    # 2026-09 incident fix: this used to gate on `_is_production()` alone
    # (bare `ENVIRONMENT == "production"`, which real Railway production
    # never sets — this migration is auto-discovered by migrations/run.py,
    # so had its `_migrations` "applied" record ever been lost, THIS is
    # what would have silently wiped every products/stores/merchants/
    # orders/customers document plus the same Cloudinary folders the
    # incident already destroyed once). It now refuses to proceed unless
    # `environment.is_confirmed_non_production()` — a POSITIVE identification
    # of a real non-production environment — is true. An unrecognized or
    # missing environment is treated exactly like production: refuse. Only
    # an environment explicitly known to be safe (e.g. "staging",
    # "development", "test") unlocks the destructive path below, matching
    # this migration's actual intended use (a deliberate pre-launch/
    # staging reset), never an ambiguous default.
    if not environment.is_confirmed_non_production():
        env_name = environment.get_environment_name() or "unknown"
        return {"summary": [
            f"SKIPPED: environment is 'production' or could not be positively "
            f"confirmed as non-production (detected: '{env_name}'). This migration "
            "performs a destructive pre-launch test-data + Cloudinary wipe "
            "(products/stores/merchants/orders/customers plus lokl/products, "
            "lokl/stores, lokl/banners) and must never run unless the environment "
            "is explicitly known to be safe. Recorded as applied with this no-op "
            "outcome so migration sequencing is never blocked and this decision "
            "is never silently re-evaluated.",
        ]}
    summary: dict = {}

    # ── STEP 1: preserve admin ─────────────────────────────────────────
    # Lokl admin auth reads from .env (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) —
    # there is no `admins` row to protect. We still null-check the row in
    # case a future iteration introduces a DB-backed admin record.
    admin = await db.admins.find_one({}) if "admins" in await db.list_collection_names() else None
    summary["preserved_admin"] = (admin or {}).get("email") or os.environ.get("ADMIN_EMAIL", "from-env-only")

    # ── STEP 2: audit BEFORE delete ────────────────────────────────────
    audit_pre: dict = {}
    targets = [
        "notifications", "webhook_events", "payment_audit_log",
        "customer_otps", "merchant_otps", "returns", "complaints",
        "order_items", "orders", "products", "stores", "merchants",
        "customers", "idempotency_keys", "revoked_refresh_jti",
        "carts", "addresses", "ratings", "reviews", "wishlists",
        "search_queries", "delivery_status", "change_requests",
        "live_sessions", "store_audit_log",
    ]
    live_collections = await db.list_collection_names()
    for c in targets:
        if c in live_collections:
            audit_pre[c] = await db[c].count_documents({})
    summary["before"] = audit_pre

    # ── STEP 3: delete in dependency-safe order ────────────────────────
    deleted: dict = {}
    for c in targets:
        if c not in live_collections:
            continue
        r = await db[c].delete_many({})
        if r.deleted_count:
            deleted[c] = r.deleted_count
    summary["deleted"] = deleted

    # ── STEP 4: blank embedded cart/addresses on legacy `users` docs ──
    if "users" in live_collections:
        r = await db.users.update_many(
            {"role": {"$in": ["customer", "merchant"]}},
            {"$set": {"cart": [], "addresses": []}},
        )
        if r.modified_count:
            summary["users_cart_addresses_cleared"] = r.modified_count
        # delete non-admin user rows from the legacy `users` collection
        r = await db.users.delete_many({"role": {"$ne": "admin"}})
        if r.deleted_count:
            summary["legacy_users_deleted"] = r.deleted_count

    # ── STEP 5: depublish testimonials (keep rows for admin moderation) ─
    if "testimonials" in live_collections:
        r = await db.testimonials.update_many(
            {}, {"$set": {"published": False}},
        )
        summary["testimonials_depublished"] = r.modified_count

    # ── STEP 6: verify admin auth still works ─────────────────────────
    # Admin lives in .env, not in Mongo — assert the env values are intact.
    if not (os.environ.get("ADMIN_EMAIL") and os.environ.get("ADMIN_PASSWORD_HASH")):
        raise RuntimeError("ADMIN_EMAIL/ADMIN_PASSWORD_HASH missing from env — aborting")
    summary["admin_intact"] = True

    # ── STEP 7: Cloudinary asset prefix purge (best-effort, optional) ─
    cloudinary_summary: dict = {"status": "skipped"}
    try:
        from dotenv import load_dotenv
        load_dotenv()
        if all(os.environ.get(k) for k in (
            "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")):
            import cloudinary
            from cloudinary import api as cloudinary_api
            cloudinary.config(
                cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
                api_key=os.environ["CLOUDINARY_API_KEY"],
                api_secret=os.environ["CLOUDINARY_API_SECRET"],
            )
            wiped = {}
            for prefix in ("lokl/products", "lokl/stores", "lokl/banners",
                           "products", "stores", "banners", "lokl-test"):
                try:
                    res = cloudinary_api.delete_resources_by_prefix(prefix)
                    wiped[prefix] = len((res.get("deleted") or {}))
                except Exception as e:
                    wiped[prefix] = f"error: {e}"
            cloudinary_summary = {"status": "ok", "deleted_by_prefix": wiped}
        else:
            cloudinary_summary = {"status": "skipped — env not set"}
    except Exception as e:
        cloudinary_summary = {"status": f"error: {e}"}
    summary["cloudinary"] = cloudinary_summary

    # ── STEP 8: final counts ──────────────────────────────────────────
    after: dict = {}
    for c in await db.list_collection_names():
        after[c] = await db[c].count_documents({})
    summary["after"] = after
    summary["completed_at"] = datetime.now(timezone.utc).isoformat()
    return {"summary": summary}
