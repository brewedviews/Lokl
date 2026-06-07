"""Migration 005 — test-data wipe + CMS-ready clean slate.

PRE-LAUNCH content management session. Drops every transactional / catalogue
collection so Lokl starts production with zero seed/test pollution, while
preserving the admin account and structural collections (delivery_config,
categories, _migrations).

Idempotent: re-running is a no-op once the DB is already empty.
"""
import os
from datetime import datetime, timezone

VERSION = "005_delete_test_data"


async def up(db) -> dict:
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
