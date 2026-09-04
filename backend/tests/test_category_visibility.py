"""Admin category visibility as a global invariant (2026-09).

Audit finding: `paused` (on db.categories for L1, db.subcategories for L2)
is the ONE existing admin visibility field — no second flag was created.
The backend was already almost entirely consistent about respecting it
(GET /categories, /categories/counts, _category_name_maps, WhatsApp's own
taxonomy fetch, and _validate_l1_l2 — the merchant/WhatsApp product-
creation gate — all independently filtered `paused` correctly already).
Two real gaps were found and fixed:

1. GET /categories/{l1_id}/l2 didn't check whether l1_id ITSELF was
   paused before returning its L2 children — a paused L1's still-
   individually-visible L2s were reachable if this endpoint was ever
   queried directly with that l1_id (no current caller actually does
   this, but it violated the "hidden parent hides children" rule
   GET /categories already encodes structurally).
2. frontend/src/components/consumer/CategoryTileRow.tsx (the persistent
   Women/Men/Kids nav strip) rendered a hardcoded PINNED_SLUGS tab even
   when the live /api/categories response didn't contain a match for
   it — the one place in the app that ignored admin visibility. Fixed
   to skip (render nothing) once the query has resolved and confirmed
   the slug isn't there; no automated frontend test framework exists in
   this repo (confirmed in earlier sessions), so that fix is verified by
   code review, not a test here.

This file is the backend regression suite for the global invariant,
covering every consumer that's supposed to respect `paused`: the two
listing endpoints, the canonical _active_l1_l2_ids() helper (which
_validate_l1_l2 — every merchant/admin/WhatsApp product-creation path —
already goes through), and _category_name_maps() (bulk-upload/VasyERP).

DB-backed, same asyncio.run()-per-test / conftest.py fixture convention
as the rest of this suite.

Run with: cd backend && python3 -m pytest tests/test_category_visibility.py -v
Requires a reachable MONGO_URL.
"""
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as srv


def _require_live_db():
    try:
        import pymongo
        pymongo.MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("ping")
    except Exception as e:
        pytest.skip(f"local MongoDB unreachable ({e}) — cannot run DB-backed tests in this environment")


async def _seed_l1(db, *, paused=False, order=50, name=None):
    l1_id = f"l1-cvtest-{uuid.uuid4().hex[:8]}"
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    await db.categories.insert_one({
        "id": l1_id, "name": name or f"Test L1 {l1_id[-6:]}", "order": order,
        "paused": paused, "image": "", "redirect_url": "", "created_at": now_iso,
    })
    return l1_id


async def _seed_l2(db, l1_id, *, paused=False, name=None):
    l2_id = f"l2-cvtest-{uuid.uuid4().hex[:8]}"
    await db.subcategories.insert_one({
        "id": l2_id, "l1_id": l1_id, "name": name or f"Test L2 {l2_id[-6:]}",
        "paused": paused, "image": "",
    })
    return l2_id


async def _cleanup(db, l1_ids=(), l2_ids=(), product_ids=()):
    for l1_id in l1_ids:
        await db.categories.delete_one({"id": l1_id})
    for l2_id in l2_ids:
        await db.subcategories.delete_one({"id": l2_id})
    for pid in product_ids:
        await db.products.delete_one({"id": pid})


