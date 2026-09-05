"""RETIRED — Cloudinary prefix-based bulk cleanup.

Kept in the tree only for history/audit continuity — `--force` no longer
exists, `--dry-run` no longer exists, no environment variable of any kind
re-enables the old behavior. `main()` unconditionally refuses.

This script's bulk `cloudinary.api.delete_resources` sweep across an entire
folder (`lokl/products`, `lokl/stores`, `lokl/banners`, `lokl/cms`), gated
only by an `ENVIRONMENT` variable check that real Railway production never
satisfied, is the leading hypothesis for the 2026-09 production Cloudinary
asset-loss incident (see the incident's forensic report). `950ae1b` added a
guard to this exact deletion sweep; `ee6f478` hardened that guard further —
neither removed the sweep itself, so the underlying capability (a normal,
callable path from a bare folder name to a bulk delete) remained one
mis-set environment variable away from repeating the incident. Phase 9 of
the incident remediation removes that capability outright rather than
adding a third guard around it.

There is no bulk-prefix-delete replacement, by design: `PREFIXES_TO_DELETE`
folders hold live production data now (they did not when this script was
written as a one-shot pre-launch cleanup) and always will going forward —
"delete everything under this folder" is no longer a legitimate operation
against this Cloudinary account. Anyone who needs to remove ONE specific,
confirmed-unreferenced, explicitly-abandoned asset should use
`services/cloudinary_safety.safe_delete_asset()` instead — it operates on
exactly one public_id, requires a live cross-collection reference check to
come back clean, requires the asset to be tracked as abandoned past a
retention window, writes an append-only audit trail, and (like this file)
refuses unconditionally in production.
"""


def main():
    raise SystemExit(
        "RETIRED: this script's bulk Cloudinary prefix-deletion capability has been "
        "permanently removed (2026-09 incident remediation, Phase 9) — see this "
        "module's own docstring. There is no flag or environment variable that "
        "re-enables it. To delete one specific, already-confirmed-abandoned Cloudinary "
        "asset, use services.cloudinary_safety.safe_delete_asset() instead — it never "
        "accepts a prefix, always checks live references first, and never runs in "
        "production."
    )


if __name__ == "__main__":
    main()
