"""Migration 017 — seed the first HeroSlide doc (redesign Phase A).

Migrates forward the REAL, currently-live hero asset/copy — the "welcome"
slide from frontend/src/components/consumer/HeroCarousel.tsx's
DEFAULT_HERO_SLIDES[0] (id: "welcome") — into the new hero_slides
collection as Women's slide 1, rather than recreating placeholder content.

image_public_id is deliberately left empty: this asset was never uploaded
through Lokl's own Cloudinary account (it's an externally-hosted
customer-assets.emergentagent.com URL, predating the Cloudinary
migration) — same "no public_id for a non-Cloudinary URL" situation
several of seed_data.py's own Unsplash-sourced L1/L2 images are already
in. Not a bug to fix here; consistent with existing precedent elsewhere
in this codebase.

Idempotent: matches by a fixed `id` (hero-women-welcome-001, not the
uuid-based id scheme admin_create_hero_slide generates for new slides —
deliberately human-readable/stable so this migration is safe to re-run),
upsert with the image fields protected by $setOnInsert so an admin edit
made after this migration first runs is never clobbered by a later
re-run. `updated_at` is refreshed on every run (matches every other seed
constant in this codebase); the image fields and `created_at` are not.
"""
from datetime import datetime, timezone

VERSION = "017_seed_hero_slides"

SLIDE = {
    "id": "hero-women-welcome-001",
    "l1_id": "l1-women",
    "image": "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    "image_public_id": "",
    "eyebrow": "Serving Bhilai",
    "headline": "Delivered in minutes from stores next door.",
    "cta_link": "/products",
    "active": True,
    "order": 1,
}


async def up(db) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    non_image_fields = {k: v for k, v in SLIDE.items() if k not in ("image", "image_public_id")}
    result = await db.hero_slides.update_one(
        {"id": SLIDE["id"]},
        {
            "$set": {**non_image_fields, "updated_at": now},
            "$setOnInsert": {
                "image": SLIDE["image"],
                "image_public_id": SLIDE["image_public_id"],
                "created_at": now,
            },
        },
        upsert=True,
    )
    return {
        "status": "upserted",
        "matched": result.matched_count,
        "upserted_id": str(result.upserted_id) if result.upserted_id else None,
    }
