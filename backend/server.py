"""Lokl — FastAPI backend (full feature set)."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Request, Response
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, base64, io, csv, json, random, secrets
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from auth import hash_password, verify_password, create_token, get_current_user, decode_token
from ai_service import generate_product_copy, enhance_product_image, ai_model_tryon
from seed_data import build_seed_docs, L1_CATEGORIES, L2_BY_L1, GENDERS
from notifications import (
    notify_order_placed, notify_merchant_new_order,
    notify_order_accepted, notify_order_rejected, notify_order_delivered,
    notify_order_on_the_way, notify_order_cancelled, notify_rider_pickup,
    notify_rider_return_pickup, notify_return_status,
)
from ai_enhance import enhance_product_images

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

ADMIN_EMAIL = "admin@lokl.in"
ADMIN_PASSWORD = "Admin@2026"

app = FastAPI(title="Lokl")
api = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("lokl")


# ===== Models =====
class MerchantSignup(BaseModel):
    email: EmailStr; password: str; store_name: str; owner_name: str
    phone: str  # mandatory — used for cellular/WhatsApp contact and (soon) OTP login
    city: Optional[str] = "Bhilai"

class MerchantLogin(BaseModel): email: EmailStr; password: str
class AdminLogin(BaseModel): email: EmailStr; password: str

class KycSubmit(BaseModel):
    pan_number: str; gst_number: Optional[str] = ""
    business_name: str; business_category: str; business_type: str; business_address: str
    bank_account_number: str; bank_ifsc: str; account_holder_name: str
    # Docs are optional on resubmission — backend keeps the previously-uploaded blob if
    # the field is empty this time. Validation still ensures a doc was provided on first submit.
    pan_doc_b64: Optional[str] = ""; gst_doc_b64: Optional[str] = ""; cancelled_cheque_b64: Optional[str] = ""

class StorefrontUpdate(BaseModel):
    tagline: str; story: str; banner: str
    banners: List[str] = []
    specialties: List[str] = []; locality: Optional[str] = ""
    timing: Optional[str] = ""
    opens_at: Optional[str] = "10:00"
    closes_at: Optional[str] = "18:00"

class ProductCreate(BaseModel):
    name: str; price: float; mrp: Optional[float] = None
    l1_id: str; l2_id: Optional[str] = ""; gender: Optional[str] = ""
    description: Optional[str] = ""
    sizes: List[str] = []; image: Optional[str] = ""
    images: List[str] = []
    ai_enhanced: bool = False; try_at_doorstep: bool = False
    return_eligible: bool = False  # if True, customer can return within 24h of delivery
    stock: Optional[dict] = None

class OrderCreate(BaseModel):
    items: List[dict]; address: dict; total: float
    payment_method: str = "COD"; customer: Optional[dict] = None  # {name, phone, age}

class AICopyRequest(BaseModel): product_name: str; category: Optional[str] = ""; notes: Optional[str] = ""
class ChangeRequest(BaseModel):
    change_type: str  # "bank" | "address"
    new_values: dict
    supporting_doc_b64: str
    reason: Optional[str] = ""

class OtpVerifyDelete(BaseModel): otp: str
class CustomerUpsert(BaseModel):
    phone: str; name: Optional[str] = ""; age: Optional[int] = None
    address: Optional[dict] = None; email: Optional[str] = ""


# ===== Auth =====
@api.post("/auth/register")
async def register(payload: MerchantSignup):
    phone = (payload.phone or "").strip()
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 10:
        raise HTTPException(400, "Phone number is required (10+ digits)")
    if await db.merchants.find_one({"email": payload.email}, {"_id": 0}):
        raise HTTPException(400, "Email already registered")
    # Phone uniqueness check — last-10-digits canonical form, ignoring +91/91 prefixes.
    p10 = digits[-10:]
    if await db.merchants.find_one({"phone_canonical": p10}, {"_id": 0}):
        raise HTTPException(400, "Phone number already registered")
    mid = f"m-{uuid.uuid4().hex[:10]}"
    doc = {"id": mid, "email": payload.email, "password_hash": hash_password(payload.password),
           "store_name": payload.store_name, "owner_name": payload.owner_name,
           "phone": phone, "phone_canonical": p10, "city": payload.city,
           "created_at": datetime.now(timezone.utc).isoformat(), "role": "merchant",
           "kyc_status": "draft", "kyc_submitted_at": None, "approved_at": None,
           "published": False, "storefront": None, "notifications": []}
    await db.merchants.insert_one(doc)
    safe = {k: v for k, v in doc.items() if k not in ("password_hash", "_id")}
    return {"token": create_token(mid, "merchant"), "merchant": safe}

@api.post("/auth/login")
async def login(payload: MerchantLogin):
    m = await db.merchants.find_one({"email": payload.email}, {"_id": 0})
    if not m or not verify_password(payload.password, m["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    safe = {k: v for k, v in m.items() if k != "password_hash"}
    return {"token": create_token(m["id"], "merchant"), "merchant": safe}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "password_hash": 0})
    if not m: raise HTTPException(404, "Merchant not found")
    return m


async def _merchant_next_route(merchant_id: str) -> str:
    """Compute the best landing route for a merchant based on onboarding state.
    Login + onboarding pages call this so an approved merchant never sees the
    onboarding page again.
    """
    m = await db.merchants.find_one({"id": merchant_id}, {"_id": 0, "kyc_status": 1})
    if not m:
        return "/merchant/login"
    kyc = (m.get("kyc_status") or "draft").lower()
    if kyc in ("draft", "rejected"):
        return "/merchant/kyc"
    if kyc == "on_hold":
        return "/merchant/onboarding"  # show hold notice + Update KYC button
    if kyc == "submitted":
        return "/merchant/onboarding"  # under review
    # approved
    store_id = f"store-m-{merchant_id}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0, "published": 1})
    if not store:
        return "/merchant/storefront"
    live_count = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    if live_count < 1:
        return "/merchant/products"
    return "/merchant/orders"


@api.get("/merchant/next-route")
async def merchant_next_route(user: dict = Depends(get_current_user)):
    """Returns where the merchant should land after login/refresh."""
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant only")
    return {"route": await _merchant_next_route(user["sub"])}


# ===== Categories =====
@api.get("/categories")
async def list_categories():
    """Returns L1 categories with their L2 children."""
    cats = await db.categories.find({}, {"_id": 0}).sort("order", 1).to_list(50)
    l2s = await db.subcategories.find({}, {"_id": 0}).to_list(200)
    by_l1 = {}
    for s in l2s:
        by_l1.setdefault(s["l1_id"], []).append(s)
    return [{**c, "l2": by_l1.get(c["id"], [])} for c in cats]


# ===== Lokl V2 — dynamic homepage feeds =====
from feeds import home_stats as _home_stats, enrich_products_with_badges as _enrich_badges


async def _visible_online_store_ids() -> set[str]:
    online_filter = {**_visible_store_filter(), "online": {"$ne": False}}
    ids = await db.stores.find(online_filter, {"_id": 0, "id": 1}).to_list(1000)
    return {s["id"] for s in ids}


@api.get("/stats/home")
async def stats_home():
    return await _home_stats(db)


@api.get("/feed/popular-in-city")
async def feed_popular_in_city(city: Optional[str] = "Bhilai", limit: int = 12):
    sids = await _visible_online_store_ids()
    if not sids: return []
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    counts: dict[str, int] = {}
    async for o in db.orders.find(
        {"created_at": {"$gte": since},
         "status": {"$nin": ["pending_merchant", "rejected", "cancelled"]}},
        {"_id": 0, "items": 1}
    ):
        for it in (o.get("items") or []):
            pid = it.get("product_id") or it.get("id")
            if pid: counts[pid] = counts.get(pid, 0) + int(it.get("qty") or 1)
    top_ids = [pid for pid, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:limit]]
    items: list[dict] = []
    if top_ids:
        items = await db.products.find(
            {"id": {"$in": top_ids}, "store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    for p in items: p["orders_7d"] = counts.get(p["id"], 0)
    return items


@api.get("/feed/selling-fast")
async def feed_selling_fast(limit: int = 12):
    sids = await _visible_online_store_ids()
    if not sids: return []
    items = await db.products.find(
        {"store_id": {"$in": list(sids)}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("created_at", -1).to_list(100)
    items = await _enrich_badges(db, items)
    items = [p for p in items if p.get("badge") in ("selling_fast", "best_seller") or p.get("low_stock_size")]
    return items[:limit]


@api.get("/feed/best-sellers")
async def feed_best_sellers(limit: int = 12):
    sids = await _visible_online_store_ids()
    if not sids: return []
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    counts: dict[str, int] = {}
    async for o in db.orders.find(
        {"created_at": {"$gte": since}, "status": "delivered"},
        {"_id": 0, "items": 1}
    ):
        for it in (o.get("items") or []):
            pid = it.get("product_id") or it.get("id")
            if pid: counts[pid] = counts.get(pid, 0) + int(it.get("qty") or 1)
    top_ids = [pid for pid, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:limit]]
    items: list[dict] = []
    if top_ids:
        items = await db.products.find(
            {"id": {"$in": top_ids}, "store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    for p in items: p["orders_30d"] = counts.get(p["id"], 0)
    return items


@api.get("/feed/new-arrivals")
async def feed_new_arrivals(limit: int = 12):
    sids = await _visible_online_store_ids()
    if not sids: return []
    items = await db.products.find(
        {"store_id": {"$in": list(sids)}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("created_at", -1).to_list(limit)
    return await _enrich_badges(db, items)


@api.get("/feed/trending")
async def feed_trending(limit: int = 12):
    sids = await _visible_online_store_ids()
    if not sids: return []
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    score: dict[str, int] = {}
    async for o in db.orders.find(
        {"created_at": {"$gte": since},
         "status": {"$nin": ["pending_merchant", "rejected", "cancelled"]}},
        {"_id": 0, "items": 1}
    ):
        for it in (o.get("items") or []):
            pid = it.get("product_id") or it.get("id")
            if pid: score[pid] = score.get(pid, 0) + 5 * int(it.get("qty") or 1)
    try:
        async for v in db.product_views.find({"ts": {"$gte": since}}, {"_id": 0, "product_id": 1}):
            pid = v.get("product_id")
            if pid: score[pid] = score.get(pid, 0) + 1
    except Exception: pass
    top_ids = [pid for pid, _ in sorted(score.items(), key=lambda kv: -kv[1])[:limit]]
    items: list[dict] = []
    if top_ids:
        items = await db.products.find(
            {"id": {"$in": top_ids}, "store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": {"$in": list(sids)}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    return await _enrich_badges(db, items)


@api.post("/track/view")
async def track_view(payload: dict):
    pid = (payload or {}).get("product_id")
    if not pid: return {"ok": False}
    await db.product_views.insert_one({
        "product_id": pid, "ts": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api.post("/me/recently-viewed")
async def record_recently_viewed(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("role") != "customer": return {"ok": False}
    pid = (payload or {}).get("product_id")
    if not pid: return {"ok": False}
    await db.recently_viewed.update_one(
        {"customer_id": user["sub"], "product_id": pid},
        {"$set": {"ts": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@api.get("/me/recently-viewed")
async def list_recently_viewed(user: dict = Depends(get_current_user), limit: int = 12):
    if user.get("role") != "customer": return []
    rows = await db.recently_viewed.find({"customer_id": user["sub"]}, {"_id": 0}).sort("ts", -1).to_list(limit)
    pids = [r["product_id"] for r in rows]
    if not pids: return []
    sids = await _visible_online_store_ids()
    items = await db.products.find(
        {"id": {"$in": pids}, "store_id": {"$in": list(sids)}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).to_list(limit)
    rank = {pid: i for i, pid in enumerate(pids)}
    items.sort(key=lambda p: rank.get(p["id"], 999))
    return await _enrich_badges(db, items)


@api.get("/search/trending")
async def search_trending(limit: int = 8):
    from collections import Counter
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    counts: Counter = Counter()
    try:
        async for r in db.search_queries.find({"ts": {"$gte": since}}, {"_id": 0, "q": 1}):
            q = (r.get("q") or "").strip().lower()
            if q: counts[q] += 1
    except Exception: pass
    items = [{"q": q, "count": c} for q, c in counts.most_common(limit)]
    if items: return items
    return [{"q": q, "count": 0} for q in
            ["Sarees", "Kurtis", "Sneakers", "Bridal wear", "Formal shirts",
             "Kids fashion", "Jeans", "Footwear"]][:limit]


@api.post("/search/track")
async def search_track(payload: dict):
    q = (payload or {}).get("q", "").strip()
    if not q: return {"ok": False}
    await db.search_queries.insert_one({"q": q.lower(), "ts": datetime.now(timezone.utc).isoformat()})
    return {"ok": True}


@api.get("/offers")
async def list_offers():
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.offers.find(
        {"published": True, "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}]},
        {"_id": 0}
    ).sort("rank", 1).to_list(20)
    return rows


def _admin_only(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")


@api.post("/admin/offers")
async def admin_create_offer(payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
    doc = {
        "id": f"off-{uuid.uuid4().hex[:8]}",
        "title": payload.get("title", "").strip(),
        "subtitle": payload.get("subtitle", "").strip(),
        "image": payload.get("image", ""),
        "cta_label": payload.get("cta_label", "Shop now"),
        "cta_link": payload.get("cta_link", "/products"),
        "background": payload.get("background", "#0A1F5C"),
        "rank": int(payload.get("rank", 100)),
        "published": bool(payload.get("published", True)),
        "expires_at": payload.get("expires_at"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.offers.insert_one(doc)
    doc.pop("_id", None); return doc


@api.delete("/admin/offers/{oid}")
async def admin_delete_offer(oid: str, user: dict = Depends(get_current_user)):
    _admin_only(user)
    await db.offers.delete_one({"id": oid})
    return {"ok": True}


@api.get("/testimonials")
async def list_testimonials(limit: int = 12):
    rows = await db.testimonials.find({"published": True}, {"_id": 0}).sort("rank", 1).to_list(limit)
    return rows


@api.post("/admin/testimonials")
async def admin_create_testimonial(payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
    doc = {
        "id": f"tes-{uuid.uuid4().hex[:8]}",
        "name": payload.get("name", "").strip(),
        "city": payload.get("city", "Bhilai").strip(),
        "rating": int(payload.get("rating", 5)),
        "quote": payload.get("quote", "").strip(),
        "avatar": payload.get("avatar", ""),
        "rank": int(payload.get("rank", 100)),
        "published": bool(payload.get("published", True)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.testimonials.insert_one(doc)
    doc.pop("_id", None); return doc


@api.delete("/admin/testimonials/{tid}")
async def admin_delete_testimonial(tid: str, user: dict = Depends(get_current_user)):
    _admin_only(user)
    await db.testimonials.delete_one({"id": tid})
    return {"ok": True}


@api.get("/categories/counts")
async def categories_with_counts():
    sids = await _visible_online_store_ids()
    cats = await db.categories.find({}, {"_id": 0}).sort("order", 1).to_list(50)
    if not sids:
        for c in cats: c["product_count"] = 0
        return cats
    pipeline = [
        {"$match": {"store_id": {"$in": list(sids)}, **_visible_product_filter()}},
        {"$group": {"_id": "$l1_id", "n": {"$sum": 1}}},
    ]
    counts: dict[str, int] = {}
    async for row in db.products.aggregate(pipeline):
        counts[row["_id"]] = int(row["n"] or 0)
    for c in cats:
        c["product_count"] = counts.get(c.get("id"), 0)
    return cats

@api.get("/categories/{l1_id}/l2")
async def list_l2(l1_id: str):
    return await db.subcategories.find({"l1_id": l1_id}, {"_id": 0}).to_list(50)


# ============ Lokl V2 — Site CMS ============
DEFAULT_HOMEPAGE_SECTIONS = [
    {"id": "hero",            "label": "Hero",                "enabled": True, "rank": 10},
    {"id": "offers",          "label": "Offers carousel",     "enabled": True, "rank": 20},
    {"id": "categories",      "label": "Categories",          "enabled": True, "rank": 30},
    {"id": "popular_in_city", "label": "Popular in Bhilai",   "enabled": True, "rank": 40},
    {"id": "selling_fast",    "label": "Selling fast",        "enabled": True, "rank": 50},
    {"id": "stores",          "label": "Stores near you",     "enabled": True, "rank": 60},
    {"id": "recently_viewed", "label": "Recently viewed",     "enabled": True, "rank": 70},
    {"id": "customer_love",   "label": "Customer love",       "enabled": True, "rank": 80},
]
DEFAULT_HERO = {
    "image": "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    "eyebrow": "Bhilai · Live",
    "title_line1": "Fashion from Bhilai's best stores.",
    "title_line2": "Delivered in under 45 minutes.",
    "subtitle": "Discover thousands of products from trusted local boutiques with fast delivery, doorstep trial and easy returns.",
    "cta_primary_label": "Shop Women", "cta_primary_link": "/c/women",
    "cta_secondary_label": "Shop Men", "cta_secondary_link": "/c/men",
    "show_stats": True, "show_usp_chips": True,
}


async def _get_site_config() -> dict:
    doc = await db.site_config.find_one({"id": "homepage"}, {"_id": 0})
    if not doc:
        doc = {"id": "homepage", "sections": DEFAULT_HOMEPAGE_SECTIONS, "hero": DEFAULT_HERO}
        await db.site_config.insert_one(doc)
    section_ids = {s["id"] for s in doc.get("sections", [])}
    added = [s for s in DEFAULT_HOMEPAGE_SECTIONS if s["id"] not in section_ids]
    if added:
        doc.setdefault("sections", []).extend(added)
        await db.site_config.update_one({"id": "homepage"}, {"$set": {"sections": doc["sections"]}})
    if "hero" not in doc:
        doc["hero"] = DEFAULT_HERO
        await db.site_config.update_one({"id": "homepage"}, {"$set": {"hero": doc["hero"]}})
    doc.pop("_id", None)
    return doc


@api.get("/site/homepage-config")
async def public_homepage_config():
    cfg = await _get_site_config()
    cfg["sections"] = sorted(cfg["sections"], key=lambda s: s.get("rank", 999))
    return cfg


@api.get("/admin/site/homepage-config")
async def admin_get_homepage_config(user: dict = Depends(get_current_user)):
    _admin_only(user)
    return await _get_site_config()


@api.put("/admin/site/homepage-config")
async def admin_put_homepage_config(payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
    update = {}
    if isinstance(payload.get("sections"), list):
        clean = []
        for s in payload["sections"]:
            if not isinstance(s, dict) or "id" not in s: continue
            clean.append({
                "id": str(s["id"]),
                "label": str(s.get("label", "")),
                "enabled": bool(s.get("enabled", True)),
                "rank": int(s.get("rank", 100)),
            })
        update["sections"] = clean
    if isinstance(payload.get("hero"), dict):
        cur = (await _get_site_config()).get("hero", DEFAULT_HERO)
        merged = {**cur, **{k: v for k, v in payload["hero"].items() if k in DEFAULT_HERO}}
        update["hero"] = merged
    if not update:
        raise HTTPException(400, "Nothing to update")
    await db.site_config.update_one({"id": "homepage"}, {"$set": update}, upsert=True)
    return await _get_site_config()


@api.get("/search")
async def search(q: str = "", limit: int = 20):
    """Lightweight typeahead. Returns products + stores matching the query."""
    if not q or len(q.strip()) < 1:
        return {"products": [], "stores": []}
    rx = {"$regex": q.strip(), "$options": "i"}
    products = await db.products.find(
        {"$and": [{"paused": {"$ne": True}}, {"$or": [{"name": rx}, {"description": rx}]}]},
        {"_id": 0, "id": 1, "name": 1, "image": 1, "price": 1, "store_id": 1, "store_name": 1, "l1_id": 1}
    ).limit(limit).to_list(limit)
    stores = await db.stores.find(
        {"$and": [{"published": True}, {"paused": {"$ne": True}}, {"product_count": {"$gte": 1}}, {"$or": [{"name": rx}, {"tagline": rx}, {"specialties": rx}]}]},
        {"_id": 0, "id": 1, "name": 1, "banner": 1, "image": 1, "tagline": 1, "area": 1}
    ).limit(8).to_list(8)
    return {"products": products, "stores": stores}


# ===== Public catalog =====
def _visible_store_filter():
    # `published` = approved + has products + has clicked store-level go-live (auto in current flow).
    # `paused` = admin-paused (hidden entirely).
    # `online` is the merchant's self-service availability toggle — when False, the store is
    # still visible in /stores listings but tagged "Offline now" and ALL their products are
    # hidden from the public products listing.
    return {"kyc_status": "approved", "published": True, "paused": {"$ne": True}, "product_count": {"$gte": 1}}

def _visible_product_filter():
    return {"paused": {"$ne": True}}


def _is_store_open_now(store: dict) -> tuple[bool, str | None]:
    """Returns (is_open, next_open_label). 30-min buffer after opens_at and before closes_at.

    If `opens_at` / `closes_at` are missing, the store is treated as always open.
    Uses local IST clock (UTC+5:30) since the pilot is Bhilai-only.
    """
    opens = store.get("opens_at")
    closes = store.get("closes_at")
    if not opens or not closes:
        return True, None
    try:
        from datetime import timezone as _tz, timedelta as _td
        ist = datetime.now(_tz.utc) + _td(hours=5, minutes=30)
        cur_min = ist.hour * 60 + ist.minute
        oh, om = [int(x) for x in opens.split(":")[:2]]
        ch, cm = [int(x) for x in closes.split(":")[:2]]
        open_min = oh * 60 + om + 30      # +30 buffer after opens
        close_min = ch * 60 + cm - 30     # -30 buffer before closes
        if open_min <= cur_min < close_min:
            return True, None
        # Compose human-readable next-open label
        opens_h = oh % 12 or 12
        opens_ampm = "AM" if oh < 12 else "PM"
        return False, f"Opens at {opens_h}:{om:02d} {opens_ampm}"
    except Exception:
        return True, None


@api.get("/stores")
async def list_stores(city: Optional[str] = None, limit: int = 50):
    q = dict(_visible_store_filter())
    if city: q["city"] = city
    # Strip heavy multi-banner array from list view (only cover `banner` is needed for cards)
    stores = await db.stores.find(q, {"_id": 0, "banner_images": 0}).sort("distance_km", 1).to_list(limit)
    open_list, offline_list = [], []
    for s in stores:
        merchant_online = s.get("online") is not False
        is_open_by_time, next_label = _is_store_open_now(s)
        is_open = is_open_by_time and merchant_online
        s["is_open"] = is_open
        s["online"] = merchant_online  # explicit for UI
        if not is_open:
            if not merchant_online:
                s["next_open_label"] = "Offline — back soon"
            else:
                s["next_open_label"] = next_label
            offline_list.append(s)
        else:
            open_list.append(s)
    return open_list + offline_list  # open first, offline at the bottom

@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one({"id": store_id, **_visible_store_filter()}, {"_id": 0})
    if not s: raise HTTPException(404, "Store not found")
    merchant_online = s.get("online") is not False
    is_open_by_time, next_label = _is_store_open_now(s)
    s["is_open"] = is_open_by_time and merchant_online
    s["online"] = merchant_online
    s["next_open_label"] = next_label if merchant_online else "Offline — back soon"
    # When merchant is offline, hide their products from the store page too (user spec).
    if not merchant_online:
        products = []
    else:
        products = await db.products.find({"store_id": store_id, **_visible_product_filter()}, {"_id": 0, "images": 0}).to_list(200)
        for p in products:
            p["store_is_open"] = s["is_open"]
            if not s["is_open"]:
                p["next_open_label"] = s.get("next_open_label")
    return {"store": s, "products": products}

@api.get("/products")
async def list_products(l1: Optional[str] = None, l2: Optional[str] = None,
                        gender: Optional[str] = None, store: Optional[str] = None,
                        sort: str = "trending", limit: int = 100):
    # Only show products from stores that are visible AND currently online (merchant toggle).
    online_filter = {**_visible_store_filter(), "online": {"$ne": False}}
    visible_ids = await db.stores.find(online_filter, {"_id": 0, "id": 1}).to_list(1000)
    visible_set = {s["id"] for s in visible_ids}
    q = {"store_id": {"$in": list(visible_set)}, **_visible_product_filter()}
    if l1: q["l1_id"] = l1
    if l2: q["l2_id"] = l2
    if gender: q["gender"] = gender
    if store: q["store_id"] = store
    # Strip heavy `images` carousel array from list responses (full array fetched on PDP via /products/{pid}).
    cursor = db.products.find(q, {"_id": 0, "images": 0})
    if sort == "price_asc": cursor = cursor.sort("price", 1)
    elif sort == "price_desc": cursor = cursor.sort("price", -1)
    elif sort == "rating": cursor = cursor.sort("rating", -1)
    return await cursor.to_list(limit)

@api.get("/products/{pid}")
async def get_product(pid: str):
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p: raise HTTPException(404, "Product not found")
    similar_q = {"id": {"$ne": pid}, **_visible_product_filter()}
    if p.get("l2_id"): similar_q["l2_id"] = p["l2_id"]
    elif p.get("l1_id"): similar_q["l1_id"] = p["l1_id"]
    similar = await db.products.find(similar_q, {"_id": 0, "images": 0}).limit(8).to_list(8)
    return {"product": p, "similar": similar}


# ===== Orders =====
SERVICEABLE_CITIES = ["bhilai"]

@api.post("/orders")
async def create_order(payload: OrderCreate):
    addr_city = (payload.address.get("city") or "").strip().lower()
    if addr_city not in SERVICEABLE_CITIES:
        raise HTTPException(400, "We're only serving Bhilai right now — please update your delivery city.")
    order_id = f"BFO-{uuid.uuid4().hex[:8].upper()}"
    merchant_ids = []
    # Snapshot per-item return_eligible at order time so later product edits don't change history
    items_snap = []
    for it in payload.items:
        p = await db.products.find_one({"id": it.get("id")}, {"merchant_id": 1, "return_eligible": 1, "_id": 0}) or {}
        if p.get("merchant_id"): merchant_ids.append(p["merchant_id"])
        new_it = dict(it)
        new_it["return_eligible"] = bool(p.get("return_eligible", False))
        items_snap.append(new_it)
    now = datetime.now(timezone.utc).isoformat()
    # 4-digit OTP shared across customer / admin / merchant for rider handoff verification
    otp = f"{random.randint(1000, 9999)}"
    doc = {"id": order_id, "items": items_snap, "address": payload.address,
           "total": payload.total, "payment_method": payload.payment_method,
           "customer": payload.customer or {},
           "status": "pending_merchant", "merchant_ids": list(set(merchant_ids)),
           "otp": otp,
           "created_at": now,
           "timeline": [{"label": "Order placed", "time": now},
                        {"label": "Merchant accepted", "time": None},
                        {"label": "Order on the way", "time": None},
                        {"label": "Delivered", "time": None}]}
    await db.orders.insert_one(doc)
    # Upsert customer profile silently
    if payload.customer and payload.customer.get("phone"):
        await _upsert_customer(payload.customer, payload.address)
    # Fire-and-forget WhatsApp notifications
    cust_phone = (payload.customer or {}).get("phone") or (payload.address or {}).get("phone")
    if cust_phone:
        try: notify_order_placed(cust_phone, order_id, float(payload.total))
        except Exception: pass
    for mid in set(merchant_ids):
        m = await db.merchants.find_one({"id": mid}, {"_id": 0, "phone": 1})
        if m and m.get("phone"):
            try: notify_merchant_new_order(m["phone"], order_id, float(payload.total), len(payload.items))
            except Exception: pass
    doc.pop("_id", None)
    return doc

@api.get("/orders/{order_id}")
async def get_order(order_id: str):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    return o

@api.get("/merchant/orders")
async def merchant_orders(user: dict = Depends(get_current_user)):
    """Returns this merchant's orders with customer PII redacted (name + pincode + landmark only)."""
    raw = await db.orders.find({"merchant_ids": user["sub"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    cleaned = []
    for o in raw:
        addr = o.get("address") or {}
        cust = o.get("customer") or {}
        o["customer"] = {"name": cust.get("name") or addr.get("name") or "Customer"}
        o["address"] = {
            "name": addr.get("name", ""),
            "pincode": addr.get("pincode", ""),
            "city": addr.get("city", "Bhilai"),
            "landmark": addr.get("landmark", ""),
            # Coarse area = last comma-segment of line1 (no house numbers / street)
            "line1": (addr.get("line1", "").split(",")[-1] or "").strip(),
        }
        cleaned.append(o)
    return cleaned

@api.post("/merchant/orders/{oid}/accept")
async def merchant_accept_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"id": oid, "merchant_ids": user["sub"]}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    now = datetime.now(timezone.utc).isoformat()
    tl = o.get("timeline", [])
    for t in tl:
        if t["label"] == "Merchant accepted" and not t["time"]:
            t["time"] = now; break
    await db.orders.update_one({"id": oid}, {"$set": {"status": "accepted", "timeline": tl}})
    # WhatsApp customer (no OTP yet — only after handoff)
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "store_name": 1})
    if cust_phone:
        try: notify_order_accepted(cust_phone, oid, (m or {}).get("store_name", "your store"))
        except Exception: pass
    # Notify the registered rider via WhatsApp with order details + OTP
    rider_phone = os.environ.get("RIDER_PHONE", "").strip()
    if rider_phone:
        try:
            addr = o.get("address") or {}
            pickup = (m or {}).get("store_name", "Store") + " · " + (m or {}).get("business_address", "Bhilai")
            drop_parts = [addr.get("line1", ""), addr.get("landmark", ""), addr.get("city", "Bhilai"), addr.get("pincode", "")]
            drop = ", ".join([p for p in drop_parts if p])
            notify_rider_pickup(
                rider_phone, order_id=oid, otp=o.get("otp", ""),
                customer_name=(o.get("customer") or {}).get("name") or addr.get("name", "Customer"),
                customer_phone=cust_phone or addr.get("phone", ""),
                pickup=pickup, drop=drop, items=o.get("items", []),
            )
        except Exception: pass
    return {"ok": True, "otp": o.get("otp")}

