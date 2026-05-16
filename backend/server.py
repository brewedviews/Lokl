"""Bharat Fashion OS — FastAPI backend."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import base64
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone

from auth import hash_password, verify_password, create_token, get_current_user
from ai_service import generate_product_copy, enhance_product_image
from seed_data import build_seed_docs

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Bharat Fashion OS")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bharat")


# ====== Pydantic ======
class MerchantSignup(BaseModel):
    email: EmailStr
    password: str
    store_name: str
    owner_name: str
    phone: Optional[str] = None
    city: Optional[str] = "Jaipur"


class MerchantLogin(BaseModel):
    email: EmailStr
    password: str


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


class OrderCreate(BaseModel):
    items: List[dict]
    address: dict
    total: float
    payment_method: str = "COD"


class AICopyRequest(BaseModel):
    product_name: str
    category: Optional[str] = ""
    notes: Optional[str] = ""


# ====== Auth Routes ======
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
    }
    await db.merchants.insert_one(doc)
    token = create_token(merchant_id, "merchant")
    return {"token": token, "merchant": {k: v for k, v in doc.items() if k not in ("password_hash", "_id")}}


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
    cats = await db.categories.find({}, {"_id": 0}).to_list(100)
    return cats


@api.get("/stores")
async def list_stores(city: Optional[str] = None, limit: int = 50):
    q = {"city": city} if city else {}
    stores = await db.stores.find(q, {"_id": 0}).sort("distance_km", 1).to_list(limit)
    return stores


@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Store not found")
    products = await db.products.find({"store_id": store_id}, {"_id": 0}).to_list(200)
    return {"store": s, "products": products}


@api.get("/products")
async def list_products(category: Optional[str] = None, store: Optional[str] = None,
                        sort: str = "trending", limit: int = 100):
    q = {}
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
        {"category_id": p["category_id"], "id": {"$ne": product_id}},
        {"_id": 0}
    ).limit(8).to_list(8)
    return {"product": p, "similar": similar}


@api.post("/orders")
async def create_order(payload: OrderCreate):
    order_id = f"BFO-{uuid.uuid4().hex[:8].upper()}"
    doc = {
        "id": order_id,
        "items": payload.items,
        "address": payload.address,
        "total": payload.total,
        "payment_method": payload.payment_method,
        "status": "confirmed",
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


# ====== Merchant Routes ======
@api.get("/merchant/dashboard")
async def merchant_dashboard(user: dict = Depends(get_current_user)):
    mid = user["sub"]
    products = await db.products.count_documents({"merchant_id": mid})
    orders = await db.orders.count_documents({"merchant_id": mid})
    # Mock analytics
    return {
        "revenue": 142850,
        "orders": orders + 38,
        "products": products,
        "repeat_rate": 34,
        "conversion": 4.2,
        "trends": [
            {"day": "Mon", "revenue": 12400},
            {"day": "Tue", "revenue": 18900},
            {"day": "Wed", "revenue": 22100},
            {"day": "Thu", "revenue": 19500},
            {"day": "Fri", "revenue": 28700},
            {"day": "Sat", "revenue": 35200},
            {"day": "Sun", "revenue": 26050},
        ],
        "top_products": [
            {"name": "Hand-Block Indigo Kurta", "sold": 48, "revenue": 91152},
            {"name": "Bandhani Anarkali", "sold": 22, "revenue": 94578},
            {"name": "Chanderi Silk Saree", "sold": 16, "revenue": 87984},
        ],
    }


@api.get("/merchant/products")
async def merchant_products(user: dict = Depends(get_current_user)):
    products = await db.products.find({"merchant_id": user["sub"]}, {"_id": 0}).to_list(500)
    return products


@api.post("/merchant/products")
async def create_merchant_product(payload: ProductCreate, user: dict = Depends(get_current_user)):
    merchant = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not merchant:
        raise HTTPException(404, "Merchant not found")
    pid = f"prod-{uuid.uuid4().hex[:10]}"
    doc = {
        "id": pid,
        "merchant_id": user["sub"],
        "store_id": user["sub"],  # merchant's own store
        "store_name": merchant["store_name"],
        "store_city": merchant.get("city", ""),
        "store_distance_km": 1.5,
        "store_eta_min": 40,
        "rating": 4.5,
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.post("/merchant/ai/copy")
async def merchant_ai_copy(payload: AICopyRequest, user: dict = Depends(get_current_user)):
    """Generate product copy with Claude Sonnet 4.5."""
    try:
        result = await generate_product_copy(payload.product_name, payload.category or "", payload.notes or "")
        return result
    except Exception as e:
        log.exception("AI copy failed")
        raise HTTPException(500, f"AI copy generation failed: {e}")


@api.post("/merchant/ai/enhance-image")
async def merchant_ai_enhance(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Enhance raw photo using Gemini Nano Banana. Returns base64 of enhanced image.
    Falls back to a curated 'after' image if Gemini doesn't return one."""
    content = await file.read()
    b64 = base64.b64encode(content).decode()
    enhanced = await enhance_product_image(b64)
    if enhanced:
        return {"enhanced_base64": enhanced, "source": "gemini-nano-banana"}
    # Demo fallback so investor demo never breaks
    return {
        "enhanced_base64": None,
        "fallback_url": "https://static.prod-images.emergentagent.com/jobs/7eafffce-c685-4839-ad08-06796579c4de/images/85d2c0f8f4172341be04027aee7a0cdd867b695317ee9a9a01a9e2b11653670e.png",
        "source": "fallback",
    }


# ====== Seed ======
@api.post("/seed")
async def seed():
    cats, stores, products = build_seed_docs()
    await db.categories.delete_many({})
    await db.stores.delete_many({})
    await db.products.delete_many({})
    if cats:
        await db.categories.insert_many(cats)
    if stores:
        await db.stores.insert_many(stores)
    if products:
        await db.products.insert_many(products)
    return {
        "categories": len(cats),
        "stores": len(stores),
        "products": len(products),
    }


@api.get("/")
async def root():
    return {"app": "Bharat Fashion OS", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_seed():
    """Auto-seed on startup if empty."""
    count = await db.stores.count_documents({})
    if count == 0:
        cats, stores, products = build_seed_docs()
        await db.categories.insert_many(cats)
        await db.stores.insert_many(stores)
        await db.products.insert_many(products)
        log.info("Seeded %d stores, %d products", len(stores), len(products))


@app.on_event("shutdown")
async def shutdown():
    client.close()
