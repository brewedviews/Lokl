"""
seed_demo.py — STANDALONE demo-data seeder for visual density testing.

Adds 10 demo stores + ~70-90 demo products directly to the `stores` and
`products` collections, matching the exact document shape the live app
reads (see backend/server.py: _visible_store_filter, _visible_product_filter,
_availability_map, _store_availability, and the `create_merchant_product` /
`storefront_update` handlers, which this script's doc shapes were read from).

This script does NOT import or modify backend/server.py or any app code.
It only imports the pure taxonomy data from seed_data.py (L1/L2 ids — so we
never invent category ids that don't exist) and duplicates the small
BHILAI_DELIVERY_POLYGON constant + point-in-polygon check inline (copied
from server.py; keep in sync if that polygon ever changes).

=== THE SAFETY RULE ===
Every single document this script writes carries `"demo_seed": True`. The
teardown path deletes ONLY on that exact field — nothing else, ever. There
is no secondary heuristic (id prefix, name pattern, date range) backing up
the delete filter, by design: one field, one meaning, no ambiguity.

Usage:
    python3 backend/seed_demo.py --baseline   # read-only: prints real vs demo counts
    python3 backend/seed_demo.py --seed        # creates demo stores + products
    python3 backend/seed_demo.py --teardown    # deletes ONLY demo_seed=true docs

Requires MONGO_URL and DB_NAME in the environment (or backend/.env), exactly
like server.py.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Pure data import only — no app/route/DB-client side effects. This is the
# single source of truth for L1/L2 category ids so this script can never
# drift from what the real taxonomy actually contains.
from seed_data import L1_CATEGORIES, L2_BY_L1

load_dotenv(Path(__file__).parent / ".env")

DEMO_FLAG_FIELD = "demo_seed"
DEMO_FLAG_QUERY = {DEMO_FLAG_FIELD: True}

RNG = random.Random(42)  # deterministic across runs, for reviewable output


# ---------------------------------------------------------------------------
# Copied from backend/server.py — BHILAI_DELIVERY_POLYGON + _point_in_polygon.
# Duplicated (not imported) so this script has zero dependency on the app
# module graph. Keep in sync if the real polygon ever changes.
# ---------------------------------------------------------------------------
BHILAI_DELIVERY_POLYGON = [
    [21.181171, 81.304172],
    [21.196210, 81.306039],
    [21.200802, 81.320573],
    [21.206586, 81.313630],
    [21.211084, 81.308707],
    [21.223536, 81.319850],
    [21.208805, 81.377901],
    [21.197012, 81.383133],
    [21.152275, 81.342198],
    [21.174136, 81.300888],
]


def _point_in_polygon(lat: float, lng: float, polygon: list) -> bool:
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        lat_i, lng_i = polygon[i][0], polygon[i][1]
        lat_j, lng_j = polygon[j][0], polygon[j][1]
        if (lng_i > lng) != (lng_j > lng):
            intersect_lat = lat_i + (lat_j - lat_i) * (lng - lng_i) / (lng_j - lng_i)
            if lat < intersect_lat:
                inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------------------
# Bhilai coordinates — sourced from frontend/src/data/bhilai-areas.ts (the
# app's own merchant-onboarding area picker). Verified against the polygon
# above at script-authoring time: of that file's 25 areas, only these 16
# actually fall inside BHILAI_DELIVERY_POLYGON — the other 9 (Sector 1-4/11,
# Powerhouse, Supela, Nehru Nagar, Smriti Nagar) are outside it. That's a
# pre-existing mismatch between the area picker and the delivery zone, not
# something this script should paper over — flagged here, not fixed here.
DEMO_AREAS = [
    {"slug": "risali",          "label": "Risali",          "pincode": "490006", "lat": 21.1876, "lng": 81.3187},
    {"slug": "ruabandha",       "label": "Ruabandha",       "pincode": "490006", "lat": 21.2034, "lng": 81.3456},
    {"slug": "new-ruabandha",   "label": "New Ruabandha",   "pincode": "490006", "lat": 21.2067, "lng": 81.3512},
    {"slug": "sector-6",        "label": "Sector 6",        "pincode": "490006", "lat": 21.1945, "lng": 81.3456},
    {"slug": "maroda",          "label": "Maroda",          "pincode": "490006", "lat": 21.1934, "lng": 81.3298},
    {"slug": "sector-10",       "label": "Sector 10",       "pincode": "490006", "lat": 21.1998, "lng": 81.3387},
    {"slug": "sector-7",        "label": "Sector 7",        "pincode": "490006", "lat": 21.1923, "lng": 81.3423},
    {"slug": "sector-5",        "label": "Sector 5",        "pincode": "490006", "lat": 21.1912, "lng": 81.3489},
    {"slug": "civic-centre",    "label": "Civic Centre",    "pincode": "490006", "lat": 21.1887, "lng": 81.3521},
    {"slug": "talpuri-b-block", "label": "Talpuri B Block", "pincode": "490006", "lat": 21.1856, "lng": 81.3398},
]
for _a in DEMO_AREAS:
    assert _point_in_polygon(_a["lat"], _a["lng"], BHILAI_DELIVERY_POLYGON), \
        f"DEMO_AREAS entry {_a['slug']!r} is outside BHILAI_DELIVERY_POLYGON — fix before seeding"


# ---------------------------------------------------------------------------
# Images — every URL below was verified with `curl -o /dev/null -w '%{http_code}'`
# to return 200 at script-authoring time (2026-08). They're curated Unsplash
# apparel/retail stock photos, grouped by best-effort category match — treat
# them as "realistic and reliably reachable placeholders for density testing",
# not as guaranteed exact-subject product photography. Swap for real
# Cloudinary shots before using this for anything customer-facing.
# ---------------------------------------------------------------------------
def _unsplash(photo_id: str) -> str:
    return f"https://images.unsplash.com/photo-{photo_id}?w=800&q=80&fit=crop"


IMAGES_BY_L1 = {
    "l1-women": [_unsplash(i) for i in [
        "1483985988355-763728e1935b", "1594633312681-425c7b97ccd1",
        "1595777457583-95e059d581b8", "1551232864-3f0890e580d9",
        "1524504388940-b1c1722653e1",
    ]],
    "l1-men": [_unsplash(i) for i in [
        "1617137968427-85924c800a22", "1602810318383-e386cc2a3ccf",
        "1552374196-c4e7ffc6e126", "1516257984-b1b4d707412e",
        "1594938298603-c8148c4dae35",
    ]],
    "l1-ethnic": [_unsplash(i) for i in [
        "1610030469983-98e550d6193c", "1584917865442-de89df76afd3",
        "1560243563-062bfc001d68", "1600180758890-6b94519a8ba6",
    ]],
    "l1-footwear": [_unsplash(i) for i in [
        "1542291026-7eec264c27ff", "1560769629-975ec94e6a86",
        "1549298916-b41d501d3772", "1595950653106-6c9ebd614d3a",
        "1595341888016-a392ef81b7de",
    ]],
    "l1-lingerie": [_unsplash(i) for i in [
        "1618354691373-d851c5c3a990", "1503342217505-b0a15ec3261c",
        "1621786030484-4c855eed6974",
    ]],
    "l1-kids": [_unsplash(i) for i in [
        "1622290291468-a28f7a7dc6a8", "1591047139829-d91aecb6caea",
        "1571945153237-4929e783af4a",
    ]],
    "l1-accessories": [_unsplash(i) for i in [
        "1492707892479-7bc8d5a4ee93", "1445205170230-053b83016050",
        "1573855619003-97b4799dcd8b", "1519415943484-9fa1873496d4",
    ]],
    "l1-beauty": [_unsplash(i) for i in [
        "1596462502278-27bfdc403348", "1519741497674-611481863552",
        "1604671801908-6f0c6a092c05",
    ]],
    "l1-sports": [_unsplash(i) for i in [
        "1517649763962-0c623066013b", "1622470953794-aa9c70b0fb9d",
        "1568252542512-9fe8fe9c87bb", "1522335789203-aabd1fc54bc9",
        "1526170375885-4d8ecf77b99f", "1533055640609-24b498dfd74c",
        "1571019613454-1cb2f99b2d8b",
    ]],
}
_VALID_L1_IDS = {c["id"] for c in L1_CATEGORIES}
assert set(IMAGES_BY_L1.keys()) <= _VALID_L1_IDS, "IMAGES_BY_L1 references an L1 id not in seed_data.py"


NOUNS_BY_L1 = {
    "l1-women":       ["Kurta", "Top", "Dress", "Palazzo Set", "Co-ord Set", "Blouse", "Jumpsuit"],
    "l1-men":         ["Shirt", "T-Shirt", "Jeans", "Polo", "Trousers", "Jacket", "Hoodie"],
    "l1-ethnic":      ["Saree", "Sherwani", "Lehenga", "Salwar Suit", "Dhoti Set", "Kurta Set"],
    "l1-footwear":    ["Sneakers", "Sandals", "Loafers", "Formal Shoes", "Flats", "Boots", "Heels"],
    "l1-lingerie":    ["Bra Set", "Nightsuit", "Camisole", "Shapewear", "Robe"],
    "l1-kids":        ["T-Shirt Set", "Frock", "Shorts Set", "School Uniform", "Onesie"],
    "l1-accessories": ["Handbag", "Belt", "Sunglasses", "Watch", "Wallet", "Scarf"],
    "l1-beauty":      ["Face Cream", "Lipstick Set", "Hair Oil", "Perfume", "Face Wash"],
    "l1-sports":      ["Track Pants", "Gym Tee", "Yoga Mat", "Sports Shoes", "Sipper Bottle"],
}
assert set(NOUNS_BY_L1.keys()) == _VALID_L1_IDS, "NOUNS_BY_L1 must cover exactly the L1 ids in seed_data.py"

ADJECTIVES = [
    "Classic", "Premium", "Everyday", "Festive", "Casual", "Urban",
    "Comfort-Fit", "Signature", "Trendy", "Essential", "Handpicked",
]

PRICE_RANGE_BY_L1 = {
    "l1-women": (499, 2999), "l1-men": (399, 2499), "l1-ethnic": (899, 4999),
    "l1-footwear": (699, 3499), "l1-lingerie": (299, 1499), "l1-kids": (299, 1499),
    "l1-accessories": (199, 1999), "l1-beauty": (149, 1299), "l1-sports": (399, 2499),
}

SIZES_BY_L1 = {
    "l1-women": ["XS", "S", "M", "L", "XL"],
    "l1-men": ["S", "M", "L", "XL", "XXL"],
    "l1-ethnic": ["S", "M", "L", "XL"],
    "l1-footwear": ["UK6", "UK7", "UK8", "UK9", "UK10"],
    "l1-lingerie": ["S", "M", "L", "XL"],
    "l1-kids": ["2-3Y", "4-5Y", "6-7Y", "8-9Y"],
    "l1-accessories": ["Free Size"],
    "l1-beauty": ["Free Size"],
    "l1-sports": ["S", "M", "L", "XL"],
}

GENDER_BY_L1 = {c["id"]: c["gender_default"] for c in L1_CATEGORIES}


# ---------------------------------------------------------------------------
# Store roster — 10 realistic Bhilai-style stores, each with a primary L1
# (products lean toward it) so every L1 in seed_data.py gets covered by at
# least one store. Two are "pro" plan so store rails / pickup gating are
# visible; the rest are "free".
# ---------------------------------------------------------------------------
STORE_ROSTER = [
    {"name": "Nexa Fashions",            "area": "risali",          "primary_l1": "l1-women",       "plan": "pro"},
    {"name": "Bhilai Threads",           "area": "ruabandha",       "primary_l1": "l1-men",         "plan": "free"},
    {"name": "Rao Garments",             "area": "new-ruabandha",   "primary_l1": "l1-ethnic",      "plan": "free"},
    {"name": "Sector 6 Style Hub",       "area": "sector-6",        "primary_l1": "l1-accessories", "plan": "free"},
    {"name": "Shakti Vastra",            "area": "maroda",          "primary_l1": "l1-lingerie",    "plan": "free"},
    {"name": "Steel City Sneakers",      "area": "sector-10",       "primary_l1": "l1-footwear",    "plan": "pro"},
    {"name": "Maa Durga Boutique",       "area": "sector-7",        "primary_l1": "l1-beauty",      "plan": "free"},
    {"name": "Bhilai Footwear Junction", "area": "sector-5",        "primary_l1": "l1-footwear",    "plan": "free"},
    {"name": "Trendz Bhilai",            "area": "civic-centre",    "primary_l1": "l1-sports",      "plan": "free"},
    {"name": "Talpuri Trends",           "area": "talpuri-b-block", "primary_l1": "l1-kids",        "plan": "free"},
]
_covered_l1s = {s["primary_l1"] for s in STORE_ROSTER}
assert _covered_l1s == _VALID_L1_IDS, f"STORE_ROSTER primary_l1s miss: {_VALID_L1_IDS - _covered_l1s}"


def _slugify(name: str) -> str:
    import re
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


def _area_by_slug(slug: str) -> dict:
    return next(a for a in DEMO_AREAS if a["slug"] == slug)


def _build_product(store: dict, l1_id: str) -> dict:
    now = datetime.now(timezone.utc)
    noun = RNG.choice(NOUNS_BY_L1[l1_id])
    adjective = RNG.choice(ADJECTIVES)
    name = f"{adjective} {noun}"

    lo, hi = PRICE_RANGE_BY_L1[l1_id]
    price = RNG.randint(lo, hi)
    # ~80% of products show a genuine discount; the rest are at MRP.
    if RNG.random() < 0.8:
        mrp = round(price * RNG.uniform(1.15, 1.6))
    else:
        mrp = price

    sizes = SIZES_BY_L1[l1_id]
    stock = {sz: RNG.randint(5, 40) for sz in sizes}
    total_stock = sum(stock.values())

    l2_choices = L2_BY_L1.get(l1_id, [])
    l2_id = RNG.choice(l2_choices)["id"] if l2_choices else ""

    # Staggered over the last ~20 days so "Just In" ordering and the 14-day
    # "New" badge both show natural variety (mix of new + slightly-older).
    created_at = now - timedelta(
        days=RNG.uniform(0, 20), hours=RNG.uniform(0, 23), minutes=RNG.uniform(0, 59)
    )

    return {
        "id": f"prod-demo-{uuid.uuid4().hex[:10]}",
        "merchant_id": store["merchant_id"],
        "store_id": store["id"],
        "store_name": store["name"],
        "store_city": "Bhilai",
        "name": name,
        "description": f"{name} from {store['name']} — Bhilai local stock.",
        "l1_id": l1_id,
        "l2_id": l2_id,
        "gender": GENDER_BY_L1.get(l1_id, ""),
        "price": float(price),
        "mrp": float(mrp),
        "image": RNG.choice(IMAGES_BY_L1[l1_id]),
        "images": [],
        "image_public_id": "",
        "image_public_ids": [],
        "sizes": sizes,
        "size_type": "",
        "stock": stock,
        "total_stock": total_stock,
        "rating": round(RNG.uniform(3.8, 4.9), 1),
        "ai_enhanced": False,
        "try_at_doorstep": RNG.random() < 0.2,
        "return_eligible": RNG.random() < 0.5,
        "paused": False,
        "status": "active",
        "is_deleted": False,
        "created_at": created_at.isoformat(),
        DEMO_FLAG_FIELD: True,
    }


def build_demo_docs() -> tuple[list[dict], list[dict]]:
    """Returns (store_docs, product_docs). Pure function — no DB calls."""
    now = datetime.now(timezone.utc)
    store_docs = []
    all_products = []

    for i, roster_entry in enumerate(STORE_ROSTER):
        area = _area_by_slug(roster_entry["area"])
        slug = f"demo-{_slugify(roster_entry['name'])}"
        store_id = f"store-demo-{i:02d}"
        merchant_id = f"merchant-demo-{i:02d}"

        store = {
            "id": store_id,
            "merchant_id": merchant_id,
            "name": roster_entry["name"],
            "slug": slug,
            "tagline": "Shop local, delivered fast",
            "story": f"{roster_entry['name']} has been serving Bhilai shoppers with quality picks.",
            "banner": IMAGES_BY_L1[roster_entry["primary_l1"]][0],
            "banners": IMAGES_BY_L1[roster_entry["primary_l1"]][:2],
            "banner_public_ids": [],
            "logo": IMAGES_BY_L1[roster_entry["primary_l1"]][0],
            "logo_public_id": "",
            "city": "Bhilai",
            "area": area["label"],
            "locality": area["label"],
            "area_slug": area["slug"],
            "area_label": area["label"],
            "pincode": area["pincode"],
            "address": f"{area['label']}, Bhilai, Chhattisgarh {area['pincode']}",
            "specialties": [roster_entry["primary_l1"].replace("l1-", "").title()],
            "timing": "9:00 AM - 10:00 PM",
            "opens_at": "09:00",
            "closes_at": "22:00",
            "lat": area["lat"],
            "lng": area["lng"],
            "location": {"type": "Point", "coordinates": [area["lng"], area["lat"]]},
            "upi_qr_url": "",
            "weekly_off": [],
            "trusted": True,
            "kyc_status": "approved",
            "published": True,
            "paused": False,
            "online": True,
            # `last_seen_at` intentionally omitted — _store_availability()
            # treats a missing value as "brand-new store" -> rank 1 / LIVE.
            # Setting a stale timestamp here would rank these Away/Offline.
            "plan": roster_entry["plan"],
            "product_count": 0,  # filled in below once products are built
            "is_deleted": False,
            "created_at": now.isoformat(),
            DEMO_FLAG_FIELD: True,
        }

        n_products = RNG.randint(6, 10)
        primary_l1 = roster_entry["primary_l1"]
        other_l1s = [c["id"] for c in L1_CATEGORIES if c["id"] != primary_l1]
        # Majority from the store's primary L1, a couple from random others.
        n_secondary = RNG.randint(1, 3)
        n_primary = max(1, n_products - n_secondary)
        l1_sequence = [primary_l1] * n_primary + RNG.sample(other_l1s, min(n_secondary, len(other_l1s)))

        store_products = [_build_product(store, l1_id) for l1_id in l1_sequence]
        store["product_count"] = len(store_products)

        store_docs.append(store)
        all_products.extend(store_products)

    return store_docs, all_products


# ---------------------------------------------------------------------------
# DB plumbing
# ---------------------------------------------------------------------------
def _get_db():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME must be set (env var or backend/.env) — "
              "same variables server.py requires. Refusing to guess a connection target.")
        sys.exit(1)
    client = AsyncIOMotorClient(mongo_url)
    return client, client[db_name]


async def print_baseline(db) -> None:
    real_stores = await db.stores.count_documents({DEMO_FLAG_FIELD: {"$ne": True}})
    real_products = await db.products.count_documents({DEMO_FLAG_FIELD: {"$ne": True}})
    demo_stores = await db.stores.count_documents(DEMO_FLAG_QUERY)
    demo_products = await db.products.count_documents(DEMO_FLAG_QUERY)
    print("=== Baseline ===")
    print(f"  REAL  stores:   {real_stores}")
    print(f"  REAL  products: {real_products}")
    print(f"  DEMO  stores:   {demo_stores}  (already present, demo_seed=true)")
    print(f"  DEMO  products: {demo_products}  (already present, demo_seed=true)")
    print()


async def cmd_baseline() -> None:
    client, db = _get_db()
    try:
        await print_baseline(db)
    finally:
        client.close()


async def cmd_seed() -> None:
    client, db = _get_db()
    try:
        await print_baseline(db)

        existing_demo = await db.stores.count_documents(DEMO_FLAG_QUERY)
        if existing_demo > 0:
            print(f"ERROR: {existing_demo} demo store(s) already exist. "
                  f"Run --teardown first to avoid duplicate/orphaned demo data.")
            sys.exit(1)

        store_docs, product_docs = build_demo_docs()

        # Verify the safety tag before writing anything — abort rather than
        # write a single untagged doc.
        missing = [d.get("id", "?") for d in (store_docs + product_docs) if d.get(DEMO_FLAG_FIELD) is not True]
        if missing:
            print(f"WARNING: {len(missing)} demo doc(s) are missing {DEMO_FLAG_FIELD}=true — aborting seed: {missing}")
            sys.exit(1)

        print(f"About to insert {len(store_docs)} demo stores and {len(product_docs)} demo products.")
        confirm = input("Type SEED to proceed: ").strip()
        if confirm != "SEED":
            print("Aborted — no changes made.")
            return

        await db.stores.insert_many(store_docs)
        await db.products.insert_many(product_docs)

        # Post-insert verification — re-query rather than trust the in-memory list.
        inserted_stores = await db.stores.count_documents(DEMO_FLAG_QUERY)
        inserted_products = await db.products.count_documents(DEMO_FLAG_QUERY)
        untagged_stores = await db.stores.count_documents({
            "id": {"$in": [d["id"] for d in store_docs]}, DEMO_FLAG_FIELD: {"$ne": True},
        })
        untagged_products = await db.products.count_documents({
            "id": {"$in": [d["id"] for d in product_docs]}, DEMO_FLAG_FIELD: {"$ne": True},
        })
        if untagged_stores or untagged_products:
            print(f"WARNING: {untagged_stores} store(s) / {untagged_products} product(s) "
                  f"were written WITHOUT {DEMO_FLAG_FIELD}=true — investigate before relying on teardown.")

        print()
        print("=== Seed complete ===")
        print(f"  Stores created:   {inserted_stores} (all tagged {DEMO_FLAG_FIELD}=true)")
        print(f"  Products created: {inserted_products} (all tagged {DEMO_FLAG_FIELD}=true)")
        by_l1: dict[str, int] = {}
        for p in product_docs:
            by_l1[p["l1_id"]] = by_l1.get(p["l1_id"], 0) + 1
        for l1_id, count in sorted(by_l1.items()):
            print(f"    {l1_id}: {count}")
        print()
        print("Run `python3 backend/seed_demo.py --teardown` to remove all of this later.")
    finally:
        client.close()


async def cmd_teardown() -> None:
    client, db = _get_db()
    try:
        await print_baseline(db)

        demo_stores = await db.stores.count_documents(DEMO_FLAG_QUERY)
        demo_products = await db.products.count_documents(DEMO_FLAG_QUERY)
        if demo_stores == 0 and demo_products == 0:
            print("Nothing to tear down — no docs with demo_seed=true found.")
            return

        print(f"About to DELETE {demo_stores} demo stores and {demo_products} demo products "
              f"(strictly filtered on {DEMO_FLAG_QUERY}).")
        confirm = input("Type DELETE to proceed: ").strip()
        if confirm != "DELETE":
            print("Aborted — no changes made.")
            return

        store_result = await db.stores.delete_many(DEMO_FLAG_QUERY)
        product_result = await db.products.delete_many(DEMO_FLAG_QUERY)

        print()
        print("=== Teardown complete ===")
        print(f"  Stores deleted:   {store_result.deleted_count}")
        print(f"  Products deleted: {product_result.deleted_count}")

        remaining_stores = await db.stores.count_documents(DEMO_FLAG_QUERY)
        remaining_products = await db.products.count_documents(DEMO_FLAG_QUERY)
        if remaining_stores or remaining_products:
            print(f"WARNING: {remaining_stores} demo store(s) / {remaining_products} demo product(s) "
                  f"still remain after delete_many — investigate.")
        else:
            print("  Confirmed: zero demo_seed=true docs remain.")
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--baseline", action="store_true", help="Read-only: print real vs demo doc counts")
    group.add_argument("--seed", action="store_true", help="Create demo stores + products (asks for confirmation)")
    group.add_argument("--teardown", action="store_true", help="Delete ALL demo_seed=true docs (asks for confirmation)")
    args = parser.parse_args()

    if args.baseline:
        asyncio.run(cmd_baseline())
    elif args.seed:
        asyncio.run(cmd_seed())
    elif args.teardown:
        asyncio.run(cmd_teardown())


if __name__ == "__main__":
    main()
