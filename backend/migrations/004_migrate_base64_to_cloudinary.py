"""004 — One-shot migration: base64 image blobs in MongoDB → Cloudinary URLs.

Scans the `products` and `stores` collections for any field whose value is a
`data:image/...` data URI (or a bare base64 string >= 256 chars that doesn't
start with `http`). For each match it:
  1. Decodes the bytes
  2. Uploads to Cloudinary in the appropriate folder
  3. Updates the Mongo doc to point at `{image_url, public_id}`
  4. Strips the legacy base64 field on success

Idempotent — already-migrated docs (with HTTP(S) URLs) are skipped.
KYC documents are NOT migrated by this script (out of scope for the user spec —
admins will re-collect KYC docs via the new Cloudinary upload flow as merchants
resubmit).

USAGE:
    cd /app/backend
    python -m migrations.run 004        # run only this migration

The migration runner's idempotency layer also ensures it runs only once per
environment. Re-run after a manual revert via:
    db._migrations.deleteOne({version: "004_migrate_base64_to_cloudinary"})
"""
import asyncio
import base64
import logging
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

DATA_URI_RE = re.compile(r"^data:image/([a-zA-Z0-9+.-]+);base64,(.+)$", re.DOTALL)
BARE_B64_HINT = re.compile(r"^[A-Za-z0-9+/=]{256,}$")


def _is_http(s: str) -> bool:
    return isinstance(s, str) and s.startswith(("http://", "https://"))


def _maybe_decode(s: str) -> Optional[bytes]:
    """Return decoded bytes if `s` looks like base64 image data, else None."""
    if not isinstance(s, str) or not s:
        return None
    m = DATA_URI_RE.match(s)
    if m:
        try:
            return base64.b64decode(m.group(2), validate=False)
        except Exception:
            return None
    # Bare base64 (no data: prefix) — only attempt if it's a single long line
    if "\n" not in s and BARE_B64_HINT.match(s):
        try:
            return base64.b64decode(s, validate=False)
        except Exception:
            return None
    return None


async def _migrate_products(db, cloudinary_service, stats: dict) -> None:
    cursor = db.products.find({}, {"_id": 0, "id": 1, "merchant_id": 1, "image": 1, "images": 1, "image_public_id": 1, "image_public_ids": 1})
    async for p in cursor:
        stats["products_scanned"] += 1
        pid = p.get("id")
        owner = p.get("merchant_id") or "legacy"

        new_set: dict = {}
        unset: dict = {}

        # cover image
        cover = p.get("image") or ""
        decoded = _maybe_decode(cover)
        if decoded:
            try:
                up = await cloudinary_service.upload_bytes(decoded, "product", owner)
                new_set["image"] = up["image_url"]
                new_set["image_public_id"] = up["public_id"]
                stats["images_migrated"] += 1
                logger.info("PROD %s cover → %s", pid, up["public_id"])
            except Exception:
                stats["failures"] += 1
                logger.exception("PROD %s cover upload failed", pid)
                continue

        # carousel images
        carousel = p.get("images") or []
        if isinstance(carousel, list) and carousel:
            new_images, new_public_ids = [], []
            changed = False
            for img in carousel:
                d = _maybe_decode(img)
                if d:
                    try:
                        up = await cloudinary_service.upload_bytes(d, "product", owner)
                        new_images.append(up["image_url"])
                        new_public_ids.append(up["public_id"])
                        stats["images_migrated"] += 1
                        changed = True
                        logger.info("PROD %s carousel → %s", pid, up["public_id"])
                    except Exception:
                        stats["failures"] += 1
                        logger.exception("PROD %s carousel upload failed", pid)
                else:
                    # keep already-URL items as-is
                    new_images.append(img if _is_http(img) else "")
                    new_public_ids.append("")
            if changed:
                new_set["images"] = [u for u in new_images if u]
                new_set["image_public_ids"] = new_public_ids[: len(new_set["images"])]

        if new_set:
            await db.products.update_one({"id": pid}, {"$set": new_set, **({"$unset": unset} if unset else {})})


