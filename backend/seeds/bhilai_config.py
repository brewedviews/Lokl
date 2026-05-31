"""Bhilai delivery config seed. Idempotent via upsert on city_slug."""
from datetime import datetime, timezone

BHILAI_CONFIG = {
    "city_slug": "bhilai",
    "city_name": "Bhilai",
    "state": "Chhattisgarh",
    "is_active": True,
    "currency": "INR",
    "max_delivery_radius_km": 15,
    "delivery_tiers": [
        {"tier_name": "local",    "min_km": 0,  "max_km": 2,  "base_fee": 20, "per_km_fee": 0,  "free_above_order_value": 299},
        {"tier_name": "nearby",   "min_km": 2,  "max_km": 5,  "base_fee": 30, "per_km_fee": 5,  "free_above_order_value": 499},
        {"tier_name": "extended", "min_km": 5,  "max_km": 10, "base_fee": 50, "per_km_fee": 8,  "free_above_order_value": 799},
        {"tier_name": "outer",    "min_km": 10, "max_km": 15, "base_fee": 80, "per_km_fee": 10, "free_above_order_value": 999},
    ],
    "eta_config": {
        "base_prep_minutes": 15,
        "per_km_minutes": 4,
        "peak_hours": ["12:00-14:00", "19:00-21:00"],
        "peak_multiplier": 1.4,
    },
}


async def up(db):
    now = datetime.now(timezone.utc).isoformat()
    doc = {**BHILAI_CONFIG, "updated_at": now}
    r = await db.delivery_config.update_one(
        {"city_slug": "bhilai"},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"seeded": [f"bhilai delivery_config (matched={r.matched_count}, upserted={r.upserted_id is not None})"]}
