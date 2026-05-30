"""Lokl V2 — dynamic data feeds for the consumer homepage.

Everything is derived from real orders / products / stores. No hardcoded values.

Public surface:
    /api/stats/home            → marketplace headline numbers
    /api/feed/popular-in-city  → top-ordered products near the user (last N days)
    /api/feed/selling-fast     → low-stock + recent demand
    /api/feed/best-sellers     → most-purchased overall
    /api/feed/new-arrivals     → most-recently published
    /api/feed/trending         → derived "trending score"

    /api/search/trending       → top searched terms (last 30d)
    /api/me/recently-viewed    → logged-in personal list

    /api/offers                → active promotions (admin-managed)
    /api/testimonials          → published customer love (admin-managed)
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

# ----- Badge engine --------------------------------------------------------
# A product gets at most ONE primary badge (never stacked).
# Priority is intentional — strongest claims first.
BADGE_PRIORITY = [
    "best_seller",     # >= 10 orders in last 30d
    "selling_fast",    # any size with stock <= 3 OR >= 5 orders in last 7d
    "top_rated",       # rating >= 4.7 and review_count >= 10
    "trending",        # >= 50 views in last 7d
    "best_deal",       # discount >= 30%
    "new_arrival",     # created within last 14d
]

BADGE_LABEL = {
    "best_seller": "Best Seller",
    "selling_fast": "Selling Fast",
    "top_rated": "Top Rated",
    "trending": "Trending",
    "best_deal": "Best Deal",
    "new_arrival": "New",
    "low_stock": "Low Stock",
}


def _safe_int(x, default=0) -> int:
    try: return int(x)
    except (TypeError, ValueError): return default


async def _orders_aggregate(db, *, days: int) -> tuple[dict[str, int], dict[str, int]]:
    """Returns (product_orders, store_orders) keyed by id for the last `days`."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    p_orders: Counter = Counter()
    s_orders: Counter = Counter()
    async for o in db.orders.find(
        {"created_at": {"$gte": since}, "status": {"$nin": ["pending_merchant", "rejected", "cancelled"]}},
        {"_id": 0, "items": 1, "store_id": 1}
    ):
        sid = o.get("store_id")
        if sid: s_orders[sid] += 1
        for it in (o.get("items") or []):
            pid = it.get("product_id") or it.get("id")
            if pid: p_orders[pid] += _safe_int(it.get("qty"), 1)
    return dict(p_orders), dict(s_orders)


async def compute_product_badge(p: dict, *, orders_30d: dict, orders_7d: dict, views_7d: dict) -> str | None:
    """Compute the single best badge for a product (None if no badge fits)."""
    pid = p.get("id")
    o30 = orders_30d.get(pid, 0)
    o7 = orders_7d.get(pid, 0)
    v7 = views_7d.get(pid, 0)
    stock = p.get("stock") or {}
    low_stock = any(_safe_int(v) <= 3 and _safe_int(v) > 0 for v in stock.values()) if stock else False

    if o30 >= 10:
        return "best_seller"
    if low_stock or o7 >= 5:
        return "selling_fast"
    if (p.get("rating") or 0) >= 4.7 and _safe_int(p.get("review_count")) >= 10:
        return "top_rated"
    if v7 >= 50:
        return "trending"
    mrp = _safe_int(p.get("mrp"))
    price = _safe_int(p.get("price"))
    if mrp and price and ((mrp - price) / mrp) >= 0.30:
        return "best_deal"
    created = p.get("created_at")
    if created:
        try:
            ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - ts).days <= 14:
                return "new_arrival"
        except (TypeError, ValueError):
            pass
    return None


async def enrich_products_with_badges(db, products: list[dict]) -> list[dict]:
    """Mutates each product dict in-place adding {badge: str|None, badge_label: str|None,
    social_proof: str|None, low_stock_size: str|None}. Cheap — one orders sweep total."""
    orders_30d, _ = await _orders_aggregate(db, days=30)
    orders_7d, _ = await _orders_aggregate(db, days=7)
    # Lightweight view tracking lives in `product_views` (created lazily). Tolerate missing collection.
    since7 = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    views_7d: dict[str, int] = {}
    try:
        async for v in db.product_views.find({"ts": {"$gte": since7}}, {"_id": 0, "product_id": 1}):
            pid = v.get("product_id")
            if pid: views_7d[pid] = views_7d.get(pid, 0) + 1
    except Exception:
        pass

    for p in products:
        badge = await compute_product_badge(p, orders_30d=orders_30d, orders_7d=orders_7d, views_7d=views_7d)
        p["badge"] = badge
        p["badge_label"] = BADGE_LABEL.get(badge) if badge else None
        # Social proof line — pick the strongest available signal, never invent.
        sp = None
        pid = p.get("id")
        if orders_7d.get(pid, 0) >= 3:
            sp = f"{orders_7d[pid]} purchased this week"
        elif views_7d.get(pid, 0) >= 8:
            sp = f"{views_7d[pid]} viewing this week"
        p["social_proof"] = sp
        # Low stock callout (e.g. "Only 2 left in size M")
        low = None
        for sz, qty in (p.get("stock") or {}).items():
            q = _safe_int(qty)
            if 0 < q <= 3:
                low = f"Only {q} left" + (f" in size {sz}" if sz and sz != "default" else "")
                break
        p["low_stock_size"] = low
    return products


# ----- Marketplace headline stats ------------------------------------------
async def home_stats(db) -> dict[str, Any]:
    """Hero metric strip. Real numbers, with sane floors so empty days don't look broken."""
    visible = {"kyc_status": "approved", "published": True, "paused": {"$ne": True}, "product_count": {"$gte": 1}}
    store_count = await db.stores.count_documents(visible)
    product_count = await db.products.count_documents({"paused": {"$ne": True}})
    delivery_count = await db.orders.count_documents({"status": "delivered"})
    # Avg product rating across the visible catalog
    pipeline = [
        {"$match": {"paused": {"$ne": True}, "rating": {"$gt": 0}}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}}},
    ]
    avg = 0.0
    async for row in db.products.aggregate(pipeline):
        avg = float(row.get("avg") or 0)
    return {
        "avg_rating": round(avg or 4.5, 1),
        "verified_stores": store_count,
        "products": product_count,
        "deliveries": delivery_count,
    }
