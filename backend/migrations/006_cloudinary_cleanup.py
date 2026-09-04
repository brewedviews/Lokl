"""Cloudinary test-asset cleanup.

Deletes every resource under the `lokl/products/`, `lokl/stores/`, and
`lokl/banners/` folders (test data left from pre-launch iterations).

EXPLICITLY PRESERVES `lokl/kyc/` — those are real merchant documents that
must never be wiped programmatically.

Usage:
    cd /app/backend && python -m migrations.006_cloudinary_cleanup --dry-run
    cd /app/backend && CLOUDINARY_CLEANUP_CONFIRM=I-UNDERSTAND-THIS-PERMANENTLY-DELETES-CLOUDINARY-ASSETS \\
        python -m migrations.006_cloudinary_cleanup --force

A real (non-dry-run) delete requires BOTH --force AND the
CLOUDINARY_CLEANUP_CONFIRM env var set to the exact value above (2026-09
incident hardening — see _require_explicit_destructive_confirmation()).
Refuses unconditionally unless the environment is positively confirmed
non-production (see _refuse_if_production()) — an unrecognized or missing
environment refuses exactly like production.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import cloudinary
import cloudinary.api

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import environment  # noqa: E402


PREFIXES_TO_DELETE = ["lokl/products", "lokl/stores", "lokl/banners", "lokl/cms"]
PRESERVE_PREFIXES = ["lokl/kyc"]  # safety net — never touch these

# Second, independent confirmation (2026-09 incident hardening) — required
# IN ADDITION to --force for a real (non-dry-run) delete. --force alone is
# too easy to pass out of habit; this env var is not something any normal
# application configuration would ever set, so setting it requires a human
# to have deliberately typed this exact string immediately before running
# the command — never persisted in any .env file or Railway config.
DESTRUCTIVE_CONFIRM_ENV_VAR = "CLOUDINARY_CLEANUP_CONFIRM"
DESTRUCTIVE_CONFIRM_VALUE = "I-UNDERSTAND-THIS-PERMANENTLY-DELETES-CLOUDINARY-ASSETS"


def _refuse_if_production() -> None:
    """Production guard (incident fix, hardened 2026-09 — this is the
    LEADING HYPOTHESIS, not a confirmed cause, for the 2026-09 production
    image-loss incident: see the incident audit). This script deletes
    every resource under folders that also hold LIVE merchant/customer
    images in production — it was written as a one-shot pre-launch
    cleanup, but nothing ever stopped it from being run against a live
    environment.

    Previously checked a bare `ENVIRONMENT` variable, which real Railway
    production never sets — so this guard silently did nothing in the one
    place it mattered. Now delegates to environment.py's
    `is_confirmed_non_production()`, which requires a POSITIVE
    identification of a real non-production environment (Railway's own
    `RAILWAY_ENVIRONMENT_NAME`, or the legacy `ENVIRONMENT` convention as a
    fallback) — an unrecognized or missing environment is refused exactly
    like production, never silently treated as safe.

    This check is unconditional and runs before any flag parsing, so
    `--force` cannot bypass it; there is no override. If this check is
    ever wrong, the fix is to correct the environment configuration, not
    to bypass this."""
    if not environment.is_confirmed_non_production():
        env_name = environment.get_environment_name() or "unknown"
        raise SystemExit(
            f"REFUSING TO RUN: environment is 'production' or could not be "
            f"positively confirmed as non-production (detected: '{env_name}').\n"
            "This script permanently deletes Cloudinary assets under "
            f"{PREFIXES_TO_DELETE} — folders that hold LIVE product/store/banner "
            "images in production. It exists only for pre-launch test-data cleanup "
            "and must never run unless the environment is explicitly known to be "
            "safe. This is not something to override; if this check is firing "
            "incorrectly, fix the environment configuration instead."
        )


def _require_explicit_destructive_confirmation() -> None:
    """Second confirmation gate, checked only for a real (non-dry-run)
    delete — see DESTRUCTIVE_CONFIRM_ENV_VAR's own comment for why this
    exists in addition to --force and _refuse_if_production()."""
    if os.environ.get(DESTRUCTIVE_CONFIRM_ENV_VAR) != DESTRUCTIVE_CONFIRM_VALUE:
        raise SystemExit(
            "REFUSING TO RUN: --force alone is not enough for this destructive "
            f"cleanup. Set {DESTRUCTIVE_CONFIRM_ENV_VAR}={DESTRUCTIVE_CONFIRM_VALUE} "
            "(exactly, as a one-off for this invocation only — never persist it in "
            "any .env file or deployment config) to confirm you understand this "
            "permanently deletes Cloudinary assets."
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

    if not dry_run:
        _require_explicit_destructive_confirmation()  # second gate — see its own comment

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
