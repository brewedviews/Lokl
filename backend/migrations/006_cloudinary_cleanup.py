"""Cloudinary test-asset cleanup.

Deletes every resource under the `lokl/products/`, `lokl/stores/`, and
`lokl/banners/` folders (test data left from pre-launch iterations).

EXPLICITLY PRESERVES `lokl/kyc/` — those are real merchant documents that
must never be wiped programmatically.

Usage:
    cd /app/backend && python -m migrations.006_cloudinary_cleanup [--dry-run]
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import cloudinary
import cloudinary.api


PREFIXES_TO_DELETE = ["lokl/products", "lokl/stores", "lokl/banners", "lokl/cms"]
PRESERVE_PREFIXES = ["lokl/kyc"]  # safety net — never touch these


def _refuse_if_production() -> None:
    """Production guard (incident fix). This script deletes every resource
    under folders that also hold LIVE merchant/customer images in
    production — it was written as a one-shot pre-launch cleanup, but
    nothing ever stopped it from being run against a live environment.
    Checked using the SAME `ENVIRONMENT` convention server.py's
    `_IS_PRODUCTION` already uses — not a new convention. This check is
    unconditional and runs before any flag parsing, so `--force` cannot
    bypass it; there is no override. If this check is ever wrong, the fix
    is to correct the environment configuration, not to bypass this."""
    env = (os.environ.get("ENVIRONMENT") or "").strip().lower()
    if env == "production":
        raise SystemExit(
            "REFUSING TO RUN: ENVIRONMENT=production.\n"
            "This script permanently deletes Cloudinary assets under "
            f"{PREFIXES_TO_DELETE} — folders that hold LIVE product/store/banner "
            "images in production. It exists only for pre-launch test-data cleanup "
            "and must never run against a production environment. This is not "
            "something to override; if this check is firing incorrectly, fix the "
            "environment configuration instead."
        )


def _configure():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    cloudinary.config(
        cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
        api_key=os.environ["CLOUDINARY_API_KEY"],
        api_secret=os.environ["CLOUDINARY_API_SECRET"],
        secure=True,
    )


def _list_prefix(prefix: str) -> list[str]:
    """Return all public_ids under a given prefix (paginates through cursors)."""
    public_ids: list[str] = []
    next_cursor = None
    while True:
        resp = cloudinary.api.resources(
            type="upload",
            prefix=prefix,
            max_results=500,
            next_cursor=next_cursor,
        )
        for r in resp.get("resources", []):
            pid = r.get("public_id")
            if not pid:
                continue
            if any(pid.startswith(p) for p in PRESERVE_PREFIXES):
                continue  # paranoia — should never match, prefix-filter excludes them
            public_ids.append(pid)
        next_cursor = resp.get("next_cursor")
        if not next_cursor:
            break
    return public_ids


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    _refuse_if_production()  # unconditional — checked before any flag, no bypass

    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv or "--yes" in sys.argv
    _configure()

    if not dry_run and not force:
        print("ERROR: destructive run requires --force (or use --dry-run first).")
        print("       Example: python -m migrations.006_cloudinary_cleanup --force")
        sys.exit(2)

    grand_total = 0
    for prefix in PREFIXES_TO_DELETE:
        pids = _list_prefix(prefix)
        print(f"[{prefix}] found {len(pids)} resources")
        if not pids:
            continue
        if dry_run:
            for pid in pids[:20]:
                print(f"  would delete: {pid}")
            if len(pids) > 20:
                print(f"  …and {len(pids) - 20} more")
            grand_total += len(pids)
            continue
        # Cloudinary delete_resources accepts up to 100 ids per call.
        for i in range(0, len(pids), 100):
            batch = pids[i:i + 100]
            resp = cloudinary.api.delete_resources(batch)
            deleted = sum(1 for v in resp.get("deleted", {}).values() if v == "deleted")
            print(f"  deleted {deleted}/{len(batch)} (batch {i // 100 + 1})")
            grand_total += deleted

    print(f"\n{'DRY RUN — ' if dry_run else ''}Total: {grand_total} resources "
          f"{'would be' if dry_run else 'were'} deleted across {PREFIXES_TO_DELETE}.")
    print(f"Preserved folders: {PRESERVE_PREFIXES}")


if __name__ == "__main__":
    main()
