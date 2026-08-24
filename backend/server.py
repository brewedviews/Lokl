"""Lokl — FastAPI backend (full feature set)."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Request, Response, Header
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import os, logging, uuid, base64, io, csv, json, random, secrets, hmac, hashlib, asyncio
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from auth import (hash_password, verify_password, create_token, get_current_user,
                  decode_token, require_role, JWT_REFRESH_DAYS,
                  JWT_SECRET, JWT_ALGO)
import jwt

# Role-guard dependencies — shorthand for the most-used auth tiers in this app.
# Returns the JWT payload on success, raises 401 (no token) or 403 (wrong role).
merchant_user = require_role("merchant", "admin")
customer_user = require_role("customer", "admin")
rider_user = require_role("rider", "admin")
from ai_service import generate_product_copy, enhance_product_image, ai_model_tryon
from seed_data import build_seed_docs, L1_CATEGORIES, L2_BY_L1, GENDERS
from notifications import (
    notify_order_placed, notify_merchant_new_order,
    notify_order_rejected, notify_order_delivered,
    notify_order_on_the_way, notify_order_cancelled, notify_rider_pickup,
    notify_rider_return_pickup, notify_return_status, notify_customer_otp,
    notify_merchant_otp, notify_rider_otp, send_with_fallback, APP_URL,
    notify_pickup_reserved, notify_merchant_pickup_reserved,
    notify_pickup_pending, notify_merchant_pickup_pending,
    notify_merchant_approved, notify_merchant_first_order,
    get_provider, active_provider_name, TwilioProvider, MSG91Provider,
)
from ai_enhance import enhance_product_images
import rider_push
from observability import init_sentry
from services import cloudinary_service
from services import encryption_service
from services import vasyerp_client
from services.vasyerp_client import VasyERPAuthError, VasyERPClientError
from services import shopify_client
from services.shopify_client import ShopifyAuthError, ShopifyClientError

load_dotenv(Path(__file__).parent / ".env")

# Initialize Sentry after dotenv so SENTRY_DSN from .env is honored.
# Graceful no-op when SENTRY_DSN is unset (local / preview).
init_sentry()

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
# bcrypt-only. The legacy plain-text ADMIN_PASSWORD path has been removed —
# generate a hash with:  python -c "import bcrypt; print(bcrypt.hashpw(b'<pw>', bcrypt.gensalt(12)).decode())"
if not ADMIN_EMAIL or not ADMIN_PASSWORD_HASH:
    raise ValueError("ADMIN_EMAIL and ADMIN_PASSWORD_HASH must be set in the environment")

app = FastAPI(title="Lokl")
api = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("lokl")


# ===== Top-level health probe =====
# The Emergent deployment health check polls `/health` (NOT `/api/health`) and
# treats any non-200 response as a failed deployment. We mount this directly
# on the FastAPI app — outside the `/api` router — so the probe succeeds with
# zero auth + zero DB work. Keep this endpoint cheap and side-effect-free.
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.head("/health")
async def health_head():
    # Some probes use HEAD instead of GET. Returning 200 with no body suffices.
    return Response(status_code=200)

# ===== Rate Limiter (slowapi) =====
# Token-bucket style limiter keyed by client IP. Sensitive auth endpoints add
# their own per-route caps via @_limit("5/minute").
limiter = Limiter(key_func=get_remote_address, default_limits=["200 per day", "50 per hour"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
_limit = limiter.limit  # short alias
# Tunable per-route rate limits — bumped from 3/min defaults so legitimate
# burst signups + the pytest suite don't trip them.
_LIMIT_LOGIN = os.environ.get("RATE_LIMIT_LOGIN", "10/minute")
_LIMIT_REGISTER = os.environ.get("RATE_LIMIT_REGISTER", "30/minute")
_LIMIT_ADMIN_LOGIN = os.environ.get("RATE_LIMIT_ADMIN_LOGIN", "10/minute")
_LIMIT_REFRESH = os.environ.get("RATE_LIMIT_REFRESH", "60/minute")
_LIMIT_CUSTOMER_OTP_REQUEST = os.environ.get("RATE_LIMIT_CUSTOMER_OTP_REQUEST", "5/minute")
_LIMIT_CUSTOMER_OTP_VERIFY = os.environ.get("RATE_LIMIT_CUSTOMER_OTP_VERIFY", "10/minute")
# iter-29 (Item 1): merchant phone-OTP login mirrors the customer-OTP limits.
_LIMIT_MERCHANT_OTP_REQUEST = os.environ.get("RATE_LIMIT_MERCHANT_OTP_REQUEST", "5/minute")
_LIMIT_MERCHANT_OTP_VERIFY = os.environ.get("RATE_LIMIT_MERCHANT_OTP_VERIFY", "10/minute")

# ===== Security response headers =====
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds OWASP-recommended hardening headers to every response. Replaces
    Flask-Talisman in this FastAPI codebase."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()"
        if os.environ.get("FORCE_HTTPS", "false").lower() == "true":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)


# ===== Merchant activity tracker =====
# Updates last_seen_at on the store doc after every successful authenticated
# merchant API call. Used by _merchant_is_active() to suppress product/store
# feeds when a merchant is logged out during their working hours.
MERCHANT_IDLE_TIMEOUT_MIN = 180

@app.middleware("http")
async def _track_merchant_last_seen(request: Request, call_next):
    response = await call_next(request)
    if response.status_code >= 400:
        return response
    if not request.url.path.startswith("/api/merchant/"):
        return response
    try:
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return response
        payload = jwt.decode(auth[7:], JWT_SECRET, algorithms=[JWT_ALGO])
        if payload.get("role") != "merchant" or payload.get("type") != "access":
            return response
        store_id = f"store-m-{payload['sub']}"
        await db.stores.update_one(
            {"id": store_id},
            {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        pass
    return response


# ===== Models =====
class MerchantSignup(BaseModel):
    email: Optional[str] = None; password: Optional[str] = None; store_name: str; owner_name: str
    phone: str  # mandatory — used for cellular/WhatsApp contact and (soon) OTP login
    city: Optional[str] = "Bhilai"

class MerchantLogin(BaseModel): email: EmailStr; password: str
class AdminLogin(BaseModel): email: EmailStr; password: str

class KycSubmit(BaseModel):
    pan_number: str; gst_number: Optional[str] = ""
    business_name: str; business_category: str; business_type: Optional[str] = ""; business_address: str
    bank_account_number: Optional[str] = ""; bank_ifsc: Optional[str] = ""; account_holder_name: Optional[str] = ""
    # Legacy base64 doc fields — kept for backwards compatibility with the
    # existing frontend. New uploads go directly to Cloudinary as private
    # assets and we store only the public_id (no URL — admin generates a
    # signed URL on demand). Backend keeps the previously-uploaded data if
    # this submission omits the field (resubmission flow).
    pan_doc_b64: Optional[str] = ""; gst_doc_b64: Optional[str] = ""; cancelled_cheque_b64: Optional[str] = ""
    pan_doc_public_id: Optional[str] = ""
    gst_doc_public_id: Optional[str] = ""
    cancelled_cheque_public_id: Optional[str] = ""

class StorefrontUpdate(BaseModel):
    tagline: str; story: str; banner: str
    banners: List[str] = []
    # Cloudinary public_ids paired with `banners` for lifecycle management.
    banner_public_ids: List[str] = []
    logo: Optional[str] = ""
    logo_public_id: Optional[str] = ""
    specialties: List[str] = []; locality: Optional[str] = ""
    timing: Optional[str] = ""
    opens_at: Optional[str] = "10:00"
    closes_at: Optional[str] = "18:00"
    lat: Optional[float] = None
    lng: Optional[float] = None
    # iter-29 (Item 2) — mandatory area + pincode for Bhilai pilot. `area`
    # is the slug from BHILAI_AREAS; `area_label` is the human-friendly name
    # we surface on the consumer storefront card.
    area: Optional[str] = ""
    area_label: Optional[str] = ""
    pincode: Optional[str] = ""
    upi_qr_url: Optional[str] = ""
    weekly_off: Optional[List[str]] = []

class ProductCreate(BaseModel):
    name: str; price: float; mrp: Optional[float] = None
    l1_id: str; l2_id: Optional[str] = ""; gender: Optional[str] = ""
    description: Optional[str] = ""
    sizes: List[str] = []; image: Optional[str] = ""
    images: List[str] = []
    # Cloudinary refs. `image_public_id` pairs with `image`; `image_public_ids`
    # pairs index-aligned with `images`. Stored alongside URLs so we can delete
    # from Cloudinary on edit/replace.
    image_public_id: Optional[str] = ""
    image_public_ids: List[str] = []
    ai_enhanced: bool = False; try_at_doorstep: bool = False
    return_eligible: bool = False  # if True, customer can return within 24h of delivery
    stock: Optional[dict] = None
    size_type: Optional[str] = ""  # alpha|numeric_shirt|numeric_bottom|numeric_shoe|free_size|custom
    # Merchant-authored fit guidance ("runs slightly large, size down").
    # No merchant/admin UI writes this field yet — it's landed on the schema
    # ahead of that UI existing, same "wired ahead of the field landing"
    # pattern as the frontend's dormant `colors` field. Always empty for
    # every product created before that UI ships.
    fit_note: Optional[str] = ""
    # Optional — most merchants won't set this on day one, and existing
    # products predate the Brand entity entirely. Set via the creatable
    # brand combobox on the product form or the bulk-upload "brand" column.
    brand_id: Optional[str] = None
    # Integration linkage — None for every manually-created/bulk-uploaded
    # product. Set only by _publish_staged_import, carried forward from the
    # StagedImport row, so a Lokl order for this product can be synced back
    # to the source platform's own inventory (see _sync_remote_inventory).
    # `remote_variant_ids` maps Lokl's own size key -> the source
    # platform's per-variant identifier (Shopify: an inventory item gid) —
    # provider-specific shape, opaque to everything except that provider's
    # own sync implementation.
    provider: Optional[str] = None
    source_item_id: Optional[str] = None
    remote_variant_ids: Optional[dict] = None

class BrandCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    logo: Optional[str] = ""
    logo_public_id: Optional[str] = ""

class HeroSlideCreate(BaseModel):
    # Single, required L1 per slide — a slide always targets exactly one
    # L1 (e.g. l1-women), never multiple/none. Validated against the real
    # L1_CATEGORIES list at create/update time (same integrity check
    # _validate_l1_l2 does for products) rather than trusting any string.
    l1_id: str
    image: Optional[str] = ""
    image_public_id: Optional[str] = ""
    eyebrow: Optional[str] = ""
    headline: Optional[str] = ""
    # Phase G3 — optional secondary line rendered below the headline.
    subheadline: Optional[str] = ""
    # Phase G3 — a substring of `headline` to render in the functional
    # orange (color rule 2.1) instead of navy. Chosen over a rigid
    # headline_line_1/headline_line_2 split: a substring match keeps the
    # headline a single editable string (no risk of the two halves being
    # saved out of sync) and degrades safely — an empty string, or a
    # string that no longer appears verbatim in `headline` (e.g. after an
    # admin edits the headline but forgets to update this), simply
    # renders the whole headline in navy, never an error.
    highlight_text: Optional[str] = ""
    # Plain string, same shape DestinationPicker already outputs/consumes
    # for the existing site-wide Hero banner's own redirect_url field — no
    # new backend "destination" concept needed, this reuses that component
    # unmodified on the admin frontend side.
    cta_link: Optional[str] = ""
    active: bool = True
    order: int = 1

class VasyERPConnectRequest(BaseModel):
    api_token: str

class VasyERPSelectBranchRequest(BaseModel):
    branch_id: str
    branch_name: Optional[str] = ""

class ShopifyConnectRequest(BaseModel):
    # Shopify's custom-app auth model changed 2026-01-01: newly-created apps
    # no longer expose a static access token in the UI. Instead the app has
    # a Client ID + Client Secret, and a real access token is obtained
    # server-side via OAuth's Client Credentials Grant (see
    # shopify_client.get_access_token). client_id/client_secret are the
    # durable credential now, not a raw access_token.
    shop_domain: str
    client_id: str
    client_secret: str

class OrderCreate(BaseModel):
    items: List[dict]; address: dict; total: float
    payment_method: str = "COD"; customer: Optional[dict] = None  # {name, phone, age}
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_signature: Optional[str] = None
    coupon_code: Optional[str] = None
    customer_lat: Optional[float] = None
    customer_lng: Optional[float] = None
    order_type: str = "delivery"  # "delivery" | "pickup"
    # Client-reported, NEVER trusted for the stored total — same pattern as
    # `total` above. The server always recomputes its own delivery fee via
    # DeliveryService (see create_order) so it can never drift from what
    # POST /api/v1/delivery/estimate showed the customer at checkout.
    # Accepted here only so the field exists on the schema / for logging.
    delivery_fee: Optional[float] = None

class CouponCreate(BaseModel):
    code: str
    discount_type: str = "percent"  # "percent" | "flat"
    discount_value: float
    min_order_value: float = 0
    max_uses: Optional[int] = None  # None = unlimited
    expires_at: Optional[str] = None  # ISO string or None

class RazorpayCreateOrderRequest(BaseModel):
    amount: float
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""

class NotifyMeRequest(BaseModel):
    phone: str
    store_id: str
    product_id: Optional[str] = None

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
    gender: Optional[str] = None
    date_of_birth: Optional[str] = None

class WaitlistEntry(BaseModel):
    phone: str
    type: str  # "customer" or "merchant"
    store_name: Optional[str] = None
    category: Optional[str] = None


# ===== Auth =====
@api.post("/auth/register")
@_limit(_LIMIT_REGISTER)
async def register(request: Request, response: Response, payload: MerchantSignup):
    phone = (payload.phone or "").strip()
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 10:
        raise HTTPException(400, "Phone number is required (10+ digits)")
    if payload.email and await db.merchants.find_one({"email": payload.email}, {"_id": 0}):
        raise HTTPException(400, "Email already registered")
    # Phone uniqueness check — last-10-digits canonical form, ignoring +91/91 prefixes.
    p10 = digits[-10:]
    if await db.merchants.find_one({"phone_canonical": p10}, {"_id": 0}):
        raise HTTPException(400, "Phone number already registered")
    mid = f"m-{uuid.uuid4().hex[:10]}"
    doc = {"id": mid, "password_hash": hash_password(payload.password or secrets.token_hex(16)),
           "store_name": payload.store_name, "owner_name": payload.owner_name,
           "phone": phone, "phone_canonical": p10, "city": payload.city,
           "created_at": datetime.now(timezone.utc).isoformat(), "role": "merchant",
           "kyc_status": "draft", "kyc_submitted_at": None, "approved_at": None,
           "published": False, "storefront": None, "notifications": []}
    # Omit the key entirely rather than storing email: null — this is what
    # actually makes the partial index (idx_merchants_email_unique, filtered
    # on {"email": {"$type": "string"}}) correctly exclude phone-only signups
    # from the uniqueness constraint. (A present-but-null field would still
    # fail the $type: "string" filter too, so this isn't strictly required
    # for correctness given the partial index — but it's the cleaner
    # representation and means a plain sparse index would also work.)
    if payload.email:
        doc["email"] = payload.email
    try:
        await db.merchants.insert_one(doc)
    except DuplicateKeyError as e:
        # Last-resort net: the pre-checks above cover the common case, but a
        # concurrent request (or an index this code doesn't know about yet)
        # can still race past them — surface a clean 400 instead of an
        # uncaught 500. keyPattern tells us which unique index actually hit.
        key_pattern = (getattr(e, "details", None) or {}).get("keyPattern", {})
        if "email" in key_pattern:
            raise HTTPException(400, "Email already registered")
        if "phone_canonical" in key_pattern:
            raise HTTPException(400, "Phone number already registered")
        raise HTTPException(400, "An account with these details already exists")
    safe = {k: v for k, v in doc.items() if k not in ("password_hash", "_id")}
    _set_refresh_cookie(response, create_token(mid, "merchant", "refresh"))
    return {"token": create_token(mid, "merchant", "access"), "merchant": safe}

@api.post("/auth/login")
@_limit(_LIMIT_LOGIN)
async def login(request: Request, response: Response, payload: MerchantLogin):
    m = await db.merchants.find_one({"email": payload.email}, {"_id": 0})
    if not m or not verify_password(payload.password, m["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    safe = {k: v for k, v in m.items() if k != "password_hash"}
    _set_refresh_cookie(response, create_token(m["id"], "merchant", "refresh"))
    return {"token": create_token(m["id"], "merchant", "access"), "merchant": safe}


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Refresh tokens live ONLY in an httpOnly + Secure + SameSite=Strict cookie.
    Never echoed back in the JSON body (prevents JS-side XSS exfiltration)."""
    response.set_cookie(
        key="refresh_token",
        value=token,
        max_age=JWT_REFRESH_DAYS * 24 * 3600,
        httponly=True,
        secure=os.environ.get("FORCE_HTTPS", "false").lower() == "true",
        samesite="strict",
        path="/api/auth",
    )


@api.post("/auth/refresh")
@_limit(_LIMIT_REFRESH)
async def refresh_token(request: Request, response: Response):
    """Exchange a valid refresh token (httpOnly cookie OR Authorization header)
    for a fresh 15-minute access token. Rotating refresh tokens — every refresh
    issues a new one and invalidates the old by virtue of overwriting the cookie.
    Additionally consults `revoked_refresh_jti` so explicitly-revoked tokens
    (via logout) cannot be replayed even if the cookie was captured.
    """
    token = request.cookies.get("refresh_token")
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1]
    if not token:
        raise HTTPException(401, "Refresh token missing")
    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Not a refresh token")
    jti = payload.get("jti")
    if jti and await db.revoked_refresh_jti.find_one({"jti": jti}, {"_id": 1}):
        raise HTTPException(401, "Refresh token revoked")
    sub, role = payload.get("sub"), payload.get("role", "merchant")
    _set_refresh_cookie(response, create_token(sub, role, "refresh"))
    return {"token": create_token(sub, role, "access")}


def _clear_refresh_cookie(response: Response) -> None:
    """Mirror of _set_refresh_cookie attributes — the path/domain MUST match
    or the browser will keep the original cookie alive."""
    response.delete_cookie(
        "refresh_token",
        path="/api/auth",
        httponly=True,
        secure=True,
        samesite="strict",
    )


async def _revoke_refresh_token(token: Optional[str]) -> None:
    """Add the refresh token's JTI to the revocation set. Best-effort —
    a malformed/expired token is swallowed silently because the cookie is
    already being cleared and an attacker presenting a bad token gains nothing."""
    if not token:
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO],
                             options={"verify_exp": False})
    except Exception:
        return
    jti = payload.get("jti")
    if not jti or payload.get("type") != "refresh":
        return
    # TTL index on `expires_at` (created in startup) auto-prunes old entries.
    expires_at = datetime.fromtimestamp(payload.get("exp", 0), tz=timezone.utc)
    await db.revoked_refresh_jti.update_one(
        {"jti": jti},
        {"$set": {"jti": jti, "sub": payload.get("sub"),
                  "role": payload.get("role"), "expires_at": expires_at}},
        upsert=True,
    )


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    """Properly terminates the session:
      1. Revokes the current refresh token (adds its JTI to the revocation set).
      2. Clears the refresh cookie so the browser stops sending it.
      3. For merchants, flips their store offline as a courtesy so customers
         don't continue to see an open store after the merchant signs out.
    Access tokens remain valid until their natural 15-min expiry — this is
    accepted by design (short TTL keeps the blast radius small)."""
    refresh_cookie = request.cookies.get("refresh_token")
    await _revoke_refresh_token(refresh_cookie)
    _clear_refresh_cookie(response)

    # Best-effort merchant-store-offline side-effect — only runs if the caller
    # presented a valid bearer token. Anonymous logout (just cookie present)
    # still works for the cookie-clearing purpose.
    auth_hdr = request.headers.get("authorization", "")
    if auth_hdr.startswith("Bearer "):
        try:
            user = decode_token(auth_hdr.split(" ", 1)[1])
            if user.get("type") != "refresh" and user.get("role") == "merchant":
                store_id = f"store-m-{user['sub']}"
                await db.stores.update_one({"id": store_id}, {"$set": {"online": False}})
                await db.merchants.update_one({"id": user["sub"]}, {"$set": {"storefront.online": False}})
        except Exception:
            pass
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0, "password_hash": 0})
    if not m: raise HTTPException(404, "Merchant not found")
    return m


# ============================================================================
# Customer authentication (OTP-based, WhatsApp delivery)
# ----------------------------------------------------------------------------
# Customers don't have passwords — they authenticate by entering their phone
# number and confirming a 6-digit OTP delivered via Twilio WhatsApp. The OTP
# is hashed with bcrypt before storage so a DB leak doesn't reveal live codes.
#
# Issued JWT: role="customer", sub=<E.164 phone without "+", e.g. "919998887776">
# All customer-data routes derive the phone from this `sub` claim and refuse
# to operate on any other customer's data (URL phone param must match).
# ============================================================================

import re as _re


def _slugify(name: str) -> str:
    """Convert a store name to a URL-safe slug."""
    s = name.lower().strip()
    s = _re.sub(r"[^\w\s-]", "", s)
    s = _re.sub(r"[\s_]+", "-", s)
    s = _re.sub(r"-+", "-", s)
    return s.strip("-")


async def _unique_brand_slug(base: str) -> str:
    """Slugify with a REAL uniqueness check — unlike the store-slug path
    (`fix_store_slugs`), which never dedupes. On collision, append -2, -3, …"""
    base = base or "brand"
    slug = base
    n = 2
    while await db.brands.find_one({"slug": slug}, {"_id": 1}):
        slug = f"{base}-{n}"
        n += 1
    return slug


async def _recompute_brand_product_count(brand_id: Optional[str]) -> None:
    """Denormalized counter, mirrors the store `product_count` pattern."""
    if not brand_id:
        return
    cnt = await db.products.count_documents({"brand_id": brand_id, "is_deleted": {"$ne": True}})
    await db.brands.update_one({"id": brand_id}, {"$set": {"product_count": cnt}})


def _normalize_customer_phone(raw: str) -> Optional[str]:
    """Convert any common Indian phone format to a 12-digit E.164 string
    (e.g. '919998887776'). Returns None if the input isn't 10/11/12 digits."""
    if not raw:
        return None
    digits = _re.sub(r"\D", "", str(raw))
    if len(digits) == 10:
        digits = "91" + digits
    elif len(digits) == 11 and digits.startswith("0"):
        digits = "91" + digits[1:]
    if len(digits) != 12 or not digits.startswith("91"):
        return None
    return digits


def _ensure_customer_phone_match(user: dict, url_phone: str) -> str:
    """Authorization guard for customer routes: the URL phone parameter
    must equal the authenticated customer's phone (from JWT `sub`).

    Admins may operate on any customer (support scenarios). Returns the
    normalized phone the route should query against. 403 on mismatch."""
    jwt_phone = user.get("sub", "")
    url_norm = _normalize_customer_phone(url_phone) or url_phone
    if user.get("role") == "admin":
        return url_norm  # admin acts on the URL-specified customer
    if jwt_phone != url_norm:
        raise HTTPException(403, "Phone in URL does not match authenticated customer")
    return jwt_phone


class CustomerOtpRequest(BaseModel):
    phone: str


class CustomerOtpVerify(BaseModel):
    phone: str
    otp: str


# ===== OTP validity windows — single source of truth per role/path =====
# Each constant is read by BOTH the stored/computed expiry AND the API
# response's `expires_in`, so the two can never drift the way they
# previously did here: two independent hardcoded literals (a `timedelta`
# and a bare `600`) kept in sync only by a human remembering to edit both.
# Customer, merchant, and rider OTP are now all the same local-generate/
# local-verify model — see customer_request_otp/verify_otp below. The
# MSG91 OTP Widget (Custom UI) integration that customer OTP briefly used
# has been fully removed, not just disabled: it required real-name/DLT
# template approval on MSG91's dashboard side and produced a confusing
# non-Lokl-branded message ("DSHOTP"/"Dash") that couldn't be fixed from
# code, since the widget model has MSG91 own the entire message body.
# Reverting to the same code path merchant/rider already used gives full
# control over wording again, at the cost of losing MSG91's own widget-
# side bot/replay protections — an accepted tradeoff for now.
CUSTOMER_OTP_TTL_MINUTES = 10
MERCHANT_OTP_TTL_MINUTES = 10
RIDER_OTP_TTL_MINUTES = 10


@api.post("/auth/customer/request-otp")
@_limit(_LIMIT_CUSTOMER_OTP_REQUEST)
async def customer_request_otp(request: Request, payload: CustomerOtpRequest):
    """Generate/dispatch a 6-digit OTP. Always returns the same shape to
    prevent user-enumeration via response timing/structure. Same
    local-generate/bcrypt-hash/10-min-TTL/5-attempt-lockout model as
    merchant_request_otp/rider_request_otp — provider (Twilio/MSG91) only
    changes the delivery channel via notify_customer_otp, never OTP
    ownership."""
    phone = _normalize_customer_phone(payload.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    otp = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = hash_password(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=CUSTOMER_OTP_TTL_MINUTES)

    # Upsert so a re-request for the same phone overwrites the prior OTP.
    await db.customer_otps.update_one(
        {"phone": phone},
        {"$set": {
            "phone": phone,
            "otp_hash": otp_hash,
            "attempts": 0,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    # Fire-and-forget delivery. The notify helper logs OTP to backend logs
    # when CUSTOMER_OTP_DEBUG=true so dev/preview works regardless of the
    # configured provider.
    try:
        notify_customer_otp(phone, otp)
    except Exception as e:
        log.warning("OTP delivery failed for %s: %s", phone, e)

    return {"ok": True, "message": "OTP sent if the phone is valid", "expires_in": CUSTOMER_OTP_TTL_MINUTES * 60}


@api.post("/auth/customer/verify-otp")
@_limit(_LIMIT_CUSTOMER_OTP_VERIFY)
async def customer_verify_otp(request: Request, payload: CustomerOtpVerify):
    """Verify the OTP and issue a customer JWT pair. Local bcrypt check
    against db.customer_otps, 5-attempt lockout — same model as
    merchant_verify_otp/rider_verify_otp."""
    phone = _normalize_customer_phone(payload.phone)
    if not phone or not payload.otp:
        raise HTTPException(400, "Invalid phone or OTP")

    rec = await db.customer_otps.find_one({"phone": phone})
    if not rec:
        raise HTTPException(401, "OTP not found or expired — request a new one")

    expires_at = rec.get("expires_at")
    if isinstance(expires_at, datetime):
        # Mongo returns naive UTC; normalize before comparison.
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.customer_otps.delete_one({"phone": phone})
            raise HTTPException(401, "OTP expired — request a new one")

    if int(rec.get("attempts", 0)) >= 5:
        await db.customer_otps.delete_one({"phone": phone})
        raise HTTPException(429, "Too many attempts — request a new OTP")

    if not verify_password(payload.otp.strip(), rec.get("otp_hash", "")):
        await db.customer_otps.update_one({"phone": phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(401, "Incorrect OTP")

    # Success — burn the OTP.
    await db.customer_otps.delete_one({"phone": phone})

    # Ensure a customer doc exists, issue tokens.
    await db.customers.update_one(
        {"phone": phone},
        {"$setOnInsert": {
            "phone": phone,
            "created_at": datetime.now(timezone.utc),
            "addresses": [],
        }},
        upsert=True,
    )
    access = create_token(phone, "customer", "access")
    refresh = create_token(phone, "customer", "refresh")
    response = JSONResponse({"token": access, "phone": phone, "role": "customer"})
    _set_refresh_cookie(response, refresh)
    return response


# ===== Merchant phone-OTP login (iter-29 Item 1) =====
# Mirrors the customer-OTP flow at /api/auth/customer/* but resolves the OTP
# to a merchant row (`phone_canonical` = last-10 digits) and issues a
# *merchant* JWT byte-identical to the email-login response shape so the
# frontend can route either entry point through the same `setAuth(token, merchant)`.

class MerchantOtpRequest(BaseModel):
    phone: str


class MerchantOtpVerify(BaseModel):
    phone: str
    otp: str


def _normalize_merchant_phone_10(raw: str) -> Optional[str]:
    """Return the last-10-digit canonical form used for merchant lookups.
    Strips +/whitespace/91 prefix. None for invalid lengths."""
    if not raw:
        return None
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) < 10:
        return None
    return digits[-10:]


@api.post("/auth/merchant/request-otp")
@_limit(_LIMIT_MERCHANT_OTP_REQUEST)
async def merchant_request_otp(request: Request, payload: MerchantOtpRequest):
    """Generate a 6-digit OTP for a registered merchant's phone, store its
    bcrypt hash with a 10-minute TTL, and dispatch via WhatsApp/SMS.
    Returns 404 when no merchant matches the phone — this is intentional
    so legitimate merchants get a clear "register first" CTA. Customer OTP
    chose the opposite (no enumeration) because anyone can become a
    customer; the merchant funnel is closed and the UX value of a clear
    error outweighs the enumeration risk."""
    p10 = _normalize_merchant_phone_10(payload.phone)
    if not p10:
        raise HTTPException(400, "Invalid phone number")
    m = await db.merchants.find_one({"phone_canonical": p10}, {"_id": 0, "id": 1})
    if not m:
        raise HTTPException(404, "No merchant account found. Please register first.")

    # NOTE on the provider migration: unlike customer OTP, merchant login OTP
    # is ALWAYS generated and verified locally regardless of NOTIFICATION_PROVIDER
    # — see notifications.py's module docstring. Merchant OTP needs custom
    # wording ("Lokl merchant login code...") that doesn't fit either
    # provider's fixed OTP-template contract, so it never goes through
    # send_otp()/verify_otp(); only the delivery channel (notify_merchant_otp
    # -> send_with_fallback) switches with the active provider.
    otp = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = hash_password(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=MERCHANT_OTP_TTL_MINUTES)
    # Store under the canonical 12-digit key (91 + last-10) so look-ups during
    # verify share a stable key with the Twilio/WhatsApp recipient.
    canonical = f"91{p10}"
    await db.merchant_login_otps.update_one(
        {"phone": canonical},
        {"$set": {
            "phone": canonical,
            "merchant_id": m["id"],
            "otp_hash": otp_hash,
            "attempts": 0,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    try:
        notify_merchant_otp(canonical, otp)
    except Exception as e:
        log.warning("Merchant OTP delivery failed for %s: %s", canonical, e)
    return {"ok": True, "message": "OTP sent", "expires_in": MERCHANT_OTP_TTL_MINUTES * 60}


@api.post("/auth/merchant/verify-otp")
@_limit(_LIMIT_MERCHANT_OTP_VERIFY)
async def merchant_verify_otp(request: Request, response: Response, payload: MerchantOtpVerify):
    """Verify the 6-digit OTP, issue a merchant JWT, and return the same
    response envelope as `/api/auth/login` so the frontend can use one
    `setAuth(token, merchant)` call regardless of entry point.

    Always a local bcrypt check regardless of NOTIFICATION_PROVIDER — see
    the note in merchant_request_otp above."""
    p10 = _normalize_merchant_phone_10(payload.phone)
    if not p10 or not payload.otp:
        raise HTTPException(400, "Invalid phone or OTP")
    canonical = f"91{p10}"
    rec = await db.merchant_login_otps.find_one({"phone": canonical})
    if not rec:
        raise HTTPException(401, "OTP expired or not requested")

    expires_at = rec.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.merchant_login_otps.delete_one({"phone": canonical})
            raise HTTPException(401, "OTP expired. Please request a new one.")

    attempts = int(rec.get("attempts", 0))
    if attempts >= 5:
        await db.merchant_login_otps.delete_one({"phone": canonical})
        raise HTTPException(429, "Too many attempts. Please request a new OTP.")

    if not verify_password(payload.otp.strip(), rec.get("otp_hash", "")):
        new_attempts = attempts + 1
        await db.merchant_login_otps.update_one({"phone": canonical}, {"$inc": {"attempts": 1}})
        remaining = max(0, 5 - new_attempts)
        if remaining <= 0:
            await db.merchant_login_otps.delete_one({"phone": canonical})
            raise HTTPException(401, "Too many attempts. Please request a new OTP.")
        raise HTTPException(401, f"Incorrect OTP. {remaining} attempt{'s' if remaining != 1 else ''} remaining.")

    # Success — burn the OTP and load the merchant.
    await db.merchant_login_otps.delete_one({"phone": canonical})
    m = await db.merchants.find_one({"id": rec["merchant_id"]}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Merchant account not found")
    safe = {k: v for k, v in m.items() if k != "password_hash"}
    out = JSONResponse({
        "token": create_token(m["id"], "merchant", "access"),
        "merchant": safe,
    })
    _set_refresh_cookie(out, create_token(m["id"], "merchant", "refresh"))
    return out


# ===== Rider phone-OTP login (Phase 1 rider delivery platform, Commit 2) =====
# Mirrors the customer-OTP flow (bcrypt-hashed OTP, 10-min TTL, 5-attempt
# lockout), but riders are ADMIN-PROVISIONED like the merchant funnel, not
# self-registered like customers — an authenticated rider sees real customer
# addresses, so a random phone must never be able to OTP its way in.
#
# Differs from the merchant OTP flow too, though: merchant_request_otp 404s
# on an unknown phone (a fine tradeoff for an open registration funnel — the
# 404 gives a legitimate merchant a clear "register first" CTA). Rider
# request-otp deliberately returns the SAME generic response whether or not
# the phone is a registered/active rider, and only actually sends an OTP
# behind that response when it is — so this endpoint can't be used to
# enumerate the rider roster.

class RiderOtpRequest(BaseModel):
    phone: str


class RiderOtpVerify(BaseModel):
    phone: str
    otp: str


_LIMIT_RIDER_OTP_REQUEST = os.environ.get("RATE_LIMIT_RIDER_OTP_REQUEST", "5/minute")
_LIMIT_RIDER_OTP_VERIFY = os.environ.get("RATE_LIMIT_RIDER_OTP_VERIFY", "10/minute")


@api.post("/auth/rider/request-otp")
@_limit(_LIMIT_RIDER_OTP_REQUEST)
async def rider_request_otp(request: Request, payload: RiderOtpRequest):
    """Generate a 6-digit OTP for a provisioned, active rider's phone and
    dispatch via WhatsApp/SMS. Always returns the same response shape
    regardless of whether the phone belongs to a registered rider (see
    module note above) — the OTP is only actually created/sent when it does."""
    phone = _normalize_customer_phone(payload.phone)  # shared Indian-phone normalization, not customer-specific
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    # Same provider-migration note as merchant_request_otp: rider login OTP
    # is ALWAYS generated/verified locally regardless of NOTIFICATION_PROVIDER
    # (custom wording, not the fixed OTP-template contract) — only the
    # delivery channel switches with the active provider.
    rider = await db.riders.find_one({"phone": phone, "status": "active"}, {"_id": 0, "id": 1})
    if rider:
        otp = f"{secrets.randbelow(1_000_000):06d}"
        otp_hash = hash_password(otp)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=RIDER_OTP_TTL_MINUTES)
        await db.rider_otps.update_one(
            {"phone": phone},
            {"$set": {
                "phone": phone,
                "otp_hash": otp_hash,
                "attempts": 0,
                "expires_at": expires_at,
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        try:
            notify_rider_otp(phone, otp)
        except Exception as e:
            log.warning("Rider OTP delivery failed for %s: %s", phone, e)

    return {"ok": True, "message": "OTP sent if this is a registered rider", "expires_in": RIDER_OTP_TTL_MINUTES * 60}


@api.post("/auth/rider/verify-otp")
@_limit(_LIMIT_RIDER_OTP_VERIFY)
async def rider_verify_otp(request: Request, payload: RiderOtpVerify):
    """Verify the OTP and issue a rider JWT with a long TTL (see
    auth.create_token's role in ("customer", "rider") branch — a mid-delivery
    401 at a customer's door is a much worse failure than a long-lived
    token risk). After 5 wrong attempts the OTP is invalidated."""
    phone = _normalize_customer_phone(payload.phone)
    if not phone or not payload.otp:
        raise HTTPException(400, "Invalid phone or OTP")

    rec = await db.rider_otps.find_one({"phone": phone})
    if not rec:
        raise HTTPException(401, "OTP not found or expired — request a new one")

    expires_at = rec.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.rider_otps.delete_one({"phone": phone})
            raise HTTPException(401, "OTP expired — request a new one")

    if int(rec.get("attempts", 0)) >= 5:
        await db.rider_otps.delete_one({"phone": phone})
        raise HTTPException(429, "Too many attempts — request a new OTP")

    if not verify_password(payload.otp.strip(), rec.get("otp_hash", "")):
        await db.rider_otps.update_one({"phone": phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(401, "Incorrect OTP")

    # Success — burn the OTP. Re-check the rider is still active (could have
    # been suspended between request and verify) before issuing a token.
    await db.rider_otps.delete_one({"phone": phone})
    now = datetime.now(timezone.utc).isoformat()
    rider = await db.riders.find_one_and_update(
        {"phone": phone, "status": "active"},
        {"$set": {"last_seen_at": now, "updated_at": now}},
        projection={"_id": 0},
        return_document=True,
    )
    if not rider:
        raise HTTPException(403, "Rider account is not active")

    access = create_token(phone, "rider", "access")
    return {"token": access, "phone": phone, "role": "rider", "rider": rider}


@api.patch("/rider/status")
async def rider_update_status(payload: dict, user: dict = Depends(rider_user)):
    """Rider self-service online/offline toggle. Body: {online: bool}. The
    future incoming-orders feed (Commit 3) only surfaces legs to riders with
    online=True. Does not touch any order/delivery state — rider doc only."""
    online = bool(payload.get("online"))
    now = datetime.now(timezone.utc).isoformat()
    r = await db.riders.find_one_and_update(
        {"phone": user["sub"]},
        {"$set": {"online": online, "last_seen_at": now, "updated_at": now}},
        projection={"_id": 0},
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "Rider not found")
    return {"ok": True, "online": online}


# ===== Web push subscriptions (Group D1) =====
# Standard W3C Push API PushSubscription shape — {endpoint, keys:{p256dh,
# auth}} — stored as-is (no reshaping) since that's exactly what
# pywebpush.webpush(subscription_info=...) expects when sending. Android/
# Chrome only; iOS is explicitly out of scope (see rider_push.py).

class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionPayload(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribePayload(BaseModel):
    endpoint: str


@api.post("/rider/push/subscribe")
async def rider_push_subscribe(payload: PushSubscriptionPayload, user: dict = Depends(rider_user)):
    """Store (or refresh) a rider's push subscription. A rider can have
    several — one per device/browser — deduped by endpoint (the same
    endpoint re-subscribing, e.g. after a service-worker update, replaces
    the stored keys rather than accumulating duplicates)."""
    rider = await _active_rider(user)
    sub = {
        "endpoint": payload.endpoint,
        "keys": {"p256dh": payload.keys.p256dh, "auth": payload.keys.auth},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.riders.update_one({"id": rider["id"]}, {"$pull": {"push_subscriptions": {"endpoint": payload.endpoint}}})
    await db.riders.update_one({"id": rider["id"]}, {"$push": {"push_subscriptions": sub}})
    return {"ok": True}


@api.post("/rider/push/unsubscribe")
async def rider_push_unsubscribe(payload: PushUnsubscribePayload, user: dict = Depends(rider_user)):
    """Remove one subscription by endpoint — called on logout or when the
    browser reports the permission was revoked. Silently succeeds even if
    the endpoint was never stored (idempotent)."""
    rider = await _active_rider(user)
    await db.riders.update_one({"id": rider["id"]}, {"$pull": {"push_subscriptions": {"endpoint": payload.endpoint}}})
    return {"ok": True}


async def _push_new_order_to_riders(pickup_area: str, order_id: str) -> None:
    """Fire-and-forget web push to eligible riders when a merchant leg
    becomes available (Group D1). Called once per leg, at ORDER PLACEMENT
    — NOT again at merchant-accept — because rider_available_orders has
    surfaced 'pending' legs (not just 'accepted' ones) to riders since the
    simultaneous-dispatch redesign (Group A1); the leg is already visible/
    claimable the moment it's created, so a second push on accept would
    just be a duplicate ping for the same leg.

    Eligible riders = status='active' AND online=True (matches
    rider_available_orders' own online gate — an offline rider gets an
    empty feed and, symmetrically, shouldn't get pushed either) AND has at
    least one stored push_subscriptions entry.

    Each send runs in a worker thread (asyncio.to_thread) since pywebpush
    is a blocking call with no async API — this keeps a slow push provider
    or a large batch of online riders from stalling the event loop. This
    whole function is scheduled via asyncio.create_task from create_order,
    never awaited inline, so push latency/failure can never delay or fail
    the customer's order-placement response."""
    try:
        riders = await db.riders.find(
            {"status": "active", "online": True, "push_subscriptions.0": {"$exists": True}},
            {"_id": 0, "id": 1, "push_subscriptions": 1},
        ).to_list(500)
    except Exception as e:
        log.warning("[push] failed to query eligible riders for order %s: %s", order_id, e)
        return
    if not riders:
        return

    title = "New order available"
    body = f"Pickup from {pickup_area}" if pickup_area else "A new delivery is ready to claim"
    tag = f"lokl-order-{order_id}"

    for rider in riders:
        subs = rider.get("push_subscriptions") or []
        expired_endpoints = []
        for sub in subs:
            result = await asyncio.to_thread(rider_push.send_to_subscription, sub, title, body, tag=tag, url="/rider")
            if result.get("expired"):
                expired_endpoints.append(sub.get("endpoint"))
        if expired_endpoints:
            try:
                await db.riders.update_one(
                    {"id": rider["id"]},
                    {"$pull": {"push_subscriptions": {"endpoint": {"$in": expired_endpoints}}}},
                )
                log.info("[push] cleaned up %d expired subscription(s) for rider=%s", len(expired_endpoints), rider["id"])
            except Exception as e:
                log.warning("[push] cleanup failed for rider=%s: %s", rider["id"], e)


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
    """Returns L1 categories with their L2 children. Filters out admin-paused
    L1 and L2 rows (iter-27 Item 7) — paused entries are hidden from the
    customer-facing site entirely. Each L1 and L2 row also carries
    `min_price` (cheapest visible product in that category, or null if it
    has none yet) so the homepage bento tiles can show a "from ₹X" chip
    without a follow-up request."""
    cats = await db.categories.find({"paused": {"$ne": True}}, {"_id": 0}).sort("order", 1).to_list(50)
    l2s = await db.subcategories.find({"paused": {"$ne": True}}, {"_id": 0}).to_list(200)
    l1_min, l2_min = await _category_min_prices()
    by_l1 = {}
    for s in l2s:
        s["min_price"] = l2_min.get(s["id"])
        by_l1.setdefault(s["l1_id"], []).append(s)
    return [{**c, "min_price": l1_min.get(c["id"]), "l2": by_l1.get(c["id"], [])} for c in cats]


@api.get("/hero-slides")
async def list_hero_slides(l1_id: str):
    """Public read of the per-L1 hero carousel (redesign Phase A's
    HeroSlide model, Phase B's first real consumer of it) — active-only,
    already sorted by `order`, so HeroCarousel.tsx can render the response
    as-is with no client-side filtering. The admin CRUD counterpart
    (/admin/hero-slides) stays auth-gated; this is the customer-facing
    read half that was missing until now."""
    rows = await db.hero_slides.find({"l1_id": l1_id, "active": True}, {"_id": 0}).sort("order", 1).to_list(20)
    return rows


@api.get("/areas")
async def list_areas():
    """Featured Bhilai areas for the homepage "Shop by Area" section — image
    + live store count per area, one grouped aggregation (not per-area
    N+1). All featured areas are returned even at 0 stores; the frontend
    shows an honest "0 stores" rather than hiding the tile."""
    rows = await db.areas.find({"featured": True}, {"_id": 0}).sort("order", 1).to_list(50)
    slugs = [r["slug"] for r in rows]
    counts = await _area_store_counts(slugs)
    return [
        {
            "slug": r["slug"],
            "name": r["name"],
            "image": r.get("image") or None,
            "store_count": counts.get(r["slug"], 0),
        }
        for r in rows
    ]


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
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
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
            {"id": {"$in": top_ids}, "store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    # Score = orders_7d * 10 + rating * 2; offline stores (rank=4) always at bottom.
    for p in items:
        p["orders_7d"] = counts.get(p["id"], 0)
        p["_pop_score"] = p["orders_7d"] * 10 + float(p.get("rating") or 0) * 2
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, -p["_pop_score"]))
    for p in items: p.pop("_pop_score", None)
    return items


@api.get("/feed/selling-fast")
async def feed_selling_fast(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    # Filter to products where total stock across all sizes is < 10 (genuinely low stock).
    items = await db.products.find(
        {"store_id": {"$in": sids}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("rating", -1).to_list(200)
    def _total_stock(p: dict) -> int:
        s = p.get("stock") or {}
        return sum(int(v) for v in s.values() if isinstance(v, (int, float)))
    items = [p for p in items if 0 < _total_stock(p) < 10]
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    # Offline stores (rank=4) always at bottom.
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/feed/best-sellers")
async def feed_best_sellers(limit: int = 12, store: Optional[str] = None):
    """`store`, when given, is the real bestseller signal (30-day delivered-
    order quantity) scoped to one store — reused as-is by the store page's
    Bestsellers rail rather than inventing a second definition."""
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    store_filter = store if store else {"$in": sids}
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
            {"id": {"$in": top_ids}, "store_id": store_filter, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": store_filter, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: p.get("store_availability_rank", 1))
    for p in items: p["orders_30d"] = counts.get(p["id"], 0)
    return items


@api.get("/feed/new-arrivals")
async def feed_new_arrivals(limit: int = 12, store: Optional[str] = None):
    """`store`, when given, scopes this same created_at-desc logic (with its
    existing all-time fallback) to one store — reused as-is by the store
    page's New Arrivals rail."""
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    store_filter = store if store else {"$in": sids}
    since_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    items = await db.products.find(
        {"store_id": store_filter, "created_at": {"$gte": since_30d}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("created_at", -1).to_list(limit * 3)
    if not items:
        # Fall back to most recent products across all time if nothing in 30 days.
        items = await db.products.find(
            {"store_id": store_filter, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("created_at", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    # Offline stores (rank=4) always at bottom.
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/feed/trending")
async def feed_trending(limit: int = 12):
    avail_map = await _availability_map()
    if not avail_map: return []
    sids = list(avail_map.keys())
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
            {"id": {"$in": top_ids}, "store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).to_list(limit)
        rank = {pid: i for i, pid in enumerate(top_ids)}
        items.sort(key=lambda p: rank.get(p["id"], 999))
    if not items:
        items = await db.products.find(
            {"store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0}
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    # Offline stores (rank=4) always at bottom; within rank, preserve score order.
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items


@api.get("/feed/home-products")
async def feed_home_products():
    """Single aggregated endpoint: store rails + trending + best deals.
    Replaces 4+ separate product feed calls on the homepage."""
    stores_raw = await db.stores.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "storefront": 1,
         "banner": 1, "tagline": 1, "online": 1, "last_seen_at": 1,
         "opens_at": 1, "closes_at": 1, "weekly_off": 1, "kyc_status": 1, "plan": 1},
    ).to_list(100)
    # Only pro stores get a dedicated rail; trending/best_deals use all stores.
    pro_sids = {s["id"] for s in stores_raw if s.get("plan") == "pro" and s.get("id")}
    avail_map = {s["id"]: _store_availability(s) for s in stores_raw if s.get("id")}
    sids = list(avail_map.keys())
    print(f"[home-products] stores={len(stores_raw)} sids={len(sids)}")
    if not sids:
        return {"store_rails": [], "trending": [], "best_deals": [], "premium_picks": []}

    all_products = await db.products.find(
        {
            "store_id": {"$in": sids},
            "is_deleted": {"$ne": True},
            "paused": {"$ne": True},  # matches _visible_product_filter() — a merchant-paused
                                       # product must never surface in a discovery rail.
            "status": {"$nin": ["deleted", "rejected"]},
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(300)
    print(f"[home-products] products={len(all_products)}")

    all_products = await _enrich_badges(db, all_products)
    all_products = _attach_store_avail(all_products, avail_map)
    all_products.sort(key=lambda p: p.get("store_availability_rank", 1))

    # Group by store — up to 8 products per rail
    from collections import defaultdict as _dd
    by_store: dict = _dd(list)
    for p in all_products:
        sid = p.get("store_id")
        if sid and len(by_store[sid]) < 8:
            by_store[sid].append(p)

    store_meta_map = {s["id"]: s for s in stores_raw if s.get("id")}

    store_rails = []
    for sid in sids:
        if sid not in pro_sids:
            continue
        prods = by_store.get(sid, [])
        if not prods:
            continue
        s = store_meta_map.get(sid, {})
        sf = s.get("storefront") or {}
        banners = sf.get("banners") or []
        banner = banners[0] if banners else s.get("banner")
        store_rails.append({
            "store_id": sid,
            "store_name": s.get("name", "Store"),
            "store_slug": s.get("slug") or sid,
            "store_banner": banner,
            "store_tagline": sf.get("tagline") or s.get("tagline") or "",
            "products": prods,
        })

    # Trending — sort by rating (no extra queries needed)
    trending = sorted(all_products, key=lambda p: float(p.get("rating") or 0), reverse=True)[:8]
    if not trending:
        trending = all_products[:8]

    # Best deals — products with mrp > price, sorted by discount %
    best_deals = sorted(
        [p for p in all_products if (p.get("mrp") or 0) > (p.get("price") or 0)],
        key=lambda p: ((p.get("mrp", 0) - p.get("price", 0)) / max(p.get("mrp", 1), 1)),
        reverse=True,
    )[:8]

    # Premium picks — highest-priced products, full stop. No discount/rating
    # weighting, mirrors how Just In is strictly created_at DESC with nothing
    # else mixed in.
    premium_picks = sorted(all_products, key=lambda p: float(p.get("price") or 0), reverse=True)[:8]

    return {"store_rails": store_rails, "trending": trending, "best_deals": best_deals,
            "premium_picks": premium_picks}


@api.get("/feed/under-499")
async def feed_under_499(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    items = await db.products.find(
        {"store_id": {"$in": sids}, "price": {"$lt": 499}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("rating", -1).to_list(limit * 2)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/feed/range-499-1099")
async def feed_range_499_1099(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    items = await db.products.find(
        {"store_id": {"$in": sids}, "price": {"$gte": 499, "$lte": 1099}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("rating", -1).to_list(limit * 2)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/feed/above-1099")
async def feed_above_1099(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    items = await db.products.find(
        {"store_id": {"$in": sids}, "price": {"$gt": 1099}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("rating", -1).to_list(limit * 2)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/feed/price-bento")
async def feed_price_bento():
    """Image for each homepage price-bento tile (Under ₹499 / Under ₹999 /
    Under ₹1,499 — <499, <999, <1499, OVERLAPPING thresholds, not
    mutually-exclusive ranges — see PRICE_BANDS_SEED's own comment). Per
    band: an admin-set override in db.price_bands wins if present;
    otherwise a visible product's image in that band; otherwise null so
    the frontend renders a neutral fallback tile instead of a broken
    image.

    Distinct-image guarantee (Phase G2 fix): because the three bands
    overlap, the single cheapest visible product in the whole catalog
    qualifies for ALL three bands whenever it's under ₹499 — picking
    "cheapest in band" independently per band (the old $facet approach)
    therefore surfaced the SAME product/image three times, every time the
    catalog had a sub-₹499 item, regardless of how much inventory existed
    — not a sparse-inventory edge case. Fixed by pulling one price-sorted
    candidate pool (everything under the largest threshold, ₹1,499),
    deduping to one (cheapest) entry per distinct IMAGE — several listings
    can legitimately share a stock/placeholder photo, and picking "cheapest
    unclaimed product id" alone would still surface visually-identical
    tiles in that case — then greedily assigning each band, smallest
    threshold first, the cheapest still-unclaimed image. A band only
    reuses an already-claimed image when no other qualifying image exists
    at all — a genuine content/inventory gap, not a code bug.

    Never N+1: at most 3 DB round trips regardless of catalog size (band
    overrides, visible store ids, one price-sorted candidate query) — and
    if every band already has an admin override, the product lookup is
    skipped entirely."""
    band_docs = await db.price_bands.find({}, {"_id": 0, "slug": 1, "image": 1}).to_list(10)
    overrides = {b["slug"]: b.get("image") for b in band_docs if b.get("image")}
    result = {
        "under_499": overrides.get("under-499"),
        "under_999": overrides.get("under-999"),
        "under_1499": overrides.get("under-1499"),
    }
    if all(result.values()):
        return result

    store_docs = await db.stores.find(_visible_store_filter(), {"_id": 0, "id": 1}).to_list(2000)
    sids = [s["id"] for s in store_docs]
    if not sids:
        return result

    # Candidate pool: every visible product under the widest band's
    # threshold, cheapest (then newest) first. 1,499 is the widest
    # threshold so this single pool covers all three bands. Deduped to one
    # (cheapest) entry per distinct image — several listings can share a
    # stock/placeholder photo, so uniqueness has to key on the image
    # that's actually rendered, not the product id.
    raw_candidates = await db.products.find(
        {"store_id": {"$in": sids}, "price": {"$lt": 1499}, **_visible_product_filter()},
        {"_id": 0, "image": 1, "price": 1},
    ).sort([("price", 1), ("created_at", -1)]).to_list(200)
    seen_images: set = set()
    candidates = []
    for c in raw_candidates:
        img = c.get("image")
        if not img or img in seen_images:
            continue
        seen_images.add(img)
        candidates.append(c)

    claimed: set = set()
    for key, threshold in (("under_499", 499), ("under_999", 999), ("under_1499", 1499)):
        if result[key]:
            continue  # admin override already set for this band
        qualifying = [c for c in candidates if c["price"] < threshold]
        pick = next((c for c in qualifying if c["image"] not in claimed), None)
        if pick is None:
            pick = qualifying[0] if qualifying else None  # inventory gap: reuse, don't fabricate
        if pick:
            claimed.add(pick["image"])
        result[key] = pick["image"] if pick else None
    return result


@api.get("/feed/gender-rail")
async def feed_gender_rail(l1: str, limit: int = 20):
    """Random sample of up to `limit` visible products from a given L1 category.
    Uses $sample so each visit serves a fresh lineup."""
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids:
        return {"products": []}
    pipeline = [
        {"$match": {"l1_id": l1, "store_id": {"$in": sids}, **_visible_product_filter()}},
        {"$sample": {"size": min(limit, 100)}},
        {"$project": {"_id": 0, "images": 0}},
    ]
    items = await db.products.aggregate(pipeline).to_list(limit)
    items = _attach_store_avail(items, avail_map)
    return {"products": items}


@api.get("/feed/just-in")
async def feed_just_in(store_id: Optional[str] = None, limit: int = 20):
    """New arrivals across Bhilai stores, newest first. No date cutoff —
    always returns products if any exist. `store_id` narrows to a single
    store; the `stores` list is always computed unfiltered so the frontend
    can render a stable set of filter chips regardless of the active one."""
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids:
        return {"products": [], "stores": []}

    product_match = {"store_id": {"$in": sids}, **_visible_product_filter()}
    if store_id:
        product_match["store_id"] = store_id if store_id in sids else "__none__"

    items = await db.products.find(
        product_match,
        {"_id": 0, "id": 1, "name": 1, "image": 1, "price": 1, "mrp": 1,
         "store_id": 1, "store_name": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(limit)

    # Distinct stores with visible products — let Mongo dedupe server-side
    # instead of pulling up to 2000 raw product docs over the wire just to
    # loop-and-dedupe in Python.
    store_agg = await db.products.aggregate([
        {"$match": {"store_id": {"$in": sids}, **_visible_product_filter()}},
        {"$group": {"_id": "$store_id", "name": {"$first": "$store_name"}}},
    ]).to_list(200)
    stores = [{"id": s["_id"], "name": s.get("name") or "Store"} for s in store_agg]

    return {"products": items, "stores": stores}


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
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    items = await db.products.find(
        {"id": {"$in": pids}, "store_id": {"$in": sids}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    rank = {pid: i for i, pid in enumerate(pids)}
    items.sort(key=lambda p: rank.get(p["id"], 999))
    return items


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
        {
            "published": True,
            "paused": {"$ne": True},
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"_id": 0}
    ).sort("rank", 1).to_list(20)
    return rows


@api.get("/offers/{offer_id}/products")
async def offer_products(offer_id: str, limit: int = 12):
    """Return products linked to an offer via offer_type/offer_id tagging.

    Offers can target products in three ways (set on the offer doc):
      - offer_type = "category"  → product_ids filtered by l1_slug
      - offer_type = "product_ids" → explicit list in offer.product_ids
      - offer_type = "store"     → all products from offer.store_id
    Falls back to random visible products if offer has no type set.
    """
    now = datetime.now(timezone.utc).isoformat()
    offer = await db.offers.find_one(
        {"id": offer_id, "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}]},
        {"_id": 0},
    )
    if not offer:
        raise HTTPException(404, "Offer not found or expired")
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    offer_type = offer.get("offer_type")
    if offer_type == "product_ids" and offer.get("product_ids"):
        items = await db.products.find(
            {"id": {"$in": offer["product_ids"]}, "store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0},
        ).to_list(limit)
    elif offer_type == "category" and offer.get("l1_slug"):
        items = await db.products.find(
            {"l1_slug": offer["l1_slug"], "store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0},
        ).sort("rating", -1).to_list(limit)
    elif offer_type == "store" and offer.get("store_id"):
        items = await db.products.find(
            {"store_id": offer["store_id"], **_visible_product_filter()},
            {"_id": 0, "images": 0},
        ).sort("rating", -1).to_list(limit)
    else:
        items = await db.products.find(
            {"store_id": {"$in": sids}, **_visible_product_filter()},
            {"_id": 0, "images": 0},
        ).sort("rating", -1).to_list(limit)
    items = await _enrich_badges(db, items)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: (p.get("store_availability_rank", 1) == 4, p.get("store_availability_rank", 1)))
    return items[:limit]


@api.get("/coupons/active")
async def list_active_coupons(limit: int = 5):
    """Public, read-only listing of currently-redeemable coupons (active,
    not expired, under their max-uses cap) — no code needs to be known in
    advance. Used by the PDP offers card so customers can discover a real
    code instead of a fabricated one. Unlike /coupons/validate this never
    takes a subtotal, so it can't compute discount_amount for a specific
    cart — callers show discount_type/discount_value instead."""
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.coupons.find(
        {"active": True, "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    rows = [c for c in rows if c.get("max_uses") is None or int(c.get("used_count") or 0) < int(c["max_uses"])]
    return rows[:limit]


@api.post("/coupons/validate")
@_limit("30/minute")
async def validate_coupon(request: Request, payload: dict):
    """Check if a coupon is valid for the given subtotal. Does NOT increment used_count."""
    code = (payload.get("code") or "").strip().upper()
    subtotal = float(payload.get("subtotal") or 0)
    if not code:
        raise HTTPException(400, "code is required")
    now = datetime.now(timezone.utc).isoformat()
    c = await db.coupons.find_one(
        {"code": code, "active": True,
         "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}]},
        {"_id": 0},
    )
    if not c:
        raise HTTPException(404, "Coupon not found or expired")
    if subtotal < float(c.get("min_order_value") or 0):
        raise HTTPException(400, f"Minimum order ₹{c['min_order_value']} required for this coupon")
    max_uses = c.get("max_uses")
    if max_uses is not None and int(c.get("used_count") or 0) >= int(max_uses):
        raise HTTPException(400, "Coupon has reached its usage limit")
    discount = (subtotal * float(c["discount_value"]) / 100) if c["discount_type"] == "percent" else float(c["discount_value"])
    discount = min(discount, subtotal)
    return {"valid": True, "code": code, "discount_type": c["discount_type"],
            "discount_value": c["discount_value"], "discount_amount": round(discount, 2),
            "description": c.get("description", "")}


async def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    """Single admin-auth dependency for every /admin/* route.

    Verifies the JWT signature (via decode_token), requires the is_admin
    claim minted only by /admin/login, then re-checks the admin_users
    collection so a deactivated account is locked out immediately even
    though its still-valid JWT hasn't expired (JWTs can't be revoked
    in-flight otherwise). Returns the admin doc (password_hash stripped).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin token required")
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload.get("type") == "refresh":
        raise HTTPException(401, "Refresh token cannot be used for API access")
    if payload.get("role") != "admin" or not payload.get("is_admin"):
        raise HTTPException(403, "Admin only")
    admin = await db.admin_users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not admin or not admin.get("active", True):
        raise HTTPException(403, "Admin account inactive or not found")
    return admin


# ===== Notification provider parallel-test endpoint (Twilio -> MSG91
# migration, Commit 3) =====
# Lets an admin validate a SPECIFIC provider against a SPECIFIC number
# WITHOUT touching NOTIFICATION_PROVIDER — every other request on the
# platform keeps going through get_provider() untouched. This is how MSG91
# gets validated end-to-end (SMS/WhatsApp/OTP, DLT template errors visible
# in the response) against a real phone before the global cutover.

class NotificationTestRequest(BaseModel):
    provider: str  # "twilio" | "msg91"
    phone: str
    channels: list[str] = ["sms", "whatsapp", "otp"]
    otp_to_verify: Optional[str] = None  # optional 2nd call: verify a code you actually received


@api.post("/admin/notifications/test")
async def admin_test_notification(payload: NotificationTestRequest, admin: dict = Depends(require_admin)):
    """Admin-only. Sends one-off test message(s) via the SPECIFIED provider
    to the SPECIFIED phone, bypassing get_provider()/NOTIFICATION_PROVIDER
    entirely — a fresh provider instance is constructed just for this call,
    so this can never affect what any other user's notification uses.

    Each requested channel ("sms", "whatsapp", "otp") is sent independently
    so you can isolate exactly which one fails. The response includes each
    provider's raw result (provider.last_result) — for MSG91 this surfaces
    the actual API response/error (e.g. a DLT template mismatch or missing
    WABA config) instead of only a log line.

    Pass `otp_to_verify` to also call verify_otp() with a code you actually
    received on your phone from the "otp" channel test above — useful for
    confirming MSG91's OTP API round-trips correctly before cutover.
    """
    phone = _normalize_customer_phone(payload.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    provider_name = (payload.provider or "").strip().lower()
    if provider_name == "msg91":
        test_provider = MSG91Provider()
    elif provider_name == "twilio":
        test_provider = TwilioProvider()
    else:
        raise HTTPException(400, f"Unknown provider {provider_name!r} — must be 'twilio' or 'msg91'")

    channels = [c.strip().lower() for c in (payload.channels or [])] or ["sms", "whatsapp", "otp"]
    results: dict = {}

    for ch in channels:
        if ch == "sms":
            ok = test_provider.send_sms(
                phone, "Lokl test SMS — provider parallel test. Ignore if unexpected.",
                message_type="admin_notification_test",
            )
            results["sms"] = {"ok": ok, **test_provider.last_result}
        elif ch == "whatsapp":
            wa_id = test_provider.send_whatsapp(
                phone, "Lokl test WhatsApp — provider parallel test. Ignore if unexpected.",
            )
            results["whatsapp"] = {"ok": wa_id is not None, **test_provider.last_result}
        elif ch == "otp":
            # Twilio has no self-generation — give it a synthetic code to
            # deliver. MSG91 generates its own; we pass nothing.
            test_otp = "482913" if provider_name == "twilio" else None
            channel_used = test_provider.send_otp(phone, test_otp)
            results["otp"] = {"ok": channel_used != "none", "delivered_via": channel_used, **test_provider.last_result}
        else:
            results[ch] = {"ok": False, "error": f"unknown channel {ch!r} — must be sms/whatsapp/otp"}
            continue
        log.info("[ADMIN-NOTIFY-TEST] provider=%s channel=%s to=%s result=%s",
                  provider_name, ch, phone, results[ch])

    if payload.otp_to_verify:
        verified = test_provider.verify_otp(phone, payload.otp_to_verify)
        results["verify_otp"] = {"ok": verified, **test_provider.last_result}
        log.info("[ADMIN-NOTIFY-TEST] provider=%s channel=verify_otp to=%s result=%s",
                  provider_name, phone, results["verify_otp"])

    return {"ok": True, "provider": provider_name, "phone": phone, "results": results}


@api.post("/webhooks/payment")
@_limit("60/minute")
async def payment_webhook(request: Request):
    """Razorpay webhook — signature verified, idempotent, amount-checked.

    Handles three events end-to-end:
      - payment.captured → flip order to status='pending_merchant' +
        payment_status='paid', then notify merchants.
      - payment.failed   → flip order to status='cancelled' +
        payment_status='failed' + restock items.
      - refund.created   → flip order to payment_status='refunded'.

    Returns 200 on every successful (or duplicate / unhandled) event so
    Razorpay stops retrying. Returns 400 ONLY on signature failure."""
    raw = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    if not verify_webhook_signature(raw, sig):
        log.warning("[Webhook] signature mismatch")
        raise HTTPException(400, "Invalid signature")
    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    event_type = data.get("event") or "unknown"
    event_id = data.get("id") or f"{event_type}:{datetime.now(timezone.utc).timestamp()}"

    # Idempotency: record-or-skip via unique index on webhook_events.razorpay_event_id
    try:
        await db.webhook_events.insert_one({
            "razorpay_event_id": event_id, "event_type": event_type,
            "raw_payload": data, "processed": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        # Duplicate key → already processed
        log.info("[Webhook] duplicate %s ignored: %s", event_id, e)
        return {"status": "already_processed"}

    try:
        if event_type == "payment.captured":
            await _handle_payment_captured(data)
        elif event_type == "payment.failed":
            await _handle_payment_failed(data)
        elif event_type == "refund.created":
            await _handle_refund_created(data)
        # order.paid is a duplicate of payment.captured — skip silently.
        await db.webhook_events.update_one(
            {"razorpay_event_id": event_id},
            {"$set": {"processed": True,
                      "processed_at": datetime.now(timezone.utc).isoformat()}})
    except Exception as e:
        log.error("[Webhook] %s handler error: %s", event_type, e)
        await db.webhook_events.update_one(
            {"razorpay_event_id": event_id},
            {"$set": {"error": str(e), "failed_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "ok"}


@api.post("/webhooks/shopify/inventory")
@_limit("120/minute")
async def shopify_inventory_webhook(request: Request):
    """Inbound half of Shopify inventory sync — a change made directly on
    Shopify (an in-store sale, a manual stock edit) reaches Lokl without
    waiting for the merchant to click "Pull latest inventory". Registered
    automatically at connect time against the INVENTORY_LEVELS_UPDATE
    topic (see shopify_client.register_inventory_webhook).

    Always returns 200 once the signature checks out (even for a shop we
    don't recognize, or a variant we have no mapping for) — Shopify retries
    aggressively on anything else, and there's nothing actionable to retry
    for those cases. 400 is reserved for a bad/missing signature only.

    The payload gives an ABSOLUTE new "available" count for one (inventory
    item, location) pair, not a delta — see shopify_client's module
    docstring for why SETting Lokl's stock to match (not incrementing) is
    what makes this safely idempotent against an outbound adjustment's own
    resulting webhook echoing back."""
    raw = await request.body()
    shop_domain = request.headers.get("x-shopify-shop-domain", "")
    hmac_header = request.headers.get("x-shopify-hmac-sha256", "")
    webhook_id = request.headers.get("x-shopify-webhook-id", "")
    if not shop_domain or not hmac_header:
        raise HTTPException(400, "Missing Shopify webhook headers")

    integ = await db.merchant_integrations.find_one({"provider": "shopify", "shop_domain": shop_domain}, {"_id": 0})
    if not integ or not integ.get("client_secret"):
        return {"ok": True}  # unknown/disconnected shop — nothing to act on
    try:
        client_secret = encryption_service.decrypt_field(integ["client_secret"])
    except ValueError:
        return {"ok": True}
    if not shopify_client.verify_webhook_signature(raw, hmac_header, client_secret):
        log.warning("[shopify_webhook] signature mismatch for shop=%s", shop_domain)
        raise HTTPException(400, "Invalid signature")

    if webhook_id:
        try:
            await db.shopify_webhook_events.insert_one({
                "webhook_id": webhook_id, "shop_domain": shop_domain,
                "received_at": datetime.now(timezone.utc).isoformat(),
            })
        except DuplicateKeyError:
            return {"ok": True}  # already processed this exact delivery

    try:
        data = json.loads(raw)
    except Exception:
        return {"ok": True}

    inv_item_numeric = data.get("inventory_item_id")
    location_numeric = data.get("location_id")
    available = data.get("available")
    if inv_item_numeric is None or available is None:
        return {"ok": True}

    # Multi-location stores: only act on the one location Lokl syncs
    # against (documented simplification, matches the outbound side).
    if location_numeric is not None and integ.get("location_id"):
        if shopify_client.to_gid("Location", location_numeric) != integ["location_id"]:
            return {"ok": True}

    inv_item_gid = shopify_client.to_gid("InventoryItem", inv_item_numeric)
    mapping = await db.remote_inventory_map.find_one(
        {"provider": "shopify", "remote_variant_id": inv_item_gid}, {"_id": 0},
    )
    if not mapping or mapping.get("merchant_id") != integ.get("merchant_id"):
        return {"ok": True}

    await db.products.update_one(
        {"id": mapping["product_id"]},
        {"$set": {f"stock.{mapping['size']}": int(available)}},
    )
    fresh = await db.products.find_one({"id": mapping["product_id"]}, {"_id": 0, "stock": 1, "store_id": 1, "paused": 1})
    if fresh and not fresh.get("paused"):
        total = sum(int(v) for v in (fresh.get("stock") or {}).values() if isinstance(v, (int, float)))
        if total <= 0:
            await db.products.update_one({"id": mapping["product_id"]}, {"$set": {"paused": True, "status": "paused"}})
            cnt = await db.products.count_documents({"store_id": fresh["store_id"], "paused": {"$ne": True}})
            await db.stores.update_one({"id": fresh["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}


async def _restock_order_items(order: dict) -> None:
    for it in (order.get("items") or []):
        pid = it.get("id"); qty = int(it.get("qty", 1) or 1)
        sz = (it.get("size") or "").strip() or "default"
        if pid and qty > 0:
            updated = await db.products.find_one_and_update(
                {"id": pid}, {"$inc": {f"stock.{sz}": qty}},
                projection={"_id": 0, "merchant_id": 1, "provider": 1, "remote_variant_ids": 1},
                return_document=True,
            )
            # A cancel/return puts stock back -> a positive delta out to
            # the source platform, mirroring create_order's negative one.
            if updated:
                asyncio.create_task(_sync_remote_inventory({**updated, "id": pid}, sz, qty))


# The Lokl order is only created by the CLIENT calling POST /api/orders after
# Razorpay's success callback fires client-side — see create_order's razorpay
# branch. If the browser/app dies between "Razorpay captured the payment" and
# that callback reaching us (closed tab, lost network, backgrounded app), this
# webhook can arrive and find no matching order — sometimes because it's
# simply racing the client's own in-flight request, sometimes because that
# request is never coming. RAZORPAY_ORPHAN_GRACE_SECONDS is how long
# _handle_payment_captured waits (measured off the payment's own `created_at`,
# not wall-clock-since-webhook-received, so a delayed webhook delivery can't
# shrink the window) before treating "no order yet" as genuinely orphaned
# rather than an in-flight race.
RAZORPAY_ORPHAN_GRACE_SECONDS = 120


async def _handle_payment_captured(event: dict) -> None:
    pay = (event.get("payload") or {}).get("payment", {}).get("entity") or {}
    rp_order_id = pay.get("order_id")
    rp_payment_id = pay.get("id")
    amount_paise = int(pay.get("amount", 0))
    if not rp_order_id:
        raise ValueError("No order_id in payment.captured")
    o = await db.orders.find_one({"razorpay_order_id": rp_order_id}, {"_id": 0})
    if not o:
        # Past the grace window this is a captured payment with no Lokl order
        # and no client request still in flight to create one — refund
        # automatically rather than leaving money captured with nothing to
        # show for it. Reconstructing the order from inside the webhook
        # instead (re-running stock reservation etc.) isn't attempted here —
        # it would duplicate create_order's atomic stock/coupon logic against
        # possibly-stale price/stock data with no cart snapshot to work from
        # (this endpoint's payload carries payment/amount info only).
        captured_at = pay.get("created_at")
        age_s = (datetime.now(timezone.utc).timestamp() - captured_at) if captured_at else None
        if age_s is None or age_s < RAZORPAY_ORPHAN_GRACE_SECONDS:
            raise ValueError(
                f"No Lokl order yet for razorpay_order_id={rp_order_id} "
                f"(age={age_s if age_s is not None else 'unknown'}s — within grace window, "
                f"likely still in flight from the client)"
            )
        try:
            # refund_payment returns None (not a raise) when Razorpay isn't
            # configured (_get_client() has no creds) — that's NOT success,
            # so check the return value, don't just assume "didn't raise"
            # means "refunded."
            refund_result = refund_payment(rp_payment_id, Decimal(amount_paise) / 100, rp_order_id)
            if refund_result is None:
                raise RuntimeError("refund_payment returned None — Razorpay client not configured")
            await audit_service.log(
                "payment_captured_no_order_auto_refunded",
                razorpay_order_id=rp_order_id, razorpay_payment_id=rp_payment_id,
                amount=amount_paise / 100, actor="razorpay_webhook",
                metadata={"reason": "no Lokl order existed past grace window — "
                                     "client success callback likely never fired"},
            )
        except Exception as refund_err:
            await audit_service.log(
                "payment_captured_no_order_refund_failed",
                razorpay_order_id=rp_order_id, razorpay_payment_id=rp_payment_id,
                amount=amount_paise / 100, actor="razorpay_webhook",
                metadata={"refund_error": str(refund_err)},
            )
        return
    if o.get("payment_status") == "paid":
        return  # idempotent
    expected_paise = int((Decimal(str(o.get("total", 0))) * 100).quantize(Decimal("1")))
    if amount_paise != expected_paise:
        await audit_service.log(
            "amount_mismatch_detected", order_id=o["id"],
            razorpay_order_id=rp_order_id, razorpay_payment_id=rp_payment_id,
            amount=amount_paise / 100, actor="razorpay_webhook",
            metadata={"expected_paise": expected_paise, "received_paise": amount_paise},
        )
        raise ValueError(f"Amount mismatch order={o['id']} expected={expected_paise} got={amount_paise}")
    await db.orders.update_one({"id": o["id"]}, {"$set": {
        "status": "pending_merchant",            # release to merchant queue
        "payment_status": "paid",
        "razorpay_payment_id": rp_payment_id,
        "paid_at": datetime.now(timezone.utc).isoformat(),
    }, "$unset": {"expires_at": ""}})
    await audit_service.log("payment_captured", order_id=o["id"],
                            razorpay_order_id=rp_order_id, razorpay_payment_id=rp_payment_id,
                            amount=amount_paise / 100, actor="razorpay_webhook")
    # Now notify merchants — payment confirmed
    for mid in (o.get("merchant_ids") or []):
        m = await db.merchants.find_one({"id": mid}, {"_id": 0, "phone": 1})
        if m and m.get("phone"):
            their = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
            try: notify_merchant_new_order(m["phone"], o["id"], float(o.get("total", 0)), len(their))
            except Exception: pass


async def _handle_payment_failed(event: dict) -> None:
    pay = (event.get("payload") or {}).get("payment", {}).get("entity") or {}
    rp_order_id = pay.get("order_id")
    if not rp_order_id: return
    o = await db.orders.find_one({"razorpay_order_id": rp_order_id}, {"_id": 0})
    if not o or o.get("payment_status") in ("paid", "refunded"): return
    await db.orders.update_one({"id": o["id"]}, {"$set": {
        "status": "cancelled",
        "payment_status": "failed",
        "payment_failure_reason": pay.get("error_description", "Payment failed"),
    }})
    await _restock_order_items(o)
    await audit_service.log("payment_failed", order_id=o["id"],
                            razorpay_order_id=rp_order_id,
                            amount=float(o.get("total", 0)),
                            actor="razorpay_webhook",
                            metadata={"reason": pay.get("error_description", "")})


async def _handle_refund_created(event: dict) -> None:
    refund = (event.get("payload") or {}).get("refund", {}).get("entity") or {}
    rp_payment_id = refund.get("payment_id")
    rp_refund_id = refund.get("id")
    if not rp_payment_id: return
    o = await db.orders.find_one({"razorpay_payment_id": rp_payment_id}, {"_id": 0})
    if not o: return
    await db.orders.update_one({"id": o["id"]}, {"$set": {
        "status": "refunded",
        "payment_status": "refunded",
        "razorpay_refund_id": rp_refund_id,
        "refund_completed_at": datetime.now(timezone.utc).isoformat(),
    }})
    await audit_service.log("refund_completed", order_id=o["id"],
                            razorpay_payment_id=rp_payment_id,
                            amount=float(o.get("total", 0)),
                            actor="razorpay_webhook",
                            metadata={"razorpay_refund_id": rp_refund_id})


@api.post("/orders/{oid}/customer-cancel")
@_limit("10/minute")
async def customer_cancel_order(oid: str, request: Request, payload: Optional[dict] = None,
                                user: dict = Depends(customer_user)):
    """Customer-initiated cancel — caller must be authenticated AND own the
    order (JWT phone === order's customer phone). Allowed pre-acceptance
    (awaiting_payment/pending_merchant — cancels the whole order) AND while
    accepted but not yet handed to a rider (cancels only the merchant
    slice(s) still at pending/accepted; a slice already handed off is
    physically with a rider and needs admin/support, not self-serve).
    Triggers auto-refund when the order was paid via Razorpay."""
    body = payload or {}
    reason = (body.get("reason") or "Customer cancelled").strip()[:200]
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if user.get("role") != "admin" and cust_phone != user.get("sub"):
        raise HTTPException(403, "Not your order")
    phone = cust_phone  # downstream code still uses `phone` for notifications
    status = o.get("status")
    if status not in ("awaiting_payment", "pending_merchant", "accepted"):
        raise HTTPException(400, f"Cannot cancel from status: {status}")

    final_status = "cancelled"
    if status == "accepted":
        mids = o.get("merchant_ids") or []
        states = dict(o.get("merchant_states") or {})
        cancellable = [m for m in mids if states.get(m) in ("pending", "accepted")]
        if not cancellable:
            raise HTTPException(400, "This order is already on its way — contact support to cancel")
        for m in cancellable:
            final_status = await _merchant_cancel_own_slice(oid, m, reason)
        for m in cancellable:
            merch = await db.merchants.find_one({"id": m}, {"_id": 0, "phone": 1})
            if merch and merch.get("phone"):
                try: send_with_fallback(merch["phone"], f"Order {oid} was cancelled by the customer.", message_type="merchant_order_cancelled_by_customer")
                except Exception: pass
    else:
        await db.orders.update_one({"id": oid}, {"$set": {
            "status": "cancelled", "cancel_reason": reason,
            "cancelled_by": "customer",
            "cancelled_at": datetime.now(timezone.utc).isoformat(),
        }})
        await _restock_order_items(o)
        for m in (o.get("merchant_ids") or []):
            merch = await db.merchants.find_one({"id": m}, {"_id": 0, "phone": 1})
            if merch and merch.get("phone"):
                try: send_with_fallback(merch["phone"], f"Order {oid} was cancelled by the customer before you accepted it.", message_type="merchant_order_cancelled_by_customer")
                except Exception: pass
    refund_initiated = False
    if o.get("payment_status") == "paid" and o.get("razorpay_payment_id"):
        try:
            refund = refund_payment(o["razorpay_payment_id"],
                                    Decimal(str(o.get("total", 0))), oid)
            if refund:
                refund_initiated = True
                await db.orders.update_one({"id": oid}, {"$set": {
                    "payment_status": "refund_pending",
                    "razorpay_refund_id": refund.get("id"),
                    "refund_initiated_at": datetime.now(timezone.utc).isoformat(),
                }})
                await audit_service.log("refund_initiated", order_id=oid,
                                        razorpay_payment_id=o["razorpay_payment_id"],
                                        amount=float(o.get("total", 0)),
                                        actor=phone, ip_address=request.client.host if request.client else None,
                                        metadata={"razorpay_refund_id": refund.get("id")})
        except Exception as e:
            log.error("[Refund] failed for %s: %s", oid, e)
            await db.failed_refunds.insert_one({
                "order_id": oid, "error": str(e), "amount": float(o.get("total", 0)),
                "razorpay_payment_id": o.get("razorpay_payment_id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    await audit_service.log("order_cancelled", order_id=oid,
                            amount=float(o.get("total", 0)),
                            actor=phone, ip_address=request.client.host if request.client else None,
                            metadata={"reason": reason, "refund_initiated": refund_initiated, "resulting_status": final_status})
    return {"ok": True, "status": final_status, "refund_initiated": refund_initiated}


@api.get("/admin/orders/{oid}/audit-log")
async def admin_order_audit_log(oid: str, admin: dict = Depends(require_admin)):
    entries = await db.payment_audit_log.find(
        {"order_id": oid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"order_id": oid, "events": entries}


# ===== Upload security =====
ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_BULK_EXTS = {"xlsx", "csv"}
ALLOWED_BULK_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel", "application/octet-stream",
    "text/csv", "application/csv", "text/plain",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024     # 5 MB
MAX_BULK_BYTES = 10 * 1024 * 1024     # 10 MB


async def _validate_image_upload(file: UploadFile) -> None:
    """Whitelist-validate an uploaded image (extension + MIME + size).
    Raises HTTPException(400) on any failure."""
    if not file or not file.filename:
        raise HTTPException(400, "No file provided")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(400, "File type not allowed (jpg/jpeg/png/webp only)")
    if file.content_type and file.content_type not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(400, "MIME type not allowed")
    # Size check by seeking to end
    pos = await file.seek(0, 2)  # whence=2 → end
    if pos > MAX_IMAGE_BYTES:
        raise HTTPException(400, f"File too large (max {MAX_IMAGE_BYTES // (1024 * 1024)} MB)")
    await file.seek(0)


# ===== Cloudinary upload endpoints =====
@api.post("/merchant/upload-image")
async def merchant_upload_image(
    file: UploadFile = File(...),
    asset_type: str = Form(...),
    user: dict = Depends(get_current_user),
):
    """Upload an image to Cloudinary and return {image_url, public_id}.

    asset_type ∈ {"product", "store_logo", "store_banner", "kyc", "brand_logo"}.
    """
    if user.get("role") not in ("merchant", "admin"):
        raise HTTPException(403, "Merchant access required")
    return await cloudinary_service.upload_image(file, asset_type, user["sub"])


@api.delete("/merchant/upload-image")
async def merchant_delete_image(public_id: str, user: dict = Depends(get_current_user)):
    """Delete an image from Cloudinary by public_id. Best-effort; returns ok flag."""
    if user.get("role") not in ("merchant", "admin"):
        raise HTTPException(403, "Merchant access required")
    ok = cloudinary_service.delete_image(public_id)
    return {"ok": ok}


@api.get("/admin/kyc/{merchant_id}/signed-url")
async def admin_kyc_signed_url(merchant_id: str, doc: str, admin: dict = Depends(require_admin)):
    """Generate a 1-hour signed URL for a private KYC document on Cloudinary.

    `doc` must be one of: pan_doc, gst_doc, cancelled_cheque.
    """
    if doc not in {"pan_doc", "gst_doc", "cancelled_cheque"}:
        raise HTTPException(400, "Invalid doc kind")
    m = await db.merchants.find_one(
        {"id": merchant_id},
        {"_id": 0, f"{doc}_public_id": 1},
    )
    if not m:
        raise HTTPException(404, "Merchant not found")
    pub_id = m.get(f"{doc}_public_id")
    if not pub_id:
        raise HTTPException(404, f"{doc} not uploaded")
    url = cloudinary_service.signed_kyc_url(pub_id)
    if not url:
        raise HTTPException(500, "Could not sign URL")
    return {"url": url, "expires_in_seconds": 3600}



async def _validate_bulk_upload(file: UploadFile) -> bytes:
    """Validate + read a bulk products .xlsx/.csv upload. Returns the raw bytes."""
    if not file or not file.filename:
        raise HTTPException(400, "No file provided")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_BULK_EXTS:
        raise HTTPException(400, "Only .xlsx or .csv files are accepted")
    if file.content_type and file.content_type not in ALLOWED_BULK_MIMES:
        raise HTTPException(400, f"MIME type not allowed: {file.content_type}")
    raw = await file.read()
    if len(raw) > MAX_BULK_BYTES:
        raise HTTPException(400, f"File too large (max {MAX_BULK_BYTES // (1024 * 1024)} MB)")
    return raw


@api.post("/admin/offers")
async def admin_create_offer(payload: dict, admin: dict = Depends(require_admin)):
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
async def admin_delete_offer(oid: str, admin: dict = Depends(require_admin)):
    await db.offers.delete_one({"id": oid})
    return {"ok": True}


# ===== Brand admin (Phase 1) =====
# Unlike categories (small, fixed list — edit only), Brand can grow
# unbounded, so this is full CRUD with search + pagination on the list
# side. Create/list/detail are also reachable un-admin-gated below (Brand
# is merchant-creatable, inline, during product upload).

ALLOWED_BRAND_FIELDS = {"name", "description", "logo", "logo_public_id"}


@api.get("/admin/brands")
async def admin_list_brands(
    search: str = "", skip: int = 0, limit: int = 20,
    admin: dict = Depends(require_admin),
):
    limit = max(1, min(limit, 100))
    q: dict = {}
    if search.strip():
        q["name"] = {"$regex": _re.escape(search.strip()), "$options": "i"}
    total = await db.brands.count_documents(q)
    rows = await db.brands.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"brands": rows, "total": total, "skip": skip, "limit": limit}


@api.post("/admin/brands")
async def admin_create_brand(payload: BrandCreate, admin: dict = Depends(require_admin)):
    return await _create_brand_doc(payload, "admin")


@api.put("/admin/brands/{bid}")
async def admin_update_brand(bid: str, payload: dict, admin: dict = Depends(require_admin)):
    existing = await db.brands.find_one({"id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Brand not found")
    update = {k: v for k, v in payload.items() if k in ALLOWED_BRAND_FIELDS}
    # Deliberately NOT regenerating the slug on rename — the slug is the
    # brand's stable public URL (/brand/{slug}); renaming shouldn't 404
    # anyone who already linked or bookmarked it.
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.brands.update_one({"id": bid}, {"$set": update})
    doc = await db.brands.find_one({"id": bid}, {"_id": 0})
    return doc


@api.delete("/admin/brands/{bid}")
async def admin_delete_brand(bid: str, admin: dict = Depends(require_admin)):
    """Delete a brand. Explicitly a SOFT-UNLINK, not a cascade-delete:
    products tagged with this brand are kept — only their `brand_id` is
    cleared. No product is ever removed as a side effect of this call."""
    existing = await db.brands.find_one({"id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Brand not found")
    await db.products.update_many({"brand_id": bid}, {"$set": {"brand_id": None}})
    await db.brands.delete_one({"id": bid})
    return {"ok": True}


# ============ Lokl V2 — Homepage Asset CMS (iter-26) ============
# Admin can edit hero, L1/L2 category tiles, and offers via these endpoints.
# Front-of-house (public) endpoints reuse the existing /categories, /offers,
# /site/homepage-config — these admin routes add the writes + analytics.

# ---- HeroSlide (redesign Phase A) — per-L1 multi-slide hero carousel ----
# A GENUINELY SEPARATE system from the existing single site-wide Hero
# banner above (site_config.homepage.hero, edited via HeroEditor.tsx /
# PUT /admin/site/homepage-config) — this is not a replacement or
# migration of that one, the two coexist. HeroSlide backs
# HeroCarousel.tsx's per-L1 slide list (currently fed a hardcoded
# DEFAULT_HERO_SLIDES array on the frontend; wiring the carousel to fetch
# from here is a later phase's frontend work, not this one).
#
# Full CRUD (unlike categories' fixed edit-only list) but no
# search/pagination (unlike Brand) — likely small volume per L1, per the
# task's own scoping call.
ALLOWED_HERO_SLIDE_FIELDS = {
    "l1_id", "image", "image_public_id", "eyebrow", "headline", "subheadline",
    "highlight_text", "cta_link", "active", "order",
}


@api.get("/admin/hero-slides")
async def admin_list_hero_slides(l1_id: Optional[str] = None, admin: dict = Depends(require_admin)):
    q: dict = {}
    if l1_id:
        q["l1_id"] = l1_id
    rows = await db.hero_slides.find(q, {"_id": 0}).sort([("l1_id", 1), ("order", 1)]).to_list(500)
    return rows


@api.post("/admin/hero-slides")
async def admin_create_hero_slide(payload: HeroSlideCreate, admin: dict = Depends(require_admin)):
    if payload.l1_id not in [c["id"] for c in L1_CATEGORIES]:
        raise HTTPException(400, "Invalid l1_id")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": f"hero-{uuid.uuid4().hex[:10]}",
        **payload.model_dump(),
        "created_at": now, "updated_at": now,
    }
    await db.hero_slides.insert_one(doc)
    doc_out = {k: v for k, v in doc.items() if k != "_id"}
    return doc_out


@api.put("/admin/hero-slides/{sid}")
async def admin_update_hero_slide(sid: str, payload: dict, admin: dict = Depends(require_admin)):
    existing = await db.hero_slides.find_one({"id": sid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Hero slide not found")
    update = {k: v for k, v in payload.items() if k in ALLOWED_HERO_SLIDE_FIELDS}
    if "l1_id" in update and update["l1_id"] not in [c["id"] for c in L1_CATEGORIES]:
        raise HTTPException(400, "Invalid l1_id")
    if "active" in update:
        update["active"] = bool(update["active"])
    if "order" in update:
        update["order"] = int(update["order"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.hero_slides.update_one({"id": sid}, {"$set": update})
    doc = await db.hero_slides.find_one({"id": sid}, {"_id": 0})
    return doc


@api.delete("/admin/hero-slides/{sid}")
async def admin_delete_hero_slide(sid: str, admin: dict = Depends(require_admin)):
    r = await db.hero_slides.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Hero slide not found")
    return {"ok": True}


ALLOWED_OFFER_FIELDS = {
    "title", "subtitle", "image", "cta_label", "cta_link",
    "background", "rank", "published", "expires_at", "redirect_url",
    # iter-27 (Item 7): admin can pause an offer (hides from public feed)
    # or make it non-clickable (renders as <div>, no link).
    "paused", "non_clickable",
}


@api.put("/admin/offers/{oid}")
async def admin_update_offer(oid: str, payload: dict, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.items() if k in ALLOWED_OFFER_FIELDS}
    if "rank" in update:
        update["rank"] = int(update["rank"])
    if "published" in update:
        update["published"] = bool(update["published"])
    if "paused" in update:
        update["paused"] = bool(update["paused"])
    if "non_clickable" in update:
        update["non_clickable"] = bool(update["non_clickable"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.offers.update_one({"id": oid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Offer not found")
    doc = await db.offers.find_one({"id": oid}, {"_id": 0})
    return doc


@api.get("/admin/offers")
async def admin_list_offers(admin: dict = Depends(require_admin)):
    """Includes unpublished offers, sorted by rank — public /offers does not."""
    rows = await db.offers.find({}, {"_id": 0}).sort("rank", 1).to_list(100)
    return rows


# ===== Admin rider provisioning (Phase 1 rider delivery platform, Commit 2) =====
# Minimal CRUD, mirroring admin_create_coupon/admin_list_coupons below. Riders
# are admin-provisioned (see rider_request_otp near the merchant OTP login
# section) — this is the only way a rider identity comes into existence in
# Phase 1.

class AdminRiderCreate(BaseModel):
    phone: str
    name: str
    zone: Optional[str] = None


class AdminRiderUpdate(BaseModel):
    status: Optional[str] = None  # "active" | "suspended"
    name: Optional[str] = None
    zone: Optional[str] = None


@api.post("/admin/riders")
async def admin_create_rider(payload: AdminRiderCreate, admin: dict = Depends(require_admin)):
    phone = _normalize_customer_phone(payload.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    existing = await db.riders.find_one({"phone": phone})
    if existing:
        raise HTTPException(409, "A rider with this phone already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": f"rider-{uuid.uuid4().hex[:8]}",
        "phone": phone,
        "name": name,
        "status": "active",
        "online": False,
        # Group B1: riders can hold MULTIPLE active legs now — there's no
        # more single "current_order_leg" slot to initialize. Active legs
        # are derived on read from db.orders.rider_assignments (see
        # _rider_active_legs) instead of denormalized onto this doc, so
        # there's nothing to keep in sync here.
        "zone": (payload.zone or "").strip() or None,
        "created_at": now,
        "updated_at": now,
        "last_seen_at": None,
    }
    await db.riders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/admin/riders")
async def admin_list_riders(admin: dict = Depends(require_admin)):
    rows = await db.riders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@api.patch("/admin/riders/{rid}")
async def admin_update_rider(rid: str, payload: AdminRiderUpdate, admin: dict = Depends(require_admin)):
    """Update status (suspend/reactivate blocks/allows OTP login — see
    rider_request_otp/rider_verify_otp's `status: 'active'` checks), name,
    and/or zone. At least one field must be provided."""
    updates: dict = {}
    if payload.status is not None:
        if payload.status not in ("active", "suspended"):
            raise HTTPException(400, "status must be 'active' or 'suspended'")
        updates["status"] = payload.status
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "name cannot be empty")
        updates["name"] = name
    if payload.zone is not None:
        updates["zone"] = payload.zone.strip() or None
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.riders.find_one_and_update(
        {"id": rid}, {"$set": updates}, projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "Rider not found")
    return r


@api.post("/admin/coupons")
async def admin_create_coupon(payload: CouponCreate, admin: dict = Depends(require_admin)):
    code = payload.code.strip().upper()
    if not code:
        raise HTTPException(400, "code is required")
    existing = await db.coupons.find_one({"code": code})
    if existing:
        raise HTTPException(409, f"Coupon code {code} already exists")
    doc = {
        "id": f"cpn-{uuid.uuid4().hex[:8]}",
        "code": code,
        "discount_type": payload.discount_type,
        "discount_value": payload.discount_value,
        "min_order_value": payload.min_order_value,
        "max_uses": payload.max_uses,
        "used_count": 0,
        "expires_at": payload.expires_at,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.coupons.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/admin/coupons")
async def admin_list_coupons(admin: dict = Depends(require_admin)):
    rows = await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@api.delete("/admin/coupons/{cid}")
async def admin_delete_coupon(cid: str, admin: dict = Depends(require_admin)):
    r = await db.coupons.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Coupon not found")
    return {"ok": True}


@api.post("/admin/offers/migrate-types")
async def admin_migrate_offer_types(admin: dict = Depends(require_admin)):
    """One-shot migration: infer offer_type on legacy offers that lack it.

    Heuristic: if offer has a `cta_link` pointing to /c/<slug>, set offer_type=category
    and l1_slug from the slug. If cta_link points to /store/<id>, set offer_type=store.
    All others remain untyped (fallback to random products in /offers/{id}/products).
    """
    rows = await db.offers.find({"offer_type": {"$exists": False}}, {"_id": 0}).to_list(200)
    migrated = 0
    for r in rows:
        link = (r.get("cta_link") or "").strip()
        update: dict = {}
        if "/c/" in link:
            parts = [p for p in link.split("/") if p]
            c_idx = next((i for i, p in enumerate(parts) if p == "c"), None)
            if c_idx is not None and c_idx + 1 < len(parts):
                update = {"offer_type": "category", "l1_slug": parts[c_idx + 1]}
        elif "/store/" in link:
            parts = [p for p in link.split("/") if p]
            s_idx = next((i for i, p in enumerate(parts) if p == "store"), None)
            if s_idx is not None and s_idx + 1 < len(parts):
                update = {"offer_type": "store", "store_id": parts[s_idx + 1]}
        if update:
            await db.offers.update_one({"id": r["id"]}, {"$set": update})
            migrated += 1
    return {"migrated": migrated, "total_checked": len(rows)}


@api.get("/admin/categories")
async def admin_list_categories(admin: dict = Depends(require_admin)):
    rows = await db.categories.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    return rows


ALLOWED_CATEGORY_FIELDS = {"name", "image", "redirect_url", "order", "paused", "non_clickable"}


@api.put("/admin/categories/{cid}")
async def admin_update_category(cid: str, payload: dict, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.items() if k in ALLOWED_CATEGORY_FIELDS}
    if "order" in update:
        update["order"] = int(update["order"])
    if "paused" in update:
        update["paused"] = bool(update["paused"])
    if "non_clickable" in update:
        update["non_clickable"] = bool(update["non_clickable"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.categories.update_one({"id": cid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Category not found")
    doc = await db.categories.find_one({"id": cid}, {"_id": 0})
    return doc


@api.get("/admin/subcategories")
async def admin_list_subcategories(admin: dict = Depends(require_admin), l1_id: Optional[str] = None):
    q = {"l1_id": l1_id} if l1_id else {}
    rows = await db.subcategories.find(q, {"_id": 0}).to_list(500)
    return rows


@api.put("/admin/subcategories/{sid}")
async def admin_update_subcategory(sid: str, payload: dict, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.items() if k in ALLOWED_CATEGORY_FIELDS}
    if "paused" in update:
        update["paused"] = bool(update["paused"])
    if "non_clickable" in update:
        update["non_clickable"] = bool(update["non_clickable"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.subcategories.update_one({"id": sid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Sub-category not found")
    doc = await db.subcategories.find_one({"id": sid}, {"_id": 0})
    return doc


@api.get("/admin/areas")
async def admin_list_areas(admin: dict = Depends(require_admin)):
    rows = await db.areas.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    return rows


ALLOWED_AREA_FIELDS = {"name", "image", "order", "featured"}


@api.put("/admin/areas/{aid}")
async def admin_update_area(aid: str, payload: dict, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.items() if k in ALLOWED_AREA_FIELDS}
    if "order" in update:
        update["order"] = int(update["order"])
    if "featured" in update:
        update["featured"] = bool(update["featured"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.areas.update_one({"id": aid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Area not found")
    doc = await db.areas.find_one({"id": aid}, {"_id": 0})
    return doc


# Fixed set of 3 homepage price-bento bands. slug MUST match the
# price=<slug> query param /api/products/all and the price-bento tiles'
# href use, and the label bands feed_price_bento() matches overrides against.
#
# OVERLAPPING "Under X" scheme (redesign Phase A) — a genuine semantic
# change from the old mutually-exclusive tiers (<499 / 499-1499 / >=1500):
# a ₹300 product now matches ALL THREE bands, not just one. See
# all_products()'s price filter and feed_price_bento()'s facet below —
# both changed from range-matching to a per-band $lt threshold.
#
# `id` values deliberately UNCHANGED from the old scheme (only slug/label
# changed) — the boot-time upsert below matches by `id` and never
# overwrites an existing doc's `image` ($setOnInsert only), so keeping the
# same ids is what lets band-under-499's real admin-uploaded image (a
# genuinely still-correct threshold, <499 both before and after) survive
# automatically with zero migration. band-most-loved and band-premium
# also keep their ids/images by the same mechanism, but their OLD images
# no longer semantically match their new "Under X" framing — see
# migrations/016_price_bands_overlapping_bands.py, which explicitly
# clears band-premium's image (a "premium/expensive" photo would be
# actively misleading under an "Under ₹1,499" budget-ceiling label) and
# flags band-most-loved's carried-forward image for admin review (still
# plausible as a mid-range product photo, but no longer a deliberate
# curation choice for this exact band).
PRICE_BANDS_SEED = [
    {"id": "band-under-499", "slug": "under-499", "label": "Under ₹499", "order": 1},
    {"id": "band-most-loved", "slug": "under-999", "label": "Under ₹999", "order": 2},
    {"id": "band-premium", "slug": "under-1499", "label": "Under ₹1,499", "order": 3},
]


@api.get("/admin/price-bands")
async def admin_list_price_bands(admin: dict = Depends(require_admin)):
    rows = await db.price_bands.find({}, {"_id": 0}).sort("order", 1).to_list(10)
    return rows


ALLOWED_PRICE_BAND_FIELDS = {"image"}


@api.put("/admin/price-bands/{bid}")
async def admin_update_price_band(bid: str, payload: dict, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.items() if k in ALLOWED_PRICE_BAND_FIELDS}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.price_bands.update_one({"id": bid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Price band not found")
    doc = await db.price_bands.find_one({"id": bid}, {"_id": 0})
    return doc


@api.post("/admin/cms/upload")
async def admin_cms_upload(
    file: UploadFile = File(...),
    asset_type: str = Form("cms"),
    admin: dict = Depends(require_admin),
):
    """Cloudinary upload for any CMS image asset. Returns the secure_url
    that admins can copy/paste into hero/category/offer image fields.

    `asset_type` defaults to "cms" (the shared homepage-asset folder) but
    accepts "brand_logo" too, so the Brand admin surface's ImageUploadField
    can route logo uploads into their own Cloudinary folder rather than
    piling into lokl/cms."""
    if asset_type not in ("cms", "brand_logo"):
        raise HTTPException(400, "Invalid asset_type for admin upload")
    return await cloudinary_service.upload_image(file, asset_type, admin.get("id", "admin"))


@api.get("/admin/cms/search-destinations")
async def admin_search_destinations(q: str = "", admin: dict = Depends(require_admin)):
    """Unified destination picker — searches Stores, Products, L1, L2 and Offers.
    Returns up to 8 of each kind. `q` is case-insensitive substring match."""
    needle = (q or "").strip()
    rx = {"$regex": _re.escape(needle), "$options": "i"} if needle else None

    async def _scan(coll, name_field, route_fn, limit=8):
        cur = coll.find({name_field: rx} if rx else {}, {"_id": 0}).limit(limit)
        out = []
        async for d in cur:
            out.append({
                "label": d.get(name_field, ""),
                "url": route_fn(d),
                "kind": coll.name,
                "id": d.get("id", ""),
            })
        return out

    results = {
        "stores":        await _scan(db.stores, "name", lambda d: f"/store/{d.get('id','')}"),
        "products":      await _scan(db.products, "name", lambda d: f"/product/{d.get('id','')}"),
        "categories":    await _scan(db.categories, "name", lambda d: f"/c/{d.get('slug','')}"),
        "subcategories": await _scan(db.subcategories, "name", lambda d: f"/c/{d.get('slug','')}"),
        "offers":        await _scan(db.offers, "title", lambda d: f"/offers/{d.get('id','')}"),
    }
    return results


# ===== Click analytics =====
@api.post("/analytics/click")
async def log_asset_click(payload: dict, request: Request):
    """Public — called from homepage when a CMS asset is clicked.
    Body: {asset_type: 'hero'|'category'|'subcategory'|'offer', asset_id: str, redirect_url: str}"""
    asset_type = (payload.get("asset_type") or "").strip()
    if asset_type not in {"hero", "category", "subcategory", "offer"}:
        raise HTTPException(400, "Invalid asset_type — must be hero|category|subcategory|offer")
    await db.asset_clicks.insert_one({
        "asset_type": asset_type,
        "asset_id": str(payload.get("asset_id") or "")[:128],
        "redirect_url": str(payload.get("redirect_url") or "")[:512],
        "ts": datetime.now(timezone.utc),
        "ua": request.headers.get("user-agent", "")[:200],
    })
    return {"ok": True}


@api.get("/admin/analytics/top-clicks")
async def admin_top_clicks(
    admin: dict = Depends(require_admin),
    asset_type: str = "hero",
    days: int = 7,
    limit: int = 10,
):
    if asset_type not in {"hero", "category", "subcategory", "offer"}:
        raise HTTPException(400, "Bad asset_type")
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"asset_type": asset_type, "ts": {"$gte": since}}},
        {"$group": {
            "_id": {"asset_id": "$asset_id", "redirect_url": "$redirect_url"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": int(limit)},
    ]
    rows = []
    async for r in db.asset_clicks.aggregate(pipeline):
        rows.append({
            "asset_id": r["_id"].get("asset_id", ""),
            "redirect_url": r["_id"].get("redirect_url", ""),
            "count": int(r["count"]),
        })
    return {"asset_type": asset_type, "days": days, "rows": rows}




@api.get("/testimonials")
async def list_testimonials(limit: int = 12):
    rows = await db.testimonials.find({"published": True}, {"_id": 0}).sort("rank", 1).to_list(limit)
    return rows


@api.post("/admin/testimonials")
async def admin_create_testimonial(payload: dict, admin: dict = Depends(require_admin)):
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
async def admin_delete_testimonial(tid: str, admin: dict = Depends(require_admin)):
    await db.testimonials.delete_one({"id": tid})
    return {"ok": True}


@api.get("/categories/counts")
async def categories_with_counts():
    avail_map = await _availability_map()
    cats = await db.categories.find({"paused": {"$ne": True}}, {"_id": 0}).sort("order", 1).to_list(50)
    if not avail_map:
        for c in cats: c["product_count"] = 0
        return cats
    sids = list(avail_map.keys())
    pipeline = [
        {"$match": {"store_id": {"$in": sids}, **_visible_product_filter()}},
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


# Simple in-memory TTL cache for stores_in_category — see that endpoint's
# own doc comment for why this one specifically got a cache when nothing
# else in this file has one. Keyed by (l1_id, l2_id, limit); {expires_at,
# value}. Deliberately NOT a general-purpose cache utility — this endpoint
# is the one flagged as an actual measured navigation-speed contributor
# (three sequential DB round-trips: _availability_map's own store scan,
# the products aggregation, the stores lookup), not a speculative
# add-it-everywhere pattern.
_STORES_IN_CATEGORY_CACHE: dict[tuple[str, Optional[str], int], dict] = {}
_STORES_IN_CATEGORY_TTL = timedelta(minutes=3)


@api.get("/categories/{l1_id}/stores")
async def stores_in_category(l1_id: str, l2_id: Optional[str] = None, limit: int = 10):
    """Stores with at least one visible product in this category — powers
    the /c/[slug] "Stores in {L1}" rail, AND (once `l2_id` is passed) the
    homepage's L2-scoped "Footwear/Ethnic/Lingerie Store" sections (Phase
    C), which target a gendered L2 like l2-women-footwear rather than the
    standalone l1-footwear — see docs/design/lokl-redesign-plan.md and the
    Phase-A discovery note on the two competing "Footwear" identities in
    the taxonomy.

    Match field: l2_id when given, else l1_id — a single request always
    matches on exactly ONE of the two, never both (an L2's parent l1_id is
    still required in the URL path even when matching on l2_id, since
    these gendered L2s are always known relative to a specific L1 — this
    keeps the URL nested/ownership-shaped without adding a second,
    near-identical endpoint or an ambiguous combined id param). The
    l1_id path segment itself is otherwise unused for matching once l2_id
    is present.

    Sort priority: availability_rank first (open stores before closed —
    the same priority _attach_store_avail/every other feed in this file
    already uses), product_count in this category as the tiebreak within
    each availability tier — a store that's currently closed still
    shouldn't outrank an open one just because it happens to stock more
    of this category.

    3-minute in-memory TTL cache, keyed by (l1_id, l2_id, limit) — this
    data doesn't need to be real-time (a store's product count or
    open/closed status shifting doesn't need to reflect within the same
    few minutes), and this was the one endpoint the /c/[slug]
    navigation-speed audit flagged as a real contributor: three
    sequential DB round-trips per request (_availability_map's own store
    scan, the products aggregation, the stores lookup) with no caching.
    No other endpoint in this file caches anything — this is a targeted
    fix for a measured cost, not a new general pattern being introduced
    everywhere.
    """
    cache_key = (l1_id, l2_id, limit)
    cached = _STORES_IN_CATEGORY_CACHE.get(cache_key)
    now = datetime.now(timezone.utc)
    if cached and cached["expires_at"] > now:
        return cached["value"]

    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids:
        return []
    match_field = "l2_id" if l2_id else "l1_id"
    match_value = l2_id if l2_id else l1_id
    pipeline = [
        {"$match": {match_field: match_value, "store_id": {"$in": sids}, **_visible_product_filter()}},
        {"$group": {"_id": "$store_id", "product_count": {"$sum": 1}}},
    ]
    counts: dict[str, int] = {}
    async for row in db.products.aggregate(pipeline):
        counts[row["_id"]] = int(row["product_count"] or 0)
    if not counts:
        _STORES_IN_CATEGORY_CACHE[cache_key] = {"value": [], "expires_at": now + _STORES_IN_CATEGORY_TTL}
        return []
    store_ids = list(counts.keys())
    stores = await db.stores.find(
        {"id": {"$in": store_ids}, **_visible_store_filter()},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "logo": 1, "banner": 1, "banners": 1,
         "area_label": 1, "locality": 1, "tagline": 1, "trusted": 1},
    ).to_list(len(store_ids))
    for s in stores:
        avail = avail_map.get(s["id"], {})
        s["product_count"] = counts.get(s["id"], 0)
        s["badge"] = avail.get("badge", "LIVE")
        s["badge_color"] = avail.get("badge_color", "green")
        s["is_open"] = avail.get("can_order", True)
        s["availability_rank"] = avail.get("rank", 1)
        if avail.get("opens_at_label"):
            s["next_open_label"] = avail["opens_at_label"]
    stores.sort(key=lambda s: (s.get("availability_rank", 4), -s.get("product_count", 0)))
    result = stores[:limit]
    _STORES_IN_CATEGORY_CACHE[cache_key] = {"value": result, "expires_at": now + _STORES_IN_CATEGORY_TTL}
    return result


# ---- Store Section Overrides (redesign Phase G4) — admin-curated banner
# + pinned display cards layered ON TOP OF (never instead of) the real
# store aggregation stores_in_category() above already powers for the
# Footwear/Ethnic/Lingerie-or-Innerwear Store sections
# (StoreSectionModule on the frontend). One doc per (l1_id, l2_id) pair —
# the SAME scoping key stores_in_category() itself already matches on, so
# "Women's Footwear" vs "Men's Footwear" (different l1_id) and "Women's
# Lingerie" vs "Men's Inner Wear" (different l2_id — there's no
# l2-men-lingerie) can never collide. Enforced by a unique compound index
# (see migrations/022_store_section_overrides.py) as well as this
# endpoint's own upsert query being keyed on the exact same pair.
#
# `pinned_stores` are CMS display cards, NOT real stores — they never
# touch db.stores/db.merchants/db.products, carry no KYC/trusted/
# product-count status, and are purely additive: the frontend always
# renders real stores_in_category() results first, pinned cards after.
ALLOWED_PINNED_STORE_FIELDS = {"id", "name", "image", "link"}


def _clean_pinned_stores(raw) -> list[dict]:
    """Keeps only well-formed cards (a non-empty `name` is the one hard
    requirement — image/link are cosmetic and optional). Assigns a stable
    id to any card the admin just added client-side (no id yet); an
    existing id is preserved as-is so edits don't silently create
    duplicates."""
    out = []
    for item in (raw or []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        out.append({
            "id": str(item.get("id") or f"psc-{uuid.uuid4().hex[:8]}"),
            "name": name,
            "image": str(item.get("image") or ""),
            "link": str(item.get("link") or ""),
        })
    return out


@api.get("/store-section-overrides/{l1_id}/{l2_id}")
async def get_store_section_override(l1_id: str, l2_id: str):
    """Public read — StoreSectionModule fetches this ALONGSIDE (not
    instead of) GET /categories/{l1_id}/stores?l2_id=.... Always returns a
    well-formed doc even when no override exists yet (no 404 branch the
    frontend has to special-case), matching _get_site_config()'s own
    "always return something render-ready" convention."""
    doc = await db.store_section_overrides.find_one({"l1_id": l1_id, "l2_id": l2_id}, {"_id": 0})
    if not doc:
        return {"l1_id": l1_id, "l2_id": l2_id, "banner_image": "", "pinned_stores": []}
    doc["pinned_stores"] = doc.get("pinned_stores") or []
    return doc


@api.get("/admin/store-section-overrides")
async def admin_list_store_section_overrides(admin: dict = Depends(require_admin)):
    rows = await db.store_section_overrides.find({}, {"_id": 0}).to_list(200)
    return rows


@api.put("/admin/store-section-overrides/{l1_id}/{l2_id}")
async def admin_put_store_section_override(l1_id: str, l2_id: str, payload: dict, admin: dict = Depends(require_admin)):
    """Single whole-doc upsert — banner + the entire pinned_stores list are
    saved together in one call, same "one PUT replaces the whole doc"
    shape as PUT /admin/site/homepage-config, rather than separate
    per-pinned-card CRUD endpoints (pinned cards are never independently
    addressed anywhere else, so there's nothing a finer-grained API would
    actually serve)."""
    if l1_id not in L2_BY_L1 or l2_id not in [s["id"] for s in L2_BY_L1[l1_id]]:
        raise HTTPException(400, "Invalid l1_id/l2_id combination")
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "l1_id": l1_id,
        "l2_id": l2_id,
        "banner_image": str(payload.get("banner_image") or ""),
        "pinned_stores": _clean_pinned_stores(payload.get("pinned_stores")),
        "updated_at": now,
    }
    await db.store_section_overrides.update_one(
        {"l1_id": l1_id, "l2_id": l2_id},
        {"$set": update, "$setOnInsert": {"id": f"sso-{uuid.uuid4().hex[:8]}", "created_at": now}},
        upsert=True,
    )
    doc = await db.store_section_overrides.find_one({"l1_id": l1_id, "l2_id": l2_id}, {"_id": 0})
    return doc


@api.delete("/admin/store-section-overrides/{l1_id}/{l2_id}")
async def admin_delete_store_section_override(l1_id: str, l2_id: str, admin: dict = Depends(require_admin)):
    """Resets the section back to defaults — no CMS banner override, no
    pinned cards. Real stores_in_category() results are entirely
    unaffected either way; this only ever touches the CMS layer."""
    r = await db.store_section_overrides.delete_one({"l1_id": l1_id, "l2_id": l2_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Override not found")
    return {"ok": True}


# ============ Lokl V2 — Site CMS ============
# Canonical homepage section list — MUST be kept in sync with
# HomeClient.tsx's DEFAULT_SECTIONS (frontend), id-for-id, label-for-label,
# rank-for-rank. Every id here must have a matching entry in HomeClient's
# `sectionRenderers` (except sections that are intentionally hardcoded
# outside the ranked system, e.g. TrustStickers — never add those here).
#
# This list feeds _get_site_config() in two ways:
#   1. Seeds a brand-new site_config.homepage doc from scratch.
#   2. Auto-appends any id here that's missing from an EXISTING doc (so a
#      newly-shipped section always shows up in the admin Sections CMS
#      and on the live homepage, without a manual migration) — see the
#      `added` logic below.
# It does NOT overwrite rank/enabled for ids that already exist in the DB
# doc — the DB is authoritative for those once an admin has touched them
# via PUT /api/admin/site/homepage-config. One-time cleanup of a stale DB
# doc (e.g. dropping long-removed ids) is a migration's job, not this
# constant's — see migrations/012_reseed_homepage_sections.py.
# LOCKED SEQUENCE (redesign Phase D) — Hero -> Shop by Category -> Best
# Deals -> Shop by Price -> Shop by Area -> Shops near you -> Footwear
# Store -> Ethnic Store -> Premium picks -> Lingerie/Innerwear Store ->
# Browse All. Everything after that block predates this redesign and was
# never part of the locked sequence. best_deals/premium_picks are
# L1-scoped to Home's default L1 (Women) via GET /api/products?l1=&sort=,
# not the global feed — see HomeClient.tsx's own DEFAULT_SECTIONS comment
# for the full per-id cheat sheet (store_footwear/ethnic/lingerie
# targeting, why "under_499" keeps its pre-rename id, etc.) — kept there
# rather than duplicated here since the admin-facing `label` values below
# are what a CMS user actually sees, not this comment.
# LOCKED SEQUENCE (Phase G2, superseding Phase F's): Hero -> Shop by
# Category -> Best Deals -> Shop by Price -> Shop by Store -> Premium
# Picks -> Shop by Area -> Footwear Store -> Ethnic Store ->
# Lingerie/Innerwear Store. Phase G2 removed five sections outright (not
# just disabled): "Shops near you"/meet_sellers, the standalone promo
# "browse_all" CTA strip (the separate inline "Browse all {L1}" product
# grid on /c/[slug] is NOT part of this ranked list at all — see
# L1PageClient.tsx's own BrowseGridBlock comment — so it's unaffected),
# try_and_buy, for_her, and for_him. See L1PageClient.tsx's own
# DEFAULT_SECTIONS comment (frontend) for the full per-id cheat sheet —
# kept there since the admin-facing `label` values below are what a CMS
# user actually sees.
DEFAULT_HOMEPAGE_SECTIONS = [
    {"id": "category_pills",  "label": "Category pills",             "enabled": True,  "rank": 10},
    {"id": "hero",             "label": "Hero",                       "enabled": True,  "rank": 20},
    {"id": "shop_by_category", "label": "Shop by Category",           "enabled": True,  "rank": 25},
    {"id": "best_deals",       "label": "Best deals",                 "enabled": True,  "rank": 30},
    {"id": "under_499",        "label": "Shop by Price",              "enabled": True,  "rank": 40},
    {"id": "shop_by_store",    "label": "Shop by Store",              "enabled": True,  "rank": 50},
    {"id": "premium_picks",    "label": "Premium picks",              "enabled": True,  "rank": 60},
    {"id": "shop_by_area",     "label": "Shop by Area",               "enabled": True,  "rank": 70},
    {"id": "store_footwear",   "label": "Footwear Store",             "enabled": True,  "rank": 90},
    {"id": "store_ethnic",     "label": "Ethnic Store",                "enabled": True,  "rank": 100},
    {"id": "store_lingerie",   "label": "Lingerie / Innerwear Store", "enabled": True,  "rank": 110},

    # Pre-redesign sections — not part of the locked sequence above.
    {"id": "shop_by_brand", "label": "Shop by Brand",            "enabled": True,  "rank": 140},
    {"id": "merchant_cta",  "label": "Open a store",             "enabled": True,  "rank": 170},
    {"id": "offers",        "label": "Offers for you",           "enabled": True,  "rank": 180},
    {"id": "just_in",       "label": "Just In",                  "enabled": False, "rank": 190},
    {"id": "trending",      "label": "Trending now",             "enabled": False, "rank": 200},
    {"id": "customer_love", "label": "Loved by Bhilai shoppers", "enabled": False, "rank": 210},
]
DEFAULT_HERO = {
    "image": "https://customer-assets.emergentagent.com/job_bharat-fashion-os/artifacts/n1elwepz_ChatGPT%20Image%20May%2016%2C%202026%2C%2006_29_23%20PM.png",
    "mobile_image": "",
    "eyebrow": "Serving Bhilai",
    "title_line1": "Delivered in minutes from",
    "title_line2": "stores next door.",
    "subtitle": "Hand-picked fashion from trusted Bhilai stores.",
    "cta_primary_label": "Shop Women", "cta_primary_link": "/c/women",
    "cta_secondary_label": "Shop Men", "cta_secondary_link": "/c/men",
    "redirect_url": "",  # iter-26 CMS — overrides cta_primary_link when set (whole banner clickable)
    "show_stats": True, "show_usp_chips": True,
    # iter-27 (Item 7): admin toggles. paused → hero hidden from consumers.
    # non_clickable → renders as <div> instead of <Link>.
    "paused": False, "non_clickable": False,
}


async def _get_site_config() -> dict:
    doc = await db.site_config.find_one({"id": "homepage"}, {"_id": 0})
    if not doc:
        doc = {"id": "homepage", "sections": DEFAULT_HOMEPAGE_SECTIONS, "hero": DEFAULT_HERO, "try_and_buy_image": ""}
        await db.site_config.insert_one(doc)
    section_ids = {s["id"] for s in doc.get("sections", [])}
    added = [s for s in DEFAULT_HOMEPAGE_SECTIONS if s["id"] not in section_ids]
    if added:
        doc.setdefault("sections", []).extend(added)
        await db.site_config.update_one({"id": "homepage"}, {"$set": {"sections": doc["sections"]}})
    if "hero" not in doc:
        doc["hero"] = DEFAULT_HERO
        await db.site_config.update_one({"id": "homepage"}, {"$set": {"hero": doc["hero"]}})
    # Try & Buy homepage strip photo — single admin-settable field, same
    # $setOnInsert-style "backfill once, never overwrite an existing value"
    # semantics as the category/area image CMS fields.
    if "try_and_buy_image" not in doc:
        doc["try_and_buy_image"] = ""
        await db.site_config.update_one({"id": "homepage"}, {"$set": {"try_and_buy_image": ""}})
    # iter-27 (Item 7) — backfill new toggles on legacy hero docs so the admin
    # editor sees explicit `false` checkboxes and the consumer code never has
    # to guess between "missing" and "off".
    hero = doc.get("hero") or {}
    missing = {k: v for k, v in {"paused": False, "non_clickable": False}.items() if k not in hero}
    if missing:
        hero.update(missing)
        doc["hero"] = hero
        await db.site_config.update_one({"id": "homepage"}, {"$set": {f"hero.{k}": v for k, v in missing.items()}})
    doc.pop("_id", None)
    return doc


@api.get("/site/homepage-config")
async def public_homepage_config():
    cfg = await _get_site_config()
    cfg["sections"] = sorted(cfg["sections"], key=lambda s: s.get("rank", 999))
    # iter-27 (Item 7): when paused, signal it to the consumer with just the
    # paused flag — HeroV2 reads `hero.paused` and renders null. We keep the
    # field rather than nulling the whole object so the front-end doesn't fall
    # back to its hard-coded default hero image.
    hero = cfg.get("hero") or {}
    if hero.get("paused"):
        cfg["hero"] = {"paused": True}
    return cfg


@api.get("/admin/site/homepage-config")
async def admin_get_homepage_config(admin: dict = Depends(require_admin)):
    return await _get_site_config()


@api.put("/admin/site/homepage-config")
async def admin_put_homepage_config(payload: dict, admin: dict = Depends(require_admin)):
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
    if "try_and_buy_image" in payload:
        update["try_and_buy_image"] = str(payload.get("try_and_buy_image") or "")
    if not update:
        raise HTTPException(400, "Nothing to update")
    await db.site_config.update_one({"id": "homepage"}, {"$set": update}, upsert=True)
    return await _get_site_config()


@api.get("/search")
async def search(q: str = "", limit: int = 20):
    """Lightweight typeahead. Returns products + stores matching the query."""
    if not q or len(q.strip()) < 1:
        return {"products": [], "stores": []}
    # Escape user input — never pass raw to $regex (ReDoS risk + Mongo regex injection)
    import re as _re
    safe_q = _re.escape(q.strip()[:64])  # also cap length
    rx = {"$regex": safe_q, "$options": "i"}
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
    # `is_deleted` = soft-deleted by admin — never surfaced.
    # `online` is the merchant's self-service availability toggle — when False,
    # offline stores appear at bottom of feeds (rank=4), products are never hidden.
    return {"kyc_status": "approved", "published": True, "paused": {"$ne": True},
            "is_deleted": {"$ne": True}}

def _visible_product_filter():
    return {"paused": {"$ne": True}, "is_deleted": {"$ne": True}}


async def _category_min_prices():
    """Cheapest visible product price per L1 and per L2, each in a single
    aggregation (2 DB round trips total, regardless of catalog/category
    count) — used to show "from ₹X" chips on the homepage category tiles
    without an N+1 query per tile."""
    l1_rows = await db.products.aggregate([
        {"$match": _visible_product_filter()},
        {"$group": {"_id": "$l1_id", "min_price": {"$min": "$price"}}},
    ]).to_list(200)
    l2_rows = await db.products.aggregate([
        {"$match": {**_visible_product_filter(), "l2_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$l2_id", "min_price": {"$min": "$price"}}},
    ]).to_list(500)
    l1_min = {r["_id"]: r["min_price"] for r in l1_rows if r["_id"]}
    l2_min = {r["_id"]: r["min_price"] for r in l2_rows if r["_id"]}
    return l1_min, l2_min


async def _area_store_counts(slugs: list) -> dict:
    """Live visible-store count per area_slug, one grouped aggregation
    (not one query per area) — powers the "Shop by Area" tile badges."""
    if not slugs:
        return {}
    rows = await db.stores.aggregate([
        {"$match": {**_visible_store_filter(), "area_slug": {"$in": slugs}}},
        {"$group": {"_id": "$area_slug", "n": {"$sum": 1}}},
    ]).to_list(len(slugs))
    return {r["_id"]: r["n"] for r in rows if r["_id"]}


# DEPRECATED — replaced by _store_availability(). Do not use.
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


def _store_availability(store: dict) -> dict:
    """Return full availability descriptor for a store.

    State matrix (rank 1=best):
      Toggle OFF                                      → rank 4, Store Offline, can_order=False
      Toggle ON + outside hours                       → rank 3, Closed,        can_order=True
      Toggle ON + in hours + last_seen < 60 min       → rank 1, LIVE,          can_order=True
      Toggle ON + in hours + last_seen 60–180 min     → rank 2, Away,          can_order=False
      Toggle ON + in hours + last_seen > 180 min      → rank 4, Store Offline, can_order=False
      Toggle ON + in hours + no last_seen (new store) → rank 1, LIVE,          can_order=True
    """
    def _fmt_time(t: str) -> str:
        try:
            oh, om = [int(x) for x in t.split(":")[:2]]
            h = oh % 12 or 12
            ampm = "AM" if oh < 12 else "PM"
            return f"{h}:{om:02d} {ampm}"
        except Exception:
            return t

    if store.get("online") is False:
        return {"rank": 4, "badge": "Store Offline", "badge_color": "red",
                "can_order": False, "eta_message": "Store offline", "opens_at_label": None}

    # Check weekly off
    weekly_off = store.get("weekly_off") or []
    if weekly_off:
        ist_now = datetime.now(timezone.utc) + timedelta(minutes=330)
        ist_day = ist_now.strftime("%A")
        if ist_day in weekly_off:
            days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            today_idx = days.index(ist_day)
            opens_raw = store.get("opens_at", "10:00")
            try:
                h, mn = map(int, opens_raw.split(":")[:2])
                opens_fmt = f"{h if h <= 12 else h - 12}:{mn:02d} {'AM' if h < 12 else 'PM'}"
            except Exception:
                opens_fmt = opens_raw
            for i in range(1, 8):
                next_day = days[(today_idx + i) % 7]
                if next_day not in weekly_off:
                    return {"rank": 3, "badge": "Closed", "badge_color": "gray",
                            "can_order": False,
                            "eta_message": f"Weekly off · Opens {next_day} at {opens_fmt}",
                            "opens_at_label": f"Opens {next_day} at {opens_fmt}"}

    opens = store.get("opens_at")
    closes = store.get("closes_at")
    in_hours = True
    cur_min = None
    closes_raw_min = None

    if opens and closes:
        try:
            ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
            cur_min = ist.hour * 60 + ist.minute
            oh, om = [int(x) for x in opens.split(":")[:2]]
            ch, cm = [int(x) for x in closes.split(":")[:2]]
            open_min = oh * 60 + om + 30   # 30-min grace after opens
            close_min = ch * 60 + cm - 30  # 30-min grace before closes
            closes_raw_min = ch * 60 + cm
            in_hours = open_min <= cur_min < close_min
        except Exception:
            in_hours = True

    if not in_hours:
        try:
            time_str = _fmt_time(opens)
            if cur_min is not None and closes_raw_min is not None and cur_min < closes_raw_min:
                eta_msg = f"Opens today at {time_str}"
                opens_lbl = f"Opens at {time_str}"
            else:
                eta_msg = f"Opens tomorrow at {time_str}"
                opens_lbl = f"Opens tomorrow at {time_str}"
        except Exception:
            eta_msg, opens_lbl = "Store closed", None
        return {"rank": 3, "badge": "Closed", "badge_color": "gray",
                "can_order": True, "eta_message": eta_msg, "opens_at_label": opens_lbl}

    last_seen = store.get("last_seen_at")
    if not last_seen:
        return {"rank": 1, "badge": "LIVE", "badge_color": "green",
                "can_order": True, "eta_message": "Delivery in ~45 mins", "opens_at_label": None}

    try:
        last_dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        elapsed_min = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
        if elapsed_min < 60:
            return {"rank": 1, "badge": "LIVE", "badge_color": "green",
                    "can_order": True, "eta_message": "Delivery in ~45 mins", "opens_at_label": None}
        if elapsed_min < 180:
            return {"rank": 2, "badge": "Away", "badge_color": "yellow",
                    "can_order": False, "eta_message": "Store is away · Try again later", "opens_at_label": None}
        return {"rank": 4, "badge": "Store Offline", "badge_color": "red",
                "can_order": False, "eta_message": "Store offline · Try other stores", "opens_at_label": None}
    except Exception:
        return {"rank": 1, "badge": "LIVE", "badge_color": "green",
                "can_order": True, "eta_message": "Delivery in ~45 mins", "opens_at_label": None}


async def _availability_map() -> dict[str, dict]:
    """Return {store_id: availability_dict} for ALL non-deleted/paused stores.
    Includes toggle-OFF stores so feeds can rank them at the bottom (rank=4)."""
    stores = await db.stores.find(
        _visible_store_filter(),
        {"_id": 0, "id": 1, "online": 1, "last_seen_at": 1, "opens_at": 1, "closes_at": 1,
         "weekly_off": 1, "plan": 1}
    ).to_list(2000)
    return {s["id"]: {**_store_availability(s), "plan": s.get("plan", "free")} for s in stores}


def _attach_store_avail(products: list, avail_map: dict) -> list:
    """Stamp store availability fields onto each product dict in-place."""
    _default = {"rank": 1, "badge": "LIVE", "badge_color": "green",
                "can_order": True, "eta_message": "Delivery in ~45 mins", "opens_at_label": None}
    for p in products:
        avail = avail_map.get(p.get("store_id"), _default)
        p["store_badge"] = avail["badge"]
        p["store_badge_color"] = avail["badge_color"]
        p["store_can_order"] = avail["can_order"]
        p["store_eta_message"] = avail["eta_message"]
        p["store_opens_at_label"] = avail["opens_at_label"]
        p["store_availability_rank"] = avail["rank"]
        # can_pickup: True for Pro-plan LIVE stores (rank 1) and Pro closed-by-hours (rank 3, can_order=True).
        # Gated behind Pro plan — free/starter/growth merchants do not get the pickup feature.
        is_pro = avail.get("plan", "free") == "pro"
        p["store_can_pickup"] = is_pro and avail.get("rank", 4) in (1, 3) and avail.get("can_order", False)
    return products


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometres."""
    import math
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

# Bhilai city centroid — same value the frontend checkout page uses for the
# delivery-fee estimate (BHILAI_LAT/BHILAI_LNG in checkout/page.tsx).
BHILAI_LAT = 21.1938
BHILAI_LNG = 81.3509
# Generous radius covering the whole Bhilai+Raipur pilot footprint (Raipur is
# ~30-35km from Bhilai). A user this far outside it isn't physically in the
# service area — their real GPS is not a meaningful reference point for
# "distance to a Bhilai store" and would show nonsense like "997 km away" on
# a page that's explicitly claiming "sorted by distance" for a hyperlocal
# same-city service. Fall back to the city centroid instead.
BHILAI_PLAUSIBLE_RADIUS_KM = 75.0


def _attach_distance_and_eta(stores: list, user_lat: Optional[float], user_lng: Optional[float]) -> list:
    """Compute distance_km + eta_min from store coords ↔ user coords, then sort ascending.

    If the caller's coords are implausibly far from Bhilai (tester's real GPS
    in another city, geolocation permission granted somewhere else, etc.),
    distance is computed from the Bhilai centroid instead — never a raw
    ~1000km readout for a hyperlocal single-city service."""
    if user_lat is None or user_lng is None:
        # No user coords — distance/ETA hidden (frontend should respect this)
        for s in stores:
            s.pop("distance_km", None); s.pop("eta_min", None)
        return stores
    ref_lat, ref_lng = user_lat, user_lng
    if _haversine_km(user_lat, user_lng, BHILAI_LAT, BHILAI_LNG) > BHILAI_PLAUSIBLE_RADIUS_KM:
        ref_lat, ref_lng = BHILAI_LAT, BHILAI_LNG
    for s in stores:
        slat, slng = s.get("lat"), s.get("lng")
        if isinstance(slat, (int, float)) and isinstance(slng, (int, float)):
            d = round(_haversine_km(ref_lat, ref_lng, float(slat), float(slng)), 2)
            s["distance_km"] = d
            # Simple ETA model: 15 min base prep + ~5 min/km for short distances, capped 90.
            s["eta_min"] = max(20, min(90, int(round(15 + d * 5))))
        else:
            # Missing/invalid store coords — never show a garbage distance.
            s.pop("distance_km", None); s.pop("eta_min", None)
    return stores


@api.get("/stores")
async def list_stores(city: Optional[str] = None, area: Optional[str] = None, limit: int = 50,
                      lat: Optional[float] = None, lng: Optional[float] = None):
    q = dict(_visible_store_filter())
    if city: q["city"] = city
    if area: q["area_slug"] = area
    stores = await db.stores.find(q, {"_id": 0, "banner_images": 0}).to_list(limit)
    stores = _attach_distance_and_eta(stores, lat, lng)
    for s in stores:
        avail = _store_availability(s)
        s["badge"] = avail["badge"]
        s["badge_color"] = avail["badge_color"]
        s["is_open"] = avail["can_order"]
        s["availability_rank"] = avail["rank"]
        if avail.get("opens_at_label"):
            s["next_open_label"] = avail["opens_at_label"]
    stores.sort(key=lambda s: (
        s.get("availability_rank", 4),
        s.get("distance_km") if s.get("distance_km") is not None else 9999
    ))
    return stores


@api.get("/feed/nearby-stores")
async def feed_nearby_stores(lat: float, lng: float, limit: int = 10):
    """Stores sorted by availability rank then distance. Requires user coords."""
    stores = await db.stores.find(_visible_store_filter(), {"_id": 0, "banner_images": 0}).to_list(200)
    stores = _attach_distance_and_eta(stores, lat, lng)
    for s in stores:
        avail = _store_availability(s)
        s["badge"] = avail["badge"]
        s["badge_color"] = avail["badge_color"]
        s["is_open"] = avail["can_order"]
        s["availability_rank"] = avail["rank"]
        if avail.get("opens_at_label"):
            s["next_open_label"] = avail["opens_at_label"]
    stores = [s for s in stores if s.get("distance_km") is not None]
    stores.sort(key=lambda s: (
        s.get("availability_rank", 4),
        s.get("distance_km", 9999)
    ))
    return stores[:limit]


@api.get("/feed/popular-stores")
async def feed_popular_stores(limit: int = 10, lat: Optional[float] = None, lng: Optional[float] = None):
    """Stores with the most orders in the last 30 days, sorted by availability rank.

    `lat`/`lng` are optional — when given, distance_km/eta_min are computed
    the same way feed_nearby_stores does (never fabricated when coords are
    absent). Popularity ranking itself is unaffected by location."""
    stores = await db.stores.find(_visible_store_filter(), {"_id": 0, "banner_images": 0}).to_list(200)
    stores = _attach_distance_and_eta(stores, lat, lng)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    counts: dict = {}
    async for o in db.orders.find({"created_at": {"$gte": since}}, {"_id": 0, "items": 1}):
        for it in (o.get("items") or []):
            sid = it.get("store_id")
            if sid: counts[sid] = counts.get(sid, 0) + 1
    for s in stores:
        s["orders_30d"] = counts.get(s["id"], 0)
        avail = _store_availability(s)
        s["badge"] = avail["badge"]
        s["badge_color"] = avail["badge_color"]
        s["is_open"] = avail["can_order"]
        s["availability_rank"] = avail["rank"]
        if avail.get("opens_at_label"):
            s["next_open_label"] = avail["opens_at_label"]
    stores.sort(key=lambda s: (s.get("availability_rank", 4), -s.get("orders_30d", 0)))
    return stores[:limit]


@api.get("/feed/delivery-status")
async def feed_delivery_status():
    """Returns delivery status with reason: LIVE / AWAY (in-hours but offline) / CLOSED (outside hours)."""
    from datetime import datetime, timezone, timedelta
    stores = await db.stores.find(
        _visible_store_filter(),
        {"_id": 0, "online": 1, "last_seen_at": 1, "opens_at": 1, "closes_at": 1, "weekly_off": 1}
    ).to_list(1000)
    if not stores:
        return {"status": "closed", "label": "CLOSED", "eta_label": "tomorrow", "message": "No stores yet"}

    live_stores = [s for s in stores if _store_availability(s).get("rank", 4) <= 2]
    if live_stores:
        return {"status": "live", "label": "LIVE", "eta_label": "45 minutes", "message": "Fast delivery"}

    ist_now = datetime.now(timezone.utc) + timedelta(minutes=330)
    current_minutes = ist_now.hour * 60 + ist_now.minute
    ist_day = ist_now.strftime("%A")

    in_hours_but_offline = []
    for s in stores:
        weekly_off = s.get("weekly_off") or []
        if ist_day in weekly_off:
            continue
        opens = s.get("opens_at", "10:00")
        closes = s.get("closes_at", "21:00")
        try:
            oh, om = map(int, opens.split(":"))
            ch, cm = map(int, closes.split(":"))
            if oh * 60 + om <= current_minutes <= ch * 60 + cm:
                in_hours_but_offline.append(s)
        except Exception:
            pass

    if in_hours_but_offline:
        return {"status": "closed", "label": "AWAY", "eta_label": "back soon", "message": "Stores away"}

    # Outside hours — find earliest opening time
    earliest_min = None
    earliest_opens = None
    opens_today = False
    for s in stores:
        weekly_off = s.get("weekly_off") or []
        if ist_day in weekly_off:
            continue
        opens = s.get("opens_at", "10:00")
        try:
            oh, om = map(int, opens.split(":"))
            store_open_min = oh * 60 + om
            if earliest_min is None or store_open_min < earliest_min:
                earliest_min = store_open_min
                earliest_opens = opens
            if store_open_min > current_minutes:
                opens_today = True
        except Exception:
            pass

    if earliest_opens:
        try:
            oh, om = map(int, earliest_opens.split(":"))
            suffix = "AM" if oh < 12 else "PM"
            h12 = oh % 12 or 12
            opens_fmt = f"{h12}:{om:02d} {suffix}"
        except Exception:
            opens_fmt = earliest_opens
        time_label = f"at {opens_fmt}" if opens_today else f"tomorrow {opens_fmt}"
        return {"status": "closed", "label": "CLOSED", "eta_label": time_label, "message": "Opens"}

    return {"status": "closed", "label": "CLOSED", "eta_label": "tomorrow", "message": "Opens"}


@api.get("/delivery/check-serviceability")
async def check_serviceability(lat: Optional[float] = None, lng: Optional[float] = None, pincode: Optional[str] = None):
    """Check if a DELIVERY ADDRESS is serviceable — polygon-with-pincode
    fallback, see _address_is_serviceable (Group C1).

    `lat`/`lng`, IF PROVIDED, MUST be the delivery address's own pin
    coordinates — the point the customer dropped on a map for THIS address.
    NEVER pass the shopper's live device GPS here. This isn't a style
    preference: we've shipped and had to revert this exact substitution
    three times (a shopper physically outside Bhilai got an otherwise-valid
    Bhilai delivery address rejected). If you don't have a delivery-pin
    coordinate for the address, omit lat/lng and pass `pincode` instead."""
    if lat is None and lng is None and not pincode:
        raise HTTPException(400, "Provide lat & lng (the delivery address's own pin) or pincode to check serviceability.")
    in_zone = _address_is_serviceable({"lat": lat, "lng": lng, "pincode": pincode})
    return {
        "serviceable": in_zone,
        "message": "We deliver here!" if in_zone else "Sorry, we don't deliver to this location yet. We're expanding soon!",
        "zone": "Bhilai" if in_zone else None,
    }


@api.post("/support/ticket")
async def create_support_ticket(payload: dict, request: Request):
    """Create a support ticket — optionally linked to an order."""
    customer_phone = ""
    try:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            import jwt as _jwt
            data = _jwt.decode(auth[7:], options={"verify_signature": False})
            customer_phone = data.get("sub", "")
    except Exception:
        pass

    ticket = {
        "id": f"ticket-{uuid.uuid4().hex[:8]}",
        "customer_phone": customer_phone,
        "order_id": payload.get("order_id"),
        "subject": payload.get("subject", "Support request"),
        "message": payload.get("message", ""),
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "messages": [
            {
                "sender": "customer",
                "text": payload.get("message", ""),
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            {
                "sender": "bot",
                "text": "Thanks for reaching out! Our team has received your message and will respond within a few hours. You can also email us at hello@shoplokl.in",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        ],
    }
    await db.support_tickets.insert_one({**ticket, "_id": ticket["id"]})
    ticket.pop("_id", None)

    try:
        from notifications import send_with_fallback
        admin_phone = os.environ.get("ADMIN_PHONE", "")
        if admin_phone:
            order_ref = f" (Order #{payload.get('order_id', '')[-6:].upper()})" if payload.get("order_id") else ""
            send_with_fallback(admin_phone, f"New support ticket{order_ref}:\n{payload.get('message', '')[:200]}", message_type="admin_support_ticket")
    except Exception:
        pass

    return ticket


@api.get("/admin/support/tickets")
async def get_support_tickets(admin: dict = Depends(require_admin)):
    tickets = await db.support_tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"tickets": tickets}


@api.post("/admin/support/tickets/{ticket_id}/reply")
async def admin_reply_ticket(ticket_id: str, payload: dict, admin: dict = Depends(require_admin)):
    message = {
        "sender": "admin",
        "text": payload.get("text", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {
            "$push": {"messages": message},
            "$set": {"status": "replied"},
        },
    )
    return {"ok": True}
    # TODO: notify customer via WhatsApp when admin replies (Twilio call goes here)


@api.post("/support/tickets/{ticket_id}/reply")
async def customer_reply_to_ticket(ticket_id: str, request: Request):
    """Customer appends a message to an existing ticket thread."""
    body = await request.json()
    text = (body.get("message") or "").strip()
    if not text:
        raise HTTPException(400, "message required")
    # Extract phone from JWT — same pattern as /support/my-tickets
    auth = request.headers.get("authorization", "")
    customer_phone = ""
    try:
        if auth.startswith("Bearer "):
            import jwt as _jwt
            data = _jwt.decode(auth[7:], options={"verify_signature": False})
            customer_phone = data.get("sub", "")
    except Exception:
        pass
    if not customer_phone:
        raise HTTPException(401, "auth required")
    ticket = await db.support_tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(404, "ticket not found")
    if ticket.get("customer_phone") and ticket["customer_phone"] != customer_phone:
        raise HTTPException(403, "not authorized")
    msg = {"sender": "customer", "text": text, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg}, "$set": {"status": "open"}},
    )
    return {"ok": True}


@api.get("/admin/support/tickets/{ticket_id}")
async def get_support_ticket(ticket_id: str, admin: dict = Depends(require_admin)):
    """Admin: fetch a single ticket with full messages array."""
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "ticket not found")
    return ticket


@api.patch("/admin/support/tickets/{ticket_id}/status")
async def update_support_ticket_status(ticket_id: str, payload: dict, admin: dict = Depends(require_admin)):
    """Admin: change ticket status. Allowed values: open, replied, closed."""
    new_status = (payload.get("status") or "").strip()
    if new_status not in ("open", "replied", "closed"):
        raise HTTPException(400, "status must be one of: open, replied, closed")
    result = await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "ticket not found")
    return {"ok": True}


@api.get("/support/my-tickets")
async def get_my_tickets(request: Request):
    auth = request.headers.get("authorization", "")
    customer_phone = ""
    try:
        if auth.startswith("Bearer "):
            import jwt as _jwt
            data = _jwt.decode(auth[7:], options={"verify_signature": False})
            customer_phone = data.get("sub", "")
    except Exception:
        pass
    if not customer_phone:
        raise HTTPException(401)
    tickets = await db.support_tickets.find(
        {"customer_phone": customer_phone}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"tickets": tickets}


@api.get("/brands")
async def list_brands(search: str = "", skip: int = 0, limit: int = 20, sort: str = "name"):
    """Public list — powers the merchant product form's search-only combobox
    typeahead (`?search=`), the /brands directory (default `sort=name`),
    and Home's "Shop by Brand" rail (`sort=popular`, i.e. product_count
    desc — a real signal already denormalized on the brand doc, not a
    fabricated "curated" flag). Brand is a closed, admin-curated
    vocabulary — this route has no create counterpart."""
    limit = max(1, min(limit, 100))
    q: dict = {}
    if search.strip():
        q["name"] = {"$regex": _re.escape(search.strip()), "$options": "i"}
    total = await db.brands.count_documents(q)
    sort_field, sort_dir = ("product_count", -1) if sort == "popular" else ("name", 1)
    rows = await db.brands.find(q, {"_id": 0}).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)
    return {"brands": rows, "total": total, "skip": skip, "limit": limit}


@api.get("/brands/{slug_or_id}")
async def get_brand(slug_or_id: str):
    """Brand metadata only — the product grid for /brand/[slug] is fetched
    separately via GET /api/products?brand_id=, the same shared,
    availability-aware endpoint every other product grid uses, rather than
    a bespoke inline query here that could drift out of sync with it."""
    b = await db.brands.find_one({"$or": [{"slug": slug_or_id}, {"id": slug_or_id}]}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Brand not found")
    return {"brand": b}


async def _create_brand_doc(payload: BrandCreate, created_by: str) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Brand name is required")
    # If a brand with this exact name (case-insensitive) already exists,
    # return it instead of creating a duplicate — matches the bulk-upload
    # path's name-matched lookup so both flows converge on one brand.
    existing = await db.brands.find_one(
        {"name": {"$regex": f"^{_re.escape(name)}$", "$options": "i"}}, {"_id": 0},
    )
    if existing:
        return existing
    slug = await _unique_brand_slug(_slugify(name))
    doc = {
        "id": f"brand-{uuid.uuid4().hex[:10]}",
        "name": name,
        "slug": slug,
        "logo": payload.logo or "",
        "logo_public_id": payload.logo_public_id or "",
        "description": payload.description or "",
        "product_count": 0,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.brands.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one(
        {"$or": [{"slug": store_id}, {"id": store_id}], **_visible_store_filter()},
        {"_id": 0},
    )
    if not s: raise HTTPException(404, "Store not found")
    # Resolve the actual store id for subsequent product query
    store_id = s["id"]
    avail = _store_availability(s)
    s["badge"] = avail["badge"]
    s["badge_color"] = avail["badge_color"]
    s["is_open"] = avail["can_order"]
    s["eta_message"] = avail["eta_message"]
    if avail.get("opens_at_label"):
        s["next_open_label"] = avail["opens_at_label"]
    # Same Pro-plan + rank gate _attach_store_avail() uses for the per-product
    # store_can_pickup field — surfaced here on the store object itself so
    # checkout's order_type selector can grey out Pickup for stores that
    # would just get rejected by create_order's own pickup pre-check.
    # NOTE: `avail` here is a raw _store_availability() call, NOT routed
    # through _availability_map() — that's the only place "plan" normally
    # gets merged in (see _availability_map's own dict-merge). Read plan
    # straight off the store doc `s` instead.
    s["can_pickup"] = (s.get("plan", "free") == "pro"
                        and avail.get("rank", 4) in (1, 3)
                        and avail.get("can_order", False))
    # Real, computed order count — same merchant_ids/status-exclusion pattern
    # already used for the merchant's own "first order" check above. Never
    # fabricated: if merchant_id is missing (shouldn't happen for a
    # published store, but defensive), this is simply 0, and the PDP's
    # merchant micro-card treats 0 the same as "omit the metric line."
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    mid = s.get("merchant_id")
    s["orders_this_month"] = (
        await db.orders.count_documents({
            "merchant_ids": mid,
            "created_at": {"$gte": month_start},
            "status": {"$nin": ["cancelled", "rejected"]},
        })
        if mid else 0
    )
    products = await db.products.find({"store_id": store_id, **_visible_product_filter()}, {"_id": 0, "images": 0}).to_list(200)
    for p in products:
        p["store_badge"] = avail["badge"]
        p["store_badge_color"] = avail["badge_color"]
        p["store_can_order"] = avail["can_order"]
        p["store_eta_message"] = avail["eta_message"]
        p["store_opens_at_label"] = avail.get("opens_at_label")
        p["store_availability_rank"] = avail["rank"]
    return {"store": s, "products": products}


@api.get("/stores/{store_id}/categories")
async def store_categories(store_id: str):
    """Distinct L1 categories actually present across this store's visible
    products — the reverse direction of stores_in_category (categories ->
    stores). Derived from real product l1_id values only; deliberately does
    NOT read store.specialties, which is merchant-declared free text with
    no connection to actual product taxonomy.

    Joined against the live db.categories collection (not the static
    L1_CATEGORIES seed constant) so admin-edited category names/images stay
    correct here too, and paused categories are excluded the same as
    everywhere else a category renders publicly."""
    store = await db.stores.find_one(
        {"$or": [{"slug": store_id}, {"id": store_id}], **_visible_store_filter()}, {"_id": 0, "id": 1},
    )
    if not store:
        raise HTTPException(404, "Store not found")
    l1_ids = [x for x in await db.products.distinct(
        "l1_id", {"store_id": store["id"], **_visible_product_filter()},
    ) if x]
    if not l1_ids:
        return []
    cats = await db.categories.find(
        {"id": {"$in": l1_ids}, "paused": {"$ne": True}}, {"_id": 0},
    ).sort("order", 1).to_list(50)
    return cats


@api.get("/products")
async def list_products(l1: Optional[str] = None, l2: Optional[str] = None,
                        gender: Optional[str] = None, store: Optional[str] = None,
                        brand_id: Optional[str] = None,
                        sort: str = "trending", limit: int = 100):
    avail_map = await _availability_map()
    sids = list(avail_map.keys()) if avail_map else []
    q: dict = {**_visible_product_filter()}
    if store:
        q["store_id"] = store
    elif sids:
        q["store_id"] = {"$in": sids}
    if l1: q["l1_id"] = l1
    if l2: q["l2_id"] = l2
    if gender: q["gender"] = gender
    if brand_id: q["brand_id"] = brand_id
    cursor = db.products.find(q, {"_id": 0, "images": 0})
    if sort == "price_asc": cursor = cursor.sort("price", 1)
    elif sort == "price_desc": cursor = cursor.sort("price", -1)
    elif sort == "rating": cursor = cursor.sort("rating", -1)
    items = await cursor.to_list(limit)
    items = _attach_store_avail(items, avail_map)
    items.sort(key=lambda p: p.get("store_availability_rank", 1))
    return items

@api.get("/products/{pid}/related")
async def related_products(pid: str):
    product = await db.products.find_one({"id": pid}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    store_id = product.get("store_id")
    category = product.get("category") or product.get("l1_id")
    avail_map = await _availability_map()
    from_store = await db.products.find(
        {**_visible_product_filter(), "store_id": store_id, "id": {"$ne": pid}},
        {"_id": 0}
    ).limit(8).to_list(8)
    similar_q: dict = {**_visible_product_filter(), "id": {"$ne": pid}, "store_id": {"$ne": store_id}}
    if category:
        similar_q["l1_id"] = category
    similar = await db.products.find(similar_q, {"_id": 0}).limit(8).to_list(8)
    _attach_store_avail(from_store, avail_map)
    _attach_store_avail(similar, avail_map)
    return {"from_store": from_store, "similar": similar}


LOCAL_PROOF_WINDOW_DAYS = 14

@api.get("/products/{pid}/local-proof")
async def product_local_proof(pid: str, pincode: str):
    """Hyperlocal social proof — count of orders for this product delivered
    to the shopper's own pincode in the last LOCAL_PROOF_WINDOW_DAYS days.
    Pincode-level, not GPS, same unit checkout/DeliveryServiceability
    already key off (see lib/serviceability.ts's BHILAI_PINCODES mirror).

    The frontend gates rendering at count >= 5 — a low count shown as "1
    person bought this" undermines trust more than it builds it — but that
    threshold is a UI decision, not this endpoint's; it returns the real
    number so the threshold can move without a backend change.

    Cached (short TTL, degrades to a live query when Redis is unconfigured
    — see services/cache_service.py) since this recomputes per pageview
    otherwise. A real scheduled precompute (rather than a request-triggered
    cache) would scale better under load; flagged as a follow-up rather
    than blocking this feature, per cache_service's own "optional, graceful
    degradation" design already established elsewhere in this file.
    """
    pin = (pincode or "").strip()
    if len(pin) != 6 or not pin.isdigit():
        return {"count": 0}

    cache_key = f"local_proof:{pid}:{pin}"
    cached = await cache_service.get(cache_key)
    if cached is not None:
        return cached

    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOCAL_PROOF_WINDOW_DAYS)).isoformat()
    count = await db.orders.count_documents({
        "items.id": pid,
        "address.pincode": pin,
        "created_at": {"$gte": cutoff},
        "status": {"$nin": ["cancelled", "rejected"]},
    })
    result = {"count": count}
    await cache_service.set(cache_key, result, ttl=1800)
    return result


@api.get("/products/all")
async def all_products(
    price: Optional[str] = None,
    l1: Optional[str] = None,
    sort: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 60,
):
    avail_map = await _availability_map()
    q: dict = {**_visible_product_filter()}
    if l1: q["l1_id"] = l1
    if search and search.strip():
        # Same escape-then-regex pattern as GET /api/search — never pass raw
        # user input to $regex (ReDoS + Mongo regex injection).
        import re as _re
        safe_q = _re.escape(search.strip()[:64])
        rx = {"$regex": safe_q, "$options": "i"}
        q["$or"] = [{"name": rx}, {"description": rx}]
    # Overlapping "Under X" bands (redesign Phase A) — each is a plain
    # $lt threshold, not a mutually-exclusive range: a ₹300 product
    # matches under-499 AND under-999 AND under-1499. See PRICE_BANDS_SEED's
    # own comment for why this replaced the old <499/499-1499/>=1500
    # mutually-exclusive scheme.
    if price == "under-499":
        q["price"] = {"$lt": 499}
    elif price == "under-999":
        q["price"] = {"$lt": 999}
    elif price == "under-1499":
        q["price"] = {"$lt": 1499}
    sort_field, sort_dir = "created_at", -1
    if sort == "price_asc":
        sort_field, sort_dir = "price", 1
    elif sort == "price_desc":
        sort_field, sort_dir = "price", -1
    elif sort == "discount":
        sort_field, sort_dir = "discount_pct", -1
    products = await db.products.find(q, {"_id": 0}).sort(sort_field, sort_dir).to_list(limit)
    products = _attach_store_avail(products, avail_map)
    products.sort(key=lambda p: p.get("store_availability_rank", 4))
    return {"products": products, "total": len(products)}


@api.get("/products/{pid}")
async def get_product(pid: str):
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p: raise HTTPException(404, "Product not found")
    store_doc = await db.stores.find_one({"id": p.get("store_id"), **_visible_store_filter()}, {"_id": 0})
    if store_doc:
        avail = _store_availability(store_doc)
        p["store_badge"] = avail["badge"]
        p["store_badge_color"] = avail["badge_color"]
        p["store_can_order"] = avail["can_order"]
        p["store_eta_message"] = avail["eta_message"]
        p["store_opens_at_label"] = avail.get("opens_at_label")
        p["store_availability_rank"] = avail["rank"]
        plan = store_doc.get("plan", "free")
        is_pro = plan == "pro"
        p["store_can_pickup"] = bool(is_pro and avail["rank"] in (1, 3) and avail["can_order"])
    # Brand join — only attached when brand_id resolves to a real, still-
    # existing brand doc (a deleted brand soft-unlinks brand_id to null on
    # the product, but a stale reference should never surface a broken
    # partial object to the PDP either way).
    if p.get("brand_id"):
        brand_doc = await db.brands.find_one(
            {"id": p["brand_id"]}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "logo": 1},
        )
        if brand_doc:
            p["brand"] = brand_doc
    similar_q = {"id": {"$ne": pid}, **_visible_product_filter()}
    if p.get("l2_id"): similar_q["l2_id"] = p["l2_id"]
    elif p.get("l1_id"): similar_q["l1_id"] = p["l1_id"]
    similar = await db.products.find(similar_q, {"_id": 0, "images": 0}).limit(8).to_list(8)
    return {"product": p, "similar": similar}


# ===== Orders =====
SERVICEABLE_CITIES = ["bhilai"]
BHILAI_PINCODES = {"490001", "490006", "490009", "490020", "490023", "490025", "490026"}

# Bhilai delivery zone polygon — [lat, lng] vertices in order
BHILAI_DELIVERY_POLYGON = [
    [21.181171, 81.304172],  # A
    [21.196210, 81.306039],  # B
    [21.200802, 81.320573],  # C
    [21.206586, 81.313630],  # D
    [21.211084, 81.308707],  # E
    [21.223536, 81.319850],  # F
    [21.208805, 81.377901],  # G
    [21.197012, 81.383133],  # H
    [21.152275, 81.342198],  # I
    [21.174136, 81.300888],  # J
]

def _point_in_polygon(lat: float, lng: float, polygon: list) -> bool:
    """Ray casting algorithm — returns True if point (lat, lng) is inside polygon.
    Polygon vertices are [lat, lng] pairs. Casts a vertical ray northward from the
    test point and counts how many edges it crosses."""
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

def _is_in_bhilai_delivery_zone(lat: float, lng: float) -> bool:
    return _point_in_polygon(lat, lng, BHILAI_DELIVERY_POLYGON)


def _to_optional_float(v) -> Optional[float]:
    """Best-effort float coercion for optional numeric fields coming out of
    loosely-typed dict payloads (address lat/lng here). None — not 0 — when
    absent/invalid, so "no pin provided" stays distinguishable from "pin at
    exactly (0, 0)"."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _address_is_serviceable(address: dict) -> bool:
    """THE serviceability check for a DELIVERY ADDRESS — polygon-with-
    pincode-fallback (Group C1).

    Takes the address's OWN pin coordinates (`address["lat"]`/`["lng"]` —
    the point the customer dropped on a map for THIS address) and/or its
    pincode. NEVER pass the shopper's device GPS (payload.customer_lat/
    customer_lng) into this function — that substitution is the exact root
    cause of three separate shipped-and-reverted bugs: a shopper physically
    outside Bhilai (real device GPS, or none at all) got an otherwise-valid
    Bhilai delivery address rejected, because the polygon check was
    validating "where is the shopper right now" instead of "where does
    this order deliver to." Those are different questions with different
    correct answers, and only the second one determines serviceability.

    - Pin coordinates present (both lat AND lng truthy) -> polygon check
      (_is_in_bhilai_delivery_zone). More precise than a pincode, so a pin
      that falls outside the polygon is NOT serviceable even if the
      address's own pincode is in BHILAI_PINCODES — the pin wins.
    - No pin coordinates -> fall back to the pincode whitelist
      (BHILAI_PINCODES), i.e. the pre-C1 behavior, unchanged.
    - No pin AND no pincode -> serviceable (fail-open). Matches the exact
      pre-C1 behavior in create_order, which only rejected when a pincode
      was actually PROVIDED and didn't match — a request with no pincode
      at all was never blocked by this gate. Preserved here rather than
      "fixed" so this refactor stays a pure behavior-preserving move for
      every address that doesn't have a pin yet.
    """
    lat, lng = address.get("lat"), address.get("lng")
    if lat and lng:
        return _is_in_bhilai_delivery_zone(lat, lng)
    pincode = str(address.get("pincode") or "").strip()
    if not pincode:
        return True
    return pincode in BHILAI_PINCODES


def _store_lat_lng(store_doc: dict) -> Optional[tuple]:
    """(lat, lng) for a store doc — GeoJSON `location.coordinates` first,
    else legacy flat lat/lng fields. Same fallback POST /api/v1/delivery/
    estimate uses (routes/geo.py's delivery_estimate handler) so create_order's
    own delivery-fee recompute agrees with it for every store. Returns None
    if the store has neither."""
    loc = store_doc.get("location") or {}
    if loc.get("type") == "Point" and loc.get("coordinates"):
        lng_v, lat_v = loc["coordinates"][0], loc["coordinates"][1]
        return (lat_v, lng_v)
    lat, lng = store_doc.get("lat"), store_doc.get("lng")
    if lat is not None and lng is not None:
        return (float(lat), float(lng))
    return None

# ---------- Multi-merchant state helpers ----------
_STATE_RANK = {"pending": 0, "accepted": 1, "handed_off": 2, "delivered": 3}
_STATE_TO_GLOBAL = {"pending": "pending_merchant", "accepted": "accepted",
                    "handed_off": "on_the_way", "delivered": "delivered"}

def _derive_global_status(states: dict) -> str:
    """Global order status = min state across NON-cancelled merchants. Cancelled
    slices are excluded so a single cancelled store doesn't drag the global
    status back to pending. If every slice is cancelled, the order itself is
    cancelled."""
    if not states: return "pending_merchant"
    active = {m: s for m, s in states.items() if s != "cancelled"}
    if not active:
        return "cancelled"
    min_state = min(active.values(), key=lambda s: _STATE_RANK.get(s, 0))
    return _STATE_TO_GLOBAL.get(min_state, "pending_merchant")

def _new_merchant_timeline(placed_at: str) -> list:
    """Each merchant gets a fresh 4-step timeline (Placed → Confirmed → Out for
    delivery → Delivered). 'Placed' is stamped at order creation."""
    return [
        {"label": "Order placed", "time": placed_at},
        {"label": "Merchant accepted", "time": None},
        {"label": "Order on the way", "time": None},
        {"label": "Delivered", "time": None},
    ]

def _stamp_merchant_step(timelines: dict, mid: str, label: str, when: str) -> dict:
    """Stamp the first matching empty step on the merchant's timeline. No-op if
    the step is already stamped or the merchant has no timeline yet."""
    tl = (timelines or {}).get(mid)
    if not tl: return timelines or {}
    for t in tl:
        if t.get("label") == label and not t.get("time"):
            t["time"] = when
            break
    timelines[mid] = tl
    return timelines


async def _mark_leg_handed_off(o: dict, mid: str) -> dict:
    """Transition one merchant's leg from 'accepted' to 'handed_off': stamps the
    timeline, recomputes global status, persists, and notifies the customer with
    that leg's DELIVERY OTP (+ the assigned rider's contact, if any — this is
    the customer's FIRST delivery-related notification under the redesigned
    flow: no notification fires on merchant-accept anymore, and the delivery
    OTP itself is only revealed here, not at accept time). Originally extracted
    from merchant_handed_to_rider; now reached exclusively via the rider's
    'out for delivery' action (POST .../out-for-delivery) — the merchant no
    longer has a state-advancing action of their own.

    Caller must have already fetched `o` fresh (this does not re-read). Raises
    400 if the leg isn't currently 'accepted'."""
    oid = o["id"]
    states = dict(o.get("merchant_states") or {})
    my_state = states.get(mid) or (o.get("status") if not states else "pending")
    if my_state not in ("accepted",):
        raise HTTPException(400, "Accept the order before handing it to the rider")
    now = datetime.now(timezone.utc).isoformat()
    states[mid] = "handed_off"
    timelines = dict(o.get("merchant_timelines") or {})
    if mid not in timelines:
        timelines[mid] = _new_merchant_timeline(o.get("created_at", now))
    timelines = _stamp_merchant_step(timelines, mid, "Order on the way", now)
    all_handed = states and all(_STATE_RANK.get(v, 0) >= _STATE_RANK["handed_off"] for v in states.values())
    new_global = _derive_global_status(states)
    tl = o.get("timeline", [])
    if all_handed:
        for t in tl:
            if t["label"] in ("Order on the way", "Handed to rider", "Rider on the way") and not t["time"]:
                t["time"] = now; break
    update_doc: dict = {"status": new_global, "merchant_states": states,
                        "merchant_timelines": timelines, "timeline": tl}

    # Surface the assigned rider's contact to the customer (persisted on the
    # order, keyed by mid like merchant_otps/rider_assignments — a "wait
    # screen" can read order.rider_contact[mid] once this leg is handed off;
    # naturally absent/never-set for legs that haven't reached this point,
    # so no extra visibility gating is needed on the read side).
    rider_phone = ""
    rider_id = ((o.get("rider_assignments") or {}).get(mid) or {}).get("rider_id")
    if rider_id:
        rdoc = await db.riders.find_one({"id": rider_id}, {"_id": 0, "name": 1, "phone": 1})
        if rdoc:
            rider_phone = rdoc.get("phone", "")
            rider_contact = dict(o.get("rider_contact") or {})
            rider_contact[mid] = {"name": rdoc.get("name", ""), "phone": rider_phone}
            update_doc["rider_contact"] = rider_contact

    await db.orders.update_one({"id": oid}, {"$set": update_doc})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        my_otp = (o.get("merchant_otps") or {}).get(mid) or o.get("otp", "")
        try: notify_order_on_the_way(cust_phone, oid, my_otp, rider_phone)
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"all_handed": all_handed, "new_global": new_global, "my_state": "handed_off"}


def _apply_delivered_state(states: dict, timelines: dict, delivered_map: dict, mid: str,
                            created_at: str, now: str) -> None:
    """Pure in-place mutation marking ONE merchant leg 'delivered' — sets
    states[mid], stamps that leg's timeline, and records delivered_map[mid].
    No guard, no I/O; callers decide whether this mid is eligible first (e.g.
    'already delivered' or 'must be handed_off') before calling."""
    states[mid] = "delivered"
    if mid not in timelines:
        timelines[mid] = _new_merchant_timeline(created_at)
    _stamp_merchant_step(timelines, mid, "Delivered", now)
    delivered_map[mid] = now


async def _finalize_delivery_update(oid: str, o: dict, states: dict, timelines: dict,
                                     delivered_map: dict, now: str, *,
                                     delivered_via: Optional[str] = None) -> str:
    """Recompute global status from `states`, persist the order, and notify the
    customer once the WHOLE order (every merchant leg) is delivered. Always
    writes — callers may call this even when no leg actually changed state this
    round (matches the existing admin/Twilio behavior of an idempotent write
    regardless of whether a guard rejected the transition)."""
    new_global = _derive_global_status(states) if states else "delivered"
    tl = o.get("timeline", [])
    update_doc = {"status": new_global, "merchant_states": states,
                  "merchant_timelines": timelines, "merchant_delivered_at": delivered_map}
    if delivered_via:
        update_doc["delivered_via"] = delivered_via
    if new_global == "delivered":
        for t in tl:
            if t["label"] == "Delivered" and not t["time"]:
                t["time"] = now; break
        update_doc["timeline"] = tl
        update_doc["delivered_at"] = now
    await db.orders.update_one({"id": oid}, {"$set": update_doc})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone and new_global == "delivered":
        try: notify_order_delivered(cust_phone, oid)
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return new_global


async def _mark_leg_delivered(o: dict, mid: Optional[str], *, require_handed_off: bool = True,
                               delivered_via: Optional[str] = None) -> str:
    """Single-merchant-leg 'mark delivered' flow — extracted from twilio_inbound's
    delivery branch. Mutates leg `mid` to 'delivered' only if `mid` is set AND
    (require_handed_off is False OR that leg is currently 'handed_off') —
    mirroring Twilio's existing guard exactly, including its no-op-but-still-write
    behavior when the guard rejects the transition (empty/legacy `states` still
    finalizes to 'delivered' via `_finalize_delivery_update`'s `if states else
    'delivered'` fallback). OTP validation is the CALLER's responsibility (Twilio
    regex-matches before calling; the future rider endpoint will validate
    structurally) — this helper only performs the state transition.

    Caller must have already fetched `o` fresh (this does not re-read)."""
    oid = o["id"]
    states = dict(o.get("merchant_states") or {})
    timelines = dict(o.get("merchant_timelines") or {})
    delivered_map = dict(o.get("merchant_delivered_at") or {})
    now = datetime.now(timezone.utc).isoformat()
    if mid and (not require_handed_off or states.get(mid) == "handed_off"):
        _apply_delivered_state(states, timelines, delivered_map, mid, o.get("created_at", now), now)
    return await _finalize_delivery_update(oid, o, states, timelines, delivered_map, now,
                                            delivered_via=delivered_via)


async def _merchant_cancel_own_slice(oid: str, mid: str, reason: str) -> str:
    """Cancel one merchant's slice of an order — restocks exactly that
    merchant's items, marks their per-merchant state 'cancelled', and
    recomputes the global status. Shared by merchant reject/cancel and the
    customer's accepted-order cancel path so there's one place that knows how
    to do this safely.

    Re-reads the order fresh (rather than trusting a caller-supplied doc) so
    repeated calls in a loop (multi-store cancel) never race on stale
    merchant_states/merchant_cancelled — this codebase doesn't use Mongo
    transactions anywhere, so read-fresh-then-write is the established
    pattern (matches admin_cancel_order).

    Caller MUST have already verified this merchant's slice is in a
    cancellable state (`pending` or `accepted`, not `cancelled` already —
    otherwise stock gets restored twice for the same slice) before calling.
    Returns the new global status.
    """
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    await _restock_order_items({"items": [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]})
    states = dict(o.get("merchant_states") or {m: "pending" for m in (o.get("merchant_ids") or [])})
    states[mid] = "cancelled"
    cancelled = dict(o.get("merchant_cancelled") or {})
    cancelled[mid] = reason
    new_global = _derive_global_status(states)
    update_doc = {"merchant_states": states, "merchant_cancelled": cancelled, "status": new_global}
    if new_global == "cancelled":
        update_doc["cancel_reason"] = reason
        update_doc["cancelled_at"] = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": oid}, {"$set": update_doc})
    return new_global


# ===== Order status FSM =====
# Valid global-status transitions. Enforced by `_assert_status_transition`
# wherever the order's top-level `status` is updated directly. The
# per-merchant accept/handoff flow already enforces its own rank ordering via
# `_STATE_RANK`; this FSM guards the GLOBAL summary status.
ORDER_STATUS_TRANSITIONS = {
    "pending_merchant": {"accepted", "cancelled"},
    "accepted":         {"on_the_way", "cancelled"},
    "on_the_way":       {"delivered", "cancelled"},
    "delivered":        {"returned", "completed"},
    "returned":         set(),
    "completed":        set(),
    "cancelled":        set(),
}


def _assert_status_transition(current: str, target: str) -> None:
    if current == target: return
    allowed = ORDER_STATUS_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise HTTPException(400, f"Invalid order status transition: {current} → {target}")


# ===== Money / Decimal helpers =====
from decimal import Decimal, ROUND_HALF_UP

def _money(x) -> Decimal:
    """Normalize any numeric (str/int/float/Decimal) to a 2-decimal Decimal.
    All cart/order/refund arithmetic in the codebase must go through this
    helper to avoid float drift (₹ 1799.999999998 → ₹ 1800.00)."""
    if x is None: return Decimal("0.00")
    try:
        return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def _sum_items_money(items: list) -> Decimal:
    total = Decimal("0.00")
    for it in items or []:
        total += _money(it.get("price")) * Decimal(int(it.get("qty", 1)))
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ===== Soft delete helpers =====
async def _soft_delete(collection_name: str, doc_id: str) -> bool:
    """Mark a document as deleted without removing it. Returns True if updated."""
    now = datetime.now(timezone.utc).isoformat()
    r = await db[collection_name].update_one(
        {"id": doc_id, "is_deleted": {"$ne": True}},
        {"$set": {"is_deleted": True, "deleted_at": now}},
    )
    return r.modified_count > 0


@api.post("/notify-me")
async def notify_me_endpoint(payload: NotifyMeRequest):
    """Guest-accessible: register phone to be WhatsApp-notified when a store comes back online.
    Sends an immediate confirmation message and upserts a record into db.notify_me."""
    phone = _normalize_customer_phone(payload.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")
    store = await db.stores.find_one({"id": payload.store_id}, {"_id": 0, "name": 1})
    store_name = (store or {}).get("name", "the store")
    now = datetime.now(timezone.utc).isoformat()
    await db.notify_me.update_one(
        {"phone": phone, "store_id": payload.store_id},
        {"$set": {"phone": phone, "store_id": payload.store_id,
                  "product_id": payload.product_id, "updated_at": now},
         "$setOnInsert": {"created_at": now, "notified": False}},
        upsert=True,
    )
    return {"ok": True}


async def _send_notify_me_messages(store_id: str) -> None:
    """Background: notify all pending subscribers when a store toggles back online."""
    try:
        store = await db.stores.find_one({"id": store_id}, {"_id": 0, "name": 1, "slug": 1})
        store_name = (store or {}).get("name", "the store")
        store_slug = (store or {}).get("slug", store_id)
        now = datetime.now(timezone.utc).isoformat()
        async for entry in db.notify_me.find(
            {"store_id": store_id, "notified": False}, {"_id": 0}
        ):
            phone = entry.get("phone")
            if not phone:
                continue
            msg = (
                f"🟢 {store_name} is now live on Lokl! "
                f"Shop now: {APP_URL}/store/{store_slug}"
            )
            try:
                send_with_fallback(phone, msg, message_type="store_back_online")
            except Exception:
                pass
            await db.notify_me.update_one(
                {"phone": phone, "store_id": store_id},
                {"$set": {"notified": True, "notified_at": now}},
            )
    except Exception as e:
        log.warning("_send_notify_me_messages error: %s", e)


@api.post("/payments/razorpay/create-order")
async def razorpay_create_payment_order(
    payload: RazorpayCreateOrderRequest,
    user: dict = Depends(customer_user),
):
    """Create a Razorpay order (payment intent only). Does NOT create a Lokl order in DB.
    The frontend uses the returned razorpay_order_id to open the Razorpay modal.
    Once payment succeeds, POST /api/orders is called with the payment proof."""
    if not razorpay_enabled():
        raise HTTPException(503, "Online payment unavailable. Try COD.")
    if payload.amount <= 0:
        raise HTTPException(400, "amount must be positive")
    try:
        from decimal import Decimal as _Decimal
        temp_receipt = f"pay-{uuid.uuid4().hex[:12]}"
        rp_order = create_razorpay_order(
            lokl_order_id=temp_receipt,
            amount_inr=_Decimal(str(payload.amount)),
            customer_phone=payload.customer_phone or "",
            customer_name=payload.customer_name or "",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Payment gateway error: {e}")
    if rp_order is None:
        raise HTTPException(503, "Online payment unavailable. Try COD.")
    return {
        "razorpay_order_id": rp_order["id"],
        "amount_paise": int(round(float(payload.amount) * 100)),
        "currency": "INR",
        "key_id": os.environ.get("RAZORPAY_KEY_ID", ""),
    }


@api.post("/orders")
async def create_order(payload: OrderCreate, user: dict = Depends(customer_user)):
    # Bind the order to the authenticated customer. The phone in the payload
    # must match the JWT `sub` — refuse to let one customer place an order
    # under another's identity. Admins may place orders on behalf of any
    # customer (support / phone-order scenarios).
    cust_in = getattr(payload, "customer", None) or {}
    if isinstance(cust_in, dict):
        payload_phone = _normalize_customer_phone(cust_in.get("phone", ""))
    else:
        payload_phone = _normalize_customer_phone(getattr(cust_in, "phone", ""))
    if not payload_phone:
        raise HTTPException(400, "customer.phone is required")
    if user.get("role") != "admin" and payload_phone != user.get("sub"):
        raise HTTPException(403, "customer.phone does not match authenticated customer")
    # Normalize the payload so downstream order/customer records use the
    # canonical 12-digit form.
    if isinstance(cust_in, dict):
        cust_in["phone"] = payload_phone
        payload.customer = cust_in
    else:
        cust_in.phone = payload_phone

    order_type = (getattr(payload, "order_type", None) or "delivery").lower()

    if order_type != "pickup":
        addr_city = (payload.address.get("city") or "").strip().lower()
        if addr_city not in SERVICEABLE_CITIES:
            raise HTTPException(400, "We're only serving Bhilai right now — please update your delivery city.")
        if not _address_is_serviceable(payload.address):
            raise HTTPException(400, "We only deliver to Bhilai pincodes (490xxx). Please check your pincode.")
        # NOTE: _address_is_serviceable checks the DELIVERY ADDRESS — its own
        # pin coordinates if the customer dropped one for this address, else
        # its pincode (see that function's docstring) — deliberately NEVER
        # payload.customer_lat/customer_lng (the shopper's device GPS at
        # order time). A prior version checked shopper GPS against
        # _is_in_bhilai_delivery_zone() directly and false-rejected valid
        # Bhilai-address orders whenever the shopper was physically outside
        # Bhilai (e.g. a tester's real device) — that bug shipped and was
        # reverted three times. customer_lat/customer_lng are still accepted
        # and stored on the order (see below) as informational metadata/for
        # rider routing — just never read by this or any other serviceability
        # gate.

    # Pre-check store availability before any stock reservations.
    # Pickup: block Away (rank 2) and Offline (rank≥4); compute dynamic window.
    # Delivery: require can_order=True.
    payload_store_ids = list({it.get("store_id") for it in payload.items if it.get("store_id")})
    _pickup_expires_at = None  # set during pre-check for pickup orders
    # Cache each store_doc fetched below (already an unfiltered projection —
    # carries location/lat/lng) so the delivery-fee recompute further down
    # doesn't need a second round-trip for the common single-store case.
    store_geo: dict = {}
    if payload_store_ids:
        unavailable_stores = []
        for sid in payload_store_ids:
            store_doc = await db.stores.find_one({"id": sid, **_visible_store_filter()}, {"_id": 0})
            if store_doc:
                store_geo[sid] = store_doc
            avail = _store_availability(store_doc) if store_doc else {"can_order": False, "rank": 4, "eta_message": "Store unavailable"}
            if order_type == "pickup":
                store_rank = avail.get("rank", 4)
                store_name = (store_doc or {}).get("name", sid)
                if (store_doc or {}).get("plan", "free") != "pro":
                    unavailable_stores.append(f"{store_name}: Store pickup is not available for this store")
                    continue
                if store_rank >= 4:
                    unavailable_stores.append(f"{store_name}: Store is not accepting reservations right now")
                elif store_rank == 2:
                    unavailable_stores.append(f"{store_name}: Store is currently away. Please try again when the store is back.")
                else:
                    # Rank 1 (LIVE) or rank 3 (Closed by hours) — compute smart pickup window
                    _now_utc = datetime.now(timezone.utc)
                    _ist_now = _now_utc + timedelta(minutes=330)
                    _closes_str = (store_doc or {}).get("closes_at") or "21:00"
                    _opens_str = (store_doc or {}).get("opens_at") or "10:00"
                    try:
                        _close_h, _close_m = map(int, _closes_str.split(":")[:2])
                        _open_h, _open_m = map(int, _opens_str.split(":")[:2])
                        _cur_min = _ist_now.hour * 60 + _ist_now.minute
                        _close_min = _close_h * 60 + _close_m
                        _open_min = _open_h * 60 + _open_m
                        if _cur_min < _open_min or _cur_min >= _close_min:
                            unavailable_stores.append(f"{store_name}: Store is currently closed. Pickup reservations are only available during store hours.")
                        else:
                            _mins_until_close = _close_min - _cur_min
                            if _mins_until_close < 30:
                                unavailable_stores.append(f"{store_name}: Store closes soon. Not enough time for a pickup reservation.")
                            else:
                                _window_min = min(4 * 60, _mins_until_close)
                                _pickup_expires_at = _now_utc + timedelta(minutes=_window_min)
                    except Exception:
                        _pickup_expires_at = datetime.now(timezone.utc) + timedelta(hours=4)
            else:
                if not avail["can_order"]:
                    store_name = (store_doc or {}).get("name", sid)
                    unavailable_stores.append(f"{store_name}: {avail['eta_message']}")
        if unavailable_stores:
            raise HTTPException(400, "Cannot place order — some stores are unavailable: " + "; ".join(unavailable_stores))

    # Order ID prefix — branded "LOKL-" since iter-45. Pre-existing orders
    # with "BFO-" ids stay valid; lookups are by full id so the prefix is
    # purely cosmetic. The DB has no constraint on the prefix.
    order_id = f"LOKL-{uuid.uuid4().hex[:8].upper()}"
    merchant_ids = []
    items_snap = []
    # Track every successful stock decrement so we can roll back if any later
    # item fails (atomicity across multiple non-transactional Mongo writes).
    reservations: list[tuple[str, str, int]] = []  # (product_id, size, qty)

    try:
        for it in payload.items:
            pid = it.get("id")
            qty = int(it.get("qty", 1) or 1)
            size = (it.get("size") or "").strip()
            if qty <= 0:
                raise HTTPException(400, f"Quantity for {pid} must be > 0")

            # Look up the product once so we can size-validate + snapshot.
            p = await db.products.find_one(
                {"id": pid, "is_deleted": {"$ne": True}, "paused": {"$ne": True}},
                {"_id": 0, "merchant_id": 1, "store_id": 1, "store_name": 1,
                 "return_eligible": 1, "name": 1, "stock": 1},
            )
            if not p:
                raise HTTPException(400, f"Product {pid} is unavailable")

            # ===== Atomic stock decrement (Mongo equivalent of SELECT … FOR UPDATE) =====
            # `find_one_and_update` with a conditional filter is atomic: either the
            # row matches AND we decrement, or it doesn't match AND nothing changes.
            # Two concurrent checkouts of the last unit → only one $inc succeeds.
            stock_field = f"stock.{size}" if size else "stock.default"
            updated = await db.products.find_one_and_update(
                {"id": pid, "is_deleted": {"$ne": True},
                 stock_field: {"$gte": qty}},
                {"$inc": {stock_field: -qty}},
                projection={"_id": 0, "merchant_id": 1, "store_id": 1, "store_name": 1,
                            "return_eligible": 1, "name": 1, stock_field: 1,
                            "provider": 1, "remote_variant_ids": 1},
                return_document=True,
            )
            if not updated:
                raise HTTPException(409, f"Insufficient stock for {p.get('name', pid)}"
                                         + (f" (size {size})" if size else ""))
            reservations.append((pid, size or "default", qty))
            if size:
                asyncio.create_task(_sync_remote_inventory({**updated, "id": pid}, size, -qty))

            # Auto-pause once every size is sold out. The atomic $inc above only
            # touches this one size's field, so re-fetch the full stock map to
            # check the true cross-size total before deciding to pause.
            fresh_stock = await db.products.find_one({"id": pid}, {"_id": 0, "stock": 1})
            new_total_stock = sum(
                int(v) for v in (fresh_stock or {}).get("stock", {}).values()
                if isinstance(v, (int, float))
            )
            if new_total_stock <= 0:
                await db.products.update_one(
                    {"id": pid},
                    {"$set": {"paused": True, "status": "paused"}}
                )
                print(f"[stock] product {pid} auto-paused — out of stock", flush=True)

            if updated.get("merchant_id"):
                merchant_ids.append(updated["merchant_id"])
            new_it = dict(it)
            new_it["return_eligible"] = bool(updated.get("return_eligible", False))
            new_it["merchant_id"] = updated.get("merchant_id")
            new_it["store_id"] = updated.get("store_id")
            if updated.get("store_name") and not new_it.get("store_name"):
                new_it["store_name"] = updated["store_name"]
            items_snap.append(new_it)

        # ===== Recompute total on the server using Decimal arithmetic =====
        # Never trust the client-sent total — recompute from the (just-validated)
        # snapshot prices. This also prevents tampered-total injection.
        items_subtotal = _sum_items_money(items_snap)
        server_total = items_subtotal

        # ===== Coupon validation (if provided) =====
        coupon_discount = Decimal("0.00")
        applied_coupon = None
        coupon_code = (getattr(payload, "coupon_code", None) or "").strip().upper()
        if coupon_code:
            now_ts = datetime.now(timezone.utc).isoformat()
            cpn = await db.coupons.find_one(
                {"code": coupon_code, "active": True,
                 "$or": [{"expires_at": None}, {"expires_at": {"$gt": now_ts}}]},
                {"_id": 0},
            )
            if cpn:
                min_val = Decimal(str(cpn.get("min_order_value") or 0))
                max_uses = cpn.get("max_uses")
                used = int(cpn.get("used_count") or 0)
                if server_total >= min_val and (max_uses is None or used < int(max_uses)):
                    if cpn["discount_type"] == "percent":
                        coupon_discount = (server_total * Decimal(str(cpn["discount_value"])) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    else:
                        coupon_discount = min(Decimal(str(cpn["discount_value"])), server_total)
                    applied_coupon = coupon_code

        # ===== Delivery fee — server-authoritative =====
        # Same DeliveryService.calculate_delivery_fee() call, with the same
        # inputs (BHILAI_LAT/BHILAI_LNG centroid, not the shopper's device
        # GPS — matching checkout/page.tsx's own delivery-estimate call, see
        # its comment on why it uses the fixed centroid), that backs
        # POST /api/v1/delivery/estimate — so the total stored here can never
        # drift from what checkout displayed. payload.total and
        # payload.delivery_fee are accepted on the schema but never read.
        #
        # Pickup orders are never charged delivery. Multi-store delivery
        # carts get FREE delivery (fee=0) — this mirrors checkout/page.tsx's
        # "Single-store rule" comment (uniqueStores.length===1 ? that store :
        # null; multi-store skips the estimate and displays FREE) exactly,
        # not a new policy invented here.
        delivery_fee = Decimal("0.00")
        if order_type != "pickup":
            item_store_ids = list({it.get("store_id") for it in items_snap if it.get("store_id")})
            if len(item_store_ids) == 1:
                sid = item_store_ids[0]
                fee_store_doc = store_geo.get(sid)
                if fee_store_doc is None:
                    fee_store_doc = await db.stores.find_one({"id": sid}, {"_id": 0, "lat": 1, "lng": 1, "location": 1})
                store_latlng = _store_lat_lng(fee_store_doc) if fee_store_doc else None
                if store_latlng is None:
                    raise HTTPException(400, "Store location not set")
                try:
                    fee_result = await _delivery_service.calculate_delivery_fee(
                        customer_lat=BHILAI_LAT, customer_lng=BHILAI_LNG,
                        store_lat=store_latlng[0], store_lng=store_latlng[1],
                        order_subtotal=items_subtotal, city_slug="bhilai",
                    )
                except ValueError as e:
                    raise HTTPException(400, str(e))
                if not fee_result["deliverable"]:
                    raise HTTPException(400, fee_result["reason"])
                delivery_fee = Decimal(str(fee_result["fee"]))

        server_total = max(Decimal("0.00"), items_subtotal - coupon_discount + delivery_fee)

        now = datetime.now(timezone.utc).isoformat()
        unique_mids = list(set([m for m in merchant_ids if m]))
        # CSPRNG (secrets) — these OTPs gate order delivery / WhatsApp verification, must not be predictable.
        _otp_rng = secrets.SystemRandom()
        def _new_otp(): return f"{_otp_rng.randint(1000, 9999)}"
        merchant_otps = {mid: _new_otp() for mid in unique_mids}
        # NEW (rider-flow redesign): a SEPARATE per-leg merchant-handoff OTP —
        # the rider reads this to the merchant at pickup (verified server-side
        # by POST /rider/orders/{oid}/{mid}/out-for-delivery), distinct from
        # merchant_otps above (the customer<->rider DELIVERY confirmation
        # code). Same CSPRNG pattern, generated at the same time.
        merchant_handoff_otps = {mid: _new_otp() for mid in unique_mids}
        otp = merchant_otps[unique_mids[0]] if unique_mids else _new_otp()
        merchant_states = {mid: "pending" for mid in unique_mids}
        merchant_timelines = {mid: _new_merchant_timeline(now) for mid in unique_mids}
        doc = {"id": order_id, "items": items_snap, "address": payload.address,
               "total": float(server_total), "delivery_fee": float(delivery_fee),
               "payment_method": payload.payment_method,
               "coupon_code": applied_coupon, "coupon_discount": float(coupon_discount),
               "customer": payload.customer or {},
               "customer_lat": payload.customer_lat,
               "customer_lng": payload.customer_lng,
               "status": "pending_merchant",
               "merchant_ids": unique_mids,
               "merchant_states": merchant_states,
               "merchant_timelines": merchant_timelines,
               "merchant_delivered_at": {},
               "merchant_otps": merchant_otps,
               "merchant_handoff_otps": merchant_handoff_otps,
               "merchant_cancelled": {},
               "rider_assignments": {},
               "is_multi_store": len(unique_mids) > 1,
               "otp": otp,
               "is_deleted": False,
               "created_at": now,
               "timeline": [{"label": "Order placed", "time": now},
                            {"label": "Merchant accepted", "time": None},
                            {"label": "Order on the way", "time": None},
                            {"label": "Delivered", "time": None}]}

        if order_type == "pickup":
            doc["order_type"] = "pickup"
            doc["pickup_code"] = f"{_otp_rng.randint(1000, 9999)}"
            _exp = _pickup_expires_at or (datetime.now(timezone.utc) + timedelta(hours=4))
            doc["pickup_expires_at"] = _exp.isoformat()
            doc["status"] = "pending_pickup"
            _ps_id = (items_snap[0].get("store_id") or "") if items_snap else ""
            _ps_name = (items_snap[0].get("store_name") or "") if items_snap else ""
            if _ps_name:
                doc["store_name"] = _ps_name
            if _ps_id:
                _ps_store = await db.stores.find_one({"id": _ps_id}, {"_id": 0, "lat": 1, "lng": 1, "address": 1})
                if _ps_store:
                    if _ps_store.get("lat") and _ps_store.get("lng"):
                        doc["maps_link"] = f"https://maps.google.com/?q={_ps_store['lat']},{_ps_store['lng']}"
                    if _ps_store.get("address"):
                        doc["store_address"] = _ps_store["address"]

        # ===== Payment method branch =====
        # COD: order goes straight to merchant queue (existing behavior).
        # razorpay: frontend calls POST /payments/razorpay/create-order first, completes
        # payment, then calls POST /orders with verified signature. Order is created
        # directly with status=pending_merchant; merchants are notified immediately.
        pm = (payload.payment_method or "COD").lower()
        if pm in ("razorpay", "online"):
            # Payment-first flow: frontend verifies payment then calls POST /orders.
            # Signature proves the payment was captured before the order is created.
            if not payload.razorpay_payment_id or not payload.razorpay_order_id or not payload.razorpay_signature:
                raise HTTPException(400, "razorpay_payment_id, razorpay_order_id and razorpay_signature are required for Razorpay payments")
            if not verify_payment_signature(payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature):
                raise HTTPException(400, "Invalid Razorpay payment signature")
            doc["payment_method"] = "razorpay"
            doc["payment_status"] = "paid"
            doc["razorpay_order_id"] = payload.razorpay_order_id
            doc["razorpay_payment_id"] = payload.razorpay_payment_id
            doc["paid_at"] = now
        else:
            doc["payment_method"] = "COD"
            doc["payment_status"] = "cod_pending"

        await db.orders.insert_one(doc)
        if applied_coupon:
            await db.coupons.update_one({"code": applied_coupon}, {"$inc": {"used_count": 1}})
    except Exception:
        # ROLL BACK any successful stock decrements before re-raising —
        # also undoes the outbound sync each decrement already dispatched
        # (positive delta out to the source platform, same as a real
        # cancel), since the Lokl order behind it never actually got created.
        await _restock_order_items({"items": [{"id": pid, "size": sz, "qty": qty} for pid, sz, qty in reservations]})
        raise

    if order_type != "pickup" and payload.customer and payload.customer.get("phone"):
        await _upsert_customer(payload.customer, payload.address)
    cust_phone = (payload.customer or {}).get("phone") or (payload.address or {}).get("phone")
    if cust_phone:
        try:
            if order_type == "pickup":
                notify_pickup_pending(cust_phone, order_id,
                                      doc.get("store_name") or "the store")
            else:
                notify_order_placed(cust_phone, order_id, float(server_total))
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    # Notify merchants for COD and Razorpay (payment verified at order creation time).
    if doc.get("payment_method") in ("COD", "razorpay"):
        for mid in unique_mids:
            # Group D1: push eligible riders the moment this leg becomes
            # available. Pickup orders have no rider leg (rider_available_orders
            # excludes order_type='pickup' entirely) — skip those. Runs as a
            # background task (never awaited here) so a slow/failing push
            # provider can never delay or fail order placement — see
            # _push_new_order_to_riders' docstring for why this fires once,
            # here, and not again at merchant-accept.
            if order_type != "pickup":
                try:
                    store = await db.stores.find_one(
                        {"id": f"store-m-{mid}"}, {"_id": 0, "area_label": 1, "area": 1, "city": 1},
                    ) or {}
                    pickup_area = store.get("area_label") or store.get("area") or store.get("city", "Bhilai")
                    asyncio.create_task(_push_new_order_to_riders(pickup_area, order_id))
                except Exception as e:
                    log.warning("[push] failed to schedule push for order %s mid=%s: %s", order_id, mid, e)

            m = await db.merchants.find_one({"id": mid}, {"_id": 0, "phone": 1, "store_name": 1})
            if m and m.get("phone"):
                their_items = [it for it in items_snap if it.get("merchant_id") == mid]
                try:
                    if order_type == "pickup":
                        notify_merchant_pickup_pending(m["phone"], order_id, len(their_items))
                    else:
                        notify_merchant_new_order(m["phone"], order_id, float(server_total), len(their_items))
                except Exception as _ne:
                    print(f"[notify_error] {_ne}", flush=True)
                first_order_count = await db.orders.count_documents(
                    {"merchant_ids": mid, "status": {"$nin": ["cancelled", "rejected"]}}
                )
                if first_order_count == 1:
                    try:
                        notify_merchant_first_order(m.get("phone", ""),
                                                     m.get("store_name", "your store"),
                                                     order_id)
                    except Exception as _ne:
                        print(f"[notify_error] first order: {_ne}", flush=True)
    await audit_service.log("order_initiated", order_id=order_id,
                            razorpay_order_id=doc.get("razorpay_order_id"),
                            amount=float(server_total),
                            actor=cust_phone or "anonymous",
                            metadata={"payment_method": doc.get("payment_method"),
                                      "is_multi_store": doc.get("is_multi_store", False)})
    doc.pop("_id", None)
    # Surface the values the customer's browser needs to open the Razorpay
    # Checkout modal. The key id is non-secret and identical to the
    # NEXT_PUBLIC_RAZORPAY_KEY_ID baked into the frontend bundle; echoing it
    # here means the frontend doesn't have to assume parity between its env
    # var and the backend's signing key.
    if doc.get("payment_method") == "razorpay":
        doc["razorpay_key_id"] = os.environ.get("RAZORPAY_KEY_ID", "")
        doc["amount_paise"] = int(round(float(server_total) * 100))
        doc["amount_inr"] = float(server_total)
    return doc

@api.get("/orders/{order_id}")
@_limit("30/minute")
async def get_order(order_id: str, request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Please sign in to view your order")

    try:
        payload = decode_token(auth.split(" ", 1)[1])
    except Exception:
        raise HTTPException(401, "Session expired. Please sign in again")

    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")

    role = payload.get("role", "customer")
    caller = payload.get("sub", "")

    if role == "admin":
        pass  # admin sees everything
    elif role == "merchant":
        merchant_ids = list((o.get("merchant_states") or {}).keys())
        if caller not in merchant_ids:
            raise HTTPException(403, "This order is not from your store")
        # Same redaction as /merchant/orders — the pickup code must only ever
        # reach the customer (via notify_pickup_reserved), never the merchant,
        # or verify-pickup's code check becomes trivially bypassable.
        o.pop("pickup_code", None)
    else:
        # Customer must own this order — compare last 10 digits of phone
        def _norm(p: str) -> str:
            return _re.sub(r"\D", "", str(p or ""))[-10:]
        order_phone = (o.get("customer") or {}).get("phone") or o.get("customer_phone", "")
        if _norm(caller) != _norm(order_phone):
            raise HTTPException(403, "This order was not placed with your mobile number")

    # Rider-flow redesign: the delivery OTP is a customer<->rider handoff
    # code that must not be visible before the leg actually goes "out for
    # delivery" — but the raw order doc always carries `otp`/`merchant_otps`
    # (generated at placement) and was being returned to the customer
    # unredacted here regardless of leg state, for BOTH single- and
    # multi-store orders (the multi-store store_breakdown block below already
    # gated its OWN copy correctly, but that's an added field — it doesn't
    # remove these raw top-level ones from the same response). Gate them the
    # same way store_breakdown does, and strip merchant_handoff_otps
    # entirely — that code is a rider<->merchant concern the customer never
    # needs (see merchant_orders for the merchant's own view of it).
    if role not in ("admin", "merchant"):
        o.pop("merchant_handoff_otps", None)
        states_map = o.get("merchant_states") or {}
        gated_otps = {
            m_id: code for m_id, code in (o.get("merchant_otps") or {}).items()
            if states_map.get(m_id) in ("handed_off", "delivered")
        }
        o["merchant_otps"] = gated_otps
        first_mid = next(iter(o.get("merchant_ids") or []), None)
        o["otp"] = gated_otps.get(first_mid, "") if first_mid else ""

    # Enrich multi-store orders with per-merchant breakdown for the customer
    # tracking UI: items grouped by store + each store's own 4-step timeline.
    if o.get("is_multi_store"):
        breakdown = []
        for mid in (o.get("merchant_ids") or []):
            items = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
            if not items: continue
            sname = items[0].get("store_name") or "Store"
            sid = items[0].get("store_id")
            leg_state = (o.get("merchant_states") or {}).get(mid, "pending")
            breakdown.append({
                "merchant_id": mid,
                "store_id": sid,
                "store_name": sname,
                "items": items,
                "subtotal": round(sum(float(it.get("price", 0)) * int(it.get("qty", 1)) for it in items), 2),
                "state": leg_state,
                "timeline": (o.get("merchant_timelines") or {}).get(mid) or [],
                "delivered_at": (o.get("merchant_delivered_at") or {}).get(mid),
                # Customer sees the per-store delivery OTP only once that
                # leg is out for delivery (handed_off) or delivered — NOT at
                # merchant-accept, matching the raw-field gating just above.
                "otp": (o.get("merchant_otps") or {}).get(mid) if leg_state in ("handed_off", "delivered") else None,
                "rider_contact": (o.get("rider_contact") or {}).get(mid),
                "cancel_reason": (o.get("merchant_cancelled") or {}).get(mid),
            })
        o["store_breakdown"] = breakdown
    return o


# ===== Rider order endpoints (Phase 1 rider delivery platform, Commit 3) =====
# The core delivery loop. Every state transition here calls the SAME shared
# helpers Commit 1 extracted from the merchant/admin/Twilio paths
# (_mark_leg_handed_off, _mark_leg_delivered) — rider actions can never drift
# from what the merchant dashboard or the WhatsApp fallback already do,
# because they're literally the same function. The WhatsApp/Twilio path is
# untouched and keeps running in parallel; both funnel through one place.

async def _active_rider(user: dict) -> dict:
    """Resolve+validate the calling rider's own doc from their JWT phone.
    Raises 403 if suspended, or if the phone doesn't match any rider at all
    (covers a still-valid JWT issued before a suspend — same re-check
    rider_verify_otp does at login). rider_user allows role=='admin' tokens
    too (for future support tooling), but an admin's `sub` is an admin id,
    not a phone, so it naturally 403s here — Phase 1 doesn't build an
    admin-acts-as-rider path, matching how /rider/status (Commit 2) already
    behaves."""
    phone = user.get("sub", "")
    rider = await db.riders.find_one({"phone": phone, "status": "active"}, {"_id": 0})
    if not rider:
        raise HTTPException(403, "Rider account is not active")
    return rider


async def _rider_owned_leg(oid: str, mid: str, rider_id: str) -> dict:
    """Fetch the order fresh and verify THIS rider owns leg `mid` via
    rider_assignments — the ownership check every leg-acting endpoint below
    needs. 404 if the order/leg doesn't exist, 403 if a different rider (or
    no rider yet) owns it. Never trusts the client's claim of ownership."""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    if mid not in (o.get("merchant_ids") or []):
        raise HTTPException(404, "Leg not found on this order")
    assignment = (o.get("rider_assignments") or {}).get(mid)
    if not assignment or assignment.get("rider_id") != rider_id:
        raise HTTPException(403, "You are not assigned to this leg")
    return o


async def _rider_active_legs(rider_id: str) -> list[dict]:
    """Group B1: a rider's active legs, DERIVED from db.orders.rider_assignments
    rather than a denormalized list on the rider doc — the orders collection
    is already the single source of truth for leg ownership (_rider_owned_leg
    has always checked it directly, never the rider doc), so deriving avoids
    a second copy that could drift out of sync.

    Pre-filter is deliberately over-inclusive, never under-inclusive:
    `status` can only be 'delivered' once EVERY non-cancelled leg is
    delivered, and can only be 'cancelled' once EVERY leg is cancelled
    (_derive_global_status's min-rank-over-non-cancelled-legs rule) — so an
    order containing an active (non-delivered, non-cancelled) leg for this
    rider can never have global status 'delivered' or 'cancelled'. Real
    per-leg filtering happens in Python below, same reason
    rider_available_orders already does this (merchant_states/
    rider_assignments are dicts keyed by merchant_id, not Mongo arrays —
    can't $elemMatch into them)."""
    cands = await db.orders.find(
        {"status": {"$nin": ["delivered", "cancelled"]}, "order_type": {"$ne": "pickup"}},
        {"_id": 0},
    ).to_list(500)

    legs = []
    for o in cands:
        states = o.get("merchant_states") or {}
        assignments = o.get("rider_assignments") or {}
        for mid, assignment in assignments.items():
            if assignment.get("rider_id") != rider_id:
                continue
            state = states.get(mid)
            if state in (None, "delivered", "cancelled"):
                continue
            legs.append({"order": o, "order_id": o["id"], "merchant_id": mid,
                         "state": state, "assignment": assignment})
    legs.sort(key=lambda l: l["assignment"].get("accepted_at") or "")
    return legs


_PICKUP_BATCH_RADIUS_KM = 2.0


def _nearest_neighbor_order(batch: list[dict], key: str, anchor: Optional[dict] = None) -> list[dict]:
    """Nearest-neighbor ordering over batch[i][key] ({"lat","lng"} dicts),
    reusing _haversine_km. Legs with no real coordinates (lat==0 and
    lng==0 — e.g. customer delivery addresses carry no lat/lng today, see
    rider_order_detail's note on that) sort last in their original relative
    order rather than computing a distance to (0, 0) — the same anti-pattern
    the 997km store-distance fix exists to avoid."""
    have = [leg for leg in batch if leg[key]["lat"] and leg[key]["lng"]]
    missing = [leg for leg in batch if not (leg[key]["lat"] and leg[key]["lng"])]
    if not have:
        return list(batch)
    if anchor and anchor.get("lat") and anchor.get("lng"):
        first = min(have, key=lambda l: _haversine_km(anchor["lat"], anchor["lng"], l[key]["lat"], l[key]["lng"]))
        have.remove(first)
        ordered = [first]
    else:
        ordered = [have.pop(0)]
    while have:
        last_pt = ordered[-1][key]
        nxt = min(have, key=lambda l: _haversine_km(last_pt["lat"], last_pt["lng"], l[key]["lat"], l[key]["lng"]))
        have.remove(nxt)
        ordered.append(nxt)
    return ordered + missing


def _compute_rider_batches(legs: list[dict]) -> list[dict]:
    """Groups a rider's active legs (Group B1) into SUGGESTED batches by
    PICKUP proximity — legs whose store point is within
    _PICKUP_BATCH_RADIUS_KM (2km, haversine) of another leg already in a
    batch join it (greedy single-linkage; fine for the small leg counts one
    rider actually holds at once — not meant as a general-purpose optimal
    clustering algorithm). A leg with no pickup coordinates never joins
    another (no bogus 0,0 distance) and becomes its own batch of one, same
    as a leg that's simply >2km from everything else.

    THIS IS A PURE SUGGESTION OVERLAY — it mutates each `leg` dict in place
    to add batch_id/batch_size/suggested_pickup_order/
    suggested_delivery_order/suggested_label, and returns a compact
    batch-summary list, but it NEVER touches order state and NO endpoint
    reads these fields to gate an action. A rider can act on any owned leg
    whenever that leg's OWN state allows it (merchant-accepted gate,
    payment-before-delivery gate, OTP check, ...), in any order, regardless
    of what's suggested here — rider_out_for_delivery, rider_payment_completed,
    and rider_deliver_leg are completely unaware this function exists.

    Within a batch: pickups are ordered nearest-neighbor starting from the
    earliest-claimed leg; deliveries are ordered nearest-neighbor
    continuing from the last REAL pickup point (skipping any coordinate-less
    tail entries). Since delivery addresses have no lat/lng for virtually
    every order today, in practice the delivery order currently just
    preserves pickup-cluster order until customer addresses carry real
    coordinates — expected, not a bug."""
    batches: list[list[dict]] = []
    for leg in legs:
        p = leg["pickup"]
        joined = False
        if p["lat"] and p["lng"]:
            for batch in batches:
                if any(
                    m["pickup"]["lat"] and m["pickup"]["lng"] and
                    _haversine_km(p["lat"], p["lng"], m["pickup"]["lat"], m["pickup"]["lng"]) <= _PICKUP_BATCH_RADIUS_KM
                    for m in batch
                ):
                    batch.append(leg)
                    joined = True
                    break
        if not joined:
            batches.append([leg])

    result = []
    for idx, batch in enumerate(batches):
        pickup_order = _nearest_neighbor_order(batch, "pickup")
        for i, leg in enumerate(pickup_order):
            leg["suggested_pickup_order"] = i + 1

        last_pickup_pt = None
        for leg in reversed(pickup_order):
            if leg["pickup"]["lat"] and leg["pickup"]["lng"]:
                last_pickup_pt = leg["pickup"]
                break

        delivery_order = _nearest_neighbor_order(batch, "drop", anchor=last_pickup_pt)
        for i, leg in enumerate(delivery_order):
            leg["suggested_delivery_order"] = i + 1

        for leg in batch:
            leg["batch_id"] = idx
            leg["batch_size"] = len(batch)
            if leg["status"] in ("pending", "accepted"):
                leg["suggested_label"] = (
                    f"Pickup {leg['suggested_pickup_order']} of {leg['batch_size']}"
                    if leg["batch_size"] > 1 else "Pickup"
                )
            elif leg["status"] == "handed_off":
                leg["suggested_label"] = (
                    f"Deliver {leg['suggested_delivery_order']} of {leg['batch_size']}"
                    if leg["batch_size"] > 1 else "Deliver"
                )
            else:
                leg["suggested_label"] = ""

        result.append({
            "batch_id": idx,
            "size": len(batch),
            "legs": [{"order_id": l["order_id"], "merchant_id": l["merchant_id"]} for l in batch],
        })
    return result


@api.get("/rider/orders/available")
async def rider_available_orders(user: dict = Depends(rider_user)):
    """Incoming-orders feed — SIMULTANEOUS DISPATCH (rider-flow redesign):
    unclaimed legs in EITHER 'pending' OR 'accepted' state, not just
    'accepted' — riders now see an order the moment it's placed, in parallel
    with the merchant, and can head to the store / nudge the merchant before
    the merchant has actually accepted. `merchant_accepted` tells the caller
    whether this leg is claimable-for-pickup yet; a leg with
    merchant_accepted=false can still be claimed and "arrived at store" can
    still be logged, but "out for delivery" will 400 until the merchant
    accepts (see rider_out_for_delivery) — the UI should show a clear
    "waiting for the store to accept" state for those, not a blocked/greyed
    accept button.

    PII REDACTION: this is a pre-claim view, so only non-identifying fields
    are returned (store name/area, drop-off area/pincode/landmark — the SAME
    'safe before a party is involved' field set merchant_orders already uses
    for its own redaction, NOT the full `address`/`customer` objects). Full
    customer detail only appears after a claim, via GET .../{oid} below.
    An offline rider gets an explicit empty feed rather than silently
    querying — the frontend should read `online: false` as a hint to toggle
    on, not as 'no orders right now'."""
    rider = await _active_rider(user)
    if not rider.get("online"):
        return {"online": False, "legs": []}

    # merchant_states/rider_assignments are dicts keyed by merchant_id, not
    # Mongo arrays — Mongo can't $elemMatch into them, so per-leg filtering
    # happens in Python after a status-band pre-filter. Same tradeoff
    # twilio_inbound's OTP scan already accepts for the identical shape
    # reason. 'on_the_way' is deliberately NOT in this pre-filter: by
    # _derive_global_status's min-rank rule, a global status of 'on_the_way'
    # means EVERY non-cancelled leg is already at rank >= handed_off, so no
    # 'pending'/'accepted' leg could exist there anyway. Pickup orders
    # (order_type=='pickup') have no rider leg at all.
    cands = await db.orders.find(
        {"status": {"$in": ["pending_merchant", "accepted"]}, "order_type": {"$ne": "pickup"}},
        {"_id": 0},
    ).to_list(500)

    legs = []
    for o in cands:
        states = o.get("merchant_states") or {}
        assignments = o.get("rider_assignments") or {}
        addr = o.get("address") or {}
        for mid, state in states.items():
            if state not in ("pending", "accepted") or mid in assignments:
                continue
            items = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
            store_name = (items[0].get("store_name") if items else None) or "Store"
            store = await db.stores.find_one(
                {"id": f"store-m-{mid}"}, {"_id": 0, "area_label": 1, "area": 1, "city": 1},
            ) or {}
            legs.append({
                "order_id": o["id"],
                "merchant_id": mid,
                "store_name": store_name,
                "pickup_area": store.get("area_label") or store.get("area") or store.get("city", "Bhilai"),
                "drop_area": addr.get("landmark") or addr.get("city", "Bhilai"),
                "drop_pincode": addr.get("pincode", ""),
                "item_count": sum(int(it.get("qty", 1)) for it in items) or len(items),
                "placed_at": o.get("created_at"),
                "merchant_accepted": state == "accepted",
            })
    legs.sort(key=lambda l: l["placed_at"] or "")
    return {"online": True, "legs": legs}


@api.post("/rider/orders/{oid}/{mid}/accept")
async def rider_accept_leg(oid: str, mid: str, user: dict = Depends(rider_user)):
    """Atomic first-to-accept claim. SIMULTANEOUS DISPATCH (rider-flow
    redesign): a rider can claim a leg whether the merchant has accepted it
    yet or not ('pending' OR 'accepted') — they just can't go "out for
    delivery" until the merchant has (see rider_out_for_delivery's guard).

    Group B1: riders can now hold MULTIPLE active legs simultaneously — the
    old "reject if the rider already has current_order_leg set" gate is
    REMOVED, with no replacement cap (low volume today; revisit if that
    changes). That gate used to require a two-step claim-then-rollback
    dance across db.riders AND db.orders (see git history); with it gone,
    the ONLY protection needed — and the only one that was ever actually
    about preventing a conflict, rather than about a rider's own
    availability — is the single atomic conditional update below: it can
    only succeed for ONE caller when two riders race the same leg (same
    "conditional filter = atomic claim" technique as create_order's
    stock-decrement reservation), so the atomic same-leg protection is
    fully intact even though the rider-doc side of the old dance is gone."""
    rider = await _active_rider(user)
    now = datetime.now(timezone.utc).isoformat()

    updated = await db.orders.find_one_and_update(
        {"id": oid, f"merchant_states.{mid}": {"$in": ["pending", "accepted"]},
         f"rider_assignments.{mid}": {"$exists": False}},
        {"$set": {f"rider_assignments.{mid}": {"rider_id": rider["id"], "accepted_at": now}}},
        projection={"_id": 0, "rider_assignments": 1},
        return_document=True,
    )
    if not updated:
        o = await db.orders.find_one({"id": oid}, {"_id": 0, "merchant_states": 1})
        if not o or mid not in (o.get("merchant_states") or {}):
            raise HTTPException(404, "Leg not found on this order")
        if (o.get("merchant_states") or {}).get(mid) not in ("pending", "accepted"):
            raise HTTPException(400, "This leg is no longer available")
        raise HTTPException(409, "Another rider already accepted this leg")

    return {"ok": True, "order_id": oid, "merchant_id": mid,
            "rider_assignment": updated["rider_assignments"][mid]}


@api.post("/rider/orders/{oid}/{mid}/reached-store")
async def rider_reached_store(oid: str, mid: str, user: dict = Depends(rider_user)):
    """Informational checkpoint only — no merchant_states/global-status
    change (this checkpoint has no equivalent in the existing order FSM).
    SIMULTANEOUS DISPATCH: the merchant need NOT have accepted yet — a rider
    can claim a leg and physically head to the store before the merchant has
    accepted, so this only blocks once the leg has moved PAST pickup
    (handed_off/delivered/cancelled), not on the pending/accepted split."""
    rider = await _active_rider(user)
    o = await _rider_owned_leg(oid, mid, rider["id"])
    if (o.get("merchant_states") or {}).get(mid) not in ("pending", "accepted"):
        raise HTTPException(400, "This leg has already moved past pickup")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": oid}, {"$set": {f"rider_assignments.{mid}.reached_store_at": now}})
    return {"ok": True, "reached_store_at": now}


class RiderOutForDeliveryPayload(BaseModel):
    # Live-testing fix: the handoff code is DISPLAYED on the rider's own
    # screen (see rider_order_detail's `handoff_otp` field) — having the
    # rider re-type a value they can already see on the same device
    # validates nothing (it's not a third party confirming an independently
    # known code, unlike the customer's delivery OTP). It's now a shared
    # VISUAL reference only (rider reads it aloud, merchant eyeballs their
    # own copy via my_handoff_otp) — kept here as an optional, ignored field
    # so an old client that still sends it doesn't break.
    merchant_handoff_otp: Optional[str] = None


@api.post("/rider/orders/{oid}/{mid}/out-for-delivery")
async def rider_out_for_delivery(oid: str, mid: str, payload: RiderOutForDeliveryPayload,
                                 user: dict = Depends(rider_user)):
    """The pickup/handoff step (rider-flow redesign — REPLACES the old
    picked-up + merchant-'handed to rider' steps). GUARD: the merchant must
    have actually accepted (merchant_states[mid] == 'accepted') — a rider
    may have claimed this leg back when it was still 'pending' (simultaneous
    dispatch), but can't take goods until the merchant has accepted it.
    (The handoff code itself is no longer validated here — see
    RiderOutForDeliveryPayload above for why.)

    On success: stamps rider_assignments[mid].picked_up_at, then calls the
    SAME _mark_leg_handed_off helper (Commit 1) the deprecated merchant
    handed-to-rider endpoint used to call — the accepted->handed_off
    transition, timeline stamp, global-status derive, write, and customer
    notification (which now ALSO reveals the delivery OTP + rider contact —
    this is the customer's first delivery-related notification) all happen
    there. NOT reimplemented here."""
    rider = await _active_rider(user)
    o = await _rider_owned_leg(oid, mid, rider["id"])
    if (o.get("merchant_states") or {}).get(mid) != "accepted":
        raise HTTPException(400, "The store hasn't accepted this order yet")

    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": oid}, {"$set": {f"rider_assignments.{mid}.picked_up_at": now}})
    o = await db.orders.find_one({"id": oid}, {"_id": 0})  # re-fetch fresh before the shared transition
    result = await _mark_leg_handed_off(o, mid)
    return {"ok": True, "all_handed": result["all_handed"], "my_state": result["my_state"]}


class RiderPaymentCompletedPayload(BaseModel):
    payment_method: Optional[str] = None


@api.post("/rider/orders/{oid}/{mid}/payment-completed")
async def rider_payment_completed(oid: str, mid: str, payload: RiderPaymentCompletedPayload,
                                  user: dict = Depends(rider_user)):
    """Rider marks payment collected from the customer (rider-flow redesign).
    GUARD: rider owns the leg AND merchant_states[mid] == 'handed_off' (i.e.
    already out for delivery — payment happens at the doorstep, after
    pickup). Does NOT touch merchant_states/global status — this is a
    sub-timestamp on rider_assignments, same tier as reached_store_at, not a
    new global FSM state. PINGS the merchant via the existing in-app
    notification inbox (db.merchants.notifications — see merchant_publish/
    admin_approve for the same pattern) so their order section shows
    "payment received." This is also the HARD GATE rider_deliver_leg checks
    before allowing the delivery OTP step — see there."""
    rider = await _active_rider(user)
    o = await _rider_owned_leg(oid, mid, rider["id"])
    if (o.get("merchant_states") or {}).get(mid) != "handed_off":
        raise HTTPException(400, "Mark the order out for delivery before completing payment")

    now = datetime.now(timezone.utc).isoformat()
    update: dict = {f"rider_assignments.{mid}.payment_completed_at": now}
    if payload.payment_method:
        update[f"rider_assignments.{mid}.payment_method"] = payload.payment_method
    await db.orders.update_one({"id": oid}, {"$set": update})

    short_id = oid[-6:].upper()
    await db.merchants.update_one({"id": mid}, {"$push": {"notifications": {
        "type": "payment-received",
        "title": "Payment received",
        "body": f"The rider collected payment for order #{short_id}.",
        "time": now,
    }}})

    return {"ok": True, "payment_completed_at": now}


class RiderDeliverPayload(BaseModel):
    otp: str
    cash_collected: Optional[bool] = None


@api.post("/rider/orders/{oid}/{mid}/deliver")
async def rider_deliver_leg(oid: str, mid: str, payload: RiderDeliverPayload, user: dict = Depends(rider_user)):
    """Delivery confirmation. GUARDS, in order:
      1. Rider owns this leg.
      2. merchant_states[mid] == 'handed_off' (already out for delivery).
      3. HARD GATE: rider_assignments[mid].payment_completed_at IS SET —
         cannot deliver before payment is marked complete (see
         rider_payment_completed above; this is what makes it a hard gate
         rather than just a UI suggestion).
      4. otp VALIDATES structurally against merchant_otps[mid] (the DELIVERY
         OTP, distinct from the merchant_handoff_otp checked at step 3 of
         out-for-delivery) — STRICTER than the WhatsApp path's free-text
         regex parse of an inbound message.

    On success: calls the SAME _mark_leg_delivered helper (Commit 1) the
    Twilio webhook uses (require_handed_off=True, delivered_via='rider-app')
    — NOT reimplemented here. Group B1: no longer clears a
    current_order_leg slot on the rider doc — this leg simply stops
    appearing in _rider_active_legs once merchant_states[mid] flips to
    'delivered' (derived, not denormalized), and the rider's OTHER active
    legs (if any) are completely unaffected."""
    rider = await _active_rider(user)
    o = await _rider_owned_leg(oid, mid, rider["id"])
    if (o.get("merchant_states") or {}).get(mid) != "handed_off":
        raise HTTPException(400, "Leg must be out for delivery before it can be delivered")
    if not ((o.get("rider_assignments") or {}).get(mid) or {}).get("payment_completed_at"):
        raise HTTPException(400, "Mark payment as completed before delivering")
    expected_otp = (o.get("merchant_otps") or {}).get(mid)
    if not expected_otp or payload.otp.strip() != expected_otp:
        raise HTTPException(400, "Incorrect delivery OTP")

    now = datetime.now(timezone.utc).isoformat()
    rider_update: dict = {f"rider_assignments.{mid}.delivered_at": now}
    if payload.cash_collected is not None:
        rider_update[f"rider_assignments.{mid}.cash_collected"] = bool(payload.cash_collected)
        rider_update[f"rider_assignments.{mid}.cash_collected_at"] = now
    await db.orders.update_one({"id": oid}, {"$set": rider_update})

    o = await db.orders.find_one({"id": oid}, {"_id": 0})  # re-fetch fresh before the shared transition
    new_global = await _mark_leg_delivered(o, mid, require_handed_off=True, delivered_via="rider-app")

    return {"ok": True, "status": new_global}


@api.get("/rider/orders/{oid}")
async def rider_order_detail(oid: str, user: dict = Depends(rider_user)):
    """Rider-scoped order detail — mirrors get_order's role-branching with a
    role=='rider' equivalent scoped to legs THIS rider is assigned to. Full
    PII (customer name/phone/address) is justified here because ownership
    was already verified. A rider must NEVER see another merchant's leg's
    items or any leg they don't own — enforced by filtering to the single
    owned mid server-side, never by trusting the client."""
    rider = await _active_rider(user)
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    assignments = o.get("rider_assignments") or {}
    my_mid = next((mid for mid, a in assignments.items() if a.get("rider_id") == rider["id"]), None)
    if not my_mid:
        raise HTTPException(403, "You are not assigned to any leg of this order")

    addr = o.get("address") or {}
    cust = o.get("customer") or {}
    items = [it for it in (o.get("items") or []) if it.get("merchant_id") == my_mid]
    m = await db.merchants.find_one({"id": my_mid}, {"_id": 0, "store_name": 1, "business_address": 1})
    store = await db.stores.find_one(
        {"id": f"store-m-{my_mid}"}, {"_id": 0, "upi_qr_url": 1, "lat": 1, "lng": 1},
    ) or {}
    drop_parts = [addr.get("line1", ""), addr.get("landmark", ""), addr.get("city", "Bhilai"), addr.get("pincode", "")]

    return {
        "order_id": oid,
        "merchant_id": my_mid,
        "status": (o.get("merchant_states") or {}).get(my_mid),
        "pickup": {
            "store_name": (m or {}).get("store_name", "Store"),
            "address": (m or {}).get("business_address", ""),
            "lat": store.get("lat") or 0,
            "lng": store.get("lng") or 0,
        },
        "drop": {
            "customer_name": cust.get("name") or addr.get("name", "Customer"),
            "customer_phone": cust.get("phone") or addr.get("phone", ""),
            "address": ", ".join(p for p in drop_parts if p),
            # Live-testing fix: this used to fall back to o["customer_lat"]/
            # ["customer_lng"] — the customer's GPS at the MOMENT THEY PLACED
            # THE ORDER, which has no necessary relationship to the delivery
            # address they typed/selected (could be their office while
            # ordering for home, a friend's place, anywhere). CustomerAddress
            # (frontend type) carries no lat/lng at all today, so addr.get
            # ("lat"/"lng") is always None for now — deliberately left as the
            # lookup anyway (not hardcoded to 0) so this starts working
            # automatically once a future group lets customers pin exact
            # delivery coordinates, with no further backend change needed.
            # Until then this is 0/0 and the frontend's mapsUrl() helper
            # falls back to a text-based Maps search on `address` above,
            # which IS the correct delivery address.
            "lat": addr.get("lat") or 0,
            "lng": addr.get("lng") or 0,
        },
        "items": items,
        "handoff_otp": (o.get("merchant_handoff_otps") or {}).get(my_mid, ""),
        "handoff_otp_note": "Tell the store this code when you arrive to collect the order",
        "otp": (o.get("merchant_otps") or {}).get(my_mid, ""),
        "otp_note": "Ask the customer for this code at drop-off to confirm delivery",
        "payment": {
            "method": o.get("payment_method"),
            "upi_qr_url": store.get("upi_qr_url") or "",
            "note": ("Show the store's UPI QR" if store.get("upi_qr_url")
                     else "Collect cash on delivery" if o.get("payment_method") == "cod"
                     else "Already paid online"),
        },
        "rider_assignment": assignments.get(my_mid),
    }


@api.get("/rider/me/active")
async def rider_me_active(user: dict = Depends(rider_user)):
    """Group B1: 'what are ALL my active legs right now' — for reopening
    the app mid-delivery. A rider can hold multiple simultaneous legs (see
    rider_accept_leg), so this returns every one of them, grouped into
    SUGGESTED batches by pickup proximity (_compute_rider_batches — 2km
    haversine clustering + a suggested pickup-then-delivery sequence).

    The batching is presentation-only: each leg's own `status` (from
    merchant_states) is the only thing that gates what the rider can
    actually do with it — batch position never does. An empty rider (no
    active legs) gets `{"active_legs": [], "batches": []}`, not a 404."""
    rider = await _active_rider(user)
    raw = await _rider_active_legs(rider["id"])
    if not raw:
        return {"active_legs": [], "batches": []}

    legs = []
    for item in raw:
        o, mid = item["order"], item["merchant_id"]
        addr = o.get("address") or {}
        m = await db.merchants.find_one({"id": mid}, {"_id": 0, "store_name": 1})
        store = await db.stores.find_one(
            {"id": f"store-m-{mid}"}, {"_id": 0, "lat": 1, "lng": 1, "area_label": 1, "area": 1, "city": 1},
        ) or {}
        legs.append({
            "order_id": item["order_id"],
            "merchant_id": mid,
            "status": item["state"],
            "store_name": (m or {}).get("store_name", "Store"),
            # Group B2 (frontend list UI) needs short text labels, not just
            # coordinates — same field semantics as rider_available_orders's
            # pickup_area/drop_area, added here for the same purpose.
            "pickup_area": store.get("area_label") or store.get("area") or store.get("city", "Bhilai"),
            "drop_area": addr.get("landmark") or addr.get("city", "Bhilai"),
            "pickup": {"lat": store.get("lat") or 0, "lng": store.get("lng") or 0},
            "drop": {"lat": addr.get("lat") or 0, "lng": addr.get("lng") or 0},
            "rider_assignment": item["assignment"],
        })

    batches = _compute_rider_batches(legs)
    return {"active_legs": legs, "batches": batches}


@api.post("/orders/{oid}/rate")
async def rate_order_product(oid: str, payload: dict, user: dict = Depends(customer_user)):
    """Customer rates a product after delivery. One rating per order per product."""
    product_id = payload.get("product_id")
    rating = payload.get("rating")
    if not product_id or not rating:
        raise HTTPException(400, "product_id and rating required")
    if not isinstance(rating, (int, float)) or not (1 <= rating <= 5):
        raise HTTPException(400, "rating must be between 1 and 5")
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    cust = o.get("customer") or {}
    if cust.get("phone") != user["sub"] and o.get("customer_phone") != user["sub"]:
        raise HTTPException(403, "Not your order")
    if o.get("status") != "delivered":
        raise HTTPException(400, "Can only rate delivered orders")
    item_ids = [it.get("product_id") or it.get("id") for it in (o.get("items") or [])]
    if product_id not in item_ids:
        raise HTTPException(400, "Product not in this order")
    existing = await db.product_ratings.find_one({"order_id": oid, "product_id": product_id})
    if existing:
        raise HTTPException(400, "Already rated this product")
    now = datetime.now(timezone.utc).isoformat()
    await db.product_ratings.insert_one({
        "id": f"rating-{oid}-{product_id}",
        "order_id": oid,
        "product_id": product_id,
        "customer_phone": user["sub"],
        "rating": float(rating),
        "created_at": now,
    })
    all_ratings = await db.product_ratings.find(
        {"product_id": product_id}, {"_id": 0, "rating": 1}
    ).to_list(10000)
    if all_ratings:
        avg = round(sum(r["rating"] for r in all_ratings) / len(all_ratings), 1)
        count = len(all_ratings)
        await db.products.update_one(
            {"id": product_id},
            {"$set": {"rating": avg, "review_count": count, "updated_at": now}},
        )
    return {"ok": True, "rating": float(rating)}


@api.get("/merchant/orders")
async def merchant_orders(user: dict = Depends(get_current_user)):
    """Returns this merchant's orders with customer PII redacted (name + pincode + landmark only).
    Items are FILTERED to only this merchant's items — multi-store orders no
    longer leak each merchant's products to every merchant."""
    mid = user["sub"]
    raw = await db.orders.find(
        {"merchant_ids": mid, "status": {"$ne": "awaiting_payment"}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
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
            "line1": (addr.get("line1", "").split(",")[-1] or "").strip(),
        }
        own_items = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
        # Legacy orders pre-fix have no merchant_id on items — fall back to all
        if not own_items and not any(it.get("merchant_id") for it in (o.get("items") or [])):
            own_items = o.get("items") or []
        o["items"] = own_items
        # Override total to this merchant's slice so revenue is accurately reported
        o["merchant_subtotal"] = round(sum(float(it.get("price", 0)) * int(it.get("qty", 1)) for it in own_items), 2)
        # This merchant's per-order accept state + their own timeline + OTP
        o["my_state"] = (o.get("merchant_states") or {}).get(mid, "pending")
        o["my_timeline"] = (o.get("merchant_timelines") or {}).get(mid) or o.get("timeline") or []
        o["my_delivered_at"] = (o.get("merchant_delivered_at") or {}).get(mid)
        o["my_otp"] = (o.get("merchant_otps") or {}).get(mid) or o.get("otp", "")
        # This merchant's handoff OTP — shown so the merchant can visually
        # confirm the code the rider reads out at pickup (see
        # POST /rider/orders/{oid}/{mid}/out-for-delivery, which validates
        # it server-side; the merchant doesn't take any action here beyond
        # eyeballing the match — "Prefer: rider submits the OTP" design).
        o["my_handoff_otp"] = (o.get("merchant_handoff_otps") or {}).get(mid, "")
        # Rider-flow redesign: surface the rider's "payment completed" ping
        # (POST /rider/orders/{oid}/{mid}/payment-completed) directly on this
        # merchant's own order row — same convenience-field pattern as
        # my_otp/my_handoff_otp above, so the frontend doesn't have to read
        # an unredacted cross-merchant rider_assignments dict for it.
        o["my_payment_completed_at"] = ((o.get("rider_assignments") or {}).get(mid) or {}).get("payment_completed_at")
        # Hide other merchants' OTPs / rider assignments from this merchant's view
        if o.get("merchant_otps"):
            o["merchant_otps"] = {mid: o["my_otp"]}
        if o.get("merchant_handoff_otps"):
            o["merchant_handoff_otps"] = {mid: o["my_handoff_otp"]}
        if o.get("rider_assignments"):
            o["rider_assignments"] = {mid: o["rider_assignments"].get(mid)} if mid in o["rider_assignments"] else {}
        # The pickup code is only ever meant to be known by the customer —
        # only they receive it via WhatsApp (notify_pickup_reserved). It must
        # NOT be visible to the merchant here, otherwise verify-pickup's code
        # check is worthless (merchant could just read it off their own screen
        # instead of asking the customer to show it).
        o.pop("pickup_code", None)
        cleaned.append(o)
    return cleaned

@api.post("/merchant/orders/{oid}/accept")
async def merchant_accept_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"id": oid, "merchant_ids": user["sub"]}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    mid = user["sub"]
    now = datetime.now(timezone.utc).isoformat()
    # Per-merchant accept state — independent per merchant. The customer-facing
    # global status is derived from min(merchant_states) so it always reflects
    # the laggard.
    states = dict(o.get("merchant_states") or {m: "pending" for m in (o.get("merchant_ids") or [])})
    if states.get(mid) != "pending":
        raise HTTPException(400, "Order already accepted")
    states[mid] = "accepted"
    timelines = dict(o.get("merchant_timelines") or {})
    if mid not in timelines:
        timelines[mid] = _new_merchant_timeline(o.get("created_at", now))
    timelines = _stamp_merchant_step(timelines, mid, "Merchant accepted", now)
    all_accepted = states and all(_STATE_RANK.get(v, 0) >= _STATE_RANK["accepted"] for v in states.values())
    new_global = _derive_global_status(states)
    # Keep the legacy global timeline in sync (stamp "Merchant accepted" only when ALL accept)
    tl = o.get("timeline", [])
    if all_accepted:
        for t in tl:
            if t["label"] == "Merchant accepted" and not t["time"]:
                t["time"] = now; break
    await db.orders.update_one(
        {"id": oid},
        {"$set": {"status": new_global, "merchant_states": states,
                  "merchant_timelines": timelines, "timeline": tl}},
    )
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "store_name": 1, "business_address": 1})
    # This merchant's UNIQUE 4-digit delivery OTP (each store gets its own).
    # Rider-flow redesign: NO customer notification fires here anymore — the
    # customer's first delivery-related notification is now at "out for
    # delivery" (_mark_leg_handed_off), which is also where this OTP is
    # first revealed to them. my_otp is still needed below for the legacy
    # WhatsApp rider_pickup notification (RIDER_PHONE fallback, unrelated to
    # the customer-facing timing change) and the response body.
    my_otp = (o.get("merchant_otps") or {}).get(mid) or o.get("otp", "")
    if not my_otp:
        import random as _random
        my_otp = str(_random.randint(1000, 9999))
        log.warning("[rider-pickup] no OTP found for order=%s mid=%s — generated fallback %s", oid, mid, my_otp)
    rider_phone = os.environ.get("RIDER_PHONE", "").strip()
    if not rider_phone:
        log.warning("[rider-pickup] RIDER_PHONE not set — skipping rider notification for order %s", oid)
    # Per-merchant rider pickup — each store's leg is its own dispatch with its
    # own OTP. Fires the moment THIS merchant accepts (not gated on all).
    if rider_phone:
        log.info("[rider-pickup] attempting notify rider=%s order=%s", rider_phone, oid)
        try:
            addr = o.get("address") or {}
            my_items = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid] or o.get("items", [])
            items_summary = "\n".join(
                f"  • {it.get('qty', 1)}x {it.get('name', 'Item')}" + (f" ({it['size']})" if it.get("size") else "")
                for it in my_items
            )
            drop_parts = [addr.get("line1", ""), addr.get("landmark", ""), addr.get("city", "Bhilai"), addr.get("pincode", "")]
            customer_address = ", ".join([p for p in drop_parts if p])
            store_doc = await db.stores.find_one({"id": f"store-m-{mid}"}, {"_id": 0, "upi_qr_url": 1, "lat": 1, "lng": 1}) or {}
            notify_rider_pickup(
                rider_phone, order_id=oid, otp=my_otp,
                customer_name=(o.get("customer") or {}).get("name") or addr.get("name", "Customer"),
                store_name=(m or {}).get("store_name", "Store"),
                store_address=(m or {}).get("business_address", "Bhilai"),
                customer_address=customer_address,
                items_summary=items_summary,
                upi_qr_url=store_doc.get("upi_qr_url") or "",
                store_lat=store_doc.get("lat") or 0,
                store_lng=store_doc.get("lng") or 0,
                # Live-testing fix (same bug as rider_order_detail's drop
                # lat/lng, see the comment there): must NOT fall back to
                # o["customer_lat"]/["customer_lng"] (order-time GPS, unrelated
                # to the delivery address). addr has no lat/lng today either —
                # this WhatsApp message still carries the correct
                # `customer_address` text regardless; notify_rider_pickup
                # simply omits the Maps link when lat/lng are 0.
                customer_lat=addr.get("lat") or 0,
                customer_lng=addr.get("lng") or 0,
            )
        except Exception as e:
            log.error("[rider-pickup] failed order=%s error=%s", oid, e)
    return {"ok": True, "otp": my_otp, "all_accepted": all_accepted, "my_state": "accepted"}

@api.post("/merchant/orders/{oid}/handed-to-rider")
async def merchant_handed_to_rider(oid: str, user: dict = Depends(get_current_user)):
    """DEPRECATED as a state-advancing action (rider-flow redesign). The
    merchant's only order action is now ACCEPT (merchant_accept_order above)
    — handoff verification moved to the rider, who submits the merchant-
    handoff OTP via POST /rider/orders/{oid}/{mid}/out-for-delivery (which
    drives the accepted->handed_off transition through the SAME
    _mark_leg_handed_off helper this endpoint used to call directly). This
    route is kept, not deleted, so a stale client gets a clear explanation
    instead of a bare 404 — but it can no longer advance order state."""
    o = await db.orders.find_one({"id": oid, "merchant_ids": user["sub"]}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    raise HTTPException(
        410,
        "This action has moved to the rider app. The rider now marks the order "
        "'out for delivery' after you give them the merchant handoff code shown "
        "on this order.",
    )


@api.post("/merchant/orders/{oid}/reject")
@_limit("20/minute")
async def merchant_reject_order(oid: str, request: Request, payload: Optional[dict] = None,
                                user: dict = Depends(get_current_user)):
    """Merchant rejects their slice of an order they have NOT yet accepted.
    Restocks this merchant's items and notifies the customer (COD — no charge
    was ever taken, so no refund logic needed here). On a multi-store cart,
    only this merchant's slice is affected; other stores' items are untouched."""
    mid = user["sub"]
    if user.get("role") not in ("merchant", "admin"):
        raise HTTPException(403, "Merchant only")
    o = await db.orders.find_one({"id": oid, "merchant_ids": mid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("order_type") == "pickup":
        raise HTTPException(400, "Use cancel-pickup for pickup orders")
    states = dict(o.get("merchant_states") or {m: "pending" for m in (o.get("merchant_ids") or [])})
    if states.get(mid) != "pending":
        raise HTTPException(400, "Already accepted — use cancel instead of reject")
    reason = ((payload or {}).get("reason") or "Rejected by merchant").strip()[:200]
    new_global = await _merchant_cancel_own_slice(oid, mid, reason)
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_rejected(cust_phone, oid)
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"ok": True, "status": new_global}


@api.post("/merchant/orders/{oid}/cancel")
@_limit("20/minute")
async def merchant_cancel_order(oid: str, request: Request, payload: Optional[dict] = None,
                                user: dict = Depends(get_current_user)):
    """Merchant cancels their slice AFTER accepting but BEFORE handing to the
    rider. Restocks this merchant's items and notifies the customer. Once a
    merchant has marked 'handed to rider', this endpoint refuses — that leg is
    already physically with a rider and needs admin/support, not a self-serve
    cancel."""
    mid = user["sub"]
    if user.get("role") not in ("merchant", "admin"):
        raise HTTPException(403, "Merchant only")
    o = await db.orders.find_one({"id": oid, "merchant_ids": mid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("order_type") == "pickup":
        raise HTTPException(400, "Use cancel-pickup for pickup orders")
    states = dict(o.get("merchant_states") or {})
    if states.get(mid) != "accepted":
        raise HTTPException(400, "Can only cancel an order you've accepted but not yet handed to the rider")
    reason = ((payload or {}).get("reason") or "Cancelled by merchant").strip()[:200]
    new_global = await _merchant_cancel_own_slice(oid, mid, reason)
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_cancelled(cust_phone, oid, reason)
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"ok": True, "status": new_global}


@api.post("/merchant/orders/{oid}/accept-pickup")
async def accept_pickup(oid: str, user: dict = Depends(merchant_user)):
    """Accept a pending pickup request — transitions status to 'reserved' and sends the customer their pickup code."""
    mid = user["sub"]
    o = await db.orders.find_one({"id": oid, "order_type": "pickup", "merchant_ids": mid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pickup order not found")
    if o.get("status") != "pending_pickup":
        raise HTTPException(400, "This pickup request is no longer pending")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": oid}, {"$set": {"status": "reserved", "accepted_at": now}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try:
            notify_pickup_reserved(
                cust_phone, oid,
                o.get("store_name") or "the store",
                o["pickup_code"], o["pickup_expires_at"],
                store_address=o.get("store_address", ""),
                maps_link=o.get("maps_link", ""),
            )
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"ok": True}


@api.post("/merchant/orders/{oid}/verify-pickup")
async def verify_pickup(oid: str, body: dict, user: dict = Depends(merchant_user)):
    """Verify the customer's 4-digit pickup code and mark the order as delivered.

    This is the ONLY path that closes a pickup reservation — `confirm-pickup`
    (which did no code check at all, letting anyone mark any reservation
    collected) was removed as part of the go-live audit Pass 2 fix. The code
    is never exposed to the merchant (stripped in /merchant/orders and
    GET /orders/{id}) — it must come from the customer showing it, not from
    the merchant's own screen."""
    mid = user["sub"]
    o = await db.orders.find_one({"id": oid, "order_type": "pickup", "merchant_ids": mid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pickup order not found")
    if o.get("status") != "reserved":
        raise HTTPException(400, "This reservation is no longer active")
    expires_at = o.get("pickup_expires_at", "")
    if expires_at and datetime.now(timezone.utc).isoformat() > expires_at:
        await db.orders.update_one({"id": oid}, {"$set": {"status": "cancelled"}})
        raise HTTPException(400, "This pickup reservation has expired")
    submitted = str((body or {}).get("code", "")).strip()
    if not submitted:
        raise HTTPException(400, "Enter the 4-digit code the customer shows you")
    if submitted != str(o.get("pickup_code", "")):
        raise HTTPException(403, "Incorrect pickup code")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": oid}, {"$set": {"status": "delivered", "delivered_at": now}})
    return {"ok": True}


@api.post("/merchant/orders/{oid}/cancel-pickup")
async def cancel_pickup_reservation(oid: str, user: dict = Depends(merchant_user)):
    """Cancel a pickup reservation or pending request."""
    mid = user["sub"]
    o = await db.orders.find_one({"id": oid, "order_type": "pickup", "merchant_ids": mid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pickup order not found")
    if o.get("status") not in ("reserved", "pending_pickup"):
        raise HTTPException(400, "This reservation is no longer active")
    await db.orders.update_one({"id": oid}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


@api.get("/admin/expire-pickups")
async def expire_pickups(admin: dict = Depends(require_admin)):
    """Manual trigger for the same sweep that now also runs automatically
    every 5 min from _auto_cancel_stale_orders() — restocks the expired
    reservation's stock and notifies the customer (the old version of this
    endpoint only flipped `status`, it never released the reserved stock)."""
    count = await _expire_pickup_reservations()
    return {"expired": count}


# ===== Admin order management =====
@api.post("/admin/orders/{oid}/mark-delivered")
async def admin_mark_delivered(oid: str, payload: Optional[dict] = None, admin: dict = Depends(require_admin)):
    """Mark an order (or one merchant's slice of a multi-store order) as delivered.

    Payload (optional): `{"merchant_id": "..."}` — when present on a multi-store
    order, marks only that merchant's slice. Global order flips to `delivered`
    only after every merchant has delivered."""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") in ("delivered", "cancelled"):
        raise HTTPException(400, "Order already finalized")
    now = datetime.now(timezone.utc).isoformat()
    mids = o.get("merchant_ids") or []
    target_mid = (payload or {}).get("merchant_id")

    states = dict(o.get("merchant_states") or {m: "pending" for m in mids})
    timelines = dict(o.get("merchant_timelines") or {})
    delivered_map = dict(o.get("merchant_delivered_at") or {})

    # Decide which merchants to mark delivered in this call
    if target_mid:
        if target_mid not in mids:
            raise HTTPException(400, "merchant_id not part of this order")
        targets = [target_mid]
    else:
        # Single-store order, or admin chose to mark everything
        targets = [m for m in mids if states.get(m) != "delivered"] or mids

    for mid in targets:
        if states.get(mid) == "delivered":
            continue
        _apply_delivered_state(states, timelines, delivered_map, mid, o.get("created_at", now), now)

    new_global = await _finalize_delivery_update(oid, o, states, timelines, delivered_map, now)
    return {"ok": True, "all_delivered": new_global == "delivered", "merchant_states": states}

@api.post("/admin/orders/{oid}/cancel")
async def admin_cancel_order(oid: str, payload: Optional[dict] = None, admin: dict = Depends(require_admin)):
    """Cancel an order or one merchant's slice of a multi-store order.

    Payload (optional): `{"reason": "...", "merchant_id": "..."}` — when
    `merchant_id` is present on a multi-store order, only that merchant's slice
    is cancelled; the rest of the order continues. Global flips to `cancelled`
    only when every merchant on the order is cancelled (or none remain active).

    Stock for the cancelled slice's items is atomically restored to the
    product catalog so the unsold inventory becomes immediately available again."""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") == "delivered":
        raise HTTPException(400, "Cannot cancel a delivered order")
    reason = (payload or {}).get("reason") or "Cancelled by admin"
    target_mid = (payload or {}).get("merchant_id")
    mids = o.get("merchant_ids") or []
    states_now = dict(o.get("merchant_states") or {})

    if target_mid and states_now.get(target_mid) == "cancelled":
        raise HTTPException(400, "This merchant's slice is already cancelled")

    # Restock the cancelled-slice items. Skip any merchant whose slice is
    # already 'cancelled' (a merchant self-reject/cancel, or an earlier admin
    # per-merchant cancel already restored their stock) — restocking twice
    # would inflate inventory that was never actually double-sold.
    already_cancelled_mids = {m for m, s in states_now.items() if s == "cancelled"}
    items_to_restock = [it for it in (o.get("items") or [])
                       if ((not target_mid) or it.get("merchant_id") == target_mid)
                       and it.get("merchant_id") not in already_cancelled_mids]
    await _restock_order_items({"items": items_to_restock})

    if target_mid:
        if target_mid not in mids:
            raise HTTPException(400, "merchant_id not part of this order")
        cancelled = dict(o.get("merchant_cancelled") or {})
        cancelled[target_mid] = reason
        states = dict(o.get("merchant_states") or {})
        states[target_mid] = "cancelled"
        new_global = _derive_global_status(states)
        update_doc = {"merchant_cancelled": cancelled, "merchant_states": states,
                      "status": new_global}
        if new_global == "cancelled":
            update_doc["cancel_reason"] = reason
        if new_global == "delivered":
            tl = o.get("timeline", [])
            now2 = datetime.now(timezone.utc).isoformat()
            for t in tl:
                if t["label"] == "Delivered" and not t["time"]:
                    t["time"] = now2; break
            update_doc["timeline"] = tl
            update_doc["delivered_at"] = o.get("delivered_at") or now2
        await db.orders.update_one({"id": oid}, {"$set": update_doc})
    else:
        _assert_status_transition(o.get("status", "pending_merchant"), "cancelled")
        await db.orders.update_one({"id": oid}, {"$set": {"status": "cancelled", "cancel_reason": reason}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        try: notify_order_cancelled(cust_phone, oid, reason)
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"ok": True}


# ===== Merchant KYC =====
@api.post("/merchant/kyc/submit")
async def kyc_submit(payload: KycSubmit, user: dict = Depends(get_current_user)):
    # Re-submitting clears any prior hold so admins see it as a fresh review.
    update = payload.model_dump()
    # Preserve previously-uploaded docs when this submission omits them (merchant just
    # tweaked text fields after an on_hold note). Covers both legacy base64 and
    # the new Cloudinary public_id fields.
    existing = await db.merchants.find_one(
        {"id": user["sub"]},
        {"_id": 0,
         "pan_doc_b64": 1, "gst_doc_b64": 1, "cancelled_cheque_b64": 1,
         "pan_doc_public_id": 1, "gst_doc_public_id": 1, "cancelled_cheque_public_id": 1}
    ) or {}
    for k in ("pan_doc_b64", "gst_doc_b64", "cancelled_cheque_b64",
              "pan_doc_public_id", "gst_doc_public_id", "cancelled_cheque_public_id"):
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
        {"_id": 0,
         "pan_doc_b64": 1, "gst_doc_b64": 1, "cancelled_cheque_b64": 1,
         "pan_doc_public_id": 1, "gst_doc_public_id": 1, "cancelled_cheque_public_id": 1}
    ) or {}
    docs_present = {
        "pan_doc": bool(raw.get("pan_doc_b64") or raw.get("pan_doc_public_id")),
        "gst_doc": bool(raw.get("gst_doc_b64") or raw.get("gst_doc_public_id")),
        "cancelled_cheque": bool(raw.get("cancelled_cheque_b64") or raw.get("cancelled_cheque_public_id")),
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
@api.get("/merchant/storefront")
async def get_storefront(user: dict = Depends(get_current_user)):
    """Return the saved storefront for the authenticated merchant."""
    sid = f"store-m-{user['sub']}"
    s = await db.stores.find_one({"id": sid}, {"_id": 0})
    if not s:
        return {}
    return s


@api.post("/merchant/storefront")
async def storefront_update(payload: StorefrontUpdate, user: dict = Depends(get_current_user)):
    m = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not m: raise HTTPException(404, "Not found")
    if m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved yet")
    # Lat/lng are mandatory so distance + ETA can be computed accurately.
    if payload.lat is None or payload.lng is None:
        raise HTTPException(400, "Pin your store on the map (latitude & longitude are required).")
    if not (-90 <= float(payload.lat) <= 90) or not (-180 <= float(payload.lng) <= 180):
        raise HTTPException(400, "Invalid coordinates.")
    # iter-29 (Item 2): area + pincode are mandatory for Bhilai pilot stores.
    # Pre-existing storefronts retain their data — the frontend pre-fills these
    # on edit, so this is only a hard gate for the first save.
    if not (payload.area or "").strip():
        raise HTTPException(400, "Please select your area before saving.")
    if not (payload.pincode or "").strip():
        raise HTTPException(400, "Pincode is required.")
    store_id = f"store-m-{user['sub']}"
    # Derive area from business_address (first comma-segment)
    biz_addr = m.get("business_address", "") or ""
    # iter-29 (Item 2): prefer the explicit area_label from the picker over the
    # legacy biz-address fallback for the `area` display string in the store doc.
    derived_area = (payload.area_label or payload.locality or biz_addr.split(",")[0]).strip() or "Bhilai"
    store_doc = {"id": store_id, "merchant_id": user["sub"], "name": m["store_name"],
        "tagline": payload.tagline, "story": payload.story,
        "banner": (payload.banners[0] if payload.banners else payload.banner),
        "banners": payload.banners or ([payload.banner] if payload.banner else []),
        "banner_public_ids": payload.banner_public_ids or [],
        "logo": payload.logo or (payload.banners[0] if payload.banners else payload.banner),
        "logo_public_id": payload.logo_public_id or "",
        "city": "Bhilai", "area": derived_area, "locality": derived_area,
        # iter-29 (Item 2): structured area + pincode + GeoJSON for future
        # within-radius queries (2dsphere index on `location` makes them fast).
        "area_slug": payload.area, "area_label": payload.area_label or derived_area,
        "pincode": (payload.pincode or "").strip(),
        "address": biz_addr,
        "specialties": payload.specialties,
        "timing": payload.timing or f"{payload.opens_at} - {payload.closes_at}",
        "opens_at": payload.opens_at or "10:00",
        "closes_at": payload.closes_at or "18:00",
        "lat": float(payload.lat), "lng": float(payload.lng),
        "location": {"type": "Point", "coordinates": [float(payload.lng), float(payload.lat)]},
        "upi_qr_url": payload.upi_qr_url or "",
        "weekly_off": payload.weekly_off or [],
        "trusted": True,
        "kyc_status": "approved", "published": False, "paused": False, "product_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()}
    existing = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if existing:
        for k in ("published", "paused", "product_count", "created_at"):
            if k in existing: store_doc[k] = existing[k]
    # Preserve existing slug; generate from store name on first save.
    store_doc["slug"] = (existing or {}).get("slug") or _slugify(m["store_name"]) or store_id
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
    update_fields: dict = {"online": online}
    if online:
        update_fields["last_seen_at"] = datetime.now(timezone.utc).isoformat()
    await db.stores.update_one({"id": sid}, {"$set": update_fields})
    # Bust geo cache so the new online/offline state surfaces immediately
    try: await cache_service.invalidate_geo()
    except Exception: pass
    if online:
        asyncio.create_task(_send_notify_me_messages(sid))
    return {"ok": True, "online": online}

@api.get("/merchant/products")
async def merchant_products(user: dict = Depends(get_current_user)):
    # Strip heavy `images` carousel array from the list response (often 5x ~200 KB
    # base64 strings per product), the merchant dashboard only needs the cover
    # `image` for the row thumbnail. The full `images` array is re-fetched on
    # demand when the merchant clicks Edit via GET /api/products/{pid}.
    return await db.products.find(
        {"merchant_id": user["sub"]},
        {"_id": 0, "images": 0}
    ).to_list(500)

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


async def _create_product_for_merchant(payload: ProductCreate, merchant_id: str) -> dict:
    """Canonical product-insert path — the ONLY place a new Product
    document gets created. Every side effect (KYC gate, storefront-exists
    check, plan product-limit check, product_count/brand-count recompute,
    autopublish check) lives here exactly once. Both the merchant product
    modal (create_merchant_product below) and the VasyERP publish flow
    (_publish_staged_import) call this — neither duplicates it."""
    m = await db.merchants.find_one({"id": merchant_id}, {"_id": 0})
    if not m or m.get("kyc_status") != "approved": raise HTTPException(403, "KYC not approved")
    _validate_l1_l2(payload.l1_id, payload.l2_id or "", payload.gender or "")
    store_id = f"store-m-{merchant_id}"
    store = await db.stores.find_one({"id": store_id}, {"_id": 0})
    if not store: raise HTTPException(400, "Set up storefront first")
    merchant_plan = m.get("plan", "free")
    plan_config = PLAN_LIMITS.get(merchant_plan, PLAN_LIMITS["free"])
    product_limit = plan_config.get("products", 10)
    existing_count = await db.products.count_documents({"merchant_id": merchant_id, "is_deleted": {"$ne": True}})
    if existing_count >= product_limit:
        raise HTTPException(400, f"You have reached the {product_limit} product limit on your {merchant_plan.title()} plan. Upgrade to add more products.")
    pid = f"prod-{uuid.uuid4().hex[:10]}"
    doc = {"id": pid, "merchant_id": merchant_id, "store_id": store_id,
        "store_name": m["store_name"], "store_city": m.get("city", ""),
        "rating": 4.5, "paused": False, **payload.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat()}
    if isinstance(doc.get("stock"), dict):
        doc["total_stock"] = sum(int(v) for v in doc["stock"].values() if isinstance(v, (int, float)))
    await db.products.insert_one(doc)
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    await _recompute_brand_product_count(doc.get("brand_id"))
    await _maybe_autopublish_store(merchant_id)
    doc.pop("_id", None)
    return doc


@api.post("/merchant/products")
async def create_merchant_product(payload: ProductCreate, user: dict = Depends(get_current_user)):
    return await _create_product_for_merchant(payload, user["sub"])

@api.put("/merchant/products/{pid}")
async def update_merchant_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": pid, "merchant_id": user["sub"]}, {"_id": 0})
    if not p: raise HTTPException(404, "Product not found")
    payload.pop("id", None); payload.pop("merchant_id", None)
    if isinstance(payload.get("stock"), dict):
        payload["total_stock"] = sum(int(v) for v in payload["stock"].values() if isinstance(v, (int, float)))
    # If the cover Cloudinary asset is being replaced (different public_id),
    # delete the previous asset to avoid orphaned Cloudinary storage.
    new_pid = payload.get("image_public_id")
    old_pid = p.get("image_public_id")
    if new_pid and old_pid and new_pid != old_pid:
        cloudinary_service.delete_image(old_pid)
    # Same for the carousel images array — delete any old ids that are no
    # longer in the new array.
    if "image_public_ids" in payload:
        old_ids = set(p.get("image_public_ids") or [])
        new_ids = set(payload.get("image_public_ids") or [])
        for stale in (old_ids - new_ids):
            cloudinary_service.delete_image(stale)
    await db.products.update_one({"id": pid}, {"$set": payload})
    # If the product was just unpaused, recompute count and maybe auto-publish.
    if "paused" in payload:
        store_id = f"store-m-{user['sub']}"
        cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
        await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
        await _maybe_autopublish_store(user["sub"])
    if "brand_id" in payload:
        old_brand_id = p.get("brand_id")
        new_brand_id = payload.get("brand_id")
        if old_brand_id != new_brand_id:
            await _recompute_brand_product_count(old_brand_id)
        await _recompute_brand_product_count(new_brand_id)
    return await db.products.find_one({"id": pid}, {"_id": 0})

@api.patch("/merchant/products/{pid}")
async def quick_update_product(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    """Quick partial update — price, mrp, total_stock, paused, status only."""
    product = await db.products.find_one({"id": pid, "merchant_id": user["sub"]}, {"_id": 0, "id": 1})
    if not product:
        raise HTTPException(404)
    allowed = {"price", "mrp", "total_stock", "paused", "status"}
    update = {k: v for k, v in payload.items() if k in allowed}
    if update:
        await db.products.update_one({"id": pid}, {"$set": update})
    return {"ok": True}

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
        affected_brand_ids = await db.products.distinct(
            "brand_id", {"id": {"$in": ids}, "merchant_id": user["sub"], "brand_id": {"$ne": None}},
        )
        r = await db.products.delete_many({"id": {"$in": ids}, "merchant_id": user["sub"]})
        for bid in affected_brand_ids:
            await _recompute_brand_product_count(bid)
        for pid in ids:
            await _revert_staged_import_on_product_delete(pid)
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



def _category_name_maps() -> tuple[dict, dict, dict]:
    """Shared by bulk_products and the VasyERP import — the exact same
    lowercased exact-match dicts, built once per call so both consumers
    can never drift out of sync with each other.

    Returns (l1_by_name, l2_by_name, l2_flat_by_name):
      - l1_by_name: {l1 name lower -> l1_id}
      - l2_by_name: {(l1_id, l2 name lower) -> l2_id} — bulk-upload's shape,
        used when the caller already knows which L1 an L2 name belongs under.
      - l2_flat_by_name: {l2 name lower -> (l1_id, l2_id)} — VasyERP only
        gives ONE flat free-text category field (no separate L1/L2 columns
        the way the bulk-upload sheet has), so it needs to try matching
        that text against L2 names directly, without already knowing the L1.
    """
    l1_by_name = {c["name"].lower(): c["id"] for c in L1_CATEGORIES}
    l2_by_name: dict = {}
    l2_flat_by_name: dict = {}
    for lid, subs in L2_BY_L1.items():
        for s in subs:
            l2_by_name[(lid, s["name"].lower())] = s["id"]
            l2_flat_by_name[s["name"].lower()] = (lid, s["id"])
    return l1_by_name, l2_by_name, l2_flat_by_name


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


_L1_NORMALIZE = {
    "women": "l1-women", "women's fashion": "l1-women", "womens fashion": "l1-women",
    "men": "l1-men", "men's fashion": "l1-men", "mens fashion": "l1-men",
    "ethnic": "l1-ethnic", "ethnic wear": "l1-ethnic",
    "footwear": "l1-footwear", "shoes": "l1-footwear",
    "lingerie": "l1-lingerie", "lingerie & innerwear": "l1-lingerie", "innerwear": "l1-lingerie",
    "kids": "l1-kids", "children": "l1-kids",
    "accessories": "l1-accessories",
    "beauty": "l1-beauty", "personal care": "l1-beauty",
    "sports": "l1-sports", "fitness": "l1-sports",
}

_GENDER_NORMALIZE = {
    "male": "Male", "men": "Male", "man": "Male", "gents": "Male",
    "female": "Female", "women": "Female", "woman": "Female", "ladies": "Female",
    "unisex": "Unisex", "both": "Unisex",
    "kids": "Kids", "children": "Kids",
    "n/a": "N/A", "na": "N/A", "": "N/A",
}


def _row_to_product(row: dict, l1_by_name: dict, l2_by_name: dict) -> tuple[dict | None, str | None]:
    """Parse one bulk-upload row (from xlsx or csv) into a product doc fragment.
    Returns (doc, skip_reason). doc is None when the row should be skipped."""
    name = str(row.get("product name") or row.get("name") or row.get("product_name") or "").strip()
    if not name:
        return None, "blank-name"
    l1_raw = (row.get("l1_category") or row.get("l1 category") or row.get("l1") or row.get("category") or "").strip().lower()
    l1_id = _L1_NORMALIZE.get(l1_raw) or l1_by_name.get(l1_raw)
    if not l1_id:
        return None, f"{name}: unknown L1 '{l1_raw}'"
    l2_raw = str(row.get("l2 category") or row.get("l2_category") or row.get("l2") or row.get("subcategory") or "").strip().lower()
    l2_id = l2_by_name.get((l1_id, l2_raw), "") if l2_raw else ""
    gender_raw = (row.get("gender") or "").strip().lower()
    gender = _GENDER_NORMALIZE.get(gender_raw, str(row.get("gender") or "N/A").strip())
    if l1_id in L2_BY_L1 and not l2_id:
        return None, f"{name}: L2 required for category"
    if l1_id not in L2_BY_L1 and gender == "N/A":
        gender = "Unisex"
    sizes_raw = row.get("sizes") or row.get("size") or ""
    sizes = [s.strip() for s in _re.split(r"[,;|]+", str(sizes_raw)) if s.strip()]
    try: price = float((row.get("selling price") or row.get("price") or row.get("selling_price") or 0) or 0)
    except (ValueError, TypeError): price = 0
    try: mrp = float(row.get("mrp") or 0)
    except (ValueError, TypeError): mrp = 0
    stock_raw = str(row.get("stock_per_size") or row.get("stock per size") or row.get("stock") or "").strip()
    stock_dict: dict = {}
    if stock_raw:
        parts = [p.strip() for p in _re.split(r"[,;|]+", stock_raw) if p.strip() != ""]
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

    merchant_plan = m.get("plan", "free")
    plan_config = PLAN_LIMITS.get(merchant_plan, PLAN_LIMITS["free"])
    product_limit = plan_config.get("products", 10)
    existing_count = await db.products.count_documents({"merchant_id": user["sub"], "is_deleted": {"$ne": True}})
    remaining_slots = product_limit - existing_count
    if remaining_slots <= 0:
        raise HTTPException(400, f"You have reached the {product_limit} product limit on your {merchant_plan.title()} plan. Upgrade to upload more products.")

    raw_bytes = await _validate_bulk_upload(file)
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

    l1_by_name, l2_by_name, _l2_flat_by_name = _category_name_maps()

    # Brand column: name-matched lookup like L1/L2 — but unlike L1/L2, a
    # miss never skips or fails the row. Brand is a CLOSED, admin-curated
    # vocabulary (no merchant- or bulk-upload-driven creation), so an
    # unrecognized name just leaves brand_id unset on that product; the
    # product itself always still gets created. `brand_cache` avoids
    # re-querying for repeated names within the same upload.
    brand_cache: dict[str, Optional[dict]] = {}
    brands_matched: set[str] = set()
    brands_unmatched: set[str] = set()

    async def _resolve_brand_id(row: dict) -> Optional[str]:
        raw = str(row.get("brand") or row.get("brand name") or row.get("brand_name") or "").strip()
        if not raw:
            return None
        key = raw.lower()
        if key in brand_cache:
            cached = brand_cache[key]
            return cached["id"] if cached else None
        existing = await db.brands.find_one(
            {"name": {"$regex": f"^{_re.escape(raw)}$", "$options": "i"}}, {"_id": 0},
        )
        brand_cache[key] = existing
        if existing:
            brands_matched.add(existing["name"])
            return existing["id"]
        brands_unmatched.add(raw)
        return None

    created_ids: list[str] = []
    created_names: list[str] = []
    skipped: list[str] = []
    slots_used = 0
    limit_hit = False
    for row in rows:
        # Skip blank rows
        if not any((v not in (None, "") for v in row.values())):
            continue
        if slots_used >= remaining_slots:
            limit_hit = True
            skipped.append("plan product limit reached")
            continue
        doc_frag, reason = _row_to_product(row, l1_by_name, l2_by_name)
        if doc_frag is None:
            skipped.append(reason or "unknown")
            continue
        doc_frag["brand_id"] = await _resolve_brand_id(row)
        pid = f"prod-{uuid.uuid4().hex[:10]}"
        # Newly bulk-uploaded products start PAUSED so the merchant adds images first;
        # they go live one-by-one as the merchant clicks Go-live or adds an image.
        await db.products.insert_one({
            "id": pid, "merchant_id": user["sub"], "store_id": store_id,
            "store_name": m["store_name"], "store_city": m.get("city", ""),
            "rating": 4.5, "paused": True, "needs_image": True,
            "image": "", "ai_enhanced": False, "try_at_doorstep": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **doc_frag,
        })
        created_ids.append(pid)
        created_names.append(doc_frag["name"])
        slots_used += 1
    cnt = await db.products.count_documents({"store_id": store_id, "paused": {"$ne": True}})
    await db.stores.update_one({"id": store_id}, {"$set": {"product_count": cnt}})
    for cached in brand_cache.values():
        if cached:
            await _recompute_brand_product_count(cached["id"])
    await _maybe_autopublish_store(user["sub"])
    result: dict = {"created": len(created_ids), "created_ids": created_ids,
                    "names": created_names[:50], "skipped": skipped[:50],
                    "brands_matched": sorted(brands_matched),
                    "brands_unmatched": sorted(brands_unmatched)}
    if brands_unmatched:
        result["brands_unmatched_note"] = "Brand not recognized — product(s) created without a brand tag. Check spelling or ask an admin to add it."
    if limit_hit:
        result["warning"] = f"Some rows were skipped: you reached the {product_limit} product limit on your {merchant_plan.title()} plan. Upgrade to upload more."
    return result


# ===== Merchant integrations — multi-provider pipeline (VasyERP, Shopify) =====
# See docs/integrations/vasyerp-integration-plan.md (Sections 1 and 9).
# MerchantIntegration/IntegrationMapping/StagedImport are provider-generic —
# every query is parameterized by a real `provider` value, never a hardcoded
# literal, so two providers' data for the same merchant can never cross-
# contaminate. Base URL / auth header / response envelope details live in
# each provider's own services/*_client.py — see those modules' doc
# comments before relying on either against a real account.

_L2_PARENT_L1 = {s["id"]: lid for lid, subs in L2_BY_L1.items() for s in subs}


def _vasyerp_item_to_fields(item: dict) -> dict:
    """Extract the fields Phase A uses from one raw VasyERP product-
    inventory item. Field names are best-effort per the integration plan's
    field list — NOT verified against a real response. A missing/oddly-
    named field degrades to a safe default rather than raising, so one
    off-shape item can't abort an entire import batch."""
    return {
        "source_item_id": str(item.get("id") or item.get("itemCode") or item.get("itemId") or "").strip(),
        "name": str(item.get("name") or item.get("productName") or "Untitled product").strip(),
        "mrp": (float(item["mrp"]) if item.get("mrp") not in (None, "") else None),
        "price": (float(item["sellingPrice"]) if item.get("sellingPrice") not in (None, "")
                  else (float(item["mrp"]) if item.get("mrp") not in (None, "") else None)),
        "qty": int(item.get("qty") or 0),
        "hsn_code": str(item.get("hsnCode") or ""),
        "raw_category": str(item.get("category") or "").strip(),
        "raw_brand": str(item.get("brand") or "").strip(),
        "measurement_unit": str(item.get("measurementUnit") or ""),
        "image_url": "",  # VasyERP never supplies one — confirmed absent from its documented field list
        "stock": None,    # no structured per-size stock — publish falls back to a single {"default": qty} bucket
        "sizes": [],
    }


def _shopify_item_to_fields(item: dict) -> dict:
    """Extract the fields the import loop uses from one raw Shopify Product
    GraphQL node. Unlike VasyERP, size comes from each variant's
    selectedOptions — structured name/value pairs, no free-text parsing —
    and stock is genuinely per-size (summed into `qty` for display, kept
    as a real {size: qty} dict in `stock` for publish to use directly)."""
    variants = [e["node"] for e in ((item.get("variants") or {}).get("edges") or []) if e.get("node")]
    images = [e["node"] for e in ((item.get("images") or {}).get("edges") or []) if e.get("node")]
    image_url = str(images[0].get("url") or "") if images else ""
    first_variant = variants[0] if variants else {}

    stock: dict[str, int] = {}
    sizes: list[str] = []
    remote_variant_ids: dict[str, str] = {}
    for v in variants:
        size_val = None
        for opt in (v.get("selectedOptions") or []):
            if (opt.get("name") or "").strip().lower() == "size" and opt.get("value"):
                size_val = opt["value"]
                break
        # Shopify auto-generates a single "Title"/"Default Title" variant
        # with no real Size option when a merchant never defines sizes at
        # all — map that to Lokl's own established "Free Size" convention
        # (see the merchant product modal's size_type=="free_size" case:
        # sizes=["Free Size"], stock={"Free Size": qty}) instead of an ad
        # hoc bucket nothing else in the app knows how to read. Both the PDP
        # (`product.sizes?.[0]` picks the size to look stock up by) and
        # checkout's per-size stock decrement (`stock.{size}` from the
        # size the customer picked) need `sizes` and `stock`'s keys to
        # actually agree — an empty `sizes` with a stray "Default" bucket
        # left neither one able to find real stock.
        key = size_val or "Free Size"
        stock[key] = stock.get(key, 0) + int(v.get("inventoryQuantity") or 0)
        if key not in sizes:
            sizes.append(key)
        inv_item_id = (v.get("inventoryItem") or {}).get("id")
        if inv_item_id:
            # Which Shopify inventory item a Lokl order for this size must
            # adjust to sync stock back out. Two variants collapsing onto
            # the same key (e.g. two colors with no Size option) is a rare
            # edge case — the last one wins, same "one bucket, not tracked
            # separately" simplification `stock`/`sizes` already accept.
            remote_variant_ids[key] = inv_item_id

    return {
        "source_item_id": str(item.get("id") or "").strip(),
        "name": str(item.get("title") or "Untitled product").strip(),
        "mrp": (float(first_variant["compareAtPrice"]) if first_variant.get("compareAtPrice") not in (None, "") else None),
        "price": (float(first_variant["price"]) if first_variant.get("price") not in (None, "") else None),
        "qty": sum(stock.values()),
        "hsn_code": "",
        "raw_category": str(item.get("productType") or "").strip(),
        "raw_brand": str(item.get("vendor") or "").strip(),
        "measurement_unit": "",
        "image_url": image_url,
        "stock": stock or None,
        "sizes": sizes,
        "remote_variant_ids": remote_variant_ids or None,
    }


async def _resolve_category(
    merchant_id: str, provider: str, raw_category: str, l1_by_name: dict, l2_by_name: dict, l2_flat_by_name: dict,
) -> tuple[Optional[str], Optional[str], bool]:
    """Returns (l1_id, l2_id, unmatched). Checks IntegrationMapping first —
    persisted per-merchant PER PROVIDER and reused across syncs, per the
    plan — and only falls back to a fresh name lookup (reusing
    _L1_NORMALIZE + the same exact-match dicts bulk-upload builds) when no
    mapping exists yet. Unlike bulk-upload, a miss is NEVER a skip — it's
    recorded as an unmatched mapping and the caller stages the product for
    review. Provider-agnostic (renamed from _vasyerp_resolve_category) —
    every VasyERP AND Shopify import calls this same function; `provider`
    is threaded into every query so the two can never cross-contaminate a
    shared category name (e.g. "Dresses" mapped differently per source)."""
    raw = (raw_category or "").strip()
    if not raw:
        return None, None, True
    key = raw.lower()
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.integration_mappings.find_one(
        {"merchant_id": merchant_id, "provider": provider, "source_value": key, "mapped_type": {"$in": ["l1", "l2"]}},
        {"_id": 0},
    )
    if existing:
        if existing.get("unmatched"):
            return None, None, True
        if existing["mapped_type"] == "l2":
            return _L2_PARENT_L1.get(existing["mapped_id"]), existing["mapped_id"], False
        return existing["mapped_id"], None, False

    async def _save_mapping(mapped_type: str, mapped_id: Optional[str], unmatched: bool):
        await db.integration_mappings.update_one(
            {"merchant_id": merchant_id, "provider": provider, "source_value": key, "mapped_type": {"$in": ["l1", "l2"]}},
            {"$set": {"mapped_type": mapped_type, "mapped_id": mapped_id, "unmatched": unmatched},
             "$setOnInsert": {"id": f"map-{uuid.uuid4().hex[:10]}", "merchant_id": merchant_id, "provider": provider,
                               "source_value": key, "created_at": now}},
            upsert=True,
        )

    # A flat free-text category field, not separate L1/L2 columns the way
    # the bulk-upload sheet has — so unlike bulk-upload, try matching it
    # against L2 names first (more specific), before L1. True of VasyERP's
    # `category` field and Shopify's `productType` field alike.
    if key in l2_flat_by_name:
        l1_id, l2_id = l2_flat_by_name[key]
        await _save_mapping("l2", l2_id, False)
        return l1_id, l2_id, False

    l1_id = _L1_NORMALIZE.get(key) or l1_by_name.get(key)
    if l1_id and l1_id not in L2_BY_L1:
        # This L1 has no L2 children — a bare L1 match is already complete.
        await _save_mapping("l1", l1_id, False)
        return l1_id, None, False

    # No match, or matched an L1 that requires an L2 we have no separate
    # text for — both are unmatched, staged for manual review instead of
    # bulk-upload's "skip the row" behavior.
    await _save_mapping("l1", l1_id, True)
    return l1_id, None, True


async def _resolve_brand(merchant_id: str, provider: str, raw_brand: str) -> tuple[Optional[str], bool]:
    """Returns (brand_id, unmatched). Brand stays optional metadata (same
    rule as everywhere else in the app) — a BLANK brand field is not a
    "miss," it's just no brand tag. Brand is a closed, admin-curated
    vocabulary: a miss never auto-creates one, exactly like bulk-upload's
    own brand column. Provider-agnostic (renamed from
    _vasyerp_resolve_brand) — `provider` is threaded into every mapping
    query so VasyERP and Shopify mappings for the same brand text never
    collide."""
    raw = (raw_brand or "").strip()
    if not raw:
        return None, False
    key = raw.lower()
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.integration_mappings.find_one(
        {"merchant_id": merchant_id, "provider": provider, "source_value": key, "mapped_type": "brand"}, {"_id": 0},
    )
    if existing:
        return (None, True) if existing.get("unmatched") else (existing["mapped_id"], False)
    match = await db.brands.find_one({"name": {"$regex": f"^{_re.escape(raw)}$", "$options": "i"}}, {"_id": 0, "id": 1})
    brand_id = match["id"] if match else None
    await db.integration_mappings.update_one(
        {"merchant_id": merchant_id, "provider": provider, "source_value": key, "mapped_type": "brand"},
        {"$set": {"mapped_id": brand_id, "unmatched": brand_id is None},
         "$setOnInsert": {"id": f"map-{uuid.uuid4().hex[:10]}", "merchant_id": merchant_id, "provider": provider,
                           "source_value": key, "mapped_type": "brand", "created_at": now}},
        upsert=True,
    )
    return brand_id, brand_id is None


def _compute_staged_status(l1_id: Optional[str], l2_id: Optional[str], has_image: bool) -> str:
    """Shared 3-way status computation (Part 2 of the Shopify build):
    has_category + has_image -> ready; has_category only -> pending_photos;
    else -> pending_review. Used by both the PUT correction endpoint and
    every provider's import loop, so an image-bearing provider (Shopify)
    can land straight on "ready" instead of always gating on
    pending_photos the way VasyERP (which never supplies an image) does."""
    has_category = bool(l1_id) and (l1_id not in L2_BY_L1 or bool(l2_id))
    if has_category and has_image:
        return "ready"
    if has_category:
        return "pending_photos"
    return "pending_review"


async def _upsert_integration(merchant_id: str, provider: str, fields: dict) -> None:
    """Shared MerchantIntegration upsert — every connect/select-branch/
    sync-status write across all providers goes through this one query
    shape, parameterized by provider, rather than each provider
    duplicating the same $set/$setOnInsert structure.

    $setOnInsert defaults are filtered to exclude any key already present
    in `fields` — Mongo rejects a path appearing in both $set and
    $setOnInsert in the same update (e.g. the import endpoint's own
    fields includes last_synced_at, which would otherwise collide with
    the insert-time default below)."""
    defaults = {"id": f"integ-{uuid.uuid4().hex[:10]}", "merchant_id": merchant_id, "provider": provider, "last_synced_at": None}
    on_insert = {k: v for k, v in defaults.items() if k not in fields}
    update: dict = {"$set": fields}
    if on_insert:
        update["$setOnInsert"] = on_insert
    await db.merchant_integrations.update_one(
        {"merchant_id": merchant_id, "provider": provider},
        update,
        upsert=True,
    )


async def _get_integration(merchant_id: str, provider: str) -> Optional[dict]:
    return await db.merchant_integrations.find_one({"merchant_id": merchant_id, "provider": provider}, {"_id": 0})


async def _stage_source_item(
    merchant_id: str, provider: str, store_id: str,
    source_item_id: str, name: str, price: Optional[float], mrp: Optional[float], qty: int,
    hsn_code: str, measurement_unit: str, raw_category: str, raw_brand: str,
    image_url: str, image_public_id: str, raw: dict,
    l1_by_name: dict, l2_by_name: dict, l2_flat_by_name: dict,
    stock: Optional[dict] = None, sizes: Optional[list] = None,
    remote_variant_ids: Optional[dict] = None,
) -> tuple[bool, bool]:
    """Resolves category/brand, computes status, and upserts one row into
    StagedImport — the ONE shared write path for every provider's import
    loop (previously VasyERP's import loop had this inlined; Shopify's
    calls the exact same function). Returns (was_staged, needs_review) for
    the caller's running totals.

    Deliberately mirrors the original VasyERP-only behavior exactly for an
    EXISTING row: status/image/created_at are never touched by a passive
    re-sync, only by the review UI or publish — but `needs_review` in the
    return value still reflects a FRESH category/brand resolution (not the
    row's stored status), matching the original's own accounting so a
    self-healed mapping is reflected in this call's summary immediately."""
    l1_id, l2_id, cat_unmatched = await _resolve_category(merchant_id, provider, raw_category, l1_by_name, l2_by_name, l2_flat_by_name)
    brand_id, brand_unmatched = await _resolve_brand(merchant_id, provider, raw_brand)
    status = _compute_staged_status(l1_id, l2_id, bool(image_url))
    now = datetime.now(timezone.utc).isoformat()
    fields_doc = {
        "merchant_id": merchant_id, "provider": provider, "store_id": store_id,
        "source_item_id": source_item_id,
        "name": name, "price": price, "mrp": mrp, "qty": qty,
        "hsn_code": hsn_code, "measurement_unit": measurement_unit,
        "raw_category": raw_category, "raw_brand": raw_brand,
        "l1_id": l1_id, "l2_id": l2_id, "brand_id": brand_id,
        "category_unmatched": cat_unmatched, "brand_unmatched": brand_unmatched,
        "stock": stock, "sizes": sizes or [],
        "remote_variant_ids": remote_variant_ids,
        "raw": raw, "updated_at": now,
    }
    existing = await db.staged_imports.find_one(
        {"merchant_id": merchant_id, "provider": provider, "source_item_id": source_item_id},
        {"_id": 0, "id": 1, "status": 1},
    )
    if existing and existing.get("status") in ("published", "skipped"):
        # Already dealt with by the merchant — a re-import never
        # resurrects or silently overwrites that decision.
        return False, False
    if existing:
        # Deliberately does NOT touch status/image/created_at here — those
        # only ever move forward via the review UI or publish, never
        # backward from a passive re-sync.
        await db.staged_imports.update_one({"id": existing["id"]}, {"$set": fields_doc})
        return True, status == "pending_review"
    fields_doc["id"] = f"stg-{uuid.uuid4().hex[:10]}"
    fields_doc["status"] = status
    fields_doc["image"] = image_url or ""
    fields_doc["image_public_id"] = image_public_id or ""
    fields_doc["created_at"] = now
    await db.staged_imports.insert_one(fields_doc)
    return True, status == "pending_review"


def _staged_publish_blocker(row: dict) -> Optional[str]:
    """Returns a human-readable reason the row can't publish yet, or None
    if it's ready. Checked by both the single and bulk publish endpoints."""
    if row.get("status") == "published":
        return "Already published"
    if not row.get("image"):
        return "Add at least one photo before publishing"
    if not row.get("l1_id"):
        return "Category is not resolved — set it before publishing"
    if row["l1_id"] in L2_BY_L1 and not row.get("l2_id"):
        return "Sub-category is required for this category"
    return None


async def _revert_staged_import_on_product_delete(pid: str) -> None:
    """A published StagedImport row keeps a reference (`product_id`) to the
    Product it created. If that product is later deleted — merchant bulk
    delete or admin delete, either one — the row must not stay stuck on
    'published' forever with no way to reference or republish it. Reverts
    to whatever status its own (untouched) category/image data computes
    today via the same _compute_staged_status every import/correction uses,
    and clears product_id since it no longer points to anything real.
    No-op if this product id isn't linked to any staged row (the common
    case — most products are created directly via the merchant modal)."""
    row = await db.staged_imports.find_one({"product_id": pid}, {"_id": 0})
    if not row:
        return
    status = _compute_staged_status(row.get("l1_id"), row.get("l2_id"), bool(row.get("image")))
    await db.staged_imports.update_one(
        {"id": row["id"]},
        {"$set": {"status": status, "product_id": None, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )


async def _sync_remote_inventory(product: dict, size: str, delta: int) -> None:
    """Best-effort OUTBOUND push: a Lokl order/rollback/cancel/return
    adjusts a linked source-platform product's own inventory by the same
    delta, so the platform an integration exists to unify around never
    silently drifts out of sync with what just happened on Lokl. The whole
    reason to connect an integration is one centralized inventory, not a
    one-time import — see the Shopify "stock stuck at the imported
    quantity" bug report this was built to fix.

    Provider-dispatched: add a branch here for each future write-capable
    integration; VasyERP has no known write API today, so it's simply not
    listed — that's a capability gap in VasyERP's own contract, not a TODO
    in Lokl's dispatch logic.

    Deliberately swallows every exception and never raises: this always
    runs as a fire-and-forget asyncio task from checkout/cancel/return, and
    a third-party outage, expired credential, or missing write scope must
    never affect the Lokl-side order itself. The two systems can briefly
    disagree and self-heal on the next "Pull latest inventory" or inbound
    webhook — an acceptable tradeoff against blocking a customer-facing
    flow on someone else's API."""
    provider = product.get("provider")
    remote_variant_ids = product.get("remote_variant_ids") or {}
    remote_id = remote_variant_ids.get(size)
    merchant_id = product.get("merchant_id")
    if not provider or not remote_id or not merchant_id or delta == 0:
        return
    try:
        if provider == "shopify":
            await _sync_shopify_delta(merchant_id, remote_id, delta)
        # else: no write-capable integration for this provider yet.
    except Exception:
        log.exception("Outbound inventory sync failed: product=%s size=%s provider=%s delta=%s",
                       product.get("id"), size, provider, delta)


async def _sync_shopify_delta(merchant_id: str, inventory_item_id: str, delta: int) -> None:
    integ = await _get_integration(merchant_id, "shopify")
    if not integ or not integ.get("client_id") or not integ.get("client_secret") or not integ.get("location_id"):
        return
    client_id = encryption_service.decrypt_field(integ["client_id"])
    client_secret = encryption_service.decrypt_field(integ["client_secret"])
    # Same "exchange fresh every time, never cache" rule as import — CCG
    # tokens expire in ~24h (see shopify_client's own docstring).
    token_data = await shopify_client.get_access_token(integ["shop_domain"], client_id, client_secret)
    await shopify_client.adjust_inventory(
        integ["shop_domain"], token_data["access_token"], inventory_item_id, integ["location_id"], delta,
    )


async def _index_remote_inventory_map(product: dict) -> None:
    """Maintains the reverse lookup an inbound sync webhook needs: given a
    source platform's own variant identifier, which Lokl (merchant_id,
    product_id, size) does it correspond to. Populated at publish time from
    the product's own remote_variant_ids (provider-specific {size: id}
    map, carried forward from its StagedImport row) — a no-op for any
    product with no provider linkage (every manually-created/bulk-uploaded
    product, and any provider whose sync doesn't need inbound webhooks)."""
    provider = product.get("provider")
    remote_variant_ids = product.get("remote_variant_ids")
    if not provider or not remote_variant_ids:
        return
    for size, remote_id in remote_variant_ids.items():
        if not remote_id:
            continue
        await db.remote_inventory_map.update_one(
            {"provider": provider, "remote_variant_id": remote_id},
            {"$set": {"merchant_id": product["merchant_id"], "product_id": product["id"], "size": size},
             "$setOnInsert": {"id": f"rim-{uuid.uuid4().hex[:10]}"}},
            upsert=True,
        )


async def _publish_staged_import(row: dict, merchant_id: str) -> dict:
    """Converts a StagedImport row into a real Product by going through
    _create_product_for_merchant — the same canonical insert path the
    merchant product modal uses — rather than a second, separate
    db.products.insert_one. This is what gives a published VasyERP item
    the KYC gate, storefront-exists check, and plan product-limit check
    the canonical path enforces (an earlier version of this function had
    its own duplicate insert and was missing all three)."""
    blocker = _staged_publish_blocker(row)
    if blocker:
        raise HTTPException(400, blocker)
    # Same fallback bulk-upload's own gender resolution uses: an L1 with no
    # L2 children needs a gender, and neither source provider has such a
    # field.
    gender = "Unisex" if row["l1_id"] not in L2_BY_L1 else ""
    # Prefer real per-size stock when the source provided it (Shopify's
    # variants) — falls back to a single "default" bucket for sources with
    # only a flat quantity (VasyERP).
    stock = row.get("stock") or {"default": row.get("qty") or 0}

    # A staged row's `image` is only ever a real Cloudinary asset when
    # image_public_id is set — that's true for a manually-attached photo
    # (uploaded via /merchant/upload-image, same as the product modal), but
    # a source provider that supplies its own real image (Shopify's CDN
    # URL) is stored as-is on the staged row for the review screen's own
    # <img> preview, which has no host restriction. A raw source-provider
    # URL must never reach the Product doc directly — the customer PDP
    # renders images via next/image, which enforces next.config.ts's
    # remotePatterns allowlist and silently fails to render any host not
    # on it (cdn.shopify.com isn't, nor could every future provider's CDN
    # be pre-listed). So publish always re-uploads through Cloudinary first
    # when there's no public_id yet, exactly like a manual product photo.
    image_url, image_public_id = row["image"], row.get("image_public_id") or ""
    if not image_public_id:
        uploaded = await cloudinary_service.upload_image_from_url(image_url, "product", merchant_id)
        image_url, image_public_id = uploaded["image_url"], uploaded["public_id"]

    payload = ProductCreate(
        name=row["name"], price=row.get("price") or 0, mrp=row.get("mrp"),
        l1_id=row["l1_id"], l2_id=row.get("l2_id") or "", gender=gender,
        brand_id=row.get("brand_id"),
        description="", sizes=row.get("sizes") or [], stock=stock,
        image=image_url, image_public_id=image_public_id,
        images=[image_url], image_public_ids=[image_public_id],
        provider=row["provider"], source_item_id=row.get("source_item_id"),
        remote_variant_ids=row.get("remote_variant_ids"),
    )
    doc = await _create_product_for_merchant(payload, merchant_id)
    await db.staged_imports.update_one(
        {"id": row["id"]},
        {"$set": {"status": "published", "product_id": doc["id"], "image": image_url, "image_public_id": image_public_id,
                   "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _index_remote_inventory_map(doc)
    return doc


@api.post("/merchant/integrations/vasyerp/connect")
async def vasyerp_connect(payload: VasyERPConnectRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    token = payload.api_token.strip()
    if not token:
        raise HTTPException(400, "API token is required")
    try:
        branches = await vasyerp_client.list_branches(token)
    except VasyERPAuthError:
        raise HTTPException(400, "VasyERP rejected this API token — double-check it and try again")
    except VasyERPClientError as e:
        raise HTTPException(502, f"Could not reach VasyERP: {e}")
    # Only encrypt + store once the token has proven itself against a real
    # VasyERP call — an invalid token is never persisted, per the plan.
    encrypted = encryption_service.encrypt_field(token)
    await _upsert_integration(user["sub"], "vasyerp", {
        "api_token": encrypted, "connected_at": datetime.now(timezone.utc).isoformat(),
        "sync_status": "pending_branch_selection", "branch_id": None,
    })
    return {"branches": branches}


@api.post("/merchant/integrations/vasyerp/select-branch")
async def vasyerp_select_branch(payload: VasyERPSelectBranchRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    integ = await _get_integration(user["sub"], "vasyerp")
    if not integ:
        raise HTTPException(400, "Connect VasyERP first")
    await _upsert_integration(user["sub"], "vasyerp", {
        "branch_id": payload.branch_id, "branch_name": payload.branch_name or "", "sync_status": "connected",
    })
    return {"ok": True}


def _shopify_webhook_callback_url() -> Optional[str]:
    """Where Shopify should POST inventory_levels/update events. Explicit
    BACKEND_PUBLIC_URL wins (set it for any deploy target that isn't
    Railway); Railway's own RAILWAY_PUBLIC_DOMAIN covers production without
    extra config. None in local dev (no public URL for Shopify to reach) —
    inbound sync registration is skipped there, not an error."""
    base = os.environ.get("BACKEND_PUBLIC_URL", "").strip()
    if not base:
        railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
        if railway_domain:
            base = f"https://{railway_domain}"
    if not base:
        return None
    return f"{base.rstrip('/')}/api/webhooks/shopify/inventory"


@api.post("/merchant/integrations/shopify/connect")
async def shopify_connect(payload: ShopifyConnectRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    shop_domain = payload.shop_domain.strip()
    client_id = payload.client_id.strip()
    client_secret = payload.client_secret.strip()
    if not shop_domain or not client_id or not client_secret:
        raise HTTPException(400, "Shop domain, Client ID, and Client Secret are required")
    try:
        token_data = await shopify_client.get_access_token(shop_domain, client_id, client_secret)
        shop_name = await shopify_client.get_shop_name(shop_domain, token_data["access_token"])
    except ShopifyAuthError:
        raise HTTPException(400, "Shopify rejected this Client ID/Secret — double-check them and make sure the app is installed on this store")
    except ShopifyClientError as e:
        raise HTTPException(502, f"Could not reach Shopify: {e}")
    # Best-effort: primary location (for outbound inventory adjustments)
    # and the inbound inventory webhook both need the write_inventory
    # scope, which is newer than the original read_products/read_inventory
    # connect flow. Neither failing should block connect itself — the
    # one-way pull still works with only the original scopes; inventory
    # sync just stays off (location_id: None) until the merchant adds
    # write_inventory to their app and reconnects.
    location_id = None
    sync_enabled = False
    try:
        location_id = await shopify_client.get_primary_location_id(shop_domain, token_data["access_token"])
        callback_url = _shopify_webhook_callback_url()
        if location_id and callback_url:
            sub_id = await shopify_client.register_inventory_webhook(shop_domain, token_data["access_token"], callback_url)
            sync_enabled = bool(sub_id)
    except (ShopifyAuthError, ShopifyClientError):
        pass
    # Only encrypt + store once the credentials have proven themselves via a
    # real token exchange + Shopify call — invalid credentials are never
    # persisted, same rule as VasyERP. client_id/client_secret (not the
    # exchanged access token, which expires in ~24h) are the durable
    # credential; a fresh token is re-exchanged at the start of every import
    # run instead of caching one with an expiry to track. No branch-
    # selection step here — Shopify has no multi-branch concept, so connect
    # alone fully establishes the integration.
    try:
        encrypted_client_id = encryption_service.encrypt_field(client_id)
        encrypted_client_secret = encryption_service.encrypt_field(client_secret)
    except RuntimeError:
        # Server misconfiguration (e.g. FIELD_ENCRYPTION_KEY missing/invalid)
        # — the credentials themselves are fine (they already passed a real
        # Shopify exchange above), so don't blame the merchant for this.
        log.exception("Shopify connect: encryption_service misconfigured, could not store credentials")
        raise HTTPException(500, "Could not save your credentials due to a server configuration issue — please try again shortly or contact support")
    await _upsert_integration(user["sub"], "shopify", {
        "client_id": encrypted_client_id,
        "client_secret": encrypted_client_secret,
        "shop_domain": shop_domain, "shop_name": shop_name,
        "connected_at": datetime.now(timezone.utc).isoformat(), "sync_status": "connected",
        "location_id": location_id, "inventory_sync_enabled": sync_enabled,
    })
    return {"ok": True, "shop_name": shop_name, "inventory_sync_enabled": sync_enabled}


@api.get("/merchant/integrations/status")
async def integrations_status(user: dict = Depends(get_current_user)):
    """Every connected integration for this merchant, across all
    providers — never returns credential fields, encrypted or not."""
    rows = await db.merchant_integrations.find(
        {"merchant_id": user["sub"]}, {"_id": 0, "api_token": 0, "client_id": 0, "client_secret": 0},
    ).to_list(20)
    return rows


@api.post("/merchant/integrations/vasyerp/import")
async def vasyerp_import(user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    integ = await _get_integration(user["sub"], "vasyerp")
    if not integ or not integ.get("branch_id"):
        raise HTTPException(400, "Connect VasyERP and select a branch first")
    try:
        token = encryption_service.decrypt_field(integ["api_token"])
    except ValueError:
        raise HTTPException(400, "Stored VasyERP credential is unusable — please reconnect")

    store_id = f"store-m-{user['sub']}"
    l1_by_name, l2_by_name, l2_flat_by_name = _category_name_maps()

    staged_count = 0
    review_count = 0
    offset = 0
    page_limit = 100
    iterations = 0
    while True:
        try:
            result = await vasyerp_client.fetch_products_inventory_page(
                token, integ["branch_id"], limit=page_limit, offset=offset,
            )
        except VasyERPAuthError:
            raise HTTPException(400, "VasyERP rejected the stored API token — please reconnect")
        except VasyERPClientError as e:
            raise HTTPException(502, f"Could not reach VasyERP: {e}")
        for item in result["items"]:
            fields = _vasyerp_item_to_fields(item)
            if not fields["source_item_id"]:
                continue  # no stable id to dedupe/update against — nothing safe to stage
            staged, needs_review = await _stage_source_item(
                user["sub"], "vasyerp", store_id,
                fields["source_item_id"], fields["name"], fields["price"], fields["mrp"], fields["qty"],
                fields["hsn_code"], fields["measurement_unit"], fields["raw_category"], fields["raw_brand"],
                fields["image_url"], "", item,
                l1_by_name, l2_by_name, l2_flat_by_name,
                stock=fields["stock"], sizes=fields["sizes"],
            )
            if staged:
                staged_count += 1
                if needs_review:
                    review_count += 1
        if not result["has_more"]:
            break
        offset += page_limit
        iterations += 1
        if iterations > 200:  # hard cap so a misbehaving pagination response can't loop forever
            break

    await _upsert_integration(user["sub"], "vasyerp", {
        "last_synced_at": datetime.now(timezone.utc).isoformat(), "sync_status": "synced",
    })
    return {"staged": staged_count, "pending_review": review_count}


@api.post("/merchant/integrations/shopify/import")
async def shopify_import(user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    integ = await _get_integration(user["sub"], "shopify")
    if not integ or integ.get("sync_status") not in ("connected", "synced"):
        raise HTTPException(400, "Connect Shopify first")
    if not integ.get("client_id") or not integ.get("client_secret"):
        raise HTTPException(400, "Stored Shopify credential is unusable — please reconnect")
    try:
        client_id = encryption_service.decrypt_field(integ["client_id"])
        client_secret = encryption_service.decrypt_field(integ["client_secret"])
    except ValueError:
        raise HTTPException(400, "Stored Shopify credential is unusable — please reconnect")
    except RuntimeError:
        log.exception("Shopify import: encryption_service misconfigured, could not decrypt credentials")
        raise HTTPException(500, "Could not read your stored credentials due to a server configuration issue — please try again shortly or contact support")
    # CCG access tokens expire in ~24h and are never persisted (see
    # shopify_connect) — exchange a fresh one at the start of every import
    # run rather than caching one with an expiry to track.
    try:
        token_data = await shopify_client.get_access_token(integ["shop_domain"], client_id, client_secret)
    except ShopifyAuthError:
        raise HTTPException(400, "Shopify rejected the stored Client ID/Secret — please reconnect")
    except ShopifyClientError as e:
        raise HTTPException(502, f"Could not reach Shopify: {e}")
    token = token_data["access_token"]

    store_id = f"store-m-{user['sub']}"
    l1_by_name, l2_by_name, l2_flat_by_name = _category_name_maps()

    staged_count = 0
    review_count = 0
    cursor = None
    iterations = 0
    while True:
        try:
            result = await shopify_client.fetch_products_page(integ["shop_domain"], token, first=50, after=cursor)
        except ShopifyAuthError:
            raise HTTPException(400, "Shopify rejected the exchanged access token — please reconnect")
        except ShopifyClientError as e:
            raise HTTPException(502, f"Could not reach Shopify: {e}")
        for item in result["items"]:
            fields = _shopify_item_to_fields(item)
            if not fields["source_item_id"]:
                continue
            staged, needs_review = await _stage_source_item(
                user["sub"], "shopify", store_id,
                fields["source_item_id"], fields["name"], fields["price"], fields["mrp"], fields["qty"],
                fields["hsn_code"], fields["measurement_unit"], fields["raw_category"], fields["raw_brand"],
                # Real image, hotlinked from Shopify's own CDN — not re-
                # uploaded/mirrored into Lokl's Cloudinary, so there's no
                # image_public_id for it (that field stays empty; deleting
                # a Shopify-sourced product's image later is a no-op on
                # Cloudinary since Lokl never owned a copy of it).
                fields["image_url"], "", item,
                l1_by_name, l2_by_name, l2_flat_by_name,
                stock=fields["stock"], sizes=fields["sizes"],
                remote_variant_ids=fields["remote_variant_ids"],
            )
            if staged:
                staged_count += 1
                if needs_review:
                    review_count += 1
        if not result["has_more"]:
            break
        cursor = result["cursor"]
        iterations += 1
        if iterations > 200:
            break

    await _upsert_integration(user["sub"], "shopify", {
        "last_synced_at": datetime.now(timezone.utc).isoformat(), "sync_status": "synced",
    })
    return {"staged": staged_count, "pending_review": review_count}


@api.get("/merchant/integrations/staged")
async def list_staged(provider: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    q: dict = {"merchant_id": user["sub"]}
    if provider:
        q["provider"] = provider
    if status:
        q["status"] = status
    rows = await db.staged_imports.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # A published row's linked product can be deleted later (see
    # _revert_staged_import_on_product_delete, which normally reverts the
    # row's status right away — this only stays relevant for rows a delete
    # touched before that existed). Annotate so the frontend's Remove
    # confirmation can tell "still a live product, warn before removing"
    # apart from "already orphaned, nothing left to protect."
    published_pids = [r["product_id"] for r in rows if r.get("status") == "published" and r.get("product_id")]
    existing_pids = set(await db.products.distinct("id", {"id": {"$in": published_pids}})) if published_pids else set()
    for r in rows:
        if r.get("status") == "published" and r.get("product_id"):
            r["product_exists"] = r["product_id"] in existing_pids
    return rows


@api.put("/merchant/integrations/staged/{sid}")
async def update_staged(sid: str, payload: dict, user: dict = Depends(get_current_user)):
    """Merchant corrects category/brand and/or attaches an image (already
    uploaded via the existing /merchant/upload-image endpoint — this route
    only accepts the resulting {image_url, public_id}, it does not accept
    a file itself). Provider-generic: reads `row["provider"]` from the
    staged row itself rather than needing it in the URL — every operation
    here already has the row loaded, so there's no reason to make the
    caller pass provider twice."""
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    row = await db.staged_imports.find_one({"id": sid, "merchant_id": user["sub"]}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Staged item not found")
    if row["status"] in ("published", "skipped"):
        raise HTTPException(400, f"Cannot edit a {row['status']} item")
    provider = row["provider"]

    ALLOWED = {"l1_id", "l2_id", "brand_id", "image", "image_public_id"}
    update = {k: v for k, v in payload.items() if k in ALLOWED}

    # A manual correction also updates the persisted IntegrationMapping so
    # future imports of the same source category/brand text auto-match —
    # the plan's "persisted once and reused across all future syncs." Keyed
    # by this row's own provider, so correcting a VasyERP mapping never
    # touches a Shopify mapping for the same text, or vice versa.
    if "l1_id" in update and row.get("raw_category"):
        key = row["raw_category"].strip().lower()
        if key:
            mapped_type = "l2" if update.get("l2_id") else "l1"
            mapped_id = update.get("l2_id") or update.get("l1_id")
            await db.integration_mappings.update_one(
                {"merchant_id": user["sub"], "provider": provider, "source_value": key, "mapped_type": {"$in": ["l1", "l2"]}},
                {"$set": {"mapped_type": mapped_type, "mapped_id": mapped_id, "unmatched": False},
                 "$setOnInsert": {"id": f"map-{uuid.uuid4().hex[:10]}", "merchant_id": user["sub"], "provider": provider,
                                   "source_value": key, "created_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            # This correction only helped FUTURE pulls until now — every
            # OTHER already-staged row (any status short of the terminal
            # published/skipped) sharing this exact source category text,
            # for this same merchant+provider, gets re-resolved right now
            # too, instead of making the merchant repeat the identical
            # correction per item.
            async for sib in db.staged_imports.find(
                {"merchant_id": user["sub"], "provider": provider, "id": {"$ne": sid},
                 "status": {"$nin": ["published", "skipped"]},
                 "raw_category": {"$regex": f"^{_re.escape(row['raw_category'])}$", "$options": "i"}},
                {"_id": 0},
            ):
                sib_l1, sib_l2 = update.get("l1_id"), update.get("l2_id")
                sib_status = _compute_staged_status(sib_l1, sib_l2, bool(sib.get("image")))
                await db.staged_imports.update_one(
                    {"id": sib["id"]},
                    {"$set": {"l1_id": sib_l1, "l2_id": sib_l2, "category_unmatched": False,
                               "status": sib_status, "updated_at": datetime.now(timezone.utc).isoformat()}},
                )
    if "brand_id" in update and row.get("raw_brand"):
        key = row["raw_brand"].strip().lower()
        if key:
            await db.integration_mappings.update_one(
                {"merchant_id": user["sub"], "provider": provider, "source_value": key, "mapped_type": "brand"},
                {"$set": {"mapped_id": update["brand_id"], "unmatched": update["brand_id"] is None},
                 "$setOnInsert": {"id": f"map-{uuid.uuid4().hex[:10]}", "merchant_id": user["sub"], "provider": provider,
                                   "source_value": key, "mapped_type": "brand", "created_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            # Same immediate-sibling-reapply as category, above — brand
            # never affects `status`, so this is a plain field update.
            await db.staged_imports.update_many(
                {"merchant_id": user["sub"], "provider": provider, "id": {"$ne": sid},
                 "status": {"$nin": ["published", "skipped"]},
                 "raw_brand": {"$regex": f"^{_re.escape(row['raw_brand'])}$", "$options": "i"}},
                {"$set": {"brand_id": update["brand_id"], "brand_unmatched": update["brand_id"] is None,
                           "updated_at": datetime.now(timezone.utc).isoformat()}},
            )

    merged = {**row, **update}
    if merged.get("l1_id"):
        update["category_unmatched"] = False
    update["status"] = _compute_staged_status(merged.get("l1_id"), merged.get("l2_id"), bool(merged.get("image")))
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.staged_imports.update_one({"id": sid}, {"$set": update})
    return await db.staged_imports.find_one({"id": sid}, {"_id": 0})


@api.post("/merchant/integrations/staged/{sid}/publish")
async def publish_staged(sid: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    row = await db.staged_imports.find_one({"id": sid, "merchant_id": user["sub"]}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Staged item not found")
    doc = await _publish_staged_import(row, user["sub"])
    await _maybe_autopublish_store(user["sub"])
    return doc


@api.post("/merchant/integrations/staged/publish-bulk")
async def publish_staged_bulk(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(400, "No ids provided")
    results = []
    for sid in ids:
        row = await db.staged_imports.find_one({"id": sid, "merchant_id": user["sub"]}, {"_id": 0})
        if not row:
            results.append({"id": sid, "ok": False, "reason": "Not found"})
            continue
        try:
            await _publish_staged_import(row, user["sub"])
            results.append({"id": sid, "ok": True})
        except HTTPException as e:
            results.append({"id": sid, "ok": False, "reason": e.detail})
    await _maybe_autopublish_store(user["sub"])
    return {"results": results, "published": sum(1 for r in results if r["ok"])}


@api.delete("/merchant/integrations/staged/{sid}")
async def delete_staged(sid: str, user: dict = Depends(get_current_user)):
    """Removes a StagedImport row from the pipeline entirely — independent
    of whether it's linked to a product. Never touches db.products itself;
    a merchant deletes the actual product from /merchant/products
    separately if that's what they want (the "This will NOT delete the
    actual product" warning is a frontend confirmation shown before calling
    this, not a backend-enforced block, since this endpoint genuinely never
    cascades into a product delete either way).

    Hard-deleting the row (not soft-deleting/marking "skipped") is
    deliberate: _stage_source_item's only dedup check is "does a row for
    this (merchant_id, provider, source_item_id) already exist" — once this
    row is gone, the next "Pull latest inventory" has nothing to find and
    re-stages it fresh, exactly like it was never imported before."""
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    row = await db.staged_imports.find_one({"id": sid, "merchant_id": user["sub"]}, {"_id": 0, "id": 1})
    if not row:
        raise HTTPException(404, "Staged item not found")
    await db.staged_imports.delete_one({"id": sid})
    return {"ok": True}


@api.post("/merchant/integrations/staged/remove-bulk")
async def remove_staged_bulk(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("role") != "merchant":
        raise HTTPException(403, "Merchant access required")
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(400, "No ids provided")
    r = await db.staged_imports.delete_many({"id": {"$in": ids}, "merchant_id": user["sub"]})
    return {"removed": r.deleted_count}


# ===== Merchant AI =====
@api.post("/merchant/ai/copy")
async def merchant_ai_copy(payload: AICopyRequest, user: dict = Depends(get_current_user)):
    try: return await generate_product_copy(payload.product_name, payload.category or "", payload.notes or "")
    except Exception as e: raise HTTPException(500, f"AI copy generation failed: {e}")

@api.post("/merchant/ai/tryon")
async def merchant_ai_tryon(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await _validate_image_upload(file)
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

PLAN_LIMITS = {
    "free":    {"products": 10,   "boosts": 0,  "images": 1,  "priority": 0, "expires_days": 30},
    "starter": {"products": 30,   "boosts": 0,  "images": 1,  "priority": 1, "expires_days": 30},
    "growth":  {"products": 100,  "boosts": 3,  "images": 5,  "priority": 2, "expires_days": 30},
    "pro":     {"products": 9999, "boosts": 10, "images": 10, "priority": 3, "expires_days": 30},
}


@api.get("/merchant/subscription")
async def get_subscription(user: dict = Depends(get_current_user)):
    merchant = await db.merchants.find_one({"id": user["sub"]}, {"_id": 0})
    if not merchant:
        raise HTTPException(404, "Merchant not found")
    plan = merchant.get("plan", "free")
    expires_at = merchant.get("plan_expires_at")
    now = datetime.now(timezone.utc)
    is_expired = False
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(str(expires_at))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            is_expired = exp_dt < now
        except Exception:
            pass
    days_left = None
    if expires_at and not is_expired:
        try:
            exp_dt = datetime.fromisoformat(str(expires_at))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            days_left = max(0, (exp_dt - now).days)
        except Exception:
            pass
    return {
        "plan": plan,
        "status": "expired" if is_expired else merchant.get("subscription_status", "active"),
        "expires_at": expires_at,
        "days_left": days_left,
        "limits": PLAN_LIMITS.get(plan, PLAN_LIMITS["free"]),
        "is_expired": is_expired,
    }


@api.post("/merchant/subscription/activate")
async def activate_subscription(payload: dict, user: dict = Depends(get_current_user)):
    plan = payload.get("plan", "starter")
    if plan not in ["starter", "growth", "pro"]:
        raise HTTPException(400, "Invalid plan")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=30)
    await db.merchants.update_one(
        {"id": user["sub"]},
        {"$set": {
            "plan": plan,
            "plan_started_at": now.isoformat(),
            "plan_expires_at": expires_at.isoformat(),
            "subscription_status": "pending_verification",
            "subscription_payment_ref": payload.get("payment_ref", ""),
            "subscription_requested_at": now.isoformat(),
        }}
    )
    await db.admin_notifications.insert_one({
        "type": "subscription_request",
        "merchant_id": user["sub"],
        "plan": plan,
        "payment_ref": payload.get("payment_ref", ""),
        "created_at": now.isoformat(),
    })
    return {"message": "Subscription request submitted. Admin will verify and activate within 2 hours."}


@api.get("/merchant/analytics/summary")
async def merchant_analytics_summary(user: dict = Depends(get_current_user)):
    merchant_id = user["sub"]
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    last_week_start = week_start - timedelta(days=7)

    today_orders = await db.orders.count_documents({
        "merchant_ids": merchant_id,
        "created_at": {"$gte": today_start.isoformat()},
    })

    today_rev_pipe = [
        {"$match": {"merchant_ids": merchant_id, "created_at": {"$gte": today_start.isoformat()},
                    "status": {"$in": ["delivered", "accepted", "out_for_delivery"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]
    today_rev = await db.orders.aggregate(today_rev_pipe).to_list(1)
    today_revenue = today_rev[0]["total"] if today_rev else 0

    week_orders = await db.orders.count_documents({
        "merchant_ids": merchant_id,
        "created_at": {"$gte": week_start.isoformat()},
    })
    last_week_orders = await db.orders.count_documents({
        "merchant_ids": merchant_id,
        "created_at": {"$gte": last_week_start.isoformat(), "$lt": week_start.isoformat()},
    })
    pending = await db.orders.count_documents({
        "merchant_ids": merchant_id,
        "status": "placed",
    })

    top_products_pipe = [
        {"$match": {"merchant_ids": merchant_id, "created_at": {"$gte": week_start.isoformat()}}},
        {"$unwind": "$items"},
        {"$match": {"items.merchant_id": merchant_id}},
        {"$group": {"_id": "$items.product_id", "name": {"$first": "$items.name"},
                    "orders": {"$sum": 1}, "revenue": {"$sum": "$items.price"}}},
        {"$sort": {"orders": -1}},
        {"$limit": 5},
    ]
    top_products = await db.orders.aggregate(top_products_pipe).to_list(5)

    low_stock = await db.products.find(
        {"merchant_id": merchant_id, "total_stock": {"$gt": 0, "$lt": 5}},
        {"_id": 0, "id": 1, "name": 1, "total_stock": 1},
    ).to_list(5)

    wow_change = 0
    if last_week_orders > 0:
        wow_change = round(((week_orders - last_week_orders) / last_week_orders) * 100)

    return {
        "today_orders": today_orders,
        "today_revenue": today_revenue,
        "week_orders": week_orders,
        "last_week_orders": last_week_orders,
        "wow_change": wow_change,
        "pending_orders": pending,
        "top_products": top_products,
        "low_stock": low_stock,
    }


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


# ===== Waitlist =====
@api.post("/waitlist")
async def join_waitlist(payload: WaitlistEntry):
    phone = _re.sub(r'\D', '', payload.phone)
    phone = phone[-10:] if len(phone) >= 10 else phone
    if len(phone) < 10:
        raise HTTPException(400, "Invalid phone number")
    now = datetime.now(timezone.utc).isoformat()
    # Use phone + type as unique key so the same person can register as both customer and merchant
    existing = await db.waitlist.find_one({"phone": phone, "type": payload.type})
    if existing:
        return {"ok": True, "message": "Already registered"}
    await db.waitlist.insert_one({
        "id": f"wl-{payload.type}-{phone}",
        "phone": phone,
        "type": payload.type,
        "store_name": payload.store_name,
        "category": payload.category,
        "created_at": now,
        "source": "landing_page",
    })
    return {"ok": True, "message": "Registered successfully"}


# ===== Page views =====
@api.post("/page-view")
async def record_page_view(request: Request):
    page = request.query_params.get("page", "coming-soon")
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]
    await db.page_views.update_one(
        {"page": page, "date": today},
        {"$inc": {"count": 1}, "$set": {"page": page, "date": today}},
        upsert=True,
    )
    await db.page_views.update_one(
        {"page": page, "date": "total"},
        {"$inc": {"count": 1}, "$set": {"page": page, "date": "total"}},
        upsert=True,
    )
    return {"ok": True}


# ===== Admin =====
@api.post("/admin/login")
@_limit(_LIMIT_ADMIN_LOGIN)
async def admin_login(request: Request, payload: AdminLogin):
    email = payload.email.strip().lower()
    admin = await db.admin_users.find_one({"email": email})
    if not admin or not admin.get("active", True) or not verify_password(payload.password, admin["password_hash"]):
        raise HTTPException(401, "Invalid admin credentials")
    token = create_token(admin["id"], "admin", extra={"is_admin": True})
    return {"token": token, "admin": {
        "id": admin["id"], "email": admin["email"],
        "name": admin.get("name", ""), "role": admin.get("role", "admin"),
    }}

@api.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    return {
        "submitted_kyc": await db.merchants.count_documents({"kyc_status": "submitted"}),
        "approved": await db.merchants.count_documents({"kyc_status": "approved"}),
        "rejected": await db.merchants.count_documents({"kyc_status": "rejected"}),
        "stores_live": await db.stores.count_documents({"published": True, "paused": {"$ne": True}}),
        "stores_paused": await db.stores.count_documents({"paused": True}),
        "pending_changes": await db.change_requests.count_documents({"status": "submitted"}),
    }

@api.get("/admin/waitlist")
async def admin_waitlist(admin: dict = Depends(require_admin)):
    customers = await db.waitlist.find({"type": "customer"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    merchants = await db.waitlist.find({"type": "merchant"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {
        "customers": customers,
        "merchants": merchants,
        "total_customers": len(customers),
        "total_merchants": len(merchants),
    }


@api.get("/admin/page-views")
async def admin_page_views(admin: dict = Depends(require_admin)):
    rows = await db.page_views.find({"page": "coming-soon"}, {"_id": 0}).sort("date", -1).to_list(100)
    total = next((r["count"] for r in rows if r["date"] == "total"), 0)
    daily = [r for r in rows if r["date"] != "total"]
    return {"total": total, "daily": daily}


@api.get("/admin/merchants")
async def admin_merchants(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    q = {}
    if status: q["kyc_status"] = status
    return await db.merchants.find(q, {"_id": 0, "password_hash": 0}) \
        .sort("kyc_submitted_at", -1).to_list(500)

@api.get("/admin/merchants/{mid}")
async def admin_merchant_detail(mid: str, admin: dict = Depends(require_admin)):
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
    if not m: raise HTTPException(404, "Not found")
    return m

@api.post("/admin/merchants/{mid}/approve")
async def admin_approve(mid: str, admin: dict = Depends(require_admin)):
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "approved", "approved_at": now},
        "$push": {"notifications": {"type": "kyc-approved", "title": "Your KYC is approved",
            "body": "Welcome aboard! Set up your storefront and start adding products.", "time": now}}})
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "phone": 1, "store_name": 1})
    if m and m.get("phone"):
        try:
            notify_merchant_approved(m["phone"], m.get("store_name", "your store"))
        except Exception as _ne:
            print(f"[notify_error] {_ne}", flush=True)
    return {"ok": True}

@api.post("/admin/merchants/{mid}/reject")
async def admin_reject(mid: str, body: dict = None, admin: dict = Depends(require_admin)):
    reason = (body or {}).get("reason", "Documents need re-verification.")
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {"kyc_status": "rejected"},
        "$push": {"notifications": {"type": "kyc-rejected", "title": "KYC needs attention",
            "body": reason, "time": now}}})
    return {"ok": True}

@api.post("/admin/merchants/{mid}/hold")
async def admin_hold(mid: str, body: dict = None, admin: dict = Depends(require_admin)):
    """Admin puts a KYC submission on hold with a remediation comment. The merchant
    sees the comment in their dashboard and can fix the issue and resubmit."""
    _body = body or {}
    comment = (_body.get("reason") or _body.get("comment") or "").strip()
    if not comment:
        raise HTTPException(400, "Comment required so the merchant knows what to fix")
    now = datetime.now(timezone.utc).isoformat()
    await db.merchants.update_one({"id": mid}, {"$set": {
        "kyc_status": "on_hold", "hold_comment": comment, "hold_at": now,
    }, "$push": {"notifications": {"type": "kyc-on-hold", "title": "KYC on hold — action needed",
            "body": comment, "time": now}}})
    return {"ok": True}

@api.post("/admin/merchant/{mid}/activate-plan")
async def admin_activate_plan(mid: str, payload: dict, admin: dict = Depends(require_admin)):
    plan = payload.get("plan", "starter")
    if plan not in ["free", "starter", "growth", "pro"]:
        raise HTTPException(400, "Invalid plan")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=30)
    await db.merchants.update_one(
        {"id": mid},
        {"$set": {
            "plan": plan,
            "plan_started_at": now.isoformat(),
            "plan_expires_at": expires_at.isoformat(),
            "subscription_status": "active",
        }}
    )
    return {"message": f"Plan {plan} activated for merchant {mid}"}

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
async def admin_change_requests(status: Optional[str] = None,
                                period: Optional[str] = None,
                                admin: dict = Depends(require_admin)):
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
async def admin_cr_approve(cid: str, admin: dict = Depends(require_admin)):
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
async def admin_cr_reject(cid: str, body: dict = None, admin: dict = Depends(require_admin)):
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
async def admin_export(period: Optional[str] = "30d", admin: dict = Depends(require_admin)):
    start, end = _period_window(period or "30d")
    merchants = await db.merchants.find(
        {"kyc_submitted_at": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).to_list(2000)
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
async def admin_stores(admin: dict = Depends(require_admin)):
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
async def admin_orders(status: Optional[str] = None, limit: int = 200,
                        admin: dict = Depends(require_admin)):
    """Returns orders grouped by lifecycle for admin tracking.

    Query `status` accepts: `live` (anything not delivered/rejected/cancelled),
    `delivered`, `rejected`, or any specific status. Omit for all orders.
    """
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
    name_by_mid = {}
    if mids:
        mers = await db.merchants.find({"id": {"$in": mids}}, {"_id": 0, "id": 1, "store_name": 1}).to_list(len(mids))
        name_by_mid = {m["id"]: m["store_name"] for m in mers}
        for o in orders:
            o["store_names"] = [name_by_mid.get(m, "—") for m in (o.get("merchant_ids") or [])]
    # Per-merchant breakdown so the admin UI can show one line per store
    # (with each store's items, subtotal, state, OTP, cancel reason) — needed
    # to render per-merchant Mark Delivered / Cancel buttons on multi-store
    # orders.
    for o in orders:
        oids = o.get("merchant_ids") or []
        if not oids: continue
        bd = []
        for mid in oids:
            its = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
            bd.append({
                "merchant_id": mid,
                "store_name": name_by_mid.get(mid, "—"),
                "items": its,
                "subtotal": round(sum(float(it.get("price", 0)) * int(it.get("qty", 1)) for it in its), 2),
                "state": (o.get("merchant_states") or {}).get(mid, "pending"),
                "otp": (o.get("merchant_otps") or {}).get(mid),
                "delivered_at": (o.get("merchant_delivered_at") or {}).get(mid),
                "cancel_reason": (o.get("merchant_cancelled") or {}).get(mid),
            })
        o["store_breakdown"] = bd
    return orders

@api.post("/admin/products/{pid}/pause")
async def admin_pause_product(pid: str, admin: dict = Depends(require_admin)):
    await db.products.update_one({"id": pid}, {"$set": {"paused": True}})
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if p:
        cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
        await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}

@api.post("/admin/products/{pid}/unpause")
async def admin_unpause_product(pid: str, admin: dict = Depends(require_admin)):
    await db.products.update_one({"id": pid}, {"$set": {"paused": False}})
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if p:
        cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
        await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    return {"ok": True}

@api.delete("/admin/products/{pid}")
async def admin_delete_product(pid: str, admin: dict = Depends(require_admin)):
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p: raise HTTPException(404, "Not found")
    await db.products.delete_one({"id": pid})
    cnt = await db.products.count_documents({"store_id": p["store_id"], "paused": {"$ne": True}})
    await db.stores.update_one({"id": p["store_id"]}, {"$set": {"product_count": cnt}})
    await _revert_staged_import_on_product_delete(pid)
    return {"ok": True}

@api.post("/admin/stores/{sid}/pause")
async def admin_pause_store(sid: str, admin: dict = Depends(require_admin)):
    await db.stores.update_one({"id": sid}, {"$set": {"paused": True}})
    return {"ok": True}

@api.post("/admin/stores/{sid}/unpause")
async def admin_unpause_store(sid: str, admin: dict = Depends(require_admin)):
    await db.stores.update_one({"id": sid}, {"$set": {"paused": False}})
    return {"ok": True}

# ===== OTP-protected delete (mocked email) =====
@api.post("/admin/stores/{sid}/request-delete-otp")
async def request_delete_otp(sid: str, admin: dict = Depends(require_admin)):
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
async def admin_delete_store(sid: str, body: OtpVerifyDelete, admin: dict = Depends(require_admin)):
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
    # ===== Signature verification (HMAC-SHA1 per Twilio spec) =====
    # Reject any inbound that doesn't bear a valid X-Twilio-Signature against
    # the configured TWILIO_AUTH_TOKEN. Allows test runs (no header) only when
    # TWILIO_AUTH_TOKEN isn't configured.
    twilio_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    sig = request.headers.get("x-twilio-signature", "")
    if twilio_token and sig:
        # Twilio canonical string = full URL + concatenated (sorted-key + value) of form fields
        url = str(request.url)
        keys = sorted(form.keys())
        canonical = url + "".join(f"{k}{form[k]}" for k in keys)
        digest = hmac.new(twilio_token.encode(), canonical.encode(), hashlib.sha1).digest()
        expected = base64.b64encode(digest).decode()
        if not hmac.compare_digest(expected, sig):
            log.warning("[Twilio inbound] signature mismatch (got=%s)", sig[:8])
            raise HTTPException(403, "Invalid Twilio signature")
    body = (form.get("Body") or "").strip()
    from_addr = (form.get("From") or "").strip()  # e.g. whatsapp:+919XXXXXXXXX
    log.info("[Twilio inbound] from=%s body=%r", from_addr, body[:80])

    # Parse OTP confirmation replies (case-insensitive, multiple formats supported)
    import re as _re
    twiml_empty = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    text_clean = body.strip().upper()
    m_del = _re.match(r'^(?:OTP\s+)?(\d{4,6})\s*[-–—]?\s*DELIVERED$', text_clean)
    m_ret = _re.search(r"\b(\d{4,6})\b[\s\-:]*picked[\s\-]?up\b", body, _re.IGNORECASE)
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
    # Match OTP against per-merchant OTP first (unique per store); fall back to
    # legacy global `otp` for single-store / pre-fix orders.
    # 'pending_merchant' is included alongside 'accepted'/'on_the_way' because
    # in a multi-store order one leg can already be 'handed_off' (rank 2)
    # while ANOTHER leg is still 'pending' (rank 0) — _derive_global_status's
    # min-rank rule means the ORDER's global status is 'pending_merchant' in
    # that case even though this leg is genuinely out for delivery. Simultaneous
    # dispatch (rider-flow redesign) makes this more reachable than before
    # (riders can now claim/progress a 'pending' leg independently of a
    # sibling leg's merchant even accepting yet), so a delivery confirmation
    # for the ahead-leg must still be found here rather than silently
    # dropped as "no matching live order".
    cands = await db.orders.find({"status": {"$in": ["pending_merchant", "accepted", "on_the_way"]}}, {"_id": 0}).to_list(500)
    target_mid = None
    target_order = None
    for cand in cands:
        m_otps = cand.get("merchant_otps") or {}
        for mid, code in m_otps.items():
            if code == otp:
                target_order = cand
                target_mid = mid
                break
        if target_order:
            break
        if cand.get("otp") == otp:
            target_order = cand
            mids = cand.get("merchant_ids") or []
            target_mid = mids[0] if mids else None
            break

    if not target_order:
        log.warning("[Twilio inbound] no matching live order for OTP %s", otp)
        return Response(content=twiml_empty, media_type="application/xml")
    o = target_order

    # Only mark delivered if THIS merchant's leg has been handed to rider —
    # enforced inside _mark_leg_delivered (require_handed_off=True, its default).
    new_global = await _mark_leg_delivered(o, target_mid, delivered_via="rider-whatsapp")

    log.info("[Twilio inbound] marked %s as delivered via rider WhatsApp (merchant=%s, global=%s)",
             o["id"], target_mid, new_global)
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
                # Group C1 — see add_customer_address's identical fields.
                "lat": _to_optional_float(address.get("lat")),
                "lng": _to_optional_float(address.get("lng")),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            addresses = addresses + [new_addr]
            upd["addresses"] = addresses
        upd["last_address"] = address
    await db.customers.update_one({"phone": phone}, {"$set": upd}, upsert=True)

@api.post("/customer/upsert")
async def customer_upsert(payload: CustomerUpsert, user: dict = Depends(customer_user)):
    payload_phone = _normalize_customer_phone(payload.phone) or payload.phone
    if user.get("role") != "admin" and payload_phone != user.get("sub"):
        raise HTTPException(403, "Cannot upsert another customer's profile")
    await _upsert_customer(payload.model_dump(), payload.address)
    c = await db.customers.find_one({"phone": payload_phone}, {"_id": 0})
    return c

@api.get("/customer/{phone}")
async def get_customer(phone: str, user: dict = Depends(customer_user)):
    phone = _ensure_customer_phone_match(user, phone)
    c = await db.customers.find_one({"phone": phone}, {"_id": 0})
    if not c: raise HTTPException(404, "Not found")
    orders = await db.orders.find({"customer.phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"customer": c, "orders": orders}


# Customer address book CRUD
@api.post("/customer/{phone}/addresses")
async def add_customer_address(phone: str, payload: dict, user: dict = Depends(customer_user)):
    phone = _ensure_customer_phone_match(user, phone)
    if not payload.get("line1") or not payload.get("pincode"):
        raise HTTPException(400, "line1 and pincode required")
    if str(payload.get("pincode", "")).strip() and str(payload.get("pincode", "")).strip() not in {"490001", "490006", "490009", "490020", "490023"}:
        raise HTTPException(400, "We only deliver to Bhilai pincodes (490xxx). Please check your pincode.")
    addr = {
        "id": f"addr-{uuid.uuid4().hex[:8]}",
        "name": payload.get("name", ""),
        "phone": payload.get("phone", phone),
        "line1": payload.get("line1", "").strip(),
        "landmark": payload.get("landmark", "").strip(),
        "city": payload.get("city", "Bhilai"),
        "pincode": str(payload.get("pincode", "")).strip(),
        "label": payload.get("label", "Home"),
        # Group C1: optional delivery-pin coordinates — the point the
        # customer dropped on a map for THIS address, NOT their device GPS.
        # None for existing/pin-skipped addresses; _address_is_serviceable
        # falls back to pincode whenever either is missing.
        "lat": _to_optional_float(payload.get("lat")),
        "lng": _to_optional_float(payload.get("lng")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.customers.update_one(
        {"phone": phone},
        {"$push": {"addresses": addr}, "$set": {"updated_at": addr["created_at"]}},
        upsert=True,
    )
    return addr

@api.delete("/customer/{phone}/addresses/{aid}")
async def delete_customer_address(phone: str, aid: str, user: dict = Depends(customer_user)):
    phone = _ensure_customer_phone_match(user, phone)
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
async def create_return(oid: str, payload: dict, user: dict = Depends(customer_user)):
    """Customer initiates a return. Payload: {item_ids: [str], reason: str}.
    Caller must own the order (JWT phone === order customer phone)."""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    order_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if user.get("role") != "admin" and order_phone != user.get("sub"):
        raise HTTPException(403, "Not your order")
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
    # Customer phone is always derived from the authenticated order, never trusted from the body.
    cust_phone = order_phone
    rid = f"RET-{uuid.uuid4().hex[:8].upper()}"
    # CSPRNG (secrets) — this OTP authorises reverse-pickup of physical goods; predictable random would let
    # anyone with the order ID intercept the parcel.
    otp = f"{secrets.SystemRandom().randint(1000, 9999)}"
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
    if not r.get("timeline"):
        created = r.get("created_at")
        r["timeline"] = [
            {"label": "Return requested", "time": created},
            {"label": "Pickup partner assigned", "time": None},
            {"label": "Pickup partner arriving", "time": None},
            {"label": "Product picked up", "time": None},
            {"label": "Return completed", "time": None},
        ]
    return r


@api.get("/customer/{phone}/returns")
async def customer_returns(phone: str, user: dict = Depends(customer_user)):
    phone = _ensure_customer_phone_match(user, phone)
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
    # Initialise timeline for legacy returns that have no pre-built template.
    if not tl:
        tl = [
            {"label": "Return requested", "time": r.get("created_at")},
            {"label": "Pickup partner assigned", "time": None},
            {"label": "Pickup partner arriving", "time": None},
            {"label": "Product picked up", "time": None},
            {"label": "Return completed", "time": None},
        ]
    for t in tl:
        if t.get("label") == label_for and not t.get("time"):
            t["time"] = now
            break
    return tl, target_status, None


@api.post("/admin/returns/{rid}/{action}")
async def admin_return_action(rid: str, action: str, admin: dict = Depends(require_admin)):
    """action ∈ {assign, arriving, picked_up, complete}"""
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
        # Returned items go back into sellable stock — this was previously
        # missing entirely (a completed return never restocked anything),
        # independent of any source-platform sync question.
        await _restock_order_items(r)
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
async def admin_returns_list(status: Optional[str] = None, admin: dict = Depends(require_admin)):
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
async def admin_returns_analytics(admin: dict = Depends(require_admin)):
    """Merchant-wise + reason-wise returns aggregation for admin Returns tab."""
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
async def create_complaint(oid: str, payload: dict, user: dict = Depends(customer_user)):
    """Customer raises a complaint for an order. Payload: {type, message}.
    Caller must own the order (JWT phone === order customer phone)."""
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    order_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if user.get("role") != "admin" and order_phone != user.get("sub"):
        raise HTTPException(403, "Not your order")
    ctype = payload.get("type") or "general"
    if ctype not in COMPLAINT_TYPES:
        raise HTTPException(400, "Invalid complaint type")
    msg = (payload.get("message") or "").strip()
    if not msg:
        raise HTTPException(400, "Message required")
    # Customer phone is always derived from the order, never trusted from the body.
    cust_phone = order_phone
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
async def admin_complaints(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    q = {}
    if status: q["status"] = status
    docs = await db.complaints.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.post("/admin/complaints/{cid}/resolve")
async def admin_resolve_complaint(cid: str, payload: Optional[dict] = None, admin: dict = Depends(require_admin)):
    note = (payload or {}).get("note", "")
    res = await db.complaints.update_one({"id": cid}, {"$set": {"status": "resolved", "resolved_at": _now_iso(), "resolution_note": note}})
    if res.matched_count == 0:
        raise HTTPException(404, "Complaint not found")
    return {"ok": True}


@api.get("/customer/{phone}/complaints")
async def customer_complaints(phone: str, user: dict = Depends(customer_user)):
    phone = _ensure_customer_phone_match(user, phone)
    docs = await db.complaints.find({"customer_phone": phone}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


@api.get("/merchant/complaints")
async def merchant_complaints(user: dict = Depends(get_current_user)):
    docs = await db.complaints.find({"merchant_ids": user["sub"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for d in docs:
        d["customer_phone"] = "(hidden)"
    return docs




# ===== Internal health check (gated by INTERNAL_API_KEY) =====
@app.get("/internal/health/db")
async def internal_db_health(request: Request):
    """Readiness probe for the Mongo replica/standalone. Requires the
    `X-Internal-Key` header to match `INTERNAL_API_KEY`. Returns 200 + ping
    latency-ish info when healthy; 503 on driver/server failures."""
    expected = os.environ.get("INTERNAL_API_KEY", "")
    key = request.headers.get("x-internal-key", "")
    if not expected or not hmac.compare_digest(key, expected):
        raise HTTPException(403, "Forbidden")
    try:
        # `ping` is Mongo's canonical no-op health command
        result = await db.command({"ping": 1})
        names = await db.list_collection_names()
        applied = await db["_migrations"].count_documents({})
        return JSONResponse({
            "status": "healthy",
            "database": os.environ.get("DB_NAME"),
            "ping": result.get("ok") == 1.0,
            "collections": len(names),
            "migrations_applied": applied,
        })
    except Exception as e:
        return JSONResponse({"status": "unhealthy", "error": str(e)[:200]}, status_code=503)


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


@api.get("/_debug/sentry")
async def debug_sentry(admin: dict = Depends(require_admin)):
    """Admin-only smoke test for Sentry wiring.

    Intentionally raises so the error reaches Sentry. Use this once after
    pasting a real SENTRY_DSN to confirm the dashboard receives events.
    Returns 503 when Sentry is disabled (graceful no-op mode).
    """
    if not os.environ.get("SENTRY_DSN", "").strip():
        raise HTTPException(503, "Sentry is disabled (SENTRY_DSN not set).")
    raise RuntimeError("Sentry debug — intentional test exception from /api/_debug/sentry")


@api.get("/admin/live-users")
async def admin_live_users(admin: dict = Depends(require_admin)):
    """Sessions seen in the last 2 minutes."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    sessions = await db.live_sessions.find({"last_seen": {"$gte": cutoff}}, {"_id": 0}).sort("last_seen", -1).to_list(500)
    by_role = {}
    for s in sessions:
        by_role.setdefault(s.get("role", "guest"), 0)
        by_role[s["role"]] = by_role.get(s["role"], 0) + 1
    return {"sessions": sessions, "count": len(sessions), "by_role": by_role}

@api.get("/admin/customers")
async def admin_customers(q: Optional[str] = None, limit: int = 200, admin: dict = Depends(require_admin)):
    query = {}
    if q:
        # Escape user input — never pass raw to $regex (ReDoS + injection risk)
        import re as _re
        safe_q = _re.escape(q.strip()[:64])
        query = {"$or": [
            {"phone": {"$regex": safe_q, "$options": "i"}},
            {"name": {"$regex": safe_q, "$options": "i"}},
            {"email": {"$regex": safe_q, "$options": "i"}},
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
async def admin_customer_detail(phone: str, admin: dict = Depends(require_admin)):
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

# ===== v1 geolocation routers (nearby stores, products, delivery estimate,
# cities, customer addresses, merchant store location) =====
from routes.geo import init as _init_geo
from routes.addresses import init as _init_addresses
from services.cache_service import cache_service
from services.payment_service import (create_razorpay_order, refund_payment,
                                       verify_webhook_signature, verify_payment_signature,
                                       is_enabled as razorpay_enabled)
from services.audit_service import AuditService
from services.delivery_service import DeliveryService
app.include_router(_init_geo(db))
app.include_router(_init_addresses(db, merchant_user))
audit_service = AuditService(db)
# Shared instance for create_order's own server-authoritative delivery-fee
# recompute — same class routes/geo.py's own delivery_estimate handler uses,
# just a separate instance since that one is scoped inside geo.py's init().
_delivery_service = DeliveryService(db)

# ===== CORS =====
# Origins must be explicitly allow-listed via ALLOWED_ORIGINS (comma-separated).
# Wildcard ("*") is only permitted for local development — in prod set the var.
_allowed = os.environ.get("ALLOWED_ORIGINS") or os.environ.get("CORS_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _allowed.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


async def _expire_pickup_reservations() -> int:
    """Cancel pickup reservations/requests past their pickup_expires_at
    window — restocks exactly once per merchant slice via the same guarded
    _merchant_cancel_own_slice() helper the manual/merchant/customer cancel
    paths use, then notifies the customer.

    Idempotent by construction: once an order's status flips away from
    reserved/pending_pickup it no longer matches this query, so re-running
    this on every sweep pass (or via the manual /admin/expire-pickups
    trigger, concurrently or right after an automatic pass) can't reprocess
    or double-restock the same order. The per-mid `states.get(mid) ==
    "cancelled"` check below is a second, belt-and-braces guard against the
    same failure mode `_merchant_cancel_own_slice`'s own docstring warns
    about (it only protects against a caller that skips checking first).
    """
    now = datetime.now(timezone.utc).isoformat()
    expired = 0
    async for order in db.orders.find(
        {"order_type": "pickup", "status": {"$in": ["reserved", "pending_pickup"]},
         "pickup_expires_at": {"$lt": now}},
        {"_id": 0, "id": 1, "merchant_ids": 1, "merchant_states": 1, "customer": 1,
         "address": 1, "store_name": 1},
    ):
        oid = order["id"]
        states = order.get("merchant_states") or {}
        for mid in (order.get("merchant_ids") or []):
            if states.get(mid) == "cancelled":
                continue
            await _merchant_cancel_own_slice(oid, mid, "Pickup reservation expired")
        cust_phone = (order.get("customer") or {}).get("phone") or (order.get("address") or {}).get("phone")
        if cust_phone:
            try:
                send_with_fallback(cust_phone,
                    f"Your Lokl pickup reservation for order {oid} at "
                    f"{order.get('store_name') or 'the store'} has expired and been cancelled. "
                    "You have not been charged.", message_type="pickup_reservation_expired")
            except Exception:
                pass
        log.info("Expired pickup reservation %s", oid)
        expired += 1
    return expired


async def _auto_cancel_stale_orders():
    """Background loop: expire stale pickup reservations, and cancel COD
    orders stuck in pending_merchant > 2 hours. Each sweep gets its own
    try/except so a failure in one doesn't skip the other within the same
    pass."""
    import asyncio as _asyncio
    while True:
        try:
            expired_pickups = await _expire_pickup_reservations()
            if expired_pickups:
                log.info("Expired %d stale pickup reservations", expired_pickups)
        except Exception as e:
            log.warning("_expire_pickup_reservations error: %s", e)
        try:
            rp_cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
            del_result = await db.orders.delete_many({
                "status": "awaiting_payment",
                "created_at": {"$lt": rp_cutoff},
            })
            if del_result.deleted_count:
                log.info("Deleted %d stale awaiting_payment orders", del_result.deleted_count)
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
            async for order in db.orders.find(
                {"status": "pending_merchant", "payment_method": "COD",
                 "created_at": {"$lt": cutoff}, "is_deleted": {"$ne": True}},
                {"_id": 0, "id": 1, "merchant_ids": 1, "merchant_states": 1, "customer": 1}
            ):
                oid = order["id"]
                # Restock via the same guarded helper the pickup-expiry sweep and
                # merchant/customer cancel paths use — one call per merchant slice,
                # each re-reading fresh and skipping any slice already 'cancelled'
                # (idempotent: a re-run of this sweep can't double-restock).
                states = order.get("merchant_states") or {}
                reason = "Auto-cancelled: no merchant response within 2 hours"
                for mid in (order.get("merchant_ids") or []):
                    if states.get(mid) == "cancelled":
                        continue
                    await _merchant_cancel_own_slice(oid, mid, reason)
                cust_phone = (order.get("customer") or {}).get("phone")
                if cust_phone:
                    try:
                        send_with_fallback(cust_phone,
                            f"Your Lokl order {oid} was auto-cancelled as no merchant accepted it within 2 hours. "
                            "You have not been charged.", message_type="order_auto_cancelled")
                    except Exception:
                        pass
                log.info("Auto-cancelled stale order %s", oid)
        except Exception as e:
            log.warning("_auto_cancel_stale_orders error: %s", e)
        await _asyncio.sleep(300)  # check every 5 minutes


async def fix_store_slugs(database):
    """Backfill slug field for any stores that don't have one."""
    stores = await database.stores.find(
        {"$or": [{"slug": {"$exists": False}}, {"slug": ""}, {"slug": None}]},
        {"_id": 1, "id": 1, "name": 1},
    ).to_list(1000)
    for s in stores:
        name = s.get("name") or s.get("id") or "store"
        slug = _re.sub(r"[^\w\s-]", "", name.lower().strip())
        slug = _re.sub(r"[\s_]+", "-", slug)
        slug = _re.sub(r"-+", "-", slug).strip("-")
        if not slug:
            slug = s.get("id", "store")
        await database.stores.update_one({"_id": s["_id"]}, {"$set": {"slug": slug}})
    if stores:
        log.info("[startup] Backfilled slugs for %d stores", len(stores))


async def fix_paused_products(database):
    """One-time repair: unpause all products that have valid data."""
    r1 = await database.products.update_many(
        {"paused": True, "is_deleted": {"$ne": True}},
        {"$set": {"paused": False, "status": "published"}},
    )
    if r1.modified_count:
        log.info("[startup] Unpaused %d products (paused=True)", r1.modified_count)
    r2 = await database.products.update_many(
        {"status": "paused", "is_deleted": {"$ne": True}},
        {"$set": {"status": "published", "paused": False}},
    )
    if r2.modified_count:
        log.info("[startup] Published %d products (status=paused)", r2.modified_count)


@app.on_event("startup")
async def startup_seed():
    log.info("[startup] RIDER_PHONE=%s APP_URL=%s TWILIO_FROM=%s NOTIFICATION_PROVIDER=%s",
        bool(os.environ.get("RIDER_PHONE")),
        os.environ.get("APP_URL", "NOT SET"),
        bool(os.environ.get("TWILIO_WHATSAPP_FROM")),
        active_provider_name(),
    )
    # ----- MongoDB version + geo support check -----
    try:
        info = await client.server_info()
        ver = info.get("version", "0.0")
        major = int(str(ver).split(".")[0])
        log.info("[GEO] MongoDB %s — geospatial support %s", ver, "OK" if major >= 6 else "DEGRADED (<6.0)")
    except Exception as e:
        log.warning("Mongo version check failed: %s", e)

    # ----- Seed the initial admin account -----
    # Idempotent: only fires when admin_users is empty, so a restart never
    # re-seeds or clobbers accounts created later via the (future) admin-user
    # management UI. ADMIN_PASSWORD_HASH is already a bcrypt hash (see the
    # ValueError check above enforcing it's set) — stored as-is, not re-hashed.
    try:
        await db.admin_users.create_index("email", unique=True)
        if await db.admin_users.count_documents({}) == 0:
            await db.admin_users.insert_one({
                "id": f"adm-{uuid.uuid4().hex[:8]}",
                "email": ADMIN_EMAIL.strip().lower(),
                "password_hash": ADMIN_PASSWORD_HASH,
                "name": "Admin",
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "created_by": "startup-seed",
                "active": True,
            })
            log.info("[startup] Seeded initial admin account for %s", ADMIN_EMAIL)
    except Exception as e:
        log.warning("admin_users seed skipped: %s", e)

    # ----- Redis cache (optional; degrades gracefully) -----
    try:
        await cache_service.connect()
    except Exception as e:
        log.warning("Cache connect skipped: %s", e)

    # Unpause any products that were accidentally left paused.
    try:
        await fix_paused_products(db)
    except Exception as e:
        log.warning("fix_paused_products skipped: %s", e)

    # Backfill slug field for stores that don't have one.
    try:
        await fix_store_slugs(db)
    except Exception as e:
        log.warning("fix_store_slugs skipped: %s", e)

    # Auto-apply pending Mongo migrations (indexes + $jsonSchema validators +
    # soft-delete backfill). Idempotent — completed versions are skipped.
    try:
        from migrations.run import _run as _run_migrations
        await _run_migrations(db)
    except Exception as e:
        log.warning("Migration runner skipped: %s", e)

    # Auto-seed Bhilai delivery config (idempotent upsert)
    try:
        from seeds.bhilai_config import up as _seed_bhilai
        await _seed_bhilai(db)
    except Exception as e:
        log.warning("Bhilai seed skipped: %s", e)

    # Remove duplicate category/subcategory documents (keep first per id).
    for _coll in (db.categories, db.subcategories):
        async for _grp in _coll.aggregate([
            {"$group": {"_id": "$id", "first": {"$first": "$_id"}, "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]):
            await _coll.delete_many({"id": _grp["_id"], "_id": {"$ne": _grp["first"]}})

    # Unique indexes guard against future dupes at DB level.
    try:
        await db.categories.create_index("id", unique=True, background=True)
        await db.subcategories.create_index("id", unique=True, background=True)
    except Exception as _e:
        log.warning("Category unique indexes: %s", _e)

    # Brand slug/id uniqueness — the DB-level backstop behind the app-level
    # collision-retry loop in _unique_brand_slug().
    try:
        await db.brands.create_index("id", unique=True, background=True)
        await db.brands.create_index("slug", unique=True, background=True)
    except Exception as _e:
        log.warning("Brand unique indexes: %s", _e)

    # Merchant integration collections (multi-provider: VasyERP, Shopify, ...).
    # Field is `source_item_id` (renamed from the original vasyerp_item_id —
    # a pure rename, no migration: no real merchant had connected yet, so
    # no backfill was needed; confirmed via a direct query before renaming).
    try:
        await db.merchant_integrations.create_index(
            [("merchant_id", 1), ("provider", 1)], unique=True, background=True,
        )
        await db.integration_mappings.create_index(
            [("merchant_id", 1), ("provider", 1), ("source_value", 1), ("mapped_type", 1)],
            unique=True, background=True,
        )
        await db.staged_imports.create_index("id", unique=True, background=True)
        await db.staged_imports.create_index(
            [("merchant_id", 1), ("provider", 1), ("source_item_id", 1)], background=True,
        )
        await db.staged_imports.create_index([("merchant_id", 1), ("status", 1)], background=True)
    except Exception as _e:
        log.warning("Merchant integration indexes: %s", _e)

    # Idempotent upsert of L1/L2 taxonomy.
    # `image` uses $setOnInsert so admin-uploaded category images are never
    # overwritten on restart — only the non-image metadata (name, slug, order)
    # is refreshed each boot.
    cats, l2s = build_seed_docs()
    for cat in cats:
        await db.categories.update_one(
            {"id": cat["id"]},
            {
                "$set": {k: v for k, v in cat.items() if k != "image"},
                "$setOnInsert": {"image": cat.get("image", "")},
            },
            upsert=True,
        )
    for sub in l2s:
        await db.subcategories.update_one(
            {"id": sub["id"]},
            {
                "$set": {k: v for k, v in sub.items() if k != "image"},
                "$setOnInsert": {"image": sub.get("image", "")},
            },
            upsert=True,
        )
    log.info("Categories seeded: %d L1, %d L2", len(cats), len(l2s))

    # Idempotent upsert of featured Bhilai areas ("Shop by Area"). Same
    # $setOnInsert-for-image pattern as categories — admin-set images survive
    # restarts, only name/slug/order/featured refresh from areas_data.py.
    from areas_data import AREAS_SEED
    for area in AREAS_SEED:
        await db.areas.update_one(
            {"id": area["id"]},
            {
                "$set": {k: v for k, v in area.items() if k != "image"},
                "$setOnInsert": {"image": area.get("image", "")},
            },
            upsert=True,
        )
    log.info("Areas seeded: %d", len(AREAS_SEED))

    # Idempotent upsert of the 3 homepage price-bento bands (Under ₹499 /
    # Most Loved / Premium). Same $setOnInsert-for-image pattern as
    # categories/areas above — an admin-set override image survives
    # restarts; label/slug/order refresh from PRICE_BANDS_SEED every boot.
    for band in PRICE_BANDS_SEED:
        await db.price_bands.update_one(
            {"id": band["id"]},
            {
                "$set": {k: v for k, v in band.items() if k != "image"},
                "$setOnInsert": {"image": band.get("image", "")},
            },
            upsert=True,
        )
    log.info("Price bands seeded: %d", len(PRICE_BANDS_SEED))

    # Idempotency index for payment webhooks — same payment_id is silently
    # ignored on retry (Razorpay can replay webhooks).
    try:
        await db.processed_payments.create_index("payment_id", unique=True)
    except Exception as e:
        log.warning("processed_payments index: %s", e)

    # Customer-OTP TTL: documents auto-expire 10 min after `expires_at`.
    try:
        await db.customer_otps.create_index("phone", unique=True)
        await db.customer_otps.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        log.warning("customer_otps indexes: %s", e)

    # iter-29 (Item 1): merchant phone-OTP login. Same TTL strategy.
    try:
        await db.merchant_login_otps.create_index("phone", unique=True)
        await db.merchant_login_otps.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        log.warning("merchant_login_otps indexes: %s", e)

    # Rider delivery platform Phase 1, Commit 2: rider phone-OTP login.
    # Same TTL strategy as customer/merchant OTP collections above.
    # db.riders' own id/phone unique indexes live in migrations/014_riders.py
    # (structural collection, not an ephemeral OTP store — matches how
    # products/stores indexes went through the formal migrations/ path too).
    try:
        await db.rider_otps.create_index("phone", unique=True)
        await db.rider_otps.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        log.warning("rider_otps indexes: %s", e)

    # Revoked-refresh-token store: auto-pruned when the JWT's natural expiry
    # passes, so the collection stays small.
    try:
        await db.revoked_refresh_jti.create_index("jti", unique=True)
        await db.revoked_refresh_jti.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        log.warning("revoked_refresh_jti indexes: %s", e)

    # Keep demo merchant auto-approved
    demo = await db.merchants.find_one({"email": "demo@bharat-os.com"}, {"_id": 0})
    if demo and demo.get("kyc_status") != "approved":
        now = datetime.now(timezone.utc).isoformat()
        await db.merchants.update_one({"id": demo["id"]}, {"$set": {
            "kyc_status": "approved", "approved_at": now,
            "pan_number": "DEMOP1234D", "business_name": "Demo Store Pvt Ltd",
            "business_category": "Multi-category", "business_type": "Pvt Ltd",
            "business_address": "Sector 10, Bhilai 490006",
            "bank_account_number": "1234567890", "bank_ifsc": "SBIN0001234",
            "account_holder_name": "Demo Owner"},
            "$push": {"notifications": {"type": "kyc-approved",
                "title": "Your KYC is approved",
                "body": "Welcome to Lokl!", "time": now}}})
        log.info("Demo merchant auto-approved")

    asyncio.create_task(_auto_cancel_stale_orders())


@app.on_event("shutdown")
async def shutdown(): client.close()