@api.post("/merchant/orders/{oid}/handed-to-rider")
async def merchant_handed_to_rider(oid: str, user: dict = Depends(get_current_user)):
    """Merchant confirms the rider has been handed the package after matching OTP."""
    o = await db.orders.find_one({"id": oid, "merchant_ids": user["sub"]}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") != "accepted":
        raise HTTPException(400, "Order must be accepted before handoff")
    now = datetime.now(timezone.utc).isoformat()
    tl = o.get("timeline", [])
    for t in tl:
        if t["label"] in ("Order on the way", "Handed to rider", "Rider on the way") and not t["time"]:
            t["time"] = now; break
    await db.orders.update_one({"id": oid}, {"$set": {"status": "on_the_way", "timeline": tl}})
    # WhatsApp customer with the OTP — they will match with rider on arrival
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_on_the_way(cust_phone, oid, o.get("otp", ""))
        except Exception: pass
    return {"ok": True}


# ===== Admin order management =====
@api.post("/admin/orders/{oid}/mark-delivered")
async def admin_mark_delivered(oid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") in ("delivered", "cancelled"):
        raise HTTPException(400, "Order already finalized")
    now = datetime.now(timezone.utc).isoformat()
    tl = o.get("timeline", [])
    for t in tl:
        if t["label"] == "Delivered" and not t["time"]:
            t["time"] = now; break
    await db.orders.update_one({"id": oid}, {"$set": {"status": "delivered", "timeline": tl, "delivered_at": now}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_delivered(cust_phone, oid)
        except Exception: pass
    return {"ok": True}

@api.post("/admin/orders/{oid}/cancel")
async def admin_cancel_order(oid: str, request: Request, payload: Optional[dict] = None):
    _check_admin(request.headers.get("authorization"))
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") == "delivered":
        raise HTTPException(400, "Cannot cancel a delivered order")
    reason = (payload or {}).get("reason") or "Cancelled by admin"
    await db.orders.update_one({"id": oid}, {"$set": {"status": "cancelled", "cancel_reason": reason}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_cancelled(cust_phone, oid, reason)
        except Exception: pass
    return {"ok": True}


# ===== Merchant KYC =====
@api.post("/merchant/kyc/submit")
async def kyc_submit(payload: KycSubmit, user: dict = Depends(get_current_user)):
    # Re-submitting clears any prior hold so admins see it as a fresh review.
    update = payload.model_dump()
    # Preserve previously-uploaded docs when this submission omits them (merchant just
    # tweaked text fields after an on_hold note).
    existing = await db.merchants.find_one(
        {"id": user["sub"]},
        {"_id": 0, "pan_doc_b64": 1, "gst_doc_b64": 1, "cancelled_cheque_b64": 1}
    ) or {}
    for k in ("pan_doc_b64", "gst_doc_b64", "cancelled_cheque_b64"):
        if not (update.get(k) or "").strip() and existing.get(k):
            update[k] = existing[k]
    await db.merchants.update_one({"id": user["sub"]}, {"$set": {
        **update,
        "kyc_status": "submitted",
        "kyc_submitted_at": datetime.now(timezone.utc).isoformat(),
        "hold_comment": None, "hold_at": None}})
    return {"ok": True, "kyc_status": "submitted"}

@api.get("/merchant/kyc/status")
async def kyc_status(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]},
        {"_id": 0, "password_hash": 0, "pan_doc_b64": 0, "gst_doc_b64": 0, "cancelled_cheque_b64": 0})
    if not m: raise HTTPException(404, "Not found")
    # Lightweight presence flags so the KYC form can show "✓ already uploaded" without
    # transferring the heavy base64 blobs back to the browser.
    raw = await db.merchants.find_one(
        {"id": user["sub"]},
        {"_id": 0, "pan_doc_b64": 1, "gst_doc_b64": 1, "cancelled_cheque_b64": 1}
    ) or {}
    docs_present = {
        "pan_doc": bool(raw.get("pan_doc_b64")),
        "gst_doc": bool(raw.get("gst_doc_b64")),
        "cancelled_cheque": bool(raw.get("cancelled_cheque_b64")),
    }
    return {"kyc_status": m.get("kyc_status", "draft"), "merchant": m, "docs_present": docs_present}

@api.get("/merchant/notifications")
async def merchant_notifications(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "notifications": 1})
    return m.get("notifications", []) if m else []


# ===== Change Requests (bank/address) =====
@api.post("/merchant/change-request")
async def submit_change_request(payload: ChangeRequest, user: dict = Depends(get_current_user)):
    cid = f"cr-{uuid.uuid4().hex[:10]}"
    doc = {"id": cid, "merchant_id": user["sub"], "change_type": payload.change_type,
           "new_values": payload.new_values, "supporting_doc_b64": payload.supporting_doc_b64,
           "reason": payload.reason, "status": "submitted",
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.change_requests.insert_one(doc)
    return {"ok": True, "id": cid}

@api.get("/merchant/change-requests")
async def my_change_requests(user: dict = Depends(get_current_user)):
    return await db.change_requests.find({"merchant_id": user["sub"]},
        {"_id": 0, "supporting_doc_b64": 0}).sort("created_at", -1).to_list(100)


# ===== Merchant Storefront / Products / Publish =====
@api.post("/merchant/storefront")
async def storefront_update(payload: StorefrontUpdate, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m: raise HTTPException(404, "Not found")
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved yet")
    store_id = f"store-m-{user['sub']}"
    # Derive area from business_address (first comma-segment)
    biz_addr = m.get("business_address", "") or ""
    derived_area = (payload.locality or biz_addr.split(",")[0]).strip() or "Bhilai"
    store_doc = {"id": store_id, "merchant_id": user["sub"], "name": m["store_name"],
        "tagline": payload.tagline, "story": payload.story,
        "banner": (payload.banners[0] if payload.banners else payload.banner),
        "banners": payload.banners or ([payload.banner] if payload.banner else []),
        "logo": (payload.banners[0] if payload.banners else payload.banner),
        "city": "Bhilai", "area": derived_area, "locality": derived_area,
        "address": biz_addr,
        "specialties": payload.specialties,
        "timing": payload.timing or f"{payload.opens_at} - {payload.closes_at}",
        "opens_at": payload.opens_at or "10:00",
        "closes_at": payload.closes_at or "18:00",
        "lat": 21.2147, "lng": 81.3850,
        "distance_km": round(random.uniform(0.8, 4.0), 1),
        "eta_min": random.choice([28, 32, 35, 40, 45]),
        "trusted": True,
        "kyc_status": "approved", "published": False, "paused": False, "product_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()}
    existing = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if existing:
        for k in ("published", "paused", "product_count", "created_at", "distance_km", "eta_min"):
            if k in existing: store_doc[k] = existing[k]
    await db.stores.update_one({"id": store_id}, {"$set": store_doc}, upsert=True)
    await db.merchants.update_one({"id": user["sub"]}, {"$set": {"storefront": store_doc}})
    return {"ok": True, "store": store_doc}

@api.post("/merchant/publish")
async def merchant_publish(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved")
    store_id = f"store-m-{user['sub']}"
    if not await db.stores.find_one({"id": store_id}): raise HTTPException(400, "Storefront not set up")
    count = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    if count < 1: raise HTTPException(400, "Add at least 1 product before publishing")
    await db.stores.update_one({"id": store_id},
        {"$set": {"published": True, "product_count": count,
                  "live_at": datetime.now(timezone.utc).isoformat()}})
    await db.merchants.update_one({"id": user["sub"]}, {"$push": {"notifications": {
        "type": "go-live", "title": "Your store is going live",
        "body": "Your storefront will be live across Lokl within 1 hour.",
        "time": datetime.now(timezone.utc).isoformat()}}})
    return {"ok": True, "go_live_eta_minutes": 60}


@api.get("/merchant/store/state")
async def merchant_store_state(user: dict = Depends(get_current_user)):
    """Returns just what the sidebar needs: is the merchant fully launched + their online toggle."""
    sid = f"store-m-{user['sub']}"
    s = await db.stores.find_one({"id": sid}, {"_id": 0, "published": 1, "online": 1, "paused": 1, "product_count": 1})
    if not s:
        return {"published": False, "online": True, "can_toggle": False, "product_count": 0}
    pc = await db.products.count_documents({"store_id": sid, "paused": {"$ne": True}})
    return {
        "published": bool(s.get("published")),
        "online": s.get("online") is not False,
        "paused": bool(s.get("paused")),
        "product_count": pc,
        # Only show the big sidebar toggle once the merchant is fully launched (approved +
        # storefront + has ≥1 live product + admin not pausing them).
        "can_toggle": bool(s.get("published")) and pc >= 1 and not s.get("paused"),
    }


@api.post("/merchant/store/online")
async def merchant_store_online(payload: dict, user: dict = Depends(get_current_user)):
    """Merchant self-service availability toggle. Body: {online: bool}.
    When `online=False`: store stays visible on the listing but is marked
    "Offline — back soon" and all products from this store are hidden from the
    public products listing."""
    online = bool(payload.get("online"))
    sid = f"store-m-{user['sub']}"
    s = await db.stores.find_one({"id": sid}, {"_id": 0, "published": 1})
    if not s:
        raise HTTPException(400, "Set up your storefront first")
    if not s.get("published"):
        raise HTTPException(400, "Take your store live before toggling availability")
    await db.stores.update_one({"id": sid}, {"$set": {"online": online}})
    return {"ok": True, "online": online}

@api.get("/merchant/products")
async def merchant_products(user: dict = Depends(get_current_user)):
    return await db.products.find({"merchant_id": user["sub"]}, {"_id": 0}).to_list(500)

def _validate_l1_l2(l1_id: str, l2_id: str, gender: str):
    if l1_id not in [c["id"] for c in L1_CATEGORIES]:
        raise HTTPException(400, "Invalid l1_id")
    if l1_id in L2_BY_L1:
        if not l2_id or l2_id not in [s["id"] for s in L2_BY_L1[l1_id]]:
            raise HTTPException(400, "l2_id required for this category")
    else:
        if not gender or gender not in GENDERS:
            raise HTTPException(400, "gender required for this category")

async def _maybe_autopublish_store(merchant_id: str) -> bool:
    """Auto-publish the merchant's store once KYC is approved, the storefront exists,
    and there is at least one un-paused product. Idempotent and safe to call after every
    product mutation. Returns True if the store was just flipped to published.

    This kills a recurring UX bug where merchants who "took products live" never noticed
    the separate store-level Go-Live step, so their store stayed `published=False` and
    invisible to customers.
    """
    m = await db.merchants.find_one({"id": merchant_id}, {"_id": 0, "kyc_status": 1})
    if not m or m.get("kyc_status") != "approved":
        return False
    store_id = f"store-m-{merchant_id}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0, "published": 1})
    if not store or store.get("published"):
        return False
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    if cnt < 1:
        return False
    await db.stores.update_one({"id": store_id}, {"$set": {
        "published": True,
        "product_count": cnt,
        "live_at": datetime.now(timezone.utc).isoformat(),
    }})
    await db.merchants.update_one({"id": merchant_id}, {"$push": {"notifications": {
        "type": "go-live", "title": "Your store is live on Lokl",
        "body": "Customers in Bhilai can now discover and order from your store.",
        "time": datetime.now(timezone.utc).isoformat(),
    }}})
    return True


@api.post("/merchant/products")
async def create_merchant_product(payload: ProductCreate, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved")
    _validate_l1_l2(payload.l1_id, payload.l2_id or "", payload.gender or "")
    store_id = f"store-m-{user['sub']}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not store: raise HTTPException(400, "Set up storefront first")
    pid = f"prod-{uuid.uuid4().hex[:10]}"
    doc = {"id": pid, "merchant_id": user["sub"], "store_id": store_id,
        "store_name": m["store_name"], "store_city": m.get("city", ""),
        "store_distance_km": store["distance_km"], "store_eta_min": store["eta_min"],
        "rating": 4.5, "paused": False, **payload.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat()}
    await db.products.insert_one(doc)
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    await _maybe_autopublish_store(user["sub"])
    doc.pop("_id", None); return doc

@api.put("/merchant/products/{pid}")
async def update_merchant_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": pid, "merchant_id": user["sub"]}, {"_id": 0})
    if not p: raise HTTPException(404, "Product not found")
    payload.pop("id", None); payload.pop("merchant_id", None)
    await db.products.update_one({"id": pid}, {"$set": payload})
    # If the product was just unpaused, recompute count and maybe auto-publish.
    if "paused" in payload:
        store_id = f"store-m-{user['sub']}"
        cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
        await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
        await _maybe_autopublish_store(user["sub"])
    return await db.products.find_one({"id": pid}, {"_id": 0})

@api.post("/merchant/ai/enhance-image")
async def merchant_ai_enhance_image(payload: dict, user: dict = Depends(get_current_user)):
    """Generate 4 standalone catalog-grade images from a raw product photo.

    Payload: {image: base64 (data-URL or bare)}
    Response: {outputs: [{kind, ok, image}, …]}  -- 4 entries in order: outdoor_1, outdoor_2, studio_1, studio_2
    Note: Frontend prefers /merchant/ai/enhance-image/one (per-kind, parallel) to dodge the 60s ingress cap.
    """
    ref = (payload or {}).get("image") or ""
    if not ref:
        raise HTTPException(400, "Reference image required")
    try:
        result = await enhance_product_images(ref)
    except Exception as exc:
        log.exception("[ai_enhance] failure for merchant=%s", user["sub"])
        raise HTTPException(500, f"AI enhancement failed: {exc}")
    ok_count = sum(1 for o in result.get("outputs", []) if o.get("ok"))
    if ok_count == 0:
        raise HTTPException(
            422,
            "AI couldn't generate any images from this photo. Please try a clearer, well-lit garment photo (JPEG/PNG, < 5 MB)."
        )
    return result


@api.post("/merchant/ai/enhance-image/one")
async def merchant_ai_enhance_one(payload: dict, user: dict = Depends(get_current_user)):
    """Generate ONE of the 4 catalog images. Frontend fires 4 parallel calls.

    Payload: {image: base64|http(s)-url|data-URI, kind: 'outdoor_1'|'outdoor_2'|'studio_1'|'studio_2'}
    Response: {kind, ok, image}
    """
    from ai_enhance import VALID_KINDS, enhance_one_kind  # late import to share module instance
    ref = (payload or {}).get("image") or ""
    kind = (payload or {}).get("kind") or ""
    if not ref:
        raise HTTPException(400, "Reference image required")
    if kind not in VALID_KINDS:
        raise HTTPException(400, f"kind must be one of {VALID_KINDS}")
    try:
        out = await enhance_one_kind(ref, kind)
    except Exception as exc:
        log.exception("[ai_enhance_one] kind=%s merchant=%s", kind, user["sub"])
        raise HTTPException(500, f"AI enhancement failed: {exc}")
    if not out.get("ok"):
        raise HTTPException(422, f"AI couldn't generate the {kind} image. Try a clearer source photo.")
    return out



@api.post("/merchant/products/bulk-action")
async def merchant_products_bulk_action(payload: dict, user: dict = Depends(get_current_user)):
    """Bulk delete / publish (= unpause) / pause for selected product ids."""
    ids = payload.get("ids") or []
    action = (payload.get("action") or "").lower()
    if not ids: raise HTTPException(400, "No ids")
    if action == "delete":
        r = await db.products.delete_many({"id": {"$in": ids}, "merchant_id": user["sub"]})
        return {"deleted": r.deleted_count}
    elif action in ("publish", "pause"):
        new_paused = (action == "pause")
        r = await db.products.update_many(
            {"id": {"$in": ids}, "merchant_id": user["sub"]},
            {"$set": {"paused": new_paused}}
        )
        store_id = f"store-m-{user['sub']}"
        cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
        await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
        await _maybe_autopublish_store(user["sub"])
        return {"updated": r.modified_count, "paused": new_paused}
    raise HTTPException(400, "Unknown action")



@api.get("/merchant/products/template.xlsx")
async def merchant_bulk_template(user: dict = Depends(get_current_user)):
    """Return the Lokl xlsx template with L1/L2/gender/returnable dropdowns and 3 example rows."""
    from xlsx_template import build_template_xlsx
    data = build_template_xlsx()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="lokl-products-template.xlsx"'},
    )


def _row_to_product(row: dict, l1_by_name: dict, l2_by_name: dict) -> tuple[dict | None, str | None]:
    """Parse one bulk-upload row (from xlsx or csv) into a product doc fragment.
    Returns (doc, skip_reason). doc is None when the row should be skipped."""
    name = str(row.get("name") or "").strip()
    if not name:
        return None, "blank-name"
    l1_name = str(row.get("l1") or row.get("category") or "").strip().lower()
    l1_id = l1_by_name.get(l1_name)
    if not l1_id:
        return None, f"{name}: unknown L1 '{l1_name}'"
    l2_name = str(row.get("l2") or row.get("subcategory") or "").strip().lower()
    l2_id = l2_by_name.get((l1_id, l2_name), "") if l2_name else ""
    gender = str(row.get("gender") or "").strip().lower()
    if l1_id in L2_BY_L1 and not l2_id:
        return None, f"{name}: L2 required for category"
    if l1_id not in L2_BY_L1 and not gender:
        gender = "unisex"
    sizes_raw = str(row.get("sizes") or "").strip()
    sizes = [s.strip() for s in sizes_raw.replace("|", ";").split(";") if s.strip()] if sizes_raw else []
    try: price = float((row.get("price") or row.get("selling_price") or 0) or 0)
    except (ValueError, TypeError): price = 0
    try: mrp = float(row.get("mrp") or 0)
    except (ValueError, TypeError): mrp = 0
    stock_raw = str(row.get("stock_per_size") or row.get("stock") or "").strip()
    stock_dict: dict = {}
    if stock_raw:
        parts = [p.strip() for p in stock_raw.replace("|", ";").split(";") if p.strip() != ""]
        if len(parts) == len(sizes) and sizes:
            for sz, n in zip(sizes, parts):
                try: stock_dict[sz] = int(float(n))
                except (ValueError, TypeError): stock_dict[sz] = 0
        elif len(parts) == 1 and sizes:
            try: only = int(float(parts[0]))
            except (ValueError, TypeError): only = 0
            stock_dict = {sz: only for sz in sizes}
        elif not sizes:
            try: stock_dict = {"default": int(float(parts[0]))}
            except (ValueError, TypeError): stock_dict = {"default": 0}
        else:
            return None, f"{name}: sizes/stock count mismatch"
    returnable_raw = str(row.get("returnable") or "").strip().lower()
    return_eligible = returnable_raw in ("yes", "y", "true", "1")
    return {
        "name": name, "price": price, "mrp": mrp or None,
        "l1_id": l1_id, "l2_id": l2_id, "gender": gender,
        "description": str(row.get("description") or "").strip(),
        "sizes": sizes, "stock": stock_dict or {"default": 0},
        "return_eligible": return_eligible,
    }, None


@api.post("/merchant/products/bulk")
async def bulk_products(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Accept BOTH .xlsx (preferred — has dropdowns) and legacy .csv.
    Columns: name, description, l1, l2, gender, mrp, price,
    sizes (semicolon-separated, e.g. `S;M;L`), stock_per_size (e.g. `50;100;39`),
    returnable (Yes/No).
    """
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved")
    store_id = f"store-m-{user['sub']}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not store: raise HTTPException(400, "Set up storefront first")

    raw_bytes = await file.read()
    fname = (file.filename or "").lower()
    rows: list[dict] = []
    if fname.endswith(".xlsx") or raw_bytes.startswith(b"PK\x03\x04"):
        try:
            from xlsx_template import parse_uploaded_xlsx
            rows = parse_uploaded_xlsx(raw_bytes)
        except Exception as e:
            raise HTTPException(400, f"Could not read xlsx: {e}")
    else:
        try:
            raw = raw_bytes.decode("utf-8", errors="ignore")
            rows = list(csv.DictReader(io.StringIO(raw)))
        except Exception as e:
            raise HTTPException(400, f"Could not read csv: {e}")

    l1_by_name = {c["name"].lower(): c["id"] for c in L1_CATEGORIES}
    l2_by_name = {}
    for lid, subs in L2_BY_L1.items():
        for s in subs: l2_by_name[(lid, s["name"].lower())] = s["id"]

    created_ids: list[str] = []
    created_names: list[str] = []
    skipped: list[str] = []
    for row in rows:
        # Skip blank rows
        if not any((v not in (None, "") for v in row.values())):
            continue
        doc_frag, reason = _row_to_product(row, l1_by_name, l2_by_name)
        if doc_frag is None:
            skipped.append(reason or "unknown")
            continue
        pid = f"prod-{uuid.uuid4().hex[:10]}"
        # Newly bulk-uploaded products start PAUSED so the merchant adds images first;
        # they go live one-by-one as the merchant clicks Go-live or adds an image.
        await db.products.insert_one({
            "id": pid, "merchant_id": user["sub"], "store_id": store_id,
            "store_name": m["store_name"], "store_city": m.get("city", ""),
            "store_distance_km": store["distance_km"], "store_eta_min": store["eta_min"],
            "rating": 4.5, "paused": True, "needs_image": True,
            "image": "", "ai_enhanced": False, "try_at_doorstep": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **doc_frag,
        })
        created_ids.append(pid)
        created_names.append(doc_frag["name"])
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    await _maybe_autopublish_store(user["sub"])
    return {"created": len(created_ids), "created_ids": created_ids,
            "names": created_names[:50], "skipped": skipped[:50]}


# ===== Merchant AI =====
@api.post("/merchant/ai/copy")
async def merchant_ai_copy(payload: AICopyRequest, user: dict = Depends(get_current_user)):
    try: return await generate_product_copy(payload.product_name, payload.category or "", payload.notes or "")
    except Exception as e: raise HTTPException(500, f"AI copy generation failed: {e}")

@api.post("/merchant/ai/tryon")
async def merchant_ai_tryon(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    b64 = base64.b64encode(await file.read()).decode()
    result = await ai_model_tryon(b64)
    if result:
        return {"image_base64": result, "source": "gemini-nano-banana"}
    return {"image_base64": None, "source": "failed",
            "message": "AI couldn't generate a try-on for this image. Use a clear product photo with the garment in full view."}


# ===== Analytics =====
def _period_window(period: str):
    now = datetime.now(timezone.utc)
    if period == "yesterday":
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)
    if period == "7d": return now - timedelta(days=7), now
    if period == "30d": return now - timedelta(days=30), now
    if period == "quarter": return now - timedelta(days=90), now
    return now - timedelta(days=30), now

@api.get("/merchant/analytics")
async def merchant_analytics(period: str = "30d", user: dict = Depends(get_current_user)):
    start, end = _period_window(period)
    # Revenue is only counted for delivered orders — pre-revenue merchants see zeros.
    orders = await db.orders.find({
        "merchant_ids": user["sub"],
        "status": "delivered",
        "created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()},
    }, {"_id": 0}).to_list(1000)
    revenue = sum(float(o.get("total", 0)) for o in orders)
    count = len(orders)
    by_day = {}
    for o in orders:
        try: d = datetime.fromisoformat(o["created_at"]).date().isoformat()
        except Exception: continue
        by_day[d] = by_day.get(d, 0) + float(o.get("total", 0))
    # Gap-fill the trend so the chart shows a continuous timeline (last N days of the period,
    # capped at 14 points for a clean bar chart). Empty days show as 0-height bars which
    # gives the merchant a clear "no orders that day" signal.
    span_days = max(1, min(14, (end.date() - start.date()).days or 1))
    trend = []
    for i in range(span_days, 0, -1):
        d = (end.date() - timedelta(days=i - 1)).isoformat()
        trend.append({"date": d, "revenue": round(by_day.get(d, 0), 2)})
    repeat_rate = min(58, int(count * 0.42)) if count >= 4 else 0
    agg = {}
    for o in orders:
        for it in o.get("items", []):
            key = it.get("id") or it.get("name")
            if not key: continue
            agg.setdefault(key, {"name": it.get("name", "Product"), "sold": 0, "revenue": 0})
            agg[key]["sold"] += int(it.get("qty", 1))
            agg[key]["revenue"] += float(it.get("price", 0)) * int(it.get("qty", 1))
    top = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)[:5]
    return {"period": period, "revenue": round(revenue, 2), "orders": count,
        "avg_order_value": round(revenue / count, 2) if count else 0,
        "repeat_rate": repeat_rate, "conversion": 0,
        "trend": trend,
        "top_products": top, "demo_mode": False}

@api.get("/merchant/analytics/report.csv")
async def merchant_report_csv(period: str = "30d", user: dict = Depends(get_current_user)):
    start, end = _period_window(period)
    orders = await db.orders.find({
        "merchant_ids": user["sub"],
        "status": "delivered",
        "created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()},
    }, {"_id": 0}).to_list(2000)
    rows = []
    for o in orders:
        for it in o.get("items", []):
            rows.append({"date": o.get("created_at", "")[:10], "order_id": o.get("id"),
                "product": it.get("name"), "qty": it.get("qty"),
                "amount": float(it.get("price", 0)) * int(it.get("qty", 1)),
                "payment": o.get("payment_method")})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["date", "order_id", "product", "qty", "amount", "payment"])
    w.writeheader(); w.writerows(rows); buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="lokl-sales-{period}.csv"'})


# ===== Admin =====
def _admin_token(): return create_token("admin", "admin")
def _check_admin(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin token required")
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload.get("role") != "admin": raise HTTPException(403, "Not an admin")
    return payload

@api.post("/admin/login")
async def admin_login(payload: AdminLogin):
    if payload.email != ADMIN_EMAIL or payload.password != ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid admin credentials")
    return {"token": _admin_token(), "admin": {"email": ADMIN_EMAIL, "role": "admin"}}

@api.get("/admin/stats")
async def admin_stats(request: Request):
    _check_admin(request.headers.get("authorization"))
    return {
        "submitted_kyc": await db.merchants.count_documents({"kyc_status": "submitted"}),
        "approved": await db.merchants.count_documents({"kyc_status": "approved"}),
        "rejected": await db.merchants.count_documents({"kyc_status": "rejected"}),
        "stores_live": await db.stores.count_documents({"published": True, "paused": {"$ne": True}}),
        "stores_paused": await db.stores.count_documents({"paused": True}),
        "pending_changes": await db.change_requests.count_documents({"status": "submitted"}),
    }

@api.get("/admin/merchants")
async def admin_merchants(request: Request, status: Optional[str] = None):
    _check_admin(request.headers.get("authorization"))
    q = {}
    if status: q["kyc_status"] = status
    return await db.merchants.find(q, {"_id": 0, "password_hash": 0}) \
        .sort("kyc_submitted_at", -1).to_list(500)

@api.get("/admin/merchants/{mid}")
async def admin_merchant_detail(mid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
    if not m: raise HTTPException(404, "Not found")
    return m

@api.post("/admin/merchants/{mid}/approve")
async def admin_approve(mid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved", "approved_at": now},
        "$push": {"notifications": {"type": "kyc-approved", "title": "Your KYC is approved",
            "body": "Welcome aboard! Set up your storefront and start adding products.", "time": now}}})
    return {"ok": True}

@api.post("/admin/merchants/{mid}/reject")
async def admin_reject(mid: str, request: Request, body: dict = None):
    _check_admin(request.headers.get("authorization"))
    reason = (body or {}).get("reason", "Documents need re-verification.")
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "rejected"},
        "$push": {"notifications": {"type": "kyc-rejected", "title": "KYC needs attention",
            "body": reason, "time": now}}})
    return {"ok": True}

@api.post("/admin/merchants/{mid}/hold")
async def admin_hold(mid: str, request: Request, body: dict = None):
    """Admin puts a KYC submission on hold with a remediation comment. The merchant
    sees the comment in their dashboard and can fix the issue and resubmit."""
    _check_admin(request.headers.get("authorization"))
    comment = (body or {}).get("comment", "").strip()
    if not comment:
        raise HTTPException(400, "Comment required so the merchant knows what to fix")
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {
        "kyc_status": "on_hold", "hold_comment": comment, "hold_at": now,
    }, "$push": {"notifications": {"type": "kyc-on-hold", "title": "KYC on hold — action needed",
            "body": comment, "time": now}}})
    return {"ok": True}

@api.post("/merchant/kyc/resubmit")
async def merchant_kyc_resubmit(user: dict = Depends(get_current_user)):
    """Merchant clicks 'I have fixed the issue' — flips kyc_status back to `submitted` for re-review."""
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m: raise HTTPException(404, "Not found")
    if m.get("kyc_status") != "on_hold":
        raise HTTPException(400, "Only on-hold submissions can be resubmitted")
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": user["sub"]}, {
        "$set": {"kyc_status": "submitted", "kyc_submitted_at": now,
                 "hold_comment": None, "hold_at": None},
    })
    return {"ok": True}


@api.get("/admin/change-requests")
async def admin_change_requests(request: Request, status: Optional[str] = None,
                                period: Optional[str] = None):
    _check_admin(request.headers.get("authorization"))
    q = {}
    if status: q["status"] = status
    if period:
        start, end = _period_window(period)
        q["created_at"] = {"$gte": start.isoformat(), "$lte": end.isoformat()}
    docs = await db.change_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # attach merchant snapshot
    for d in docs:
        m = await db.merchants.find_one({"id": d["merchant_id"]},
            {"_id": 0, "store_name": 1, "email": 1, "owner_name": 1, "city": 1})
        d["merchant"] = m
    return docs

@api.post("/admin/change-requests/{cid}/approve")
async def admin_cr_approve(cid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    cr = await db.change_requests.find_one({"id": cid}, {"_id": 0})
    if not cr: raise HTTPException(404, "Not found")
    now = datetime.now(timezone.utc).isoformat()
    # Apply the change to the merchant
    new_vals = cr.get("new_values", {})
    safe_update = {}
    if cr["change_type"] == "bank":
        for k in ("bank_account_number", "bank_ifsc", "account_holder_name"):
            if k in new_vals: safe_update[k] = new_vals[k]
    elif cr["change_type"] == "address":
        if "business_address" in new_vals: safe_update["business_address"] = new_vals["business_address"]
    if safe_update:
        await db.merchants.update_one({"id": cr["merchant_id"]}, {"$set": safe_update})
    await db.change_requests.update_one({"id": cid}, {"$set": {"status": "approved", "actioned_at": now}})
    await db.merchants.update_one({"id": cr["merchant_id"]}, {"$push": {"notifications": {
        "type": "change-approved", "title": f"{cr['change_type'].title()} change approved",
        "body": "Your update has been applied.", "time": now}}})
    return {"ok": True}

@api.post("/admin/change-requests/{cid}/reject")
async def admin_cr_reject(cid: str, request: Request, body: dict = None):
    _check_admin(request.headers.get("authorization"))
    reason = (body or {}).get("reason", "Please re-submit with clearer documents.")
    cr = await db.change_requests.find_one({"id": cid}, {"_id": 0})
    if not cr: raise HTTPException(404, "Not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.change_requests.update_one({"id": cid}, {"$set": {"status": "rejected", "reason": reason, "actioned_at": now}})
    await db.merchants.update_one({"id": cr["merchant_id"]}, {"$push": {"notifications": {
        "type": "change-rejected", "title": f"{cr['change_type'].title()} change rejected",
        "body": reason, "time": now}}})
    return {"ok": True}

@api.get("/admin/export/approvals.csv")
async def admin_export(request: Request, period: Optional[str] = "30d"):
    _check_admin(request.headers.get("authorization"))
    start, end = _period_window(period or "30d")
    merchants = await db.merchants.find({"kyc_submitted_at": {"$ne": None},
        "kyc_submitted_at": {"$gte": start.isoformat(), "$lte": end.isoformat()}}, {"_id": 0}).to_list(2000)
    crs = await db.change_requests.find({"created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0, "supporting_doc_b64": 0}).to_list(2000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["type", "id", "merchant", "email", "submitted_at", "status", "details"])
    for m in merchants:
        w.writerow(["KYC", m.get("id"), m.get("store_name"), m.get("email"),
                    m.get("kyc_submitted_at"), m.get("kyc_status"),
                    f"PAN:{m.get('pan_number','')}, Biz:{m.get('business_name','')}"])
    for c in crs:
        w.writerow([f"CR-{c['change_type']}", c["id"], c.get("merchant_id"), "",
                    c.get("created_at"), c.get("status"), json.dumps(c.get("new_values", {}))])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="approvals-{period}.csv"'})

@api.get("/admin/stores")
async def admin_stores(request: Request):
    _check_admin(request.headers.get("authorization"))
    stores = await db.stores.find({}, {"_id": 0}).to_list(500)
    for s in stores:
        s["products"] = await db.products.find({"store_id": s["id"]}, {"_id": 0}).to_list(500)
        # Enrich with merchant KYC + bank details (PII for admin only)
        m = await db.merchants.find_one({"id": s.get("merchant_id")}, {"_id": 0, "password_hash": 0}) if s.get("merchant_id") else None
        if m:
            s["merchant"] = {
                "id": m.get("id"),
                "email": m.get("email"),
                "phone": m.get("phone"),
                "owner_name": m.get("owner_name"),
                "store_name": m.get("store_name"),
                "city": m.get("city"),
                "business_address": m.get("business_address"),
                "business_category": m.get("business_category"),
                "business_type": m.get("business_type"),
                "pan_number": m.get("pan_number"),
                "gst_number": m.get("gst_number"),
                "kyc_status": m.get("kyc_status"),
                "kyc_submitted_at": m.get("kyc_submitted_at"),
                "approved_at": m.get("approved_at"),
                "hold_comment": m.get("hold_comment"),
                "hold_at": m.get("hold_at"),
                "bank_account_number": m.get("bank_account_number"),
                "bank_ifsc": m.get("bank_ifsc"),
                "account_holder_name": m.get("account_holder_name"),
                "kyc_docs": m.get("kyc_docs", {}),
                "pan_doc_b64": m.get("pan_doc_b64"),
                "gst_doc_b64": m.get("gst_doc_b64"),
                "cancelled_cheque_b64": m.get("cancelled_cheque_b64"),
            }
    return stores

@api.get("/admin/orders")
async def admin_orders(request: Request, status: Optional[str] = None, limit: int = 200):
    """Returns orders grouped by lifecycle for admin tracking.

    Query `status` accepts: `live` (anything not delivered/rejected/cancelled),
    `delivered`, `rejected`, or any specific status. Omit for all orders.
    """
    _check_admin(request.headers.get("authorization"))
    LIVE = ["pending_merchant", "accepted", "preparing", "on_the_way"]
    q = {}
    if status == "live":
        q["status"] = {"$in": LIVE}
    elif status == "delivered":
        q["status"] = "delivered"
    elif status == "rejected":
        q["status"] = {"$in": ["rejected", "cancelled"]}
    elif status:
        q["status"] = status
    cursor = db.orders.find(q, {"_id": 0}).sort("created_at", -1)
    orders = await cursor.to_list(limit)
    # Enrich with store names
    mids = list({m for o in orders for m in (o.get("merchant_ids") or [])})
    if mids:
        mers = await db.merchants.find({"id": {"$in": mids}}, {"_id": 0, "id": 1, "store_name": 1}).to_list(len(mids))
        name_by_mid = {m["id"]: m["store_name"] for m in mers}
        for o in orders:
            o["store_names"] = [name_by_mid.get(m, "—") for m in (o.get("merchant_ids") or [])]
    return orders

@api.post("/admin/products/{pid}/pause")
async def admin_pause_product(pid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    await db.products.update_one({"id": pid}, {"$set": {"paused": True}})
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if p:
        cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
        await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}

@api.post("/admin/products/{pid}/unpause")
async def admin_unpause_product(pid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    await db.products.update_one({"id": pid}, {"$set": {"paused": False}})
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if p:
        cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
        await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}

@api.delete("/admin/products/{pid}")
async def admin_delete_product(pid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p: raise HTTPException(404, "Not found")
    await db.products.delete_one({"id": pid})
    cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
    await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}

@api.post("/admin/stores/{sid}/pause")
async def admin_pause_store(sid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    await db.stores.update_one({"id": sid}, {"$set": {"paused": True}})
    return {"ok": True}

@api.post("/admin/stores/{sid}/unpause")
async def admin_unpause_store(sid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    await db.stores.update_one({"id": sid}, {"$set": {"paused": False}})
    return {"ok": True}

# ===== OTP-protected delete (mocked email) =====
@api.post("/admin/stores/{sid}/request-delete-otp")
async def request_delete_otp(sid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    s = await db.stores.find_one({"id": sid}, {"_id": 0})
    if not s: raise HTTPException(404, "Store not found")
    otp = "".join(str(secrets.randbelow(10)) for _ in range(6))
    await db.admin_otps.update_one({"sid": sid},
        {"$set": {"otp": otp, "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}},
        upsert=True)
    # MOCK email — log to console + return in response
    log.warning("[ADMIN OTP] Email mock to %s: OTP for deleting store '%s' is %s", ADMIN_EMAIL, s.get("name"), otp)
    return {"ok": True, "otp_demo": otp, "message": f"OTP sent to {ADMIN_EMAIL} (mocked — shown here for demo)"}

@api.delete("/admin/stores/{sid}")
async def admin_delete_store(sid: str, request: Request, body: OtpVerifyDelete):
    _check_admin(request.headers.get("authorization"))
    rec = await db.admin_otps.find_one({"sid": sid}, {"_id": 0})
    if not rec or rec.get("otp") != body.otp:
        raise HTTPException(401, "Invalid OTP")
    try:
        if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(401, "OTP expired")
    except (KeyError, ValueError):
        pass
    await db.products.delete_many({"store_id": sid})
    await db.stores.delete_one({"id": sid})
    # Full merchant offboarding: wipe merchant doc + orders + change-requests
    # so the email/phone can be re-used as a brand-new merchant signup.
    s = await db.stores.find_one({"id": sid}, {"_id": 0}) or {}
    mid = s.get("merchant_id") or sid.replace("store-m-", "")
    if mid:
        await db.merchants.delete_one({"id": mid})
        await db.orders.delete_many({"merchant_ids": mid})
        await db.change_requests.delete_many({"merchant_id": mid})
    await db.admin_otps.delete_one({"sid": sid})
    return {"ok": True}


@api.post("/twilio/inbound")
async def twilio_inbound(request: Request):
    """Twilio WhatsApp inbound webhook.

    Twilio POSTs `application/x-www-form-urlencoded` with `From`, `Body` etc.
    If a registered rider replies with `<OTP> - Delivered` (case-insensitive),
    we find the matching live order and mark it delivered.

    Configure this URL in Twilio Console → Messaging → Try it out → WhatsApp
    Sandbox Settings → "When a message comes in" → POST to:
        {REACT_APP_BACKEND_URL}/api/twilio/inbound
    """
    form = await request.form()
    body = (form.get("Body") or "").strip()
    from_addr = (form.get("From") or "").strip()  # e.g. whatsapp:+919XXXXXXXXX
    log.info("[Twilio inbound] from=%s body=%r", from_addr, body[:80])

    # Parse `<4-digit OTP> - Delivered` OR `<4-digit OTP> - Picked Up` (case-insensitive, dash/colon/spaces optional)
    import re as _re
    twiml_empty = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    m_del = _re.search(r"\b(\d{4})\b[\s\-:]*delivered\b", body, _re.IGNORECASE)
    m_ret = _re.search(r"\b(\d{4})\b[\s\-:]*picked[\s\-]?up\b", body, _re.IGNORECASE)
    if not m_del and not m_ret:
        return Response(content=twiml_empty, media_type="application/xml")

    # Restrict to RIDER_PHONE if configured (so random WhatsApp messages can't trigger)
    rider_env = (os.environ.get("RIDER_PHONE") or "").replace("+", "").replace(" ", "")
    if rider_env:
        sender = from_addr.replace("whatsapp:", "").replace("+", "").replace(" ", "")
        if not sender.endswith(rider_env[-10:]):
            log.warning("[Twilio inbound] OTP from non-rider %s", from_addr)
            return Response(content=twiml_empty, media_type="application/xml")

    if m_ret:
        # Return-pickup confirmation
        otp = m_ret.group(1)
        r = await db.returns.find_one({"otp": otp, "status": {"$in": ["pickup_assigned", "arriving"]}}, {"_id": 0})
        if not r:
            log.warning("[Twilio inbound] no matching live return for picked-up OTP %s", otp)
            return Response(content=twiml_empty, media_type="application/xml")
        tl, _, _ = _advance_return(r, "picked_up")
        await db.returns.update_one({"id": r["id"]}, {"$set": {"status": "picked_up", "timeline": tl, "picked_via": "rider-whatsapp"}})
        await db.orders.update_one({"id": r["order_id"]}, {"$set": {"return_status": "picked_up"}})
        log.info("[Twilio inbound] marked return %s as picked_up via rider WhatsApp", r["id"])
        reply = f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>✅ Lokl: Return {r["id"]} marked picked up. Drop at warehouse.</Message></Response>'
        return Response(content=reply, media_type="application/xml")

    # Otherwise — delivery confirmation
    otp = m_del.group(1)
    o = await db.orders.find_one({"otp": otp, "status": {"$in": ["accepted", "on_the_way"]}}, {"_id": 0})
    if not o:
        log.warning("[Twilio inbound] no matching live order for OTP %s", otp)
        return Response(content=twiml_empty, media_type="application/xml")

    now = datetime.now(timezone.utc).isoformat()
    tl = o.get("timeline", [])
    for t in tl:
        if t["label"] == "Delivered" and not t["time"]:
            t["time"] = now; break
    await db.orders.update_one({"id": o["id"]}, {"$set": {"status": "delivered", "timeline": tl, "delivered_via": "rider-whatsapp", "delivered_at": now}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_delivered(cust_phone, o["id"])
        except Exception: pass
    log.info("[Twilio inbound] marked %s as delivered via rider WhatsApp", o["id"])
    reply = f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>✅ Lokl: Order {o["id"]} marked delivered. Thank you!</Message></Response>'
    return Response(content=reply, media_type="application/xml")



async def _upsert_customer(customer: dict, address: dict | None = None):
    phone = customer.get("phone")
    if not phone: return
    upd = {k: v for k, v in customer.items() if v is not None and v != ""}
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Persist address book (de-dup by line1+pincode)
    if address and address.get("line1"):
        existing = await db.customers.find_one({"phone": phone}, {"addresses": 1, "_id": 0})
        addresses = (existing or {}).get("addresses") or []
        key = (address.get("line1", "").strip().lower(), str(address.get("pincode", "")).strip())
        already = any(
            (a.get("line1", "").strip().lower(), str(a.get("pincode", "")).strip()) == key
            for a in addresses
        )
        if not already:
            new_addr = {
                "id": f"addr-{uuid.uuid4().hex[:8]}",
                "name": address.get("name", customer.get("name", "")),
                "phone": address.get("phone", phone),
                "line1": address.get("line1", ""),
                "landmark": address.get("landmark", ""),
                "city": address.get("city", "Bhilai"),
                "pincode": str(address.get("pincode", "")),
                "label": address.get("label", "Home"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            addresses = addresses + [new_addr]
            upd["addresses"] = addresses
        upd["last_address"] = address
    await db.customers.update_one({"phone": phone}, {"$set": upd}, upsert=True)

@api.post("/customer/upsert")
async def customer_upsert(payload: CustomerUpsert):
    await _upsert_customer(payload.model_dump(), payload.address)
    c = await db.customers.find_one({"phone": payload.phone}, {"_id": 0})
    return c

@api.get("/customer/{phone}")
async def get_customer(phone: str):
    c = await db.customers.find_one({"phone": phone}, {"_id": 0})
    if not c: raise HTTPException(404, "Not found")
    orders = await db.orders.find({"customer.phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"customer": c, "orders": orders}


# Customer address book CRUD
@api.post("/customer/{phone}/addresses")
async def add_customer_address(phone: str, payload: dict):
    if not payload.get("line1") or not payload.get("pincode"):
        raise HTTPException(400, "line1 and pincode required")
    addr = {
        "id": f"addr-{uuid.uuid4().hex[:8]}",
        "name": payload.get("name", ""),
        "phone": payload.get("phone", phone),
        "line1": payload.get("line1", "").strip(),
        "landmark": payload.get("landmark", "").strip(),
        "city": payload.get("city", "Bhilai"),
        "pincode": str(payload.get("pincode", "")).strip(),
        "label": payload.get("label", "Home"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.customers.update_one(
        {"phone": phone},
        {"$push": {"addresses": addr}, "$set": {"updated_at": addr["created_at"]}},
        upsert=True,
    )
    return addr

@api.delete("/customer/{phone}/addresses/{aid}")
async def delete_customer_address(phone: str, aid: str):
    await db.customers.update_one({"phone": phone}, {"$pull": {"addresses": {"id": aid}}})
    return {"ok": True}



# ===== Returns =====
RETURN_WINDOW_HOURS = 24
RETURN_STATUS_FLOW = ["requested", "pickup_assigned", "arriving", "picked_up", "completed"]

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

async def _can_return_order(order: dict):
    """Returns (ok, reason). Order must be delivered, have at least 1 return_eligible item, and be within 24h window."""
    if not order:
        return False, "Order not found"
    if order.get("status") != "delivered":
        return False, "Only delivered orders can be returned"
    delivered_at_str = order.get("delivered_at")
    if not delivered_at_str:
        # Fall back to the timeline 'Delivered' entry if delivered_at wasn't set (older orders)
        for t in order.get("timeline", []):
            if t.get("label") == "Delivered" and t.get("time"):
                delivered_at_str = t["time"]
                break
    if not delivered_at_str:
        return False, "Delivery time not recorded — please contact customer care"
    try:
        delivered_at = datetime.fromisoformat(delivered_at_str.replace("Z", "+00:00"))
    except ValueError:
        return False, "Invalid delivery timestamp"
    if datetime.now(timezone.utc) > delivered_at + timedelta(hours=RETURN_WINDOW_HOURS):
        return False, f"Return window of {RETURN_WINDOW_HOURS}h has expired"
    eligible_items = [it for it in (order.get("items") or []) if it.get("return_eligible")]
    if not eligible_items:
        return False, "None of the items in this order are return-eligible"
    return True, None


@api.post("/orders/{oid}/returns")
async def create_return(oid: str, payload: dict):
    """Customer initiates a return. Payload: {item_ids: [str], reason: str, customer_phone: str}"""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    ok, reason = await _can_return_order(o)
    if not ok: raise HTTPException(400, reason)
    item_ids = payload.get("item_ids") or []
    ret_reason = (payload.get("reason") or "").strip()
    if not ret_reason:
        raise HTTPException(400, "Reason required")
    # Filter to only return-eligible items in this order
    elig_ids = {it.get("id") for it in (o.get("items") or []) if it.get("return_eligible")}
    chosen = [iid for iid in item_ids if iid in elig_ids]
    if not chosen:
        # Default: include all eligible items
        chosen = list(elig_ids)
    cust_phone = (payload.get("customer_phone")
                  or (o.get("customer") or {}).get("phone")
                  or (o.get("address") or {}).get("phone"))
    rid = f"RET-{uuid.uuid4().hex[:8].upper()}"
    otp = f"{random.randint(1000, 9999)}"
    now = _now_iso()
    doc = {
        "id": rid,
        "order_id": oid,
        "customer_phone": cust_phone,
        "merchant_ids": o.get("merchant_ids", []),
        "items": [it for it in (o.get("items") or []) if it.get("id") in chosen],
        "reason": ret_reason,
        "status": "requested",
        "otp": otp,
        "created_at": now,
        "timeline": [
            {"label": "Return requested", "time": now},
            {"label": "Pickup partner assigned", "time": None},
            {"label": "Pickup partner arriving", "time": None},
            {"label": "Product picked up", "time": None},
            {"label": "Return completed", "time": None},
        ],
    }
    await db.returns.insert_one(doc)
    # Flag the order so UI can show return state
    await db.orders.update_one({"id": oid}, {"$set": {"return_status": "requested", "return_id": rid}})
    doc.pop("_id", None)
    return doc


@api.get("/returns/{rid}")
async def get_return(rid: str):
    r = await db.returns.find_one({"id": rid}, {"_id": 0})
    if not r: raise HTTPException(404, "Return not found")
    return r


@api.get("/customer/{phone}/returns")
async def customer_returns(phone: str):
    rs = await db.returns.find({"customer_phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return rs


def _advance_return(r: dict, target_status: str):
    """Advance timeline + status. Returns updated tl, status, and any failure reason."""
    if target_status not in RETURN_STATUS_FLOW:
        return None, None, "Invalid status"
    cur_idx = RETURN_STATUS_FLOW.index(r.get("status", "requested"))
    new_idx = RETURN_STATUS_FLOW.index(target_status)
    if new_idx <= cur_idx:
        return None, None, f"Return is already at or past '{r.get('status')}'"
    label_for = {
        "requested": "Return requested",
        "pickup_assigned": "Pickup partner assigned",
        "arriving": "Pickup partner arriving",
        "picked_up": "Product picked up",
        "completed": "Return completed",
    }[target_status]
    now = _now_iso()
    tl = r.get("timeline") or []
    for t in tl:
        if t.get("label") == label_for and not t.get("time"):
            t["time"] = now
            break
    return tl, target_status, None


@api.post("/admin/returns/{rid}/{action}")
async def admin_return_action(rid: str, action: str, request: Request):
    """action ∈ {assign, arriving, picked_up, complete}"""
    _check_admin(request.headers.get("authorization"))
    r = await db.returns.find_one({"id": rid}, {"_id": 0})
    if not r: raise HTTPException(404, "Return not found")
    action_to_status = {
        "assign": "pickup_assigned",
        "arriving": "arriving",
        "picked_up": "picked_up",
        "complete": "completed",
    }
    target = action_to_status.get(action)
    if not target: raise HTTPException(400, "Unknown action")
    tl, status, err = _advance_return(r, target)
    if err: raise HTTPException(400, err)
    update = {"status": status, "timeline": tl}
    await db.returns.update_one({"id": rid}, {"$set": update})
    if status == "completed":
        await db.orders.update_one({"id": r["order_id"]}, {"$set": {"return_status": "completed", "status": "returned"}})
    else:
        await db.orders.update_one({"id": r["order_id"]}, {"$set": {"return_status": status}})
    # Outbound notifications (fire-and-forget)
    if status == "pickup_assigned":
        rider_phone = os.environ.get("RIDER_PHONE", "").strip()
        if rider_phone:
            try:
                o = await db.orders.find_one({"id": r["order_id"]}, {"_id": 0}) or {}
                addr = o.get("address") or {}
                pickup_addr = ", ".join([p for p in [addr.get("line1", ""), addr.get("landmark", ""), addr.get("city", "Bhilai"), addr.get("pincode", "")] if p])
                notify_rider_return_pickup(
                    rider_phone,
                    return_id=rid, order_id=r["order_id"], otp=r.get("otp", ""),
                    customer_name=(o.get("customer") or {}).get("name") or addr.get("name", "Customer"),
                    pickup_addr=pickup_addr,
                    items=r.get("items", []),
                    reason=r.get("reason", ""),
                )
            except Exception: pass
    if r.get("customer_phone"):
        label_map = {
            "pickup_assigned": "pickup partner assigned",
            "arriving": "pickup partner arriving",
            "picked_up": "product picked up",
            "completed": "return completed",
        }
        if status in label_map:
            try: notify_return_status(r["customer_phone"], rid, label_map[status])
            except Exception: pass
    return {"ok": True, "status": status}


@api.get("/admin/returns")
async def admin_returns_list(request: Request, status: Optional[str] = None):
    _check_admin(request.headers.get("authorization"))
    q = {}
    if status: q["status"] = status
    rs = await db.returns.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rs


@api.get("/merchant/returns")
async def merchant_returns(user: dict = Depends(get_current_user)):
    """Merchant view: return requests for orders that include their items, with customer PII redacted."""
    rs = await db.returns.find({"merchant_ids": user["sub"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Redact customer phone like merchant_orders does
    for r in rs:
        r["customer_phone"] = "(hidden)"
    return rs


@api.get("/merchant/analytics/returns")
async def merchant_returns_analytics(user: dict = Depends(get_current_user)):
    """Returns rate + reason histogram for the calling merchant."""
    mid = user["sub"]
    delivered_count = await db.orders.count_documents({"merchant_ids": mid, "status": {"$in": ["delivered", "returned"]}})
    returns = await db.returns.find({"merchant_ids": mid}, {"_id": 0, "reason": 1, "status": 1}).to_list(2000)
    by_reason = {}
    for r in returns:
        k = r.get("reason") or "Other"
        by_reason[k] = by_reason.get(k, 0) + 1
    return {
        "delivered_count": delivered_count,
        "returns_total": len(returns),
        "returns_rate_pct": round((len(returns) / delivered_count * 100), 1) if delivered_count > 0 else 0.0,
        "by_reason": [{"reason": k, "count": v} for k, v in sorted(by_reason.items(), key=lambda x: -x[1])],
    }


@api.get("/admin/returns/analytics")
async def admin_returns_analytics(request: Request):
    """Merchant-wise + reason-wise returns aggregation for admin Returns tab."""
    _check_admin(request.headers.get("authorization"))
    returns = await db.returns.find({}, {"_id": 0}).to_list(5000)
    by_reason, by_merchant = {}, {}
    for r in returns:
        rk = r.get("reason") or "Other"
        by_reason[rk] = by_reason.get(rk, 0) + 1
        for mid in (r.get("merchant_ids") or []):
            by_merchant[mid] = by_merchant.get(mid, 0) + 1
    # Decorate merchant ids with store names
    mids = list(by_merchant.keys())
    merchants = await db.merchants.find({"id": {"$in": mids}}, {"_id": 0, "id": 1, "store_name": 1}).to_list(1000) if mids else []
    name_by_id = {m["id"]: m.get("store_name") for m in merchants}
    return {
        "total": len(returns),
        "by_reason": [{"reason": k, "count": v} for k, v in sorted(by_reason.items(), key=lambda x: -x[1])],
        "by_merchant": [{"merchant_id": k, "store_name": name_by_id.get(k, "—"), "count": v}
                        for k, v in sorted(by_merchant.items(), key=lambda x: -x[1])],
        "by_status": [{"status": s, "count": sum(1 for r in returns if r.get("status") == s)}
                      for s in ["requested", "pickup_assigned", "arriving", "picked_up", "completed"]],
    }


# ===== Complaints =====
COMPLAINT_TYPES = ["return", "missing_item", "damaged_item", "delivery_issue", "general"]


@api.post("/orders/{oid}/complaints")
async def create_complaint(oid: str, payload: dict):
    """Customer raises a complaint for an order. Payload: {type, message, customer_phone}"""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    ctype = payload.get("type") or "general"
    if ctype not in COMPLAINT_TYPES:
        raise HTTPException(400, "Invalid complaint type")
    msg = (payload.get("message") or "").strip()
    if not msg:
        raise HTTPException(400, "Message required")
    cust_phone = (payload.get("customer_phone")
                  or (o.get("customer") or {}).get("phone")
                  or (o.get("address") or {}).get("phone"))
    cid = f"CMP-{uuid.uuid4().hex[:8].upper()}"
    now = _now_iso()
    doc = {
        "id": cid,
        "order_id": oid,
        "merchant_ids": o.get("merchant_ids", []),
        "customer_phone": cust_phone,
        "type": ctype,
        "message": msg,
        "status": "open",
        "created_at": now,
    }
    await db.complaints.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/admin/complaints")
async def admin_complaints(request: Request, status: Optional[str] = None):
    _check_admin(request.headers.get("authorization"))
    q = {}
    if status: q["status"] = status
    docs = await db.complaints.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.post("/admin/complaints/{cid}/resolve")
async def admin_resolve_complaint(cid: str, request: Request, payload: Optional[dict] = None):
    _check_admin(request.headers.get("authorization"))
    note = (payload or {}).get("note", "")
    await db.complaints.update_one({"id": cid}, {"$set": {"status": "resolved", "resolved_at": _now_iso(), "resolution_note": note}})
    return {"ok": True}


@api.get("/customer/{phone}/complaints")
async def customer_complaints(phone: str):
    docs = await db.complaints.find({"customer_phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


@api.get("/merchant/complaints")
async def merchant_complaints(user: dict = Depends(get_current_user)):
    docs = await db.complaints.find({"merchant_ids": user["sub"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for d in docs:
        d["customer_phone"] = "(hidden)"
    return docs




# ===== Admin: Live users + Customers directory =====
@api.post("/heartbeat")
async def heartbeat(payload: dict):
    """Lightweight presence ping. Called by frontend every 30s while user has tab open.

    Payload: {sid: client-session-id, role: customer|merchant|guest, phone?: str, mid?: str, path?: str}
    """
    sid = (payload.get("sid") or "").strip()
    if not sid: return {"ok": False}
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "sid": sid,
        "role": payload.get("role", "guest"),
        "phone": payload.get("phone"),
        "mid": payload.get("mid"),
        "path": payload.get("path"),
        "last_seen": now,
    }
    await db.live_sessions.update_one({"sid": sid}, {"$set": doc, "$setOnInsert": {"first_seen": now}}, upsert=True)
    return {"ok": True}

@api.get("/admin/live-users")
async def admin_live_users(request: Request):
    """Sessions seen in the last 2 minutes."""
    _check_admin(request.headers.get("authorization"))
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    sessions = await db.live_sessions.find({"last_seen": {"$gte": cutoff}}, {"_id": 0}).sort("last_seen", -1).to_list(500)
    by_role = {}
    for s in sessions:
        by_role.setdefault(s.get("role", "guest"), 0)
        by_role[s["role"]] = by_role.get(s["role"], 0) + 1
    return {"sessions": sessions, "count": len(sessions), "by_role": by_role}

@api.get("/admin/customers")
async def admin_customers(request: Request, q: Optional[str] = None, limit: int = 200):
    _check_admin(request.headers.get("authorization"))
    query = {}
    if q:
        query = {"$or": [
            {"phone": {"$regex": q, "$options": "i"}},
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]}
    customers = await db.customers.find(query, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    # Enrich with order count + total spend
    for c in customers:
        phone = c.get("phone")
        orders = await db.orders.find({"customer.phone": phone}, {"_id": 0, "id": 1, "total": 1, "status": 1, "created_at": 1}).to_list(200)
        c["order_count"] = len(orders)
        c["total_spend"] = sum(float(o.get("total", 0)) for o in orders if o.get("status") == "delivered")
    return customers

@api.get("/admin/customers/{phone}")
async def admin_customer_detail(phone: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    c = await db.customers.find_one({"phone": phone}, {"_id": 0})
    if not c: raise HTTPException(404, "Not found")
    orders = await db.orders.find({"customer.phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"customer": c, "orders": orders}


# ===== Geo =====
PILOT_CITIES = [{"name": "Bhilai", "lat": 21.2147, "lng": 81.3850}]

def _nearest_pilot_city(lat: float, lng: float):
    import math
    best, best_d = None, 1e9
    for c in PILOT_CITIES:
        dx = (lng - c["lng"]) * math.cos(math.radians((lat + c["lat"]) / 2))
        dy = lat - c["lat"]
        d = math.sqrt(dx * dx + dy * dy) * 111.0
        if d < best_d: best_d, best = d, c["name"]
    return best if best_d <= 50 else None

@api.get("/geo/detect")
async def geo_detect(lat: Optional[float] = None, lng: Optional[float] = None, request: Request = None):
    import httpx
    source = None
    if lat is not None and lng is not None:
        nearest = _nearest_pilot_city(lat, lng); source = "gps"
        if nearest: return {"city": nearest, "supported": True, "detected_city": nearest, "source": source}
    try:
        ip = None
        if request:
            xff = request.headers.get("x-forwarded-for", "")
            ip = xff.split(",")[0].strip() if xff else request.client.host
        async with httpx.AsyncClient(timeout=5) as cli:
            url = f"https://ipapi.co/{ip}/json/" if ip else "https://ipapi.co/json/"
            r = await cli.get(url); data = r.json() if r.status_code == 200 else {}
        ip_city = (data.get("city") or "").strip()
        ip_lat, ip_lng = data.get("latitude"), data.get("longitude")
        source = source or "ip"
        if ip_lat is not None and ip_lng is not None:
            nearest = _nearest_pilot_city(float(ip_lat), float(ip_lng))
            if nearest: return {"city": nearest, "supported": True, "detected_city": ip_city or nearest, "source": source}
        return {"city": None, "supported": False, "detected_city": ip_city or "Unknown", "source": source}
    except Exception:
        return {"city": None, "supported": False, "detected_city": "Unknown", "source": source or "none"}


# ===== Root =====
@api.get("/")
async def root(): return {"app": "Lokl", "status": "ok"}

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup_seed():
    # Re-seed L1/L2 taxonomy on every boot to ensure it's up-to-date
    await db.categories.delete_many({})
    await db.subcategories.delete_many({})
    cats, l2s = build_seed_docs()
    await db.categories.insert_many(cats)
    if l2s: await db.subcategories.insert_many(l2s)
    log.info("Categories: %d L1, %d L2", len(cats), len(l2s))

    # Keep demo merchant auto-approved
    demo = await db.merchants.find_one({"email": "demo@bharat-os.com"}, {"_id": 0})
    if demo and demo.get("kyc_status") != "approved":
        now = datetime.now(timezone.utc).isoformat()
        await db.merchants.update_one({"id": demo["id"]}, {"$set": {
            "kyc_status": "approved", "approved_at": now,
            "pan_number": "DEMOP1234D", "business_name": "Demo Boutique Pvt Ltd",
            "business_category": "Multi-category", "business_type": "Pvt Ltd",
            "business_address": "Sector 10, Bhilai 490006",
            "bank_account_number": "1234567890", "bank_ifsc": "SBIN0001234",
            "account_holder_name": "Demo Owner"},
            "$push": {"notifications": {"type": "kyc-approved",
                "title": "Your KYC is approved",
                "body": "Welcome to Lokl!", "time": now}}})
        log.info("Demo merchant auto-approved")

@app.on_event("shutdown")
async def shutdown(): client.close()
