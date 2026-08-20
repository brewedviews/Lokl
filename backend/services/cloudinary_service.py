"""Cloudinary image storage service.

Single source of truth for all uploads (product images, store logos/banners,
KYC docs). Mongo stores only `{image_url, public_id}` — no base64 blobs.
"""
import os
import re
import uuid
import logging
from typing import Optional
import cloudinary
import cloudinary.uploader
import cloudinary.api
import cloudinary.utils
import httpx
from fastapi import UploadFile, HTTPException

logger = logging.getLogger(__name__)

cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
    secure=True,
)

FOLDER_MAP = {
    "product": "lokl/products",
    "store_logo": "lokl/stores",
    "store_banner": "lokl/banners",
    "kyc": "lokl/kyc",
    "cms": "lokl/cms",
    "brand_logo": "lokl/brands",
}

ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def is_configured() -> bool:
    return bool(os.environ.get("CLOUDINARY_CLOUD_NAME"))


async def upload_image(file: UploadFile, asset_type: str, owner_id: str) -> dict:
    """Upload a user-provided image to Cloudinary.

    KYC assets are uploaded as `type=private`, so the resulting URL is not
    directly accessible — callers must use `signed_kyc_url()` to render them.
    All other assets are public.
    """
    if asset_type not in FOLDER_MAP:
        raise HTTPException(400, f"Unknown asset_type: {asset_type}")
    if not is_configured():
        raise HTTPException(500, "Cloudinary not configured")
    if not file or not file.filename:
        raise HTTPException(400, "No file provided")
    if file.content_type not in ALLOWED_MIMES:
        raise HTTPException(400, "Only JPEG, PNG and WebP images are allowed")
    contents = await file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(400, f"File too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    if len(contents) == 0:
        raise HTTPException(400, "Empty file")

    public_id = None
    if asset_type == "kyc":
        safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", file.filename)
        public_id = f"{owner_id}/{uuid.uuid4().hex[:8]}_{safe_name}"
    return _do_upload(contents, asset_type, owner_id, public_id=public_id)


def _do_upload(contents: bytes, asset_type: str, owner_id: str, public_id: Optional[str] = None) -> dict:
    """Shared Cloudinary upload call — same folder/transformation options
    for every caller (browser file upload, base64 migration, and a
    source-provider's remote image URL alike), so there is exactly one
    place that decides how a product/store/kyc image gets stored."""
    folder = FOLDER_MAP[asset_type]
    options: dict = {
        "folder": folder,
        "resource_type": "image",
        "transformation": [{"quality": "auto", "fetch_format": "auto"}],
    }
    if asset_type == "kyc":
        options["type"] = "private"
        options["public_id"] = public_id or f"{owner_id}/{uuid.uuid4().hex}"
    else:
        options["transformation"].append({"width": 1600, "height": 1600, "crop": "limit"})

    try:
        result = cloudinary.uploader.upload(contents, **options)
    except Exception as e:
        logger.exception("Cloudinary upload failed")
        raise HTTPException(502, f"Image upload failed: {e}") from e

    return {
        "image_url": result.get("secure_url", ""),
        "public_id": result.get("public_id", ""),
        "width": result.get("width"),
        "height": result.get("height"),
        "bytes": result.get("bytes"),
        "format": result.get("format"),
    }


async def upload_image_from_url(source_url: str, asset_type: str, owner_id: str) -> dict:
    """Download an image from a source provider's own CDN (e.g. Shopify's
    product images) and re-upload it to Cloudinary through the exact same
    _do_upload() path every other product image goes through — a source
    provider's raw URL must never be stored directly as a product's
    image/images field. See _stage_source_item/_publish_staged_import in
    server.py: staged rows keep the raw source URL for the merchant's own
    review-screen preview (a plain <img>, no host restriction), but publish
    always calls this first so the resulting Product doc only ever holds a
    Cloudinary URL + public_id, same as a manually-uploaded photo.

    Raises HTTPException on any failure (network error, non-2xx, wrong
    content-type, oversized, or the Cloudinary upload itself failing) —
    publish should hard-fail rather than let a broken/foreign image URL
    through, matching the same "no publish with bad data" rule the category
    gate already enforces."""
    if not is_configured():
        raise HTTPException(500, "Cloudinary not configured")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(source_url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not download source image: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"Source image returned {r.status_code}")
    content_type = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_MIMES:
        raise HTTPException(400, f"Source image has an unsupported content type: {content_type or 'unknown'}")
    contents = r.content
    if len(contents) > MAX_BYTES:
        raise HTTPException(400, f"Source image too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    if len(contents) == 0:
        raise HTTPException(400, "Source image was empty")
    return _do_upload(contents, asset_type, owner_id)


async def upload_bytes(data: bytes, asset_type: str, owner_id: str, ext: str = "jpg") -> dict:
    """Server-side helper for the base64→Cloudinary migration script."""
    if asset_type not in FOLDER_MAP:
        raise ValueError(f"Unknown asset_type: {asset_type}")
    folder = FOLDER_MAP[asset_type]
    options: dict = {
        "folder": folder,
        "resource_type": "image",
        "transformation": [{"quality": "auto", "fetch_format": "auto"}],
    }
    if asset_type == "kyc":
        options["type"] = "private"
        options["public_id"] = f"{owner_id}/{uuid.uuid4().hex}"
    else:
        options["transformation"].append({"width": 1600, "height": 1600, "crop": "limit"})
        options["public_id"] = f"{owner_id}/{uuid.uuid4().hex}"
    result = cloudinary.uploader.upload(data, **options)
    return {
        "image_url": result.get("secure_url", ""),
        "public_id": result.get("public_id", ""),
    }


def delete_image(public_id: str, *, kyc: bool = False) -> bool:
    """Best-effort delete. Returns True on success or if asset already gone."""
    if not public_id:
        return True
    if not is_configured():
        return False
    try:
        opts = {"type": "private"} if kyc else {}
        result = cloudinary.uploader.destroy(public_id, **opts)
        return result.get("result") in ("ok", "not found")
    except Exception:
        logger.exception("Cloudinary delete failed for %s", public_id)
        return False


def signed_kyc_url(public_id: str, expires_in_seconds: int = 3600) -> Optional[str]:
    """Generate a signed URL for a private KYC document.

    Uses private_download_url which correctly handles expiry for private assets.
    Returns None on failure.
    """
    if not public_id or not is_configured():
        return None
    try:
        import time
        url = cloudinary.utils.private_download_url(
            public_id,
            "",
            resource_type="image",
            type="private",
            expiration_time=int(time.time()) + expires_in_seconds,
        )
        return url
    except Exception:
        logger.exception("Failed to sign KYC URL for %s", public_id)
        return None
