"""Migration 029 — P0-5 (G20 product review): hero gradient becomes
configuration-driven instead of a scrim HeroCarousel.tsx applied
unconditionally to every slide on every surface.

Adds `gradient: bool` to every existing HeroSlide doc (new field, default
False) and explicitly sets it True on the one slide that's meant to keep
the scrim — the marketplace "globe" welcome slide (l1_id="global"). Every
L1 slide (women/men/kids) and any future additional marketplace slide
gets `gradient: False` by default, so:
  - L1 heroes render with no gradient (P0-5's explicit requirement).
  - A newly-added marketplace hero slide does NOT automatically inherit
    the globe hero's gradient — an admin has to opt it in.

Idempotent — `$set` on every doc is safe to re-run, and the globe-slide
branch only sets `gradient: True` on the one known id.
"""
from datetime import datetime, timezone

VERSION = "029_g20_hero_gradient_config"

GLOBAL_SLIDE_ID = "hero-global-welcome-001"


async def up(db) -> dict:
    report: dict = {}
    now = datetime.now(timezone.utc).isoformat()

    r1 = await db.hero_slides.update_many(
        {"gradient": {"$exists": False}},
        {"$set": {"gradient": False, "updated_at": now}},
    )
    report["gradient_field_backfilled_count"] = r1.modified_count

    r2 = await db.hero_slides.update_one(
        {"id": GLOBAL_SLIDE_ID},
        {"$set": {"gradient": True, "updated_at": now}},
    )
    report[GLOBAL_SLIDE_ID] = "gradient set True" if r2.modified_count else "not found / already set"

    return report
