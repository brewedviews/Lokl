"""Migration 024 — Phase G7: seed the Marketplace Home's own hero slide.

Context: G7 splits "/" (Marketplace Home) from "/c/[slug]" (L1 Shopping
Home) into two genuinely separate section compositions — see
MarketplaceHomeClient.tsx / L1PageClient.tsx's own top comments. The
Marketplace Home needs its own gender-neutral hero-slide feed, decoupled
from Women's (before G7, "/" literally rendered Women's hero feed under
an l1Id="l1-women" call). Rather than move the existing Women slide
(hero-women-welcome-001) — which would blank out /c/women's own hero —
this seeds a NEW slide under the "global" sentinel id (added to
admin_create_hero_slide's own allow-list in server.py) with the exact
same content the Women slide already carries, since G6 already wrote the
correct marketplace message there ("Bhilai's own neighbourhood shopping
app.") — duplicating it, not moving it, so /c/women's hero is completely
unaffected (zero regression) while "/" gets a feed of its own that can
never accidentally pick up a future Women-specific slide.

Idempotent: a fixed known id (hero-global-welcome-001), insert-if-not-
exists — safe to re-run.
"""
from datetime import datetime, timezone

VERSION = "024_g7_marketplace_home"

SLIDE_ID = "hero-global-welcome-001"
SOURCE_SLIDE_ID = "hero-women-welcome-001"

# Fallback content, used only if the source Women slide is somehow
# missing (fresh/partial environment) — same content G6 wrote there.
_FALLBACK = {
    "image": "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    "eyebrow": "Serving Bhilai",
    "headline": "Bhilai's own neighbourhood shopping app.",
    "subheadline": "Shop from trusted stores around you.",
    "highlight_text": "neighbourhood shopping app",
    "cta_link": "",
}


async def up(db) -> dict:
    existing = await db.hero_slides.find_one({"id": SLIDE_ID}, {"_id": 0})
    if existing:
        return {"status": f"{SLIDE_ID} already exists — nothing to do"}

    source = await db.hero_slides.find_one({"id": SOURCE_SLIDE_ID}, {"_id": 0})
    content = {
        "image": (source or {}).get("image") or _FALLBACK["image"],
        "eyebrow": (source or {}).get("eyebrow") or _FALLBACK["eyebrow"],
        "headline": (source or {}).get("headline") or _FALLBACK["headline"],
        "subheadline": (source or {}).get("subheadline") or _FALLBACK["subheadline"],
        "highlight_text": (source or {}).get("highlight_text") or _FALLBACK["highlight_text"],
        "cta_link": (source or {}).get("cta_link") or _FALLBACK["cta_link"],
    }

    now = datetime.now(timezone.utc).isoformat()
    await db.hero_slides.insert_one({
        "id": SLIDE_ID,
        "l1_id": "global",
        "image": content["image"],
        "image_public_id": "",
        "eyebrow": content["eyebrow"],
        "headline": content["headline"],
        "subheadline": content["subheadline"],
        "highlight_text": content["highlight_text"],
        "cta_link": content["cta_link"],
        "active": True,
        "order": 1,
        "created_at": now,
        "updated_at": now,
    })
    return {"status": "created", "slide_id": SLIDE_ID, "copied_from": SOURCE_SLIDE_ID if source else "fallback"}
