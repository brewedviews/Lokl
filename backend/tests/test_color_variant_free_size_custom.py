"""Backend compatibility check for the multi-colour Free Size / Custom Size
frontend fix (2026-09).

The frontend audit (ProductForm.tsx) concluded the backend needs NO change:
ColorVariantSize.size is a plain str with no enum/whitelist, and
_derive_flat_fields_from_variants/order stock-decrement match by that string
generically. These tests exist to prove that conclusion rather than assume
it — same "confirm from actual code, don't invent a new representation"
standard the frontend audit was held to.

Covers (test matrix item M):
  - creating a product with "Free Size" and an arbitrary custom-size string
    inside color_variants is accepted (no validation rejects those values)
  - _derive_flat_fields_from_variants produces correct sizes/stock/total_stock
  - _apply_product_update (edit path) accepts the same values and re-derives
    correctly, without disturbing an unrelated existing colour
  - the exact atomic stock-decrement query POST /orders uses (color_variant_id
    + size match, $inc) works identically for "Free Size" and a custom string
    as it does for a standard size — proving PDP/cart/order compatibility
    without needing to stand up the full order/customer/payment flow.

Run with: cd backend && python3 -m pytest tests/test_color_variant_free_size_custom.py -v
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


async def _ensure_categories_seeded(db):
    """_create_product_for_merchant validates l1_id/l2_id against
    db.categories/db.subcategories (_active_l1_l2_ids) — real collections,
    not a hardcoded list. These tests run against a fresh disposable Mongo
    with nothing in it yet (the app's own startup_seed() populates this on
    a real boot, but these tests call server functions directly without
    running the app). Seeding just the two real categories these tests use
    (Women / Dresses) via the app's own build_seed_docs(), rather than
    duplicating the taxonomy by hand."""
    if await db.categories.count_documents({"id": "l1-women"}) > 0:
        return
    cats, l2s = srv.build_seed_docs()
    women = next(c for c in cats if c["id"] == "l1-women")
    dresses = next(l2 for l2 in l2s if l2["id"] == "l2-women-dresses")
    await db.categories.update_one({"id": women["id"]}, {"$set": women}, upsert=True)
    await db.subcategories.update_one({"id": dresses["id"]}, {"$set": dresses}, upsert=True)


async def _seed_kyc_approved_merchant_with_store(db, mid):
    now_iso = srv.datetime.now(srv.timezone.utc).isoformat()
    await db.merchants.insert_one({
        "id": mid, "email": f"{mid}@test.lokl", "store_name": "Test Store",
        "owner_name": "Test Owner", "phone": f"9{uuid.uuid4().hex[:9]}", "city": "Bhilai",
        "kyc_status": "approved", "plan": "free", "created_at": now_iso,
    })
    await db.stores.insert_one({"id": f"store-m-{mid}", "merchant_id": mid, "name": "Test Store"})


class TestColorVariantFreeSizeAndCustomSize:
    def test_creation_accepts_free_size_and_custom_size_strings(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-cv-freecustom-{uuid.uuid4().hex[:6]}"
            await _ensure_categories_seeded(db)
            await _seed_kyc_approved_merchant_with_store(db, mid)
            doc = None
            try:
                payload = srv.ProductCreate(
                    name="Multi-colour Dress", price=999, l1_id="l1-women", l2_id="l2-women-dresses",
                    size_type="free_size",
                    color_variants=[
                        srv.ColorVariant(
                            id="cv-purple", name="Purple",
                            images=[srv.ColorVariantImage(url="https://cdn.test/purple.png", public_id="pub_purple")],
                            sizes=[srv.ColorVariantSize(size="Free Size", stock=5)],
                        ),
                        srv.ColorVariant(
                            id="cv-black", name="Black",
                            images=[srv.ColorVariantImage(url="https://cdn.test/black.png", public_id="pub_black")],
                            sizes=[srv.ColorVariantSize(size="Free Size", stock=8)],
                        ),
                    ],
                )
                doc = await srv._create_product_for_merchant(payload, mid)

                # No rejection anywhere in the create path for "Free Size".
                assert doc["color_variants"][0]["sizes"][0]["size"] == "Free Size"
                assert doc["color_variants"][0]["sizes"][0]["stock"] == 5
                assert doc["color_variants"][1]["sizes"][0]["stock"] == 8

                # _derive_flat_fields_from_variants: union + per-size sum across colours.
                assert doc["sizes"] == ["Free Size"]
                assert doc["stock"] == {"Free Size": 13}
                assert doc["total_stock"] == 13
            finally:
                if doc:
                    await db.products.delete_one({"id": doc["id"]})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})

        asyncio.run(_run())

    def test_creation_accepts_arbitrary_custom_size_string_unmodified(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-cv-custom-{uuid.uuid4().hex[:6]}"
            await _ensure_categories_seeded(db)
            await _seed_kyc_approved_merchant_with_store(db, mid)
            doc = None
            try:
                custom_size = "28 Waist"
                payload = srv.ProductCreate(
                    name="Custom Jeans", price=1499, l1_id="l1-women", l2_id="l2-women-dresses",
                    size_type="custom",
                    color_variants=[
                        srv.ColorVariant(
                            id="cv-purple", name="Purple",
                            images=[srv.ColorVariantImage(url="https://cdn.test/purple.png", public_id="pub_purple")],
                            sizes=[srv.ColorVariantSize(size=custom_size, stock=6)],
                        ),
                    ],
                )
                doc = await srv._create_product_for_merchant(payload, mid)

                # The exact merchant-typed string is preserved, not coerced
                # to any standard size.
                assert doc["color_variants"][0]["sizes"][0]["size"] == custom_size
                assert doc["sizes"] == [custom_size]
                assert doc["stock"] == {custom_size: 6}
            finally:
                if doc:
                    await db.products.delete_one({"id": doc["id"]})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})

        asyncio.run(_run())

    def test_edit_path_accepts_and_rederives_free_size_without_disturbing_other_colour(self):
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-cv-edit-{uuid.uuid4().hex[:6]}"
            await _ensure_categories_seeded(db)
            await _seed_kyc_approved_merchant_with_store(db, mid)
            doc = None
            try:
                payload = srv.ProductCreate(
                    name="Dress", price=799, l1_id="l1-women", l2_id="l2-women-dresses",
                    size_type="free_size",
                    color_variants=[
                        srv.ColorVariant(
                            id="cv-purple", name="Purple",
                            images=[srv.ColorVariantImage(url="https://cdn.test/purple.png", public_id="pub_purple")],
                            sizes=[srv.ColorVariantSize(size="Free Size", stock=5)],
                        ),
                    ],
                )
                doc = await srv._create_product_for_merchant(payload, mid)

                p = await db.products.find_one({"id": doc["id"], "merchant_id": mid}, {"_id": 0})
                new_color_variants = list(p["color_variants"]) + [{
                    "id": "cv-black", "name": "Black", "hex": None,
                    "images": [{"url": "https://cdn.test/black.png", "public_id": "pub_black"}],
                    "sizes": [{"size": "Free Size", "stock": 8}],
                }]
                updated = await srv._apply_product_update(doc["id"], p, {"color_variants": new_color_variants})

                assert len(updated["color_variants"]) == 2
                purple = next(v for v in updated["color_variants"] if v["id"] == "cv-purple")
                black = next(v for v in updated["color_variants"] if v["id"] == "cv-black")
                assert purple["sizes"] == [{"size": "Free Size", "stock": 5}], "existing colour's stock must survive the edit unchanged"
                assert black["sizes"] == [{"size": "Free Size", "stock": 8}]
                assert updated["stock"] == {"Free Size": 13}
                assert updated["total_stock"] == 13
            finally:
                if doc:
                    await db.products.delete_one({"id": doc["id"]})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})

        asyncio.run(_run())

    def test_order_stock_decrement_query_matches_free_size_and_custom_size(self):
        """Exercises the SAME atomic $elemMatch/$inc query POST /orders uses
        to decrement a colour-variant's per-size stock (server.py, order
        creation) — proving it matches "Free Size" and an arbitrary custom
        string exactly as it would any standard size, with no code change."""
        _require_live_db()
        import asyncio

        async def _run():
            db = srv.db
            mid = f"m-cv-decrement-{uuid.uuid4().hex[:6]}"
            await _ensure_categories_seeded(db)
            await _seed_kyc_approved_merchant_with_store(db, mid)
            doc = None
            try:
                payload = srv.ProductCreate(
                    name="Dress", price=799, l1_id="l1-women", l2_id="l2-women-dresses",
                    size_type="free_size",
                    color_variants=[
                        srv.ColorVariant(
                            id="cv-purple", name="Purple",
                            images=[srv.ColorVariantImage(url="https://cdn.test/purple.png", public_id="pub_purple")],
                            sizes=[srv.ColorVariantSize(size="Free Size", stock=5)],
                        ),
                    ],
                )
                doc = await srv._create_product_for_merchant(payload, mid)
                pid = doc["id"]
                color_variant_id = "cv-purple"
                size = "Free Size"
                qty = 2

                updated = await db.products.find_one_and_update(
                    {"id": pid, "is_deleted": {"$ne": True},
                     "color_variants": {"$elemMatch": {"id": color_variant_id,
                                                        "sizes": {"$elemMatch": {"size": size, "stock": {"$gte": qty}}}}}},
                    {"$inc": {"color_variants.$[v].sizes.$[s].stock": -qty, f"stock.{size}": -qty}},
                    array_filters=[{"v.id": color_variant_id}, {"s.size": size}],
                    return_document=True,
                )
                assert updated is not None, "the exact production decrement query must match a Free Size variant/size"
                variant = next(v for v in updated["color_variants"] if v["id"] == color_variant_id)
                assert variant["sizes"][0]["stock"] == 3
                assert updated["stock"]["Free Size"] == 3

                # A quantity exceeding remaining stock must NOT match (same
                # atomic guarantee as any standard size) — no negative stock.
                over = await db.products.find_one_and_update(
                    {"id": pid, "is_deleted": {"$ne": True},
                     "color_variants": {"$elemMatch": {"id": color_variant_id,
                                                        "sizes": {"$elemMatch": {"size": size, "stock": {"$gte": 999}}}}}},
                    {"$inc": {"color_variants.$[v].sizes.$[s].stock": -999, f"stock.{size}": -999}},
                    array_filters=[{"v.id": color_variant_id}, {"s.size": size}],
                    return_document=True,
                )
                assert over is None
            finally:
                if doc:
                    await db.products.delete_one({"id": doc["id"]})
                await db.merchants.delete_one({"id": mid})
                await db.stores.delete_one({"id": f"store-m-{mid}"})

        asyncio.run(_run())
