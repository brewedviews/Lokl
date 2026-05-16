"""Bharat Fashion OS — FastAPI backend (extended with KYC, admin, sales, AI try-on)."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import base64
import io
import csv
import json
import random
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from auth import hash_password, verify_password, create_token, get_current_user
from ai_service import generate_product_copy, enhance_product_image, ai_model_tryon
from seed_data import build_seed_docs

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

ADMIN_EMAIL = "admin@bharat-os.com"
ADMIN_PASSWORD = "Admin@2026"

app = FastAPI(title="Bharat Fashion OS")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bharat")


# ====== Pydantic Models ======
class MerchantSignup(BaseModel):
    email: EmailStr
    password: str
    store_name: str
    owner_name: str
    phone: Optional[str] = None
    city: Optional[str] = "Raipur"


class MerchantLogin(BaseModel):
    email: EmailStr
    password: str


class AdminLogin(BaseModel):
    email: EmailStr
    password: str


class KycSubmit(BaseModel):
    pan_number: str
    gst_number: Optional[str] = ""
    business_name: str
    business_category: str
    business_type: str  # Proprietorship | Partnership | Pvt Ltd | LLP
    business_address: str
    bank_account_number: str
    bank_ifsc: str
    account_holder_name: str
    # base64 strings
    pan_doc_b64: Optional[str] = ""
    gst_doc_b64: Optional[str] = ""
    cancelled_cheque_b64: str


class StorefrontUpdate(BaseModel):
    tagline: str
    story: str
    banner: str  # URL or data URL
    specialties: List[str] = []
    locality: Optional[str] = ""
    timing: Optional[str] = "10am - 9pm"


class ProductCreate(BaseModel):
    name: str
    price: float
    mrp: Optional[float] = None
    category_id: str
    description: Optional[str] = ""
    sizes: List[str] = []
    image: Optional[str] = ""
    ai_enhanced: bool = False
    try_at_doorstep: bool = False
    stock: Optional[dict] = None


class OrderCreate(BaseModel):
    items: List[dict]
    address: dict
    total: float
    payment_method: str = "COD"


class AICopyRequest(BaseModel):
    product_name: str
    category: Optional[str] = ""
    notes: Optional[str] = ""


class AIPublishRequest(BaseModel):
    pass


# ====== Auth ======
@api.post("/auth/register")
async def register(payload: MerchantSignup):
    existing = await db.merchants.find_one({"email": payload.email}, {"_id": 0})
    if existing:
        raise HTTPException(400, "Email already registered")
    merchant_id = f"m-{uuid.uuid4().hex[:10]}"
    doc = {
        "id": merchant_id,
        "email": payload.email,
        "password_hash": hash_password(payload.password),
        "store_name": payload.store_name,
        "owner_name": payload.owner_name,
        "phone": payload.phone,
        "city": payload.city,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "role": "merchant",
        "kyc_status": "draft",  # draft | submitted | approved | rejected
        "kyc_submitted_at": None,
        "approved_at": None,
        "published": False,
        "storefront": None,
        "notifications": [],
    }
    await db.merchants.insert_one(doc)
    token = create_token(merchant_id, "merchant")
    safe = {k: v for k, v in doc.items() if k not in ("password_hash", "_id")}
    return {"token": token, "merchant": safe}


@api.post("/auth/login")
async def login(payload: MerchantLogin):
    m = await db.merchants.find_one({"email": payload.email}, {"_id": 0})
    if not m or not verify_password(payload.password, m["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(m["id"], "merchant")
    safe = {k: v for k, v in m.items() if k != "password_hash"}
    return {"token": token, "merchant": safe}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "password_hash": 0})
    if not m:
        raise HTTPException(404, "Merchant not found")
    return m


# ====== Public Catalog ======
@api.get("/categories")
async def list_categories():
    return await db.categories.find({}, {"_id": 0}).to_list(100)


def _visible_store_filter():
    """Stores visible on consumer side: either seeded demo OR approved+published+has products."""
    return {"$or": [
        {"seeded": True},
        {"kyc_status": "approved", "published": True, "product_count": {"$gte": 1}},
    ]}


@api.get("/stores")
async def list_stores(city: Optional[str] = None, limit: int = 50):
    q = {"city": city} if city else {}
    q.update(_visible_store_filter())
    return await db.stores.find(q, {"_id": 0}).sort("distance_km", 1).to_list(limit)


@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one({"id": store_id, **_visible_store_filter()}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Store not found")
    products = await db.products.find({"store_id": store_id}, {"_id": 0}).to_list(200)
    return {"store": s, "products": products}


@api.get("/products")
async def list_products(category: Optional[str] = None, store: Optional[str] = None,
                        sort: str = "trending", limit: int = 100):
    # only products from visible stores
    visible_ids = await db.stores.find(_visible_store_filter(), {"_id": 0, "id": 1}).to_list(1000)
    visible_set = {s["id"] for s in visible_ids}
    q = {"store_id": {"$in": list(visible_set)}}
    if category:
        q["category_id"] = category
    if store:
        q["store_id"] = store
    cursor = db.products.find(q, {"_id": 0})
    if sort == "price_asc":
        cursor = cursor.sort("price", 1)
    elif sort == "price_desc":
        cursor = cursor.sort("price", -1)
    elif sort == "rating":
        cursor = cursor.sort("rating", -1)
    return await cursor.to_list(limit)


@api.get("/products/{product_id}")
async def get_product(product_id: str):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Product not found")
    similar = await db.products.find(
        {"category_id": p["category_id"], "id": {"$ne": product_id}}, {"_id": 0}
    ).limit(8).to_list(8)
    return {"product": p, "similar": similar}


@api.post("/orders")
async def create_order(payload: OrderCreate):
    order_id = f"BFO-{uuid.uuid4().hex[:8].upper()}"
    # Find unique merchant_ids for items
    merchant_ids = []
    for it in payload.items:
        p = await db.products.find_one({"id": it.get("id")}, {"merchant_id": 1, "_id": 0})
        if p and p.get("merchant_id"):
            merchant_ids.append(p["merchant_id"])
    doc = {
        "id": order_id,
        "items": payload.items,
        "address": payload.address,
        "total": payload.total,
        "payment_method": payload.payment_method,
        "status": "confirmed",
        "merchant_ids": list(set(merchant_ids)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timeline": [
            {"label": "Order placed", "time": datetime.now(timezone.utc).isoformat()},
            {"label": "Merchant accepted", "time": None},
            {"label": "Rider on the way", "time": None},
            {"label": "Delivered", "time": None},
        ],
    }
    await db.orders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/orders/{order_id}")
async def get_order(order_id: str):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    return o


# ====== Merchant KYC ======
@api.post("/merchant/kyc/submit")
async def kyc_submit(payload: KycSubmit, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Merchant not found")
    update = {
        **payload.model_dump(),
        "kyc_status": "submitted",
        "kyc_submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.merchants.update_one({"id": user["sub"]}, {"$set": update})
    return {"ok": True, "kyc_status": "submitted"}


@api.get("/merchant/kyc/status")
async def kyc_status(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one(
        {"id": user["sub"]},
        {"_id": 0, "password_hash": 0, "pan_doc_b64": 0, "gst_doc_b64": 0, "cancelled_cheque_b64": 0},
    )
    if not m:
        raise HTTPException(404, "Not found")
    return {"kyc_status": m.get("kyc_status", "draft"), "merchant": m}


@api.get("/merchant/notifications")
async def merchant_notifications(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "notifications": 1})
    return m.get("notifications", []) if m else []


# ====== Merchant Storefront ======
@api.post("/merchant/storefront")
async def storefront_update(payload: StorefrontUpdate, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Not found")
    if m.get("kyc_status") != "approved":
        raise HTTPException(403, "KYC not approved yet")

    store_id = f"store-m-{user['sub']}"
    store_doc = {
        "id": store_id,
        "merchant_id": user["sub"],
        "name": m["store_name"],
        "tagline": payload.tagline,
        "story": payload.story,
        "banner": payload.banner,
        "logo": payload.banner,
        "city": m.get("city", "Raipur"),
        "locality": payload.locality or m.get("business_address", "")[:60],
        "specialties": payload.specialties,
        "timing": payload.timing,
        "lat": 21.2147 if m.get("city") == "Bhilai" else 21.2514,
        "lng": 81.3850 if m.get("city") == "Bhilai" else 81.6296,
        "distance_km": round(random.uniform(0.8, 4.0), 1),
        "eta_min": random.choice([28, 32, 35, 40, 45]),
        "rating": 4.6,
        "reviews": random.randint(20, 80),
        "trusted": True,
        "seeded": False,
        "kyc_status": "approved",
        "published": False,
        "product_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stores.update_one({"id": store_id}, {"$set": store_doc}, upsert=True)
    await db.merchants.update_one({"id": user["sub"]}, {"$set": {"storefront": store_doc}})
    return {"ok": True, "store": store_doc}


@api.post("/merchant/publish")
async def merchant_publish(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved":
        raise HTTPException(403, "KYC not approved")
    store_id = f"store-m-{user['sub']}"
    s = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not s:
        raise HTTPException(400, "Storefront not set up")
    count = await db.products.count_documents({"store_id": store_id})
    if count < 1:
        raise HTTPException(400, "Add at least 1 product before publishing")
    await db.stores.update_one(
        {"id": store_id},
        {"$set": {"published": True, "product_count": count, "live_at": datetime.now(timezone.utc).isoformat()}},
    )
    msg = {
        "type": "go-live",
        "title": "Your store is going live",
        "body": "Your storefront will be live across Bharat Fashion OS within 1 hour.",
        "time": datetime.now(timezone.utc).isoformat(),
    }
    await db.merchants.update_one({"id": user["sub"]}, {"$push": {"notifications": msg}})
    return {"ok": True, "go_live_eta_minutes": 60}


# ====== Merchant Products ======
@api.get("/merchant/products")
async def merchant_products(user: dict = Depends(get_current_user)):
    return await db.products.find({"merchant_id": user["sub"]}, {"_id": 0}).to_list(500)


@api.post("/merchant/products")
async def create_merchant_product(payload: ProductCreate, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Merchant not found")
    if m.get("kyc_status") != "approved":
        raise HTTPException(403, "KYC not approved")
    store_id = f"store-m-{user['sub']}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    pid = f"prod-{uuid.uuid4().hex[:10]}"
    doc = {
        "id": pid,
        "merchant_id": user["sub"],
        "store_id": store_id,
        "store_name": m["store_name"],
        "store_city": m.get("city", ""),
        "store_distance_km": store["distance_km"] if store else 1.5,
        "store_eta_min": store["eta_min"] if store else 40,
        "rating": 4.5,
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(doc)
    # update store count
    cnt = await db.products.count_documents({"store_id": store_id})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    doc.pop("_id", None)
    return doc


@api.put("/merchant/products/{pid}")
async def update_merchant_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": pid, "merchant_id": user["sub"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Product not found")
    payload.pop("id", None)
    payload.pop("merchant_id", None)
    await db.products.update_one({"id": pid}, {"$set": payload})
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api.post("/merchant/products/bulk")
async def bulk_products(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """CSV columns: name, description, category, mrp, price, sizes (semicolon-separated), stock_per_size"""
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved":
        raise HTTPException(403, "KYC not approved")
    raw = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    cats = {c["name"].lower(): c["id"] for c in await db.categories.find({}, {"_id": 0}).to_list(50)}
    store_id = f"store-m-{user['sub']}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    created = []
    for row in reader:
        name = (row.get("name") or row.get("Name") or "").strip()
        if not name:
            continue
        cat_input = (row.get("category") or "").strip().lower()
        cat_id = cats.get(cat_input) or "cat-women"
        sizes_raw = (row.get("sizes") or "").strip()
        sizes = [s.strip() for s in sizes_raw.replace("|", ";").split(";") if s.strip()] if sizes_raw else []
        try:
            price = float((row.get("price") or row.get("selling_price") or 0) or 0)
        except ValueError:
            price = 0
        try:
            mrp = float(row.get("mrp") or 0)
        except ValueError:
            mrp = 0
        try:
            stock = int(row.get("stock_per_size") or row.get("stock") or 0)
        except ValueError:
            stock = 0
        pid = f"prod-{uuid.uuid4().hex[:10]}"
        doc = {
            "id": pid,
            "merchant_id": user["sub"],
            "store_id": store_id,
            "store_name": m["store_name"],
            "store_city": m.get("city", ""),
            "store_distance_km": store["distance_km"] if store else 1.5,
            "store_eta_min": store["eta_min"] if store else 40,
            "rating": 4.5,
            "name": name,
            "price": price,
            "mrp": mrp or None,
            "category_id": cat_id,
            "description": (row.get("description") or "").strip(),
            "sizes": sizes,
            "image": "",
            "ai_enhanced": False,
            "try_at_doorstep": False,
            "stock": {s: stock for s in sizes} if sizes else {"default": stock},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.products.insert_one(doc)
        created.append(name)
    cnt = await db.products.count_documents({"store_id": store_id})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    return {"created": len(created), "names": created[:20]}


# ====== Merchant AI ======
@api.post("/merchant/ai/copy")
async def merchant_ai_copy(payload: AICopyRequest, user: dict = Depends(get_current_user)):
    try:
        return await generate_product_copy(payload.product_name, payload.category or "", payload.notes or "")
    except Exception as e:
        log.exception("AI copy failed")
        raise HTTPException(500, f"AI copy generation failed: {e}")


@api.post("/merchant/ai/enhance-image")
async def merchant_ai_enhance(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    content = await file.read()
    b64 = base64.b64encode(content).decode()
    enhanced = await enhance_product_image(b64)
    if enhanced:
        return {"enhanced_base64": enhanced, "source": "gemini-nano-banana"}
    return {
        "enhanced_base64": None,
        "fallback_url": "https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/85d2c0f8f4172341be04027aee7a0cdd867b695317ee9a9a01a9e2b11653670e.png",
        "source": "fallback",
    }


@api.post("/merchant/ai/tryon")
async def merchant_ai_tryon(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """AI Model Try-On: place product on a realistic model WITHOUT changing the design."""
    content = await file.read()
    b64 = base64.b64encode(content).decode()
    result = await ai_model_tryon(b64)
    if result:
        return {"image_base64": result, "source": "gemini-nano-banana"}
    return {
        "image_base64": None,
        "fallback_url": "https://images.unsplash.com/photo-1610189012906-4c0aa9b9781e?w=800&auto=format&fit=crop&q=80",
        "source": "fallback",
    }


# ====== Merchant Analytics ======
def _period_window(period: str):
    now = datetime.now(timezone.utc)
    if period == "yesterday":
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return start, end
    if period == "7d":
        return now - timedelta(days=7), now
    if period == "30d":
        return now - timedelta(days=30), now
    if period == "quarter":
        return now - timedelta(days=90), now
    return now - timedelta(days=30), now


@api.get("/merchant/analytics")
async def merchant_analytics(period: str = "30d", user: dict = Depends(get_current_user)):
    start, end = _period_window(period)
    mid = user["sub"]

    # Real orders
    orders = await db.orders.find(
        {"merchant_ids": mid, "created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).to_list(1000)

    revenue = sum(float(o.get("total", 0)) for o in orders)
    count = len(orders)

    # daily revenue series
    by_day = {}
    for o in orders:
        try:
            d = datetime.fromisoformat(o["created_at"]).date().isoformat()
        except Exception:
            continue
        by_day[d] = by_day.get(d, 0) + float(o.get("total", 0))

    # If empty (new merchant), generate demo trend so dashboard isn't empty
    demo_mode = count == 0
    if demo_mode:
        days = max(1, int((end - start).total_seconds() / 86400))
        for i in range(min(days, 30)):
            d = (end - timedelta(days=i)).date().isoformat()
            by_day[d] = round(random.uniform(2400, 18500), 2)
        revenue = sum(by_day.values())
        count = max(8, int(revenue / 1800))

    repeat_rate = 0
    if count >= 4:
        # heuristic
        repeat_rate = min(58, int(count * 0.42))
    elif demo_mode:
        repeat_rate = 34

    top_products = []
    if not demo_mode:
        # group by product
        agg = {}
        for o in orders:
            for it in o.get("items", []):
                key = it.get("id") or it.get("name")
                if not key:
                    continue
                agg.setdefault(key, {"name": it.get("name", "Product"), "sold": 0, "revenue": 0})
                agg[key]["sold"] += int(it.get("qty", 1))
                agg[key]["revenue"] += float(it.get("price", 0)) * int(it.get("qty", 1))
        top_products = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)[:5]
    else:
        top_products = [
            {"name": "Hand-Block Indigo Kurta", "sold": 48, "revenue": 91152},
            {"name": "Bandhani Anarkali", "sold": 22, "revenue": 94578},
            {"name": "Chanderi Silk Saree", "sold": 16, "revenue": 87984},
        ]

    sorted_days = sorted(by_day.keys())
    trend = [{"date": d, "revenue": by_day[d]} for d in sorted_days[-14:]]

    return {
        "period": period,
        "revenue": round(revenue, 2),
        "orders": count,
        "avg_order_value": round(revenue / count, 2) if count else 0,
        "repeat_rate": repeat_rate,
        "conversion": 4.2,
        "trend": trend,
        "top_products": top_products,
        "demo_mode": demo_mode,
    }


@api.get("/merchant/analytics/report.csv")
async def merchant_report_csv(period: str = "30d", user: dict = Depends(get_current_user)):
    start, end = _period_window(period)
    orders = await db.orders.find(
        {"merchant_ids": user["sub"], "created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).to_list(2000)

    if not orders:
        # Provide a demo CSV so download still works
        rows = []
        for i in range(20):
            day = (end - timedelta(days=random.randint(0, 28))).date().isoformat()
            rows.append({
                "date": day,
                "order_id": f"BFO-DEMO-{i+1:03d}",
                "product": random.choice(["Indigo Kurta", "Bandhani Anarkali", "Linen Co-ord"]),
                "qty": random.randint(1, 3),
                "amount": round(random.uniform(900, 5400), 2),
                "payment": random.choice(["UPI", "COD", "Card"]),
            })
    else:
        rows = []
        for o in orders:
            for it in o.get("items", []):
                rows.append({
                    "date": o.get("created_at", "")[:10],
                    "order_id": o.get("id"),
                    "product": it.get("name"),
                    "qty": it.get("qty"),
                    "amount": float(it.get("price", 0)) * int(it.get("qty", 1)),
                    "payment": o.get("payment_method"),
                })

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["date", "order_id", "product", "qty", "amount", "payment"])
    w.writeheader()
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="bharat-sales-{period}.csv"'},
    )


@api.get("/merchant/dashboard")
async def merchant_dashboard(user: dict = Depends(get_current_user)):
    # Backward-compatible — uses 30d analytics
    return await merchant_analytics(period="30d", user=user)


# ====== Admin ======
def _admin_token():
    return create_token("admin", "admin")


def _check_admin(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin token required")
    from auth import decode_token
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload.get("role") != "admin":
        raise HTTPException(403, "Not an admin")
    return payload


@api.post("/admin/login")
async def admin_login(payload: AdminLogin):
    if payload.email != ADMIN_EMAIL or payload.password != ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid admin credentials")
    return {"token": _admin_token(), "admin": {"email": ADMIN_EMAIL, "role": "admin"}}


@api.get("/admin/merchants")
async def admin_merchants(request: Request, status: Optional[str] = None):
    _check_admin(request.headers.get("authorization"))
    q = {}
    if status:
        q["kyc_status"] = status
    docs = await db.merchants.find(
        q,
        {"_id": 0, "password_hash": 0, "pan_doc_b64": 0, "gst_doc_b64": 0, "cancelled_cheque_b64": 0},
    ).sort("kyc_submitted_at", -1).to_list(500)
    return docs


@api.get("/admin/merchants/{mid}")
async def admin_merchant_detail(mid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
    if not m:
        raise HTTPException(404, "Not found")
    return m


@api.post("/admin/merchants/{mid}/approve")
async def admin_approve(mid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
    m = await db.merchants.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Not found")
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "type": "kyc-approved",
        "title": "Your KYC is approved",
        "body": "Welcome to Bharat Fashion OS! Set up your storefront and start adding products.",
        "time": now,
    }
    await db.merchants.update_one(
        {"id": mid},
        {"$set": {"kyc_status": "approved", "approved_at": now}, "$push": {"notifications": msg}},
    )
    log.info("[ADMIN] Approved merchant %s (mock notification sent)", mid)
    return {"ok": True}


@api.post("/admin/merchants/{mid}/reject")
async def admin_reject(mid: str, request: Request, body: dict = None):
    _check_admin(request.headers.get("authorization"))
    reason = (body or {}).get("reason", "Documents need re-verification.")
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "type": "kyc-rejected",
        "title": "KYC needs attention",
        "body": reason,
        "time": now,
    }
    await db.merchants.update_one(
        {"id": mid},
        {"$set": {"kyc_status": "rejected"}, "$push": {"notifications": msg}},
    )
    return {"ok": True}


@api.get("/admin/stats")
async def admin_stats(request: Request):
    _check_admin(request.headers.get("authorization"))
    submitted = await db.merchants.count_documents({"kyc_status": "submitted"})
    approved = await db.merchants.count_documents({"kyc_status": "approved"})
    rejected = await db.merchants.count_documents({"kyc_status": "rejected"})
    return {"submitted": submitted, "approved": approved, "rejected": rejected}


# ====== Geo (existing) ======
PILOT_CITIES = [
    {"name": "Bhilai", "lat": 21.2147, "lng": 81.3850},
    {"name": "Raipur", "lat": 21.2514, "lng": 81.6296},
]


def _nearest_pilot_city(lat: float, lng: float):
    import math
    best, best_d = None, 1e9
    for c in PILOT_CITIES:
        dx = (lng - c["lng"]) * math.cos(math.radians((lat + c["lat"]) / 2))
        dy = lat - c["lat"]
        d = math.sqrt(dx * dx + dy * dy) * 111.0
        if d < best_d:
            best_d, best = d, c["name"]
    return best if best_d <= 50 else None


@api.get("/geo/detect")
async def geo_detect(lat: Optional[float] = None, lng: Optional[float] = None, request: Request = None):
    import httpx
    detected_city = None
    source = None
    if lat is not None and lng is not None:
        detected_city = _nearest_pilot_city(lat, lng)
        source = "gps"
        if detected_city:
            return {"city": detected_city, "supported": True, "detected_city": detected_city, "source": source}
    try:
        client_ip = None
        if request is not None:
            xff = request.headers.get("x-forwarded-for", "")
            client_ip = xff.split(",")[0].strip() if xff else request.client.host
        async with httpx.AsyncClient(timeout=5) as cli:
            url = f"https://ipapi.co/{client_ip}/json/" if client_ip else "https://ipapi.co/json/"
            r = await cli.get(url)
            data = r.json() if r.status_code == 200 else {}
        ip_city = (data.get("city") or "").strip()
        ip_lat = data.get("latitude")
        ip_lng = data.get("longitude")
        source = source or "ip"
        if ip_lat is not None and ip_lng is not None:
            nearest = _nearest_pilot_city(float(ip_lat), float(ip_lng))
            if nearest:
                return {"city": nearest, "supported": True, "detected_city": ip_city or nearest, "source": source}
        return {"city": None, "supported": False, "detected_city": ip_city or "Unknown", "source": source}
    except Exception as e:
        log.warning("Geo detection failed: %s", e)
        return {"city": None, "supported": False, "detected_city": "Unknown", "source": source or "none"}


# ====== Seed / Root ======
@api.post("/seed")
async def seed():
    cats, stores, products = build_seed_docs()
    await db.categories.delete_many({})
    await db.stores.delete_many({"seeded": True})
    await db.products.delete_many({"merchant_id": {"$exists": False}})
    if cats:
        await db.categories.insert_many(cats)
    if stores:
        for s in stores:
            s["seeded"] = True
            s["kyc_status"] = "approved"
            s["published"] = True
            s["product_count"] = 999
        await db.stores.insert_many(stores)
    if products:
        await db.products.insert_many(products)
    return {"categories": len(cats), "stores": len(stores), "products": len(products)}


@api.get("/")
async def root():
    return {"app": "Bharat Fashion OS", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_seed():
    # Categories are still needed for product taxonomy
    if not await db.categories.count_documents({}):
        cats, _stores, _products = build_seed_docs()
        await db.categories.insert_many(cats)
        log.info("Seeded %d categories", len(cats))

    # Wipe any pre-existing fake seeded stores/products on every boot — pilot is live-merchants only
    deleted_stores = (await db.stores.delete_many({"seeded": True})).deleted_count
    deleted_products = (await db.products.delete_many({"merchant_id": {"$exists": False}})).deleted_count
    if deleted_stores or deleted_products:
        log.info("Removed %d seeded stores and %d seeded products", deleted_stores, deleted_products)

    # Auto-approve the demo merchant so the post-approval flow is demoable
    demo = await db.merchants.find_one({"email": "demo@bharat-os.com"}, {"_id": 0})
    if demo and demo.get("kyc_status") != "approved":
        store_id = f"store-m-{demo['id']}"
        now = datetime.now(timezone.utc).isoformat()
        await db.merchants.update_one(
            {"id": demo["id"]},
            {"$set": {
                "kyc_status": "approved",
                "approved_at": now,
                "pan_number": "DEMOP1234D",
                "business_name": "Demo Boutique Pvt Ltd",
                "business_category": "Multi-category",
                "business_type": "Pvt Ltd",
                "business_address": "Sector 10, Bhilai 490006",
                "bank_account_number": "1234567890",
                "bank_ifsc": "SBIN0001234",
                "account_holder_name": "Demo Owner",
            }, "$push": {"notifications": {
                "type": "kyc-approved",
                "title": "Your KYC is approved",
                "body": "Welcome to Bharat Fashion OS! Set up your storefront and start adding products.",
                "time": now,
            }}},
        )
        log.info("Demo merchant auto-approved (storefront/products not pre-created — go through the flow)")


@app.on_event("shutdown")
async def shutdown():
    client.close()