async def _migrate_stores(db, cloudinary_service, stats: dict) -> None:
    cursor = db.stores.find({}, {"_id": 0, "id": 1, "merchant_id": 1,
                                 "banner": 1, "banners": 1, "logo": 1,
                                 "banner_public_ids": 1, "logo_public_id": 1})
    async for s in cursor:
        stats["stores_scanned"] += 1
        sid = s.get("id")
        owner = s.get("merchant_id") or "legacy"
        new_set: dict = {}

        # logo
        logo = s.get("logo") or ""
        d = _maybe_decode(logo)
        if d:
            try:
                up = await cloudinary_service.upload_bytes(d, "store_logo", owner)
                new_set["logo"] = up["image_url"]
                new_set["logo_public_id"] = up["public_id"]
                stats["images_migrated"] += 1
                logger.info("STORE %s logo → %s", sid, up["public_id"])
            except Exception:
                stats["failures"] += 1
                logger.exception("STORE %s logo upload failed", sid)

        # primary banner
        banner = s.get("banner") or ""
        d = _maybe_decode(banner)
        if d:
            try:
                up = await cloudinary_service.upload_bytes(d, "store_banner", owner)
                new_set["banner"] = up["image_url"]
                stats["images_migrated"] += 1
                logger.info("STORE %s banner → %s", sid, up["public_id"])
            except Exception:
                stats["failures"] += 1
                logger.exception("STORE %s banner upload failed", sid)

        # banner array
        banners = s.get("banners") or []
        if isinstance(banners, list) and banners:
            new_b, new_b_ids = [], []
            changed = False
            for b in banners:
                d = _maybe_decode(b)
                if d:
                    try:
                        up = await cloudinary_service.upload_bytes(d, "store_banner", owner)
                        new_b.append(up["image_url"])
                        new_b_ids.append(up["public_id"])
                        stats["images_migrated"] += 1
                        changed = True
                    except Exception:
                        stats["failures"] += 1
                        logger.exception("STORE %s banner-list upload failed", sid)
                else:
                    new_b.append(b if _is_http(b) else "")
                    new_b_ids.append("")
            if changed:
                new_set["banners"] = [u for u in new_b if u]
                new_set["banner_public_ids"] = new_b_ids[: len(new_set["banners"])]

        if new_set:
            await db.stores.update_one({"id": sid}, {"$set": new_set})


async def up(db):
    """Run the migration. Called by /app/backend/migrations/run.py."""
    # Lazy-import so missing dotenv loading doesn't fail import-time.
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from services import cloudinary_service  # noqa: WPS433

    if not cloudinary_service.is_configured():
        raise RuntimeError(
            "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in .env first."
        )

    stats = {
        "products_scanned": 0,
        "stores_scanned": 0,
        "images_migrated": 0,
        "failures": 0,
    }
    t0 = time.time()
    print("Running 004_migrate_base64_to_cloudinary…")
    await _migrate_products(db, cloudinary_service, stats)
    await _migrate_stores(db, cloudinary_service, stats)
    dt = time.time() - t0
    print(
        "DONE 004 in {:.1f}s — products_scanned={} stores_scanned={} migrated={} failures={}".format(
            dt,
            stats["products_scanned"],
            stats["stores_scanned"],
            stats["images_migrated"],
            stats["failures"],
        )
    )
    # Return shape compatible with /app/backend/migrations/run.py summary printer
    # (expects dict[str, list[str]]).
    return {
        "summary": [
            f"products_scanned={stats['products_scanned']}",
            f"stores_scanned={stats['stores_scanned']}",
            f"images_migrated={stats['images_migrated']}",
            f"failures={stats['failures']}",
            f"elapsed_seconds={dt:.1f}",
        ],
    }
