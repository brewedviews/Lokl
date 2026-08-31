"""Migration 032 — reassign the ambiguous-gender subset of migration 031's
Beauty/Sports -> Women remap onto Men -> Accessories instead.

Context: migration 031 (L1 consolidation) moved every former Beauty/Sports
product to Women/Accessories using a blanket "unisex or missing gender
defaults to Women" rule. On review, that rule was flagged as exactly the
kind of silent guess it shouldn't have made for products with no real
gender signal at all (a cricket bat, a yoga mat, sunscreen) — the user
explicitly asked these NOT be silently resolved, audited them, and decided:
move this specific set to Men -> Accessories instead.

This is a narrow, explicit correction — NOT a re-run of 031's general
gender-based rule. It targets an EXPLICIT list of product ids (the exact
set identified in that audit: migration 031 already overwrote each
product's own l1_id, so "was this originally Beauty vs. Sports" is no
longer independently recoverable from the product doc itself — an id list
captured at audit time is the only reliable handle). The 3 Beauty products
with a clear `gender: "women"` are NOT in this list and are left exactly
where 031 put them (Women -> Accessories) — untouched, matching "do not
make any unrelated taxonomy changes."

Idempotent: each product is set to the same (l1_id, l2_id) regardless of
its current value, so re-running is always a safe no-op.
"""
from datetime import datetime, timezone

VERSION = "032_reassign_ambiguous_beauty_sports_products"

NOW = datetime.now(timezone.utc).isoformat()

# Captured from the post-031 audit — 2 unisex-gender former-Beauty products
# + all 6 gender-less former-Sports products. The 3 former-Beauty products
# with gender="women" (Vitamin C Serum, Matte Lipstick Set, Eyeshadow
# Palette) are deliberately NOT here.
_AMBIGUOUS_PRODUCT_IDS = [
    "prod-demo-858a295b",  # Hyaluronic Acid Moisturizer (gender: unisex)
    "prod-demo-14df7d1c",  # Sunscreen SPF 50 (gender: unisex)
    "prod-demo-52a90e00",  # Cricket Bat — English Willow (gender: missing)
    "prod-demo-9a7dff38",  # Football Match-grade (gender: missing)
    "prod-demo-432b5c48",  # Badminton Racquet Pack (gender: missing)
    "prod-demo-ae985bec",  # Yoga Mat 6mm (gender: missing)
    "prod-demo-75bd951e",  # Dumbbell Pair 5kg (gender: missing)
    "prod-demo-7b79f0a7",  # Cycling Helmet (gender: missing)
]

_TARGET_L1 = "l1-men"
_TARGET_L2 = "l2-men-accessories"


async def up(db) -> dict:
    report: list[str] = []
    for pid in _AMBIGUOUS_PRODUCT_IDS:
        existing = await db.products.find_one({"id": pid}, {"_id": 0, "id": 1, "name": 1, "l1_id": 1, "l2_id": 1})
        if not existing:
            report.append(f"{pid}: not found, skipped (already deleted or id changed)")
            continue
        if existing.get("l1_id") == _TARGET_L1 and existing.get("l2_id") == _TARGET_L2:
            report.append(f"{pid} ({existing.get('name')}): already {_TARGET_L1}/{_TARGET_L2}, no-op")
            continue
        await db.products.update_one(
            {"id": pid},
            {"$set": {"l1_id": _TARGET_L1, "l2_id": _TARGET_L2, "updated_at": NOW}},
        )
        report.append(f"{pid} ({existing.get('name')}): moved {existing.get('l1_id')}/{existing.get('l2_id')} -> {_TARGET_L1}/{_TARGET_L2}")
    return {"reassign_ambiguous_beauty_sports": report}
