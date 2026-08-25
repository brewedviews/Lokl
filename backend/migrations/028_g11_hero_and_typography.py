"""Migration 028 — Phase G11: hero copy correction.

G11 §8 explicitly requires the "Serving Bhilai" eyebrow removed from the
Marketplace hero and the generic Bhilai hero treatment, and the global
hero's highlighted phrase narrowed from "neighbourhood shopping app" to
just "shopping app." — only "shopping app." should render in orange,
"Bhilai's own neighbourhood" stays navy.

Two idempotent, guarded changes (same discipline as every prior content
fix this session — guarded on the OLD value still being present, so this
is a no-op if an admin has since edited a slide, not a silent overwrite):

1. Clear `eyebrow` on every hero slide that still says "Serving Bhilai"
   (global + all three L1 slides — G11 doesn't ask to change L1 heroes'
   headline/subheadline/image, only to drop this one shared eyebrow).
2. Narrow the global slide's `highlight_text` from "neighbourhood
   shopping app" to "shopping app." — L1 slides' own highlight_text
   values are untouched (each already highlights a different, correct
   phrase from G8/G9's own work).
"""
from datetime import datetime, timezone

VERSION = "028_g11_hero_and_typography"

OLD_EYEBROW = "Serving Bhilai"
GLOBAL_SLIDE_ID = "hero-global-welcome-001"
OLD_GLOBAL_HIGHLIGHT = "neighbourhood shopping app"
NEW_GLOBAL_HIGHLIGHT = "shopping app."


async def up(db) -> dict:
    report: dict = {}
    now = datetime.now(timezone.utc).isoformat()

    r1 = await db.hero_slides.update_many(
        {"eyebrow": OLD_EYEBROW},
        {"$set": {"eyebrow": "", "updated_at": now}},
    )
    report["eyebrow_cleared_count"] = r1.modified_count

    global_slide = await db.hero_slides.find_one({"id": GLOBAL_SLIDE_ID}, {"_id": 0, "highlight_text": 1})
    if global_slide and global_slide.get("highlight_text") == OLD_GLOBAL_HIGHLIGHT:
        await db.hero_slides.update_one(
            {"id": GLOBAL_SLIDE_ID},
            {"$set": {"highlight_text": NEW_GLOBAL_HIGHLIGHT, "updated_at": now}},
        )
        report[GLOBAL_SLIDE_ID] = "highlight_text narrowed to 'shopping app.'"
    else:
        report[GLOBAL_SLIDE_ID] = "left untouched (already customized or missing)"

    return report
