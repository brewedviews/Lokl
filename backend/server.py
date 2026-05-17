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
)

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
    phone: Optional[str] = None; city: Optional[str] = "Bhilai"

class MerchantLogin(BaseModel): email: EmailStr; password: str
class AdminLogin(BaseModel): email: EmailStr; password: str

class KycSubmit(BaseModel):
    pan_number: str; gst_number: Optional[str] = ""
    business_name: str; business_category: str; business_type: str; business_address: str
    bank_account_number: str; bank_ifsc: str; account_holder_name: str
    pan_doc_b64: Optional[str] = ""; gst_doc_b64: Optional[str] = ""; cancelled_cheque_b64: str

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
    if await db.merchants.find_one({"email": payload.email}, {"_id": 0}):
        raise HTTPException(400, "Email already registered")
    mid = f"m-{uuid.uuid4().hex[:10]}"
    doc = {"id": mid, "email": payload.email, "password_hash": hash_password(payload.password),
           "store_name": payload.store_name, "owner_name": payload.owner_name,
           "phone": payload.phone, "city": payload.city,
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

@api.get("/categories/{l1_id}/l2")
async def list_l2(l1_id: str):
    return await db.subcategories.find({"l1_id": l1_id}, {"_id": 0}).to_list(50)


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
    stores = await db.stores.find(q, {"_id": 0}).sort("distance_km", 1).to_list(limit)
    open_list, offline_list = [], []
    for s in stores:
        is_open, next_label = _is_store_open_now(s)
        s["is_open"] = is_open
        if not is_open:
            s["next_open_label"] = next_label
            offline_list.append(s)
        else:
            open_list.append(s)
    return open_list + offline_list  # open first, offline at the bottom

@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one({"id": store_id, **_visible_store_filter()}, {"_id": 0})
    if not s: raise HTTPException(404, "Store not found")
    is_open, next_label = _is_store_open_now(s)
    s["is_open"] = is_open
    s["next_open_label"] = next_label
    products = await db.products.find({"store_id": store_id, **_visible_product_filter()}, {"_id": 0}).to_list(200)
    for p in products:
        p["store_is_open"] = is_open
        if not is_open:
            p["next_open_label"] = next_label
    return {"store": s, "products": products}

@api.get("/products")
async def list_products(l1: Optional[str] = None, l2: Optional[str] = None,
                        gender: Optional[str] = None, store: Optional[str] = None,
                        sort: str = "trending", limit: int = 100):
    visible_ids = await db.stores.find(_visible_store_filter(), {"_id": 0, "id": 1}).to_list(1000)
    visible_set = {s["id"] for s in visible_ids}
    q = {"store_id": {"$in": list(visible_set)}, **_visible_product_filter()}
    if l1: q["l1_id"] = l1
    if l2: q["l2_id"] = l2
    if gender: q["gender"] = gender
    if store: q["store_id"] = store
    cursor = db.products.find(q, {"_id": 0})
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
    similar = await db.products.find(similar_q, {"_id": 0}).limit(8).to_list(8)
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
    for it in payload.items:
        p = await db.products.find_one({"id": it.get("id")}, {"merchant_id": 1, "_id": 0})
        if p and p.get("merchant_id"): merchant_ids.append(p["merchant_id"])
    now = datetime.now(timezone.utc).isoformat()
    # 4-digit OTP shared across customer / admin / merchant for rider handoff verification
    otp = f"{random.randint(1000, 9999)}"
    doc = {"id": order_id, "items": payload.items, "address": payload.address,
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
    await db.orders.update_one({"id": oid}, {"$set": {"status": "delivered", "timeline": tl}})
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
    await db.merchants.update_one({"id": user["sub"]}, {"$set": {
        **payload.model_dump(),
        "kyc_status": "submitted",
        "kyc_submitted_at": datetime.now(timezone.utc).isoformat(),
        "hold_comment": None, "hold_at": None}})
    return {"ok": True, "kyc_status": "submitted"}

@api.get("/merchant/kyc/status")
async def kyc_status(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]},
        {"_id": 0, "password_hash": 0, "pan_doc_b64": 0, "gst_doc_b64": 0, "cancelled_cheque_b64": 0})
    if not m: raise HTTPException(404, "Not found")
    return {"kyc_status": m.get("kyc_status", "draft"), "merchant": m}

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
    doc.pop("_id", None); return doc

@api.put("/merchant/products/{pid}")
async def update_merchant_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": pid, "merchant_id": user["sub"]}, {"_id": 0})
    if not p: raise HTTPException(404, "Product not found")
    payload.pop("id", None); payload.pop("merchant_id", None)
    await db.products.update_one({"id": pid}, {"$set": payload})
    return await db.products.find_one({"id": pid}, {"_id": 0})

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
        return {"updated": r.modified_count, "paused": new_paused}
    raise HTTPException(400, "Unknown action")



