"""Migration 021 — Phase G3: add subheadline + highlight_text to Women's
seeded hero slide (hero-women-welcome-001).

Context: migration 017 seeded this slide with only the fields that
existed at the time (image/eyebrow/headline/cta_link). Phase G3 adds two
new optional HeroSlide fields — `subheadline` and `highlight_text` (see
HeroSlideCreate's own comment in server.py) — and this migration is the
one-time content update that puts real values into them for the one
slide that's actually live in production today, the same "targeted $set
by known id" pattern migration 016 used to clear band-premium's stale
image.

`headline` and `image` are left untouched: the existing headline
("Delivered in minutes from stores next door.") already contains the
phrase this migration highlights, and the existing image (the Bhilai
Globe Chowk roundabout — a real, recognizable local landmark, not a
generic stock photo) already satisfies G3's "Bhilai/cityscape background"
requirement; no other candidate image exists anywhere in the repo, so
there's nothing to swap it for.

`subheadline` reuses the exact copy already written for the (separate,
dormant) site-wide hero's own subtitle field — DEFAULT_HERO in this same
file — rather than inventing new marketing copy from scratch.

Idempotent: always sets the same target values, safe to re-run (though
the runner tracks it and won't). Only touches the one known slide id —
any other hero slide (other L1s, or a second Women's slide an admin adds
later) is untouched, and simply renders with these fields empty (blank
subheadline, whole headline in navy) until an admin fills them in via the
Hero Slides editor — same graceful-empty behavior every other optional
CMS field in this codebase already has.
"""
VERSION = "021_hero_slide_g3_content"

SLIDE_ID = "hero-women-welcome-001"
SUBHEADLINE = "Hand-picked fashion from trusted Bhilai stores."
HIGHLIGHT_TEXT = "in minutes"


async def up(db) -> dict:
    existing = await db.hero_slides.find_one({"id": SLIDE_ID}, {"_id": 0})
    if not existing:
        return {"status": f"{SLIDE_ID} not found — nothing to update (migration 017 should run first)"}

    await db.hero_slides.update_one(
        {"id": SLIDE_ID},
        {"$set": {"subheadline": SUBHEADLINE, "highlight_text": HIGHLIGHT_TEXT}},
    )
    return {
        "status": "updated",
        "slide_id": SLIDE_ID,
        "subheadline": SUBHEADLINE,
        "highlight_text": HIGHLIGHT_TEXT,
        "highlight_matches_headline": HIGHLIGHT_TEXT in (existing.get("headline") or ""),
    }