class TestL1Visibility:
    def test_a_to_e_visible_hide_unhide_round_trip(self):
        """A-E: visible L1 appears everywhere a category API represents
        active taxonomy; admin hides it -> disappears from GET /categories,
        /categories/counts, AND _active_l1_l2_ids() (the exact check
        _validate_l1_l2 uses for every merchant/admin/WhatsApp product-
        creation path); admin unhides it -> reappears in all three."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            l1_id = await _seed_l1(db)
            try:
                # A — visible, appears everywhere.
                listing = await srv.list_categories()
                assert any(c["id"] == l1_id for c in listing), "visible L1 must appear in GET /categories"
                counts = await srv.categories_with_counts()
                assert any(c["id"] == l1_id for c in counts), "visible L1 must appear in /categories/counts"
                active_l1_ids, _ = await srv._active_l1_l2_ids()
                assert l1_id in active_l1_ids, "visible L1 must be in the canonical active-taxonomy set"
                l1_by_name, _, _ = await srv._category_name_maps()
                assert l1_id in l1_by_name.values(), "visible L1 must be selectable via bulk-upload/WhatsApp's own taxonomy map"

                # B — admin hides it.
                await srv.admin_update_category(l1_id, {"paused": True}, admin={"id": "test-admin"})

                # C — disappears from every active-taxonomy consumer.
                listing = await srv.list_categories()
                assert not any(c["id"] == l1_id for c in listing), "paused L1 must disappear from GET /categories"
                counts = await srv.categories_with_counts()
                assert not any(c["id"] == l1_id for c in counts), "paused L1 must disappear from /categories/counts"
                active_l1_ids, _ = await srv._active_l1_l2_ids()
                assert l1_id not in active_l1_ids, "paused L1 must leave the active-taxonomy set (blocks merchant/WhatsApp product creation against it)"
                l1_by_name, _, _ = await srv._category_name_maps()
                assert l1_id not in l1_by_name.values(), "paused L1 must not be selectable via bulk-upload/WhatsApp's taxonomy map"

                # D — admin unhides it.
                await srv.admin_update_category(l1_id, {"paused": False}, admin={"id": "test-admin"})

                # E — available again everywhere.
                listing = await srv.list_categories()
                assert any(c["id"] == l1_id for c in listing), "unpaused L1 must reappear in GET /categories"
                active_l1_ids, _ = await srv._active_l1_l2_ids()
                assert l1_id in active_l1_ids, "unpaused L1 must reappear in the active-taxonomy set"
            finally:
                await _cleanup(db, l1_ids=[l1_id])

        asyncio.run(_run())


class TestL2Visibility:
    def test_f_l2_hide_unhide_round_trip(self):
        """F: same round trip for an L2 — visible, hidden (disappears from
        GET /categories/{l1_id}/l2 and _active_l1_l2_ids' per-L1 set),
        sibling L2s and the parent L1 unaffected, unhide restores it."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            l1_id = await _seed_l1(db)
            l2_id = await _seed_l2(db, l1_id)
            sibling_l2_id = await _seed_l2(db, l1_id, name="Sibling L2")
            try:
                l2s = await srv.list_l2(l1_id)
                assert any(s["id"] == l2_id for s in l2s), "visible L2 must appear in GET /categories/{l1_id}/l2"
                _, active_l2_by_l1 = await srv._active_l1_l2_ids()
                assert l2_id in active_l2_by_l1.get(l1_id, set())

                await srv.admin_update_subcategory(l2_id, {"paused": True}, admin={"id": "test-admin"})

                l2s = await srv.list_l2(l1_id)
                assert not any(s["id"] == l2_id for s in l2s), "paused L2 must disappear from GET /categories/{l1_id}/l2"
                assert any(s["id"] == sibling_l2_id for s in l2s), "sibling L2 (still visible) must remain"
                _, active_l2_by_l1 = await srv._active_l1_l2_ids()
                assert l2_id not in active_l2_by_l1.get(l1_id, set())
                # Parent L1 itself is unaffected by hiding one of its children.
                listing = await srv.list_categories()
                assert any(c["id"] == l1_id for c in listing), "parent L1 must remain visible when only one child L2 is paused"

                await srv.admin_update_subcategory(l2_id, {"paused": False}, admin={"id": "test-admin"})
                l2s = await srv.list_l2(l1_id)
                assert any(s["id"] == l2_id for s in l2s), "unpaused L2 must reappear"
            finally:
                await _cleanup(db, l1_ids=[l1_id], l2_ids=[l2_id, sibling_l2_id])

        asyncio.run(_run())

    def test_g_hidden_parent_l1_hides_visible_child_l2(self):
        """G: the existing, already-encoded hierarchy rule — a hidden
        parent L1 hides its L2 children too, even when the L2 itself is
        NOT individually paused. Verified against both GET /categories
        (already correctly structural) and the newly-fixed
        GET /categories/{l1_id}/l2 (previously leaked this)."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            l1_id = await _seed_l1(db)
            l2_id = await _seed_l2(db, l1_id)  # L2 itself stays unpaused throughout
            try:
                # Sanity: before hiding the parent, the L2 is reachable both ways.
                listing = await srv.list_categories()
                l1_entry = next(c for c in listing if c["id"] == l1_id)
                assert any(s["id"] == l2_id for s in l1_entry["l2"])
                l2s = await srv.list_l2(l1_id)
                assert any(s["id"] == l2_id for s in l2s)

                await srv.admin_update_category(l1_id, {"paused": True}, admin={"id": "test-admin"})

                # GET /categories: parent gone entirely (structural — the L2
                # was never individually paused, but is unreachable anyway).
                listing = await srv.list_categories()
                assert not any(c["id"] == l1_id for c in listing)

                # GET /categories/{l1_id}/l2 direct call — the exact gap this
                # task fixed: must now also refuse the still-visible L2 once
                # its parent is paused.
                l2s = await srv.list_l2(l1_id)
                assert l2s == [], "a paused parent L1's L2 children must not be reachable via the direct L2 endpoint either"

                # Confirmed still not individually paused — this is the
                # parent-hides-child rule in action, not a side effect.
                raw_l2 = await db.subcategories.find_one({"id": l2_id}, {"_id": 0, "paused": 1})
                assert raw_l2.get("paused") is not True, "the L2's own paused flag must be untouched by hiding its parent"
            finally:
                await _cleanup(db, l1_ids=[l1_id], l2_ids=[l2_id])

        asyncio.run(_run())


class TestLegacyAndDeactivatedTaxonomy:
    def test_h_and_i_paused_legacy_l1s_including_beauty_sports_remain_excluded(self):
        """H/I: paused legacy L1s (the six deactivated in migration
        031_consolidate_l1_categories — Ethnic/Footwear/Lingerie/
        Accessories/Beauty/Sports) stay excluded from every active-
        taxonomy consumer. Seeds representative paused L1s (including
        ones literally named Beauty/Sports) rather than assuming
        production data, so this test is self-contained and doesn't
        depend on what's actually in any real database."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            legacy_ids = []
            for name in ("Beauty", "Sports", "Ethnic Wear", "Footwear", "Lingerie & Innerwear", "Accessories"):
                lid = await _seed_l1(db, paused=True, name=name)
                legacy_ids.append(lid)
            try:
                listing = await srv.list_categories()
                listed_ids = {c["id"] for c in listing}
                for lid in legacy_ids:
                    assert lid not in listed_ids, f"paused legacy L1 {lid} must not appear in GET /categories"

                active_l1_ids, _ = await srv._active_l1_l2_ids()
                for lid in legacy_ids:
                    assert lid not in active_l1_ids, f"paused legacy L1 {lid} must not be in the active-taxonomy set"

                l1_by_name, _, _ = await srv._category_name_maps()
                assert "beauty" not in l1_by_name, "Beauty must not be selectable as an L1 via bulk-upload/WhatsApp"
                assert "sports" not in l1_by_name, "Sports must not be selectable as an L1 via bulk-upload/WhatsApp"
            finally:
                await _cleanup(db, l1_ids=legacy_ids)

        asyncio.run(_run())


class TestNoDestructiveSideEffects:
    def test_j_hiding_category_does_not_touch_existing_products(self):
        """J: hiding a category must not delete or silently remap an
        existing product that belongs to it — the product doc stays
        byte-for-byte unchanged."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            l1_id = await _seed_l1(db)
            mid = f"m-cvtest-{uuid.uuid4().hex[:6]}"
            pid = f"prod-cvtest-{uuid.uuid4().hex[:8]}"
            now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
            product_doc = {
                "id": pid, "merchant_id": mid, "store_id": f"store-m-{mid}",
                "name": "Existing Product", "price": 499.0, "mrp": 999.0,
                "l1_id": l1_id, "stock": {"default": 5}, "is_deleted": False,
                "paused": False, "created_at": now_iso,
            }
            await db.products.insert_one(dict(product_doc))
            try:
                await srv.admin_update_category(l1_id, {"paused": True}, admin={"id": "test-admin"})
                fetched = await db.products.find_one({"id": pid}, {"_id": 0})
                assert fetched == product_doc, "hiding the category must not modify the existing product document at all"
                # Unhide too, for completeness — still untouched.
                await srv.admin_update_category(l1_id, {"paused": False}, admin={"id": "test-admin"})
                fetched = await db.products.find_one({"id": pid}, {"_id": 0})
                assert fetched == product_doc, "unhiding must not modify the product document either"
            finally:
                await _cleanup(db, l1_ids=[l1_id], product_ids=[pid])

        asyncio.run(_run())


class TestWhatsAppTaxonomy:
    def test_k_hidden_category_not_available_to_whatsapp_product_addition(self):
        """K: WhatsApp product addition's own active-taxonomy fetch
        (routes/whatsapp.py:189) is explicitly documented as querying the
        identical db.categories/db.subcategories paused filter as
        _active_l1_l2_ids() — same collections, same field, same
        condition. That inner function is a closure defined inside
        routes/whatsapp.py's init(db, ...) factory and isn't reachable as
        a standalone unit outside a full app-init context, so this test
        verifies the shared invariant it depends on (a freshly-paused
        category leaving the active set) directly against
        _active_l1_l2_ids() — the same check _validate_l1_l2 uses for the
        actual product-creation call WhatsApp's flow ends with. Documented
        honestly as a proxy check, not a fabricated direct test of the
        WhatsApp closure itself."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            l1_id = await _seed_l1(db)
            try:
                active_l1_ids, _ = await srv._active_l1_l2_ids()
                assert l1_id in active_l1_ids

                await srv.admin_update_category(l1_id, {"paused": True}, admin={"id": "test-admin"})

                active_l1_ids, _ = await srv._active_l1_l2_ids()
                assert l1_id not in active_l1_ids, \
                    "a paused category must leave the exact active-taxonomy set WhatsApp's own fetch mirrors and _validate_l1_l2 enforces at creation time"

                # Also confirm the actual product-creation gate (the real
                # enforcement point WhatsApp's flow calls at the end)
                # rejects it — not just the lookup set.
                with pytest.raises(srv.HTTPException) as exc:
                    await srv._validate_l1_l2(l1_id, "", "")
                assert exc.value.status_code == 400
            finally:
                await _cleanup(db, l1_ids=[l1_id])

        asyncio.run(_run())
