"""Send the "Merchant Launch Nudge" WhatsApp template to an explicit,
admin-supplied list of merchant ids — a one-off campaign, not a general
bulk-messaging tool. Reuses the existing Gupshup wiring in
notifications.py (notify_merchant_launch_nudge -> send_with_fallback ->
GupshupProvider.send_whatsapp) — no new provider, queue, or database.

Requires GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE and NOTIFICATION_PROVIDER=
gupshup already configured (see backend/.env.example) — the script refuses
to send without them.

Safety model: dry run is the default. Every supplied merchant id is
resolved and validated (exists, has a usable phone number, has a name to
greet them with) BEFORE any message is sent — if any one is invalid, the
whole run aborts with nothing sent. Real transmission requires --send.

Usage, from the repo root:

    # Dry run (default) — shows who WOULD be messaged, sends nothing.
    python -m backend.scripts.send_merchant_launch_nudge \\
        --merchant-id ID1 --merchant-id ID2 --merchant-id ID3

    # Actually send.
    python -m backend.scripts.send_merchant_launch_nudge \\
        --merchant-id ID1 --merchant-id ID2 --merchant-id ID3 --send

Delivery/failure status after sending is tracked the same way every other
Gupshup send is: check the db.gupshup_notifications collection (filter by
notification_type="merchant_launch_nudge"), updated live by the existing
/api/webhooks/gupshup/inbound webhook.
"""
import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
import pymongo

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from notifications import notify_merchant_launch_nudge, _to_gupshup_mobile  # noqa: E402

DEFAULT_DELAY_SECONDS = 2.0


def _get_merchants_collection():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL/DB_NAME not configured — aborting.")
        sys.exit(1)
    client = pymongo.MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    return client[db_name].merchants


def _dedupe_preserving_order(ids):
    seen = set()
    out = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _resolve_and_validate(merchant_ids, coll):
    """Looks up every id and validates it has a usable phone + name.
    Returns (targets, errors) — targets is empty if errors is non-empty,
    since a partial send is never allowed."""
    docs = list(coll.find(
        {"id": {"$in": merchant_ids}},
        {"_id": 0, "id": 1, "owner_name": 1, "store_name": 1, "phone": 1},
    ))
    by_id = {d["id"]: d for d in docs}

    errors = []
    targets = []
    for mid in merchant_ids:
        doc = by_id.get(mid)
        if not doc:
            errors.append(f"{mid}: no merchant found with this id")
            continue
        phone = (doc.get("phone") or "").strip()
        mobile = _to_gupshup_mobile(phone) if phone else None
        if not mobile:
            errors.append(f"{mid}: no usable phone number (got {phone!r})")
            continue
        owner_name = (doc.get("owner_name") or "").strip() or (doc.get("store_name") or "").strip()
        if not owner_name:
            errors.append(f"{mid}: no owner_name or store_name to greet the merchant with")
            continue
        targets.append({
            "id": mid, "owner_name": owner_name,
            "store_name": doc.get("store_name", ""), "phone": phone,
        })

    if errors:
        return [], errors
    return targets, []


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Send the Merchant Launch Nudge WhatsApp template to an explicit list of merchants.")
    parser.add_argument("--merchant-id", action="append", dest="merchant_ids", required=True,
                         help="Merchant id to send to. Repeat for multiple merchants.")
    parser.add_argument("--send", action="store_true",
                         help="Actually send. Without this flag, only a dry-run preview is shown.")
    parser.add_argument("--delay-seconds", type=float, default=DEFAULT_DELAY_SECONDS,
                         help=f"Delay between sends, in seconds (default: {DEFAULT_DELAY_SECONDS}).")
    args = parser.parse_args()

    merchant_ids = _dedupe_preserving_order(args.merchant_ids)
    coll = _get_merchants_collection()
    targets, errors = _resolve_and_validate(merchant_ids, coll)

    if errors:
        print(f"VALIDATION FAILED for {len(errors)} of {len(merchant_ids)} supplied merchant id(s) "
              f"— nothing was sent:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"Merchant Launch Nudge — {len(targets)} merchant(s) would be messaged:")
    for t in targets:
        print(f"  {t['id']}  owner={t['owner_name']!r}  store={t['store_name']!r}  phone={t['phone']}")

    if not args.send:
        print("\nDRY RUN — no messages sent. Re-run with --send to actually send.")
        return 0

    if (os.environ.get("NOTIFICATION_PROVIDER") or "").strip().lower() != "gupshup":
        print("\nNOTIFICATION_PROVIDER is not 'gupshup' in this environment — refusing to send "
              "(this campaign requires the approved Gupshup template path).")
        return 1
    if not (os.environ.get("GUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE") or "").strip():
        print("\nGUPSHUP_TEMPLATE_MERCHANT_LAUNCH_NUDGE is not set — refusing to send.")
        return 1

    print(f"\nSENDING to {len(targets)} merchant(s), {args.delay_seconds}s delay between sends...")
    failures = []
    for i, t in enumerate(targets):
        result = notify_merchant_launch_nudge(t["phone"], t["owner_name"])
        status = "OK" if result == "whatsapp" else "FAILED"
        print(f"  [{i + 1}/{len(targets)}] {t['id']} ({t['phone']}) -> {status}")
        if result != "whatsapp":
            failures.append(t["id"])
        if i < len(targets) - 1:
            time.sleep(args.delay_seconds)

    print(f"\nDone. {len(targets) - len(failures)} succeeded, {len(failures)} failed.")
    if failures:
        print("Failed merchant ids:", ", ".join(failures))
        print("Check application logs and the gupshup_notifications collection for details.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