@api.post("/merchant/products/bulk")
async def bulk_products(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """CSV columns: name, description, l1, l2, gender, mrp, price,
    sizes (semicolon-separated, e.g. `S;M;L`),
    stock_per_size (semicolon-separated counts matching sizes, e.g. `50;100;39`).
    A single integer in stock_per_size means "same qty for every size"."""
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved")
    raw = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    l1_by_name = {c["name"].lower(): c["id"] for c in L1_CATEGORIES}
    l2_by_name = {}
    for lid, subs in L2_BY_L1.items():
        for s in subs: l2_by_name[(lid, s["name"].lower())] = s["id"]
    store_id = f"store-m-{user['sub']}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not store: raise HTTPException(400, "Set up storefront first")
    created, skipped = [], []
    for row in reader:
        name = (row.get("name") or row.get("Name") or "").strip()
        if not name: continue
        l1_name = (row.get("l1") or row.get("category") or "").strip().lower()
        l1_id = l1_by_name.get(l1_name)
        if not l1_id: skipped.append(name); continue
        l2_name = (row.get("l2") or row.get("subcategory") or "").strip().lower()
        l2_id = l2_by_name.get((l1_id, l2_name), "") if l2_name else ""
        gender = (row.get("gender") or "").strip().lower()
        # Validate L1/L2/gender
        if l1_id in L2_BY_L1 and not l2_id: skipped.append(name); continue
        if l1_id not in L2_BY_L1 and not gender: gender = "unisex"
        sizes_raw = (row.get("sizes") or "").strip()
        sizes = [s.strip() for s in sizes_raw.replace("|", ";").split(";") if s.strip()] if sizes_raw else []
        try: price = float((row.get("price") or row.get("selling_price") or 0) or 0)
        except ValueError: price = 0
        try: mrp = float(row.get("mrp") or 0)
        except ValueError: mrp = 0
        # stock_per_size: semicolon-separated counts matching sizes positionally.
        # Backwards compat: a single integer means "same qty for every size".
        stock_raw = (row.get("stock_per_size") or row.get("stock") or "").strip()
        stock_dict = {}
        if stock_raw:
            parts = [p.strip() for p in stock_raw.replace("|", ";").split(";") if p.strip() != ""]
            if len(parts) == len(sizes) and sizes:
                for sz, n in zip(sizes, parts):
                    try: stock_dict[sz] = int(float(n))
                    except ValueError: stock_dict[sz] = 0
            elif len(parts) == 1 and sizes:
                try: only = int(float(parts[0]))
                except ValueError: only = 0
                stock_dict = {sz: only for sz in sizes}
            elif not sizes:
                try: stock_dict = {"default": int(float(parts[0]))}
                except ValueError: stock_dict = {"default": 0}
            else:
                # Mismatched count → skip row to avoid silent corruption
                skipped.append(name); continue
        pid = f"prod-{uuid.uuid4().hex[:10]}"
        await db.products.insert_one({"id": pid, "merchant_id": user["sub"], "store_id": store_id,
            "store_name": m["store_name"], "store_city": m.get("city", ""),
            "store_distance_km": store["distance_km"], "store_eta_min": store["eta_min"],
            "rating": 4.5, "paused": False, "name": name, "price": price,
            "mrp": mrp or None, "l1_id": l1_id, "l2_id": l2_id, "gender": gender,
            "description": (row.get("description") or "").strip(),
            "sizes": sizes, "image": "", "ai_enhanced": False, "try_at_doorstep": False,
            "stock": stock_dict or {"default": 0},
            "created_at": datetime.now(timezone.utc).isoformat()})
        created.append(name)
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    return {"created": len(created), "skipped": skipped, "names": created[:20]}


# ===== Merchant AI =====
@api.post("/merchant/ai/copy")
async def merchant_ai_copy(payload: AICopyRequest, user: dict = Depends(get_current_user)):
    try: return await generate_product_copy(payload.product_name, payload.category or "", payload.notes or "")
    except Exception as e: raise HTTPException(500, f"AI copy generation failed: {e}")

@api.post("/merchant/ai/enhance-image")
async def merchant_ai_enhance(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    b64 = base64.b64encode(await file.read()).decode()
    enhanced = await enhance_product_image(b64)
    if enhanced:
        return {"enhanced_base64": enhanced, "source": "gemini-nano-banana"}
    return {"enhanced_base64": None, "source": "failed",
            "message": "AI couldn't process this image. Try uploading a clear, well-lit product photo."}

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
        "trend": [{"date": d, "revenue": by_day[d]} for d in sorted(by_day.keys())[-14:]],
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

    # Parse `<4-digit OTP> - Delivered` (also accepts ":" / variants)
    import re as _re
    m = _re.search(r"\b(\d{4})\b[\s\-:]*delivered\b", body, _re.IGNORECASE)
    twiml_empty = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    if not m:
        return Response(content=twiml_empty, media_type="application/xml")

    otp = m.group(1)
    # Restrict to RIDER_PHONE if configured (so random WhatsApp messages can't trigger)
    rider_env = (os.environ.get("RIDER_PHONE") or "").replace("+", "").replace(" ", "")
    if rider_env:
        sender = from_addr.replace("whatsapp:", "").replace("+", "").replace(" ", "")
        if not sender.endswith(rider_env[-10:]):
            log.warning("[Twilio inbound] OTP from non-rider %s", from_addr)
            return Response(content=twiml_empty, media_type="application/xml")

    o = await db.orders.find_one({"otp": otp, "status": {"$in": ["accepted", "on_the_way"]}}, {"_id": 0})
    if not o:
        log.warning("[Twilio inbound] no matching live order for OTP %s", otp)
        return Response(content=twiml_empty, media_type="application/xml")

    now = datetime.now(timezone.utc).isoformat()
    tl = o.get("timeline", [])
    for t in tl:
        if t["label"] == "Delivered" and not t["time"]:
            t["time"] = now; break
    await db.orders.update_one({"id": o["id"]}, {"$set": {"status": "delivered", "timeline": tl, "delivered_via": "rider-whatsapp"}})
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
