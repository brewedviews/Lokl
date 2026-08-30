"""Read-only image-integrity audit (image reliability incident).

Scans MongoDB for structural signs of the two root causes found in the
audit — parallel-array misalignment (`images[]` vs `image_public_ids[]`)
and legacy/never-migrated image data — across products, stores, hero
slides (banners), categories, and brands.

STRICTLY READ-ONLY:
  - Every Mongo call in this file is `find`/`find_one`/`count_documents`.
    There is no `update_one`, `update_many`, `delete_one`, or `$set`
    anywhere in this module.
  - This module never imports `cloudinary` or `services.cloudinary_service`
    and makes zero network calls to Cloudinary — it only reasons about
    what's already stored in MongoDB.
  - Safe to run against production for exactly this reason.

Usage:
    cd /app/backend && python -m scripts.image_integrity_audit [--out report.json]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Same base64/data-URI detection convention as migration 004 — reused here
# purely to RECOGNIZE legacy-never-migrated data, never to touch it.
_DATA_URI_RE = re.compile(r"^data:image/([a-zA-Z0-9+.-]+);base64,", re.DOTALL)
_BARE_B64_HINT = re.compile(r"^[A-Za-z0-9+/=]{256,}$")


def _is_http(s) -> bool:
    return isinstance(s, str) and s.startswith(("http://", "https://"))


def _looks_like_base64_blob(s) -> bool:
    if not isinstance(s, str) or not s:
        return False
    if _DATA_URI_RE.match(s):
        return True
    return "\n" not in s and bool(_BARE_B64_HINT.match(s))


def _is_malformed_url(s) -> bool:
    """Empty, non-string, or present-but-not-a-URL (base64 blob or
    otherwise) — anything an <img src> would fail to render as a real
    remote image."""
    if s is None:
        return False  # absent is a different bucket (missing), not malformed
    if not isinstance(s, str) or not s.strip():
        return True
    return not _is_http(s)


def _audit_products(rows: list[dict], global_public_id_owners: dict) -> dict:
    scanned = len(rows)
    unhealthy: set[str] = set()
    buckets = {
        "array_length_mismatch": [], "missing_public_ids": [], "malformed_urls": [],
        "legacy_base64": [], "legacy_structure": [], "duplicate_public_ids_within_product": [],
        "cover_desync": [],
    }

    for p in rows:
        pid = p.get("id") or str(p.get("_id"))
        image = p.get("image") or ""
        image_public_id = p.get("image_public_id") or ""
        images = p.get("images") if isinstance(p.get("images"), list) else None
        public_ids = p.get("image_public_ids") if isinstance(p.get("image_public_ids"), list) else None

        # Legacy structure: pre-carousel schema — only the singular cover
        # fields exist at all, no arrays ever populated.
        if images is None and public_ids is None:
            buckets["legacy_structure"].append(pid)
            unhealthy.add(pid)

        images = images or []
        public_ids = public_ids or []

        if len(images) != len(public_ids):
            buckets["array_length_mismatch"].append(pid)
            unhealthy.add(pid)

        if _looks_like_base64_blob(image) or any(_looks_like_base64_blob(u) for u in images):
            buckets["legacy_base64"].append(pid)
            unhealthy.add(pid)

        if _is_malformed_url(image) or any(_is_malformed_url(u) for u in images):
            buckets["malformed_urls"].append(pid)
            unhealthy.add(pid)

        missing_pid = (image and not image_public_id) or any(
            (u and not u2) for u, u2 in zip(images, public_ids + [""] * max(0, len(images) - len(public_ids)))
        )
        if missing_pid or (images and not public_ids):
            buckets["missing_public_ids"].append(pid)
            unhealthy.add(pid)

        all_pids_this_product = [x for x in ([image_public_id] + public_ids) if x]
        if len(all_pids_this_product) != len(set(all_pids_this_product)):
            buckets["duplicate_public_ids_within_product"].append(pid)
            unhealthy.add(pid)
        for x in set(all_pids_this_product):
            global_public_id_owners[x].append(("product", pid))

        if (len(images) == len(public_ids) and images and public_ids
                and image and image_public_id
                and (image != images[0] or image_public_id != public_ids[0])):
            buckets["cover_desync"].append(pid)
            unhealthy.add(pid)

    return {
        "scanned": scanned,
        "healthy": scanned - len(unhealthy),
        "issues": {k: {"count": len(v), "ids": v[:20], "truncated": len(v) > 20} for k, v in buckets.items()},
    }


def _audit_stores(rows: list[dict], global_public_id_owners: dict) -> dict:
    scanned = len(rows)
    unhealthy: set[str] = set()
    buckets = {
        "array_length_mismatch": [], "missing_public_ids": [], "malformed_urls": [],
        "legacy_base64": [], "duplicate_public_ids_within_store": [],
    }
    for s in rows:
        sid = s.get("id") or str(s.get("_id"))
        logo, logo_pid = s.get("logo") or "", s.get("logo_public_id") or ""
        banners = s.get("banners") if isinstance(s.get("banners"), list) else []
        banner_pids = s.get("banner_public_ids") if isinstance(s.get("banner_public_ids"), list) else []

        if len(banners) != len(banner_pids):
            buckets["array_length_mismatch"].append(sid)
            unhealthy.add(sid)
        if _looks_like_base64_blob(logo) or any(_looks_like_base64_blob(u) for u in banners):
            buckets["legacy_base64"].append(sid)
            unhealthy.add(sid)
        if _is_malformed_url(logo) or any(_is_malformed_url(u) for u in banners):
            buckets["malformed_urls"].append(sid)
            unhealthy.add(sid)
        if (logo and not logo_pid) or (banners and not banner_pids):
            buckets["missing_public_ids"].append(sid)
            unhealthy.add(sid)

        all_pids = [x for x in ([logo_pid] + banner_pids) if x]
        if len(all_pids) != len(set(all_pids)):
            buckets["duplicate_public_ids_within_store"].append(sid)
            unhealthy.add(sid)
        for x in set(all_pids):
            global_public_id_owners[x].append(("store", sid))

    return {
        "scanned": scanned,
        "healthy": scanned - len(unhealthy),
        "issues": {k: {"count": len(v), "ids": v[:20], "truncated": len(v) > 20} for k, v in buckets.items()},
    }


def _audit_singular_image_collection(rows: list[dict], global_public_id_owners: dict,
                                      owner_label: str, id_field: str = "id",
                                      image_field: str = "image", public_id_field: str = "image_public_id") -> dict:
    """Shared shape for collections that carry ONE image + one public_id
    per doc (hero_slides/banners, brands) — no arrays involved."""
    scanned = len(rows)
    unhealthy: set[str] = set()
    buckets = {"missing_public_id": [], "malformed_url": [], "legacy_base64": [], "no_public_id_field_tracked": []}
    for r in rows:
        rid = r.get(id_field) or str(r.get("_id"))
        img = r.get(image_field) or ""
        pid = r.get(public_id_field)
        if pid is None and img:
            # Schema doesn't track a public_id for this collection at all
            # (e.g. categories today) — informational, not itself a defect.
            buckets["no_public_id_field_tracked"].append(rid)
            continue
        pid = pid or ""
        if _looks_like_base64_blob(img):
            buckets["legacy_base64"].append(rid)
            unhealthy.add(rid)
        if _is_malformed_url(img):
            buckets["malformed_url"].append(rid)
            unhealthy.add(rid)
        if img and not pid:
            buckets["missing_public_id"].append(rid)
            unhealthy.add(rid)
        if pid:
            global_public_id_owners[pid].append((owner_label, rid))

    return {
        "scanned": scanned,
        "healthy": scanned - len(unhealthy),
        "issues": {k: {"count": len(v), "ids": v[:20], "truncated": len(v) > 20} for k, v in buckets.items()},
    }


async def run_audit(db) -> dict:
    global_public_id_owners: dict[str, list] = defaultdict(list)

    products = await db.products.find(
        {}, {"_id": 0, "id": 1, "image": 1, "image_public_id": 1, "images": 1, "image_public_ids": 1}
    ).to_list(None)
    stores = await db.stores.find(
        {}, {"_id": 0, "id": 1, "logo": 1, "logo_public_id": 1, "banners": 1, "banner_public_ids": 1}
    ).to_list(None)
    hero_slides = await db.hero_slides.find(
        {}, {"_id": 0, "id": 1, "image": 1, "image_public_id": 1}
    ).to_list(None) if "hero_slides" in await db.list_collection_names() else []
    categories = await db.categories.find(
        {}, {"_id": 0, "id": 1, "image": 1}
    ).to_list(None) if "categories" in await db.list_collection_names() else []
    brands = await db.brands.find(
        {}, {"_id": 0, "id": 1, "logo": 1, "logo_public_id": 1}
    ).to_list(None) if "brands" in await db.list_collection_names() else []

    report = {
        "products": _audit_products(products, global_public_id_owners),
        "stores": _audit_stores(stores, global_public_id_owners),
        "banners_hero_slides": _audit_singular_image_collection(hero_slides, global_public_id_owners, "hero_slide"),
        "categories": _audit_singular_image_collection(
            categories, global_public_id_owners, "category", public_id_field="image_public_id"
        ),
        "brands": _audit_singular_image_collection(
            brands, global_public_id_owners, "brand", image_field="logo", public_id_field="logo_public_id"
        ),
    }

    cross_collection_duplicates = {
        pid: owners for pid, owners in global_public_id_owners.items() if len(set(owners)) > 1
    }
    report["cross_collection_duplicate_public_ids"] = {
        "count": len(cross_collection_duplicates),
        "examples": dict(list(cross_collection_duplicates.items())[:20]),
        "truncated": len(cross_collection_duplicates) > 20,
    }
    return report


def _print_console_summary(report: dict) -> None:
    p, s, b, c, br = (report["products"], report["stores"], report["banners_hero_slides"],
                      report["categories"], report["brands"])

    def fmt(n: int) -> str:
        return f"{n:,}"

    print(f"Products scanned: {fmt(p['scanned'])}")
    print(f"  Healthy: {fmt(p['healthy'])}")
    for k, v in p["issues"].items():
        print(f"  {k.replace('_', ' ').capitalize()}: {fmt(v['count'])}")
    print()
    print(f"Stores scanned: {fmt(s['scanned'])}")
    print(f"  Healthy: {fmt(s['healthy'])}")
    for k, v in s["issues"].items():
        print(f"  {k.replace('_', ' ').capitalize()}: {fmt(v['count'])}")
    print()
    print(f"Banner (hero slide) images scanned: {fmt(b['scanned'])}  |  issues: "
          f"{fmt(sum(v['count'] for k, v in b['issues'].items() if k != 'no_public_id_field_tracked'))}")
    print(f"Category images scanned: {fmt(c['scanned'])}  |  issues: "
          f"{fmt(sum(v['count'] for k, v in c['issues'].items() if k != 'no_public_id_field_tracked'))}"
          f"  (no_public_id_field_tracked: {fmt(c['issues']['no_public_id_field_tracked']['count'])}, informational)")
    print(f"Brand logos scanned: {fmt(br['scanned'])}  |  issues: "
          f"{fmt(sum(v['count'] for k, v in br['issues'].items() if k != 'no_public_id_field_tracked'))}")
    print()
    dup = report["cross_collection_duplicate_public_ids"]
    print(f"Cross-collection duplicate public_ids (same Cloudinary asset referenced by >1 record): {fmt(dup['count'])}")


async def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", help="Optional path to also write the full JSON report to.")
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    try:
        print(f"Image integrity audit — read-only — target: {db_name}\n")
        report = await run_audit(db)
        _print_console_summary(report)
        print("\n--- full JSON report ---")
        print(json.dumps(report, indent=2))
        if args.out:
            Path(args.out).write_text(json.dumps(report, indent=2))
            print(f"\nJSON report written to {args.out}")
    finally:
        client.close()


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    asyncio.run(_main())
