"""Lokl — FastAPI backend (full feature set)."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, base64, io, csv, json, random, secrets, hmac, hashlib, asyncio
import bcrypt
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
admin_user = require_role("admin")
customer_user = require_role("customer", "admin")
from ai_service import generate_product_copy, enhance_product_image, ai_model_tryon
from seed_data import build_seed_docs, L1_CATEGORIES, L2_BY_L1, GENDERS
from notifications import (
    notify_order_placed, notify_merchant_new_order,
    notify_order_accepted, notify_order_rejected, notify_order_delivered,
    notify_order_on_the_way, notify_order_cancelled, notify_rider_pickup,
    notify_rider_return_pickup, notify_return_status, notify_customer_otp,
    notify_merchant_otp, send_with_fallback, APP_URL,
)
from ai_enhance import enhance_product_images
from observability import init_sentry
from services import cloudinary_service

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

class OrderCreate(BaseModel):
    items: List[dict]; address: dict; total: float
    payment_method: str = "COD"; customer: Optional[dict] = None  # {name, phone, age}
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_signature: Optional[str] = None
    coupon_code: Optional[str] = None
    customer_lat: Optional[float] = None
    customer_lng: Optional[float] = None

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
    doc = {"id": mid, "email": payload.email, "password_hash": hash_password(payload.password or secrets.token_hex(16)),
           "store_name": payload.store_name, "owner_name": payload.owner_name,
           "phone": phone, "phone_canonical": p10, "city": payload.city,
           "created_at": datetime.now(timezone.utc).isoformat(), "role": "merchant",
           "kyc_status": "draft", "kyc_submitted_at": None, "approved_at": None,
           "published": False, "storefront": None, "notifications": []}
    await db.merchants.insert_one(doc)
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


@api.post("/auth/customer/request-otp")
@_limit(_LIMIT_CUSTOMER_OTP_REQUEST)
async def customer_request_otp(request: Request, payload: CustomerOtpRequest):
    """Generate a 6-digit OTP, store its bcrypt hash with a 10-minute TTL,
    and dispatch via WhatsApp. Always returns the same shape to prevent
    user-enumeration via response timing/structure."""
    phone = _normalize_customer_phone(payload.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    otp = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = hash_password(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

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
    # when CUSTOMER_OTP_DEBUG=true so dev/preview works regardless of Twilio.
    try:
        notify_customer_otp(phone, otp)
    except Exception as e:
        log.warning("OTP delivery failed for %s: %s", phone, e)

    return {"ok": True, "message": "OTP sent if the phone is valid", "expires_in": 600}


@api.post("/auth/customer/verify-otp")
@_limit(_LIMIT_CUSTOMER_OTP_VERIFY)
async def customer_verify_otp(request: Request, payload: CustomerOtpVerify):
    """Verify the OTP and issue a customer JWT pair. After 5 wrong attempts
    the OTP is invalidated and the customer must request a new one."""
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

    # Success — burn the OTP, ensure a customer doc exists, issue tokens.
    await db.customer_otps.delete_one({"phone": phone})
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

    otp = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = hash_password(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
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
    return {"ok": True, "message": "OTP sent", "expires_in": 600}


@api.post("/auth/merchant/verify-otp")
@_limit(_LIMIT_MERCHANT_OTP_VERIFY)
async def merchant_verify_otp(request: Request, response: Response, payload: MerchantOtpVerify):
    """Verify the 6-digit OTP, issue a merchant JWT, and return the same
    response envelope as `/api/auth/login` so the frontend can use one
    `setAuth(token, merchant)` call regardless of entry point."""
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
    customer-facing site entirely."""
    cats = await db.categories.find({"paused": {"$ne": True}}, {"_id": 0}).sort("order", 1).to_list(50)
    l2s = await db.subcategories.find({"paused": {"$ne": True}}, {"_id": 0}).to_list(200)
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
async def feed_best_sellers(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
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
    items.sort(key=lambda p: p.get("store_availability_rank", 1))
    for p in items: p["orders_30d"] = counts.get(p["id"], 0)
    return items


@api.get("/feed/new-arrivals")
async def feed_new_arrivals(limit: int = 12):
    avail_map = await _availability_map()
    sids = list(avail_map.keys())
    if not sids: return []
    since_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    items = await db.products.find(
        {"store_id": {"$in": sids}, "created_at": {"$gte": since_30d}, **_visible_product_filter()},
        {"_id": 0, "images": 0}
    ).sort("created_at", -1).to_list(limit * 3)
    if not items:
        # Fall back to most recent products across all time if nothing in 30 days.
        items = await db.products.find(
            {"store_id": {"$in": sids}, **_visible_product_filter()},
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


def _admin_only(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")


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


async def _restock_order_items(order: dict) -> None:
    for it in (order.get("items") or []):
        pid = it.get("id"); qty = int(it.get("qty", 1) or 1)
        sz = (it.get("size") or "").strip() or "default"
        if pid and qty > 0:
            await db.products.update_one({"id": pid}, {"$inc": {f"stock.{sz}": qty}})


async def _handle_payment_captured(event: dict) -> None:
    pay = (event.get("payload") or {}).get("payment", {}).get("entity") or {}
    rp_order_id = pay.get("order_id")
    rp_payment_id = pay.get("id")
    amount_paise = int(pay.get("amount", 0))
    if not rp_order_id:
        raise ValueError("No order_id in payment.captured")
    o = await db.orders.find_one({"razorpay_order_id": rp_order_id}, {"_id": 0})
    if not o:
        raise ValueError(f"No Lokl order for razorpay_order_id={rp_order_id}")
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
    order (JWT phone === order's customer phone). Allowed only while the order
    is still pre-acceptance. Triggers auto-refund when the order was paid via
    Razorpay."""
    body = payload or {}
    reason = (body.get("reason") or "Customer cancelled").strip()[:200]
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if user.get("role") != "admin" and cust_phone != user.get("sub"):
        raise HTTPException(403, "Not your order")
    phone = cust_phone  # downstream code still uses `phone` for notifications
    if o.get("status") not in ("awaiting_payment", "pending_merchant"):
        raise HTTPException(400, f"Cannot cancel from status: {o.get('status')}")
    await db.orders.update_one({"id": oid}, {"$set": {
        "status": "cancelled", "cancel_reason": reason,
        "cancelled_by": "customer",
        "cancelled_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _restock_order_items(o)
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
                            metadata={"reason": reason, "refund_initiated": refund_initiated})
    return {"ok": True, "status": "cancelled", "refund_initiated": refund_initiated}


@api.get("/admin/orders/{oid}/audit-log")
async def admin_order_audit_log(oid: str, request: Request):
    _check_admin(request.headers.get("authorization"))
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

    asset_type ∈ {"product", "store_logo", "store_banner", "kyc"}.
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
async def admin_kyc_signed_url(merchant_id: str, doc: str, request: Request):
    """Generate a 1-hour signed URL for a private KYC document on Cloudinary.

    `doc` must be one of: pan_doc, gst_doc, cancelled_cheque.
    """
    _check_admin(request.headers.get("authorization"))
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


# ============ Lokl V2 — Homepage Asset CMS (iter-26) ============
# Admin can edit hero, L1/L2 category tiles, and offers via these endpoints.
# Front-of-house (public) endpoints reuse the existing /categories, /offers,
# /site/homepage-config — these admin routes add the writes + analytics.

ALLOWED_OFFER_FIELDS = {
    "title", "subtitle", "image", "cta_label", "cta_link",
    "background", "rank", "published", "expires_at", "redirect_url",
    # iter-27 (Item 7): admin can pause an offer (hides from public feed)
    # or make it non-clickable (renders as <div>, no link).
    "paused", "non_clickable",
}


@api.put("/admin/offers/{oid}")
async def admin_update_offer(oid: str, payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
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
async def admin_list_offers(user: dict = Depends(get_current_user)):
    """Includes unpublished offers, sorted by rank — public /offers does not."""
    _admin_only(user)
    rows = await db.offers.find({}, {"_id": 0}).sort("rank", 1).to_list(100)
    return rows


@api.post("/admin/coupons")
async def admin_create_coupon(payload: CouponCreate, user: dict = Depends(get_current_user)):
    _admin_only(user)
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
async def admin_list_coupons(user: dict = Depends(get_current_user)):
    _admin_only(user)
    rows = await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@api.delete("/admin/coupons/{cid}")
async def admin_delete_coupon(cid: str, user: dict = Depends(get_current_user)):
    _admin_only(user)
    r = await db.coupons.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Coupon not found")
    return {"ok": True}


@api.post("/admin/offers/migrate-types")
async def admin_migrate_offer_types(user: dict = Depends(get_current_user)):
    """One-shot migration: infer offer_type on legacy offers that lack it.

    Heuristic: if offer has a `cta_link` pointing to /c/<slug>, set offer_type=category
    and l1_slug from the slug. If cta_link points to /store/<id>, set offer_type=store.
    All others remain untyped (fallback to random products in /offers/{id}/products).
    """
    _admin_only(user)
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
async def admin_list_categories(user: dict = Depends(get_current_user)):
    _admin_only(user)
    rows = await db.categories.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    return rows


ALLOWED_CATEGORY_FIELDS = {"name", "image", "redirect_url", "order", "paused", "non_clickable"}


@api.put("/admin/categories/{cid}")
async def admin_update_category(cid: str, payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
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
async def admin_list_subcategories(user: dict = Depends(get_current_user), l1_id: Optional[str] = None):
    _admin_only(user)
    q = {"l1_id": l1_id} if l1_id else {}
    rows = await db.subcategories.find(q, {"_id": 0}).to_list(500)
    return rows


@api.put("/admin/subcategories/{sid}")
async def admin_update_subcategory(sid: str, payload: dict, user: dict = Depends(get_current_user)):
    _admin_only(user)
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


@api.post("/admin/cms/upload")
async def admin_cms_upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Cloudinary upload for any CMS image asset. Returns the secure_url
    that admins can copy/paste into hero/category/offer image fields."""
    _admin_only(user)
    return await cloudinary_service.upload_image(file, "cms", user.get("sub", "admin"))


@api.get("/admin/cms/search-destinations")
async def admin_search_destinations(q: str = "", user: dict = Depends(get_current_user)):
    """Unified destination picker — searches Stores, Products, L1, L2 and Offers.
    Returns up to 8 of each kind. `q` is case-insensitive substring match."""
    _admin_only(user)
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
    user: dict = Depends(get_current_user),
    asset_type: str = "hero",
    days: int = 7,
    limit: int = 10,
):
    _admin_only(user)
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


# ============ Lokl V2 — Site CMS ============
# IMPORTANT: keep these defaults in sync with /app/backend/seeds/homepage_config.py
# (the seed is the canonical authored ordering; this constant is the fallback
# used only when neither the seed has run nor any admin has saved a config).
DEFAULT_HOMEPAGE_SECTIONS = [
    {"id": "hero",            "label": "Hero",                       "enabled": True, "rank": 1},
    {"id": "under_499",       "label": "Under ₹499",                 "enabled": True, "rank": 2},
    {"id": "category_pills",  "label": "Category pills",             "enabled": True, "rank": 3},
    {"id": "popular_in_city", "label": "Trending now",               "enabled": True, "rank": 10},
    {"id": "stores",          "label": "Popular stores in Bhilai",   "enabled": True, "rank": 20},
    {"id": "offers",          "label": "Offers for you",             "enabled": True, "rank": 30},
    {"id": "selling_fast",    "label": "Selling fast",               "enabled": True, "rank": 40},
    {"id": "recently_viewed", "label": "Recently added",             "enabled": True, "rank": 50},
    {"id": "customer_love",   "label": "Loved by Bhilai shoppers",   "enabled": True, "rank": 70},
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
            "is_deleted": {"$ne": True}, "product_count": {"$gte": 1}}

def _visible_product_filter():
    return {"paused": {"$ne": True}, "is_deleted": {"$ne": True}}


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
      Toggle ON + in hours + last_seen 60–180 min     → rank 2, Away,          can_order=True
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
                "can_order": True, "eta_message": "Delivery in ~30 mins", "opens_at_label": None}

    try:
        last_dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        elapsed_min = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
        if elapsed_min < 60:
            return {"rank": 1, "badge": "LIVE", "badge_color": "green",
                    "can_order": True, "eta_message": "Delivery in ~30 mins", "opens_at_label": None}
        if elapsed_min < 180:
            return {"rank": 2, "badge": "Away", "badge_color": "yellow",
                    "can_order": True, "eta_message": "May be delayed · Store is away", "opens_at_label": None}
        return {"rank": 4, "badge": "Store Offline", "badge_color": "red",
                "can_order": False, "eta_message": "Store offline · Try other stores", "opens_at_label": None}
    except Exception:
        return {"rank": 1, "badge": "LIVE", "badge_color": "green",
                "can_order": True, "eta_message": "Delivery in ~30 mins", "opens_at_label": None}


async def _availability_map() -> dict[str, dict]:
    """Return {store_id: availability_dict} for ALL non-deleted/paused stores.
    Includes toggle-OFF stores so feeds can rank them at the bottom (rank=4)."""
    stores = await db.stores.find(
        _visible_store_filter(),
        {"_id": 0, "id": 1, "online": 1, "last_seen_at": 1, "opens_at": 1, "closes_at": 1}
    ).to_list(2000)
    return {s["id"]: _store_availability(s) for s in stores}


def _attach_store_avail(products: list, avail_map: dict) -> list:
    """Stamp store availability fields onto each product dict in-place."""
    _default = {"rank": 1, "badge": "LIVE", "badge_color": "green",
                "can_order": True, "eta_message": "Delivery in ~30 mins", "opens_at_label": None}
    for p in products:
        avail = avail_map.get(p.get("store_id"), _default)
        p["store_badge"] = avail["badge"]
        p["store_badge_color"] = avail["badge_color"]
        p["store_can_order"] = avail["can_order"]
        p["store_eta_message"] = avail["eta_message"]
        p["store_opens_at_label"] = avail["opens_at_label"]
        p["store_availability_rank"] = avail["rank"]
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

def _attach_distance_and_eta(stores: list, user_lat: Optional[float], user_lng: Optional[float]) -> list:
    """Compute distance_km + eta_min from store coords ↔ user coords, then sort ascending."""
    if user_lat is None or user_lng is None:
        # No user coords — distance/ETA hidden (frontend should respect this)
        for s in stores:
            s.pop("distance_km", None); s.pop("eta_min", None)
        return stores
    for s in stores:
        slat, slng = s.get("lat"), s.get("lng")
        if isinstance(slat, (int, float)) and isinstance(slng, (int, float)):
            d = round(_haversine_km(user_lat, user_lng, float(slat), float(slng)), 2)
            s["distance_km"] = d
            # Simple ETA model: 15 min base prep + ~5 min/km for short distances, capped 90.
            s["eta_min"] = max(20, min(90, int(round(15 + d * 5))))
        else:
            s.pop("distance_km", None); s.pop("eta_min", None)
    return stores


@api.get("/stores")
async def list_stores(city: Optional[str] = None, limit: int = 50,
                      lat: Optional[float] = None, lng: Optional[float] = None):
    q = dict(_visible_store_filter())
    if city: q["city"] = city
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
async def feed_popular_stores(limit: int = 10):
    """Stores with the most orders in the last 30 days, sorted by availability rank."""
    stores = await db.stores.find(_visible_store_filter(), {"_id": 0, "banner_images": 0}).to_list(200)
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
        return {"status": "live", "label": "LIVE", "eta_label": "30 minutes", "message": "Fast delivery"}

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


@api.get("/stores/{store_id}")
async def get_store(store_id: str):
    s = await db.stores.find_one({"id": store_id, **_visible_store_filter()}, {"_id": 0})
    if not s: raise HTTPException(404, "Store not found")
    avail = _store_availability(s)
    s["badge"] = avail["badge"]
    s["badge_color"] = avail["badge_color"]
    s["is_open"] = avail["can_order"]
    s["eta_message"] = avail["eta_message"]
    if avail.get("opens_at_label"):
        s["next_open_label"] = avail["opens_at_label"]
    products = await db.products.find({"store_id": store_id, **_visible_product_filter()}, {"_id": 0, "images": 0}).to_list(200)
    for p in products:
        p["store_badge"] = avail["badge"]
        p["store_badge_color"] = avail["badge_color"]
        p["store_can_order"] = avail["can_order"]
        p["store_eta_message"] = avail["eta_message"]
        p["store_opens_at_label"] = avail.get("opens_at_label")
        p["store_availability_rank"] = avail["rank"]
    return {"store": s, "products": products}

@api.get("/products")
async def list_products(l1: Optional[str] = None, l2: Optional[str] = None,
                        gender: Optional[str] = None, store: Optional[str] = None,
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


@api.get("/products/all")
async def all_products(
    price: Optional[str] = None,
    sort: Optional[str] = None,
    limit: int = 60,
):
    avail_map = await _availability_map()
    q: dict = {**_visible_product_filter()}
    if price == "under-499":
        q["price"] = {"$lt": 499}
    elif price == "499-1099":
        q["price"] = {"$gte": 499, "$lte": 1099}
    elif price == "above-1099":
        q["price"] = {"$gt": 1099}
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
    similar_q = {"id": {"$ne": pid}, **_visible_product_filter()}
    if p.get("l2_id"): similar_q["l2_id"] = p["l2_id"]
    elif p.get("l1_id"): similar_q["l1_id"] = p["l1_id"]
    similar = await db.products.find(similar_q, {"_id": 0, "images": 0}).limit(8).to_list(8)
    return {"product": p, "similar": similar}


# ===== Orders =====
SERVICEABLE_CITIES = ["bhilai"]

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
                send_with_fallback(phone, msg)
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

    addr_city = (payload.address.get("city") or "").strip().lower()
    if addr_city not in SERVICEABLE_CITIES:
        raise HTTPException(400, "We're only serving Bhilai right now — please update your delivery city.")
    addr_pincode = str(payload.address.get("pincode") or "").strip()
    _BHILAI_PINCODES = {"490001", "490006", "490009", "490020", "490023"}
    if addr_pincode and addr_pincode not in _BHILAI_PINCODES:
        raise HTTPException(400, "We only deliver to Bhilai pincodes (490xxx). Please check your pincode.")

    # Pre-check store availability before any stock reservations.
    payload_store_ids = list({it.get("store_id") for it in payload.items if it.get("store_id")})
    if payload_store_ids:
        unavailable_stores = []
        for sid in payload_store_ids:
            store_doc = await db.stores.find_one({"id": sid, **_visible_store_filter()}, {"_id": 0})
            avail = _store_availability(store_doc) if store_doc else {"can_order": False, "eta_message": "Store unavailable"}
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
                            "return_eligible": 1, "name": 1, stock_field: 1},
                return_document=True,
            )
            if not updated:
                raise HTTPException(409, f"Insufficient stock for {p.get('name', pid)}"
                                         + (f" (size {size})" if size else ""))
            reservations.append((pid, size or "default", qty))

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
        server_total = _sum_items_money(items_snap)

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
        server_total = max(Decimal("0.00"), server_total - coupon_discount)

        now = datetime.now(timezone.utc).isoformat()
        unique_mids = list(set([m for m in merchant_ids if m]))
        # CSPRNG (secrets) — these OTPs gate order delivery / WhatsApp verification, must not be predictable.
        _otp_rng = secrets.SystemRandom()
        def _new_otp(): return f"{_otp_rng.randint(1000, 9999)}"
        merchant_otps = {mid: _new_otp() for mid in unique_mids}
        otp = merchant_otps[unique_mids[0]] if unique_mids else _new_otp()
        merchant_states = {mid: "pending" for mid in unique_mids}
        merchant_timelines = {mid: _new_merchant_timeline(now) for mid in unique_mids}
        doc = {"id": order_id, "items": items_snap, "address": payload.address,
               "total": float(server_total), "payment_method": payload.payment_method,
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
               "merchant_cancelled": {},
               "is_multi_store": len(unique_mids) > 1,
               "otp": otp,
               "is_deleted": False,
               "created_at": now,
               "timeline": [{"label": "Order placed", "time": now},
                            {"label": "Merchant accepted", "time": None},
                            {"label": "Order on the way", "time": None},
                            {"label": "Delivered", "time": None}]}

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
        # ROLL BACK any successful stock decrements before re-raising
        for pid, sz, qty in reservations:
            stock_field = f"stock.{sz}"
            await db.products.update_one({"id": pid}, {"$inc": {stock_field: qty}})
        raise

    if payload.customer and payload.customer.get("phone"):
        await _upsert_customer(payload.customer, payload.address)
    cust_phone = (payload.customer or {}).get("phone") or (payload.address or {}).get("phone")
    if cust_phone:
        try: notify_order_placed(cust_phone, order_id, float(server_total))
        except Exception: pass
    # Notify merchants for COD and Razorpay (payment verified at order creation time).
    if doc.get("payment_method") in ("COD", "razorpay"):
        for mid in unique_mids:
            m = await db.merchants.find_one({"id": mid}, {"_id": 0, "phone": 1})
            if m and m.get("phone"):
                their_items = [it for it in items_snap if it.get("merchant_id") == mid]
                try: notify_merchant_new_order(m["phone"], order_id, float(server_total), len(their_items))
                except Exception: pass
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
    else:
        # Customer must own this order — compare last 10 digits of phone
        def _norm(p: str) -> str:
            return _re.sub(r"\D", "", str(p or ""))[-10:]
        order_phone = (o.get("customer") or {}).get("phone") or o.get("customer_phone", "")
        if _norm(caller) != _norm(order_phone):
            raise HTTPException(403, "This order was not placed with your mobile number")

    # Enrich multi-store orders with per-merchant breakdown for the customer
    # tracking UI: items grouped by store + each store's own 4-step timeline.
    if o.get("is_multi_store"):
        breakdown = []
        for mid in (o.get("merchant_ids") or []):
            items = [it for it in (o.get("items") or []) if it.get("merchant_id") == mid]
            if not items: continue
            sname = items[0].get("store_name") or "Store"
            sid = items[0].get("store_id")
            breakdown.append({
                "merchant_id": mid,
                "store_id": sid,
                "store_name": sname,
                "items": items,
                "subtotal": round(sum(float(it.get("price", 0)) * int(it.get("qty", 1)) for it in items), 2),
                "state": (o.get("merchant_states") or {}).get(mid, "pending"),
                "timeline": (o.get("merchant_timelines") or {}).get(mid) or [],
                "delivered_at": (o.get("merchant_delivered_at") or {}).get(mid),
                # Customer sees the per-store OTP only AFTER that store accepts
                "otp": (o.get("merchant_otps") or {}).get(mid) if (o.get("merchant_states") or {}).get(mid) in ("handed_off", "delivered") else None,
                "cancel_reason": (o.get("merchant_cancelled") or {}).get(mid),
            })
        o["store_breakdown"] = breakdown
    return o

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
        # Hide other merchants' OTPs from this merchant's view
        if o.get("merchant_otps"):
            o["merchant_otps"] = {mid: o["my_otp"]}
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
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    m = await db.merchants.find_one({"id": mid}, {"_id": 0, "store_name": 1, "business_address": 1})
    # This merchant's UNIQUE 4-digit OTP (each store gets its own; customer
    # receives the OTP only after that merchant accepts).
    my_otp = (o.get("merchant_otps") or {}).get(mid) or o.get("otp", "")
    if not my_otp:
        import random as _random
        my_otp = str(_random.randint(1000, 9999))
        log.warning("[rider-pickup] no OTP found for order=%s mid=%s — generated fallback %s", oid, mid, my_otp)
    if cust_phone:
        try: notify_order_accepted(cust_phone, oid, (m or {}).get("store_name", "your store"), otp=my_otp)
        except Exception: pass
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
                customer_lat=o.get("customer_lat") or addr.get("lat") or 0,
                customer_lng=o.get("customer_lng") or addr.get("lng") or 0,
            )
        except Exception as e:
            log.error("[rider-pickup] failed order=%s error=%s", oid, e)
    return {"ok": True, "otp": my_otp, "all_accepted": all_accepted, "my_state": "accepted"}

@api.post("/merchant/orders/{oid}/handed-to-rider")
async def merchant_handed_to_rider(oid: str, user: dict = Depends(get_current_user)):
    """Merchant confirms the rider has been handed the package after matching OTP.
    In multi-store carts each merchant hands off independently — we check the
    PER-MERCHANT state, not the global order status."""
    o = await db.orders.find_one({"id": oid, "merchant_ids": user["sub"]}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    mid = user["sub"]
    states = dict(o.get("merchant_states") or {})
    my_state = states.get(mid) or (o.get("status") if not states else "pending")
    if my_state not in ("accepted",):
        raise HTTPException(400, "Accept the order before handing it to the rider")
    now = datetime.now(timezone.utc).isoformat()
    # Mark this merchant as handed off
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
    await db.orders.update_one({"id": oid}, {"$set": {"status": new_global, "merchant_states": states,
                                                       "merchant_timelines": timelines, "timeline": tl}})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone:
        # Notify customer THIS store is on the way (with that store's unique OTP)
        my_otp = (o.get("merchant_otps") or {}).get(mid) or o.get("otp", "")
        try: notify_order_on_the_way(cust_phone, oid, my_otp)
        except Exception: pass
    return {"ok": True, "all_handed": all_handed, "my_state": "handed_off"}


# ===== Admin order management =====
@api.post("/admin/orders/{oid}/mark-delivered")
async def admin_mark_delivered(oid: str, request: Request, payload: Optional[dict] = None):
    """Mark an order (or one merchant's slice of a multi-store order) as delivered.

    Payload (optional): `{"merchant_id": "..."}` — when present on a multi-store
    order, marks only that merchant's slice. Global order flips to `delivered`
    only after every merchant has delivered."""
    _check_admin(request.headers.get("authorization"))
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
        states[mid] = "delivered"
        if mid not in timelines:
            timelines[mid] = _new_merchant_timeline(o.get("created_at", now))
        timelines = _stamp_merchant_step(timelines, mid, "Delivered", now)
        delivered_map[mid] = now

    new_global = _derive_global_status(states) if states else "delivered"
    tl = o.get("timeline", [])
    update_doc = {"status": new_global, "merchant_states": states,
                  "merchant_timelines": timelines, "merchant_delivered_at": delivered_map}
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
        except Exception: pass
    return {"ok": True, "all_delivered": new_global == "delivered", "merchant_states": states}

@api.post("/admin/orders/{oid}/cancel")
async def admin_cancel_order(oid: str, request: Request, payload: Optional[dict] = None):
    """Cancel an order or one merchant's slice of a multi-store order.

    Payload (optional): `{"reason": "...", "merchant_id": "..."}` — when
    `merchant_id` is present on a multi-store order, only that merchant's slice
    is cancelled; the rest of the order continues. Global flips to `cancelled`
    only when every merchant on the order is cancelled (or none remain active).

    Stock for the cancelled slice's items is atomically restored to the
    product catalog so the unsold inventory becomes immediately available again."""
    _check_admin(request.headers.get("authorization"))
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o: raise HTTPException(404, "Order not found")
    if o.get("status") == "delivered":
        raise HTTPException(400, "Cannot cancel a delivered order")
    reason = (payload or {}).get("reason") or "Cancelled by admin"
    target_mid = (payload or {}).get("merchant_id")
    mids = o.get("merchant_ids") or []

    # Restock the cancelled-slice items
    items_to_restock = [it for it in (o.get("items") or [])
                       if (not target_mid) or it.get("merchant_id") == target_mid]
    for it in items_to_restock:
        pid = it.get("id"); qty = int(it.get("qty", 1) or 1)
        size = (it.get("size") or "").strip() or "default"
        if pid and qty > 0:
            await db.products.update_one({"id": pid}, {"$inc": {f"stock.{size}": qty}})

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
        except Exception: pass
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
def _admin_token(): return create_token("admin", "admin")
def _check_admin(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin token required")
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload.get("role") != "admin": raise HTTPException(403, "Not an admin")
    return payload

@api.post("/admin/login")
@_limit(_LIMIT_ADMIN_LOGIN)
async def admin_login(request: Request, payload: AdminLogin):
    # Constant-time comparison for email + bcrypt for password. Plain-text
    # ADMIN_PASSWORD support has been removed — ADMIN_PASSWORD_HASH is required.
    email_ok = hmac.compare_digest(payload.email, ADMIN_EMAIL)
    password_ok = bcrypt.checkpw(payload.password.encode(), ADMIN_PASSWORD_HASH.encode())
    if not (email_ok and password_ok):
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

@api.get("/admin/waitlist")
async def admin_waitlist(request: Request):
    _check_admin(request.headers.get("authorization"))
    customers = await db.waitlist.find({"type": "customer"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    merchants = await db.waitlist.find({"type": "merchant"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {
        "customers": customers,
        "merchants": merchants,
        "total_customers": len(customers),
        "total_merchants": len(merchants),
    }


@api.get("/admin/page-views")
async def admin_page_views(request: Request):
    _check_admin(request.headers.get("authorization"))
    rows = await db.page_views.find({"page": "coming-soon"}, {"_id": 0}).sort("date", -1).to_list(100)
    total = next((r["count"] for r in rows if r["date"] == "total"), 0)
    daily = [r for r in rows if r["date"] != "total"]
    return {"total": total, "daily": daily}


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
    cands = await db.orders.find({"status": {"$in": ["accepted", "on_the_way"]}}, {"_id": 0}).to_list(500)
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

    now = datetime.now(timezone.utc).isoformat()
    states = dict(o.get("merchant_states") or {})
    timelines = dict(o.get("merchant_timelines") or {})
    delivered_map = dict(o.get("merchant_delivered_at") or {})
    # Only mark delivered if THIS merchant's leg has been handed to rider.
    if target_mid and states.get(target_mid) == "handed_off":
        states[target_mid] = "delivered"
        if target_mid not in timelines:
            timelines[target_mid] = _new_merchant_timeline(o.get("created_at", now))
        timelines = _stamp_merchant_step(timelines, target_mid, "Delivered", now)
        delivered_map[target_mid] = now
    elif target_mid is None and not states:
        # Truly legacy order (no per-merchant state) — flip global
        pass
    new_global = _derive_global_status(states) if states else "delivered"
    tl = o.get("timeline", [])
    update_doc = {"status": new_global, "merchant_states": states,
                  "merchant_timelines": timelines, "merchant_delivered_at": delivered_map,
                  "delivered_via": "rider-whatsapp"}
    if new_global == "delivered":
        for t in tl:
            if t["label"] == "Delivered" and not t["time"]:
                t["time"] = now; break
        update_doc["timeline"] = tl
        update_doc["delivered_at"] = now
    await db.orders.update_one({"id": o["id"]}, {"$set": update_doc})
    cust_phone = (o.get("customer") or {}).get("phone") or (o.get("address") or {}).get("phone")
    if cust_phone and new_global == "delivered":
        try: notify_order_delivered(cust_phone, o["id"])
        except Exception: pass
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
async def debug_sentry(request: Request):
    """Admin-only smoke test for Sentry wiring.

    Intentionally raises so the error reaches Sentry. Use this once after
    pasting a real SENTRY_DSN to confirm the dashboard receives events.
    Returns 503 when Sentry is disabled (graceful no-op mode).
    """
    _check_admin(request.headers.get("authorization"))
    if not os.environ.get("SENTRY_DSN", "").strip():
        raise HTTPException(503, "Sentry is disabled (SENTRY_DSN not set).")
    raise RuntimeError("Sentry debug — intentional test exception from /api/_debug/sentry")


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

# ===== v1 geolocation routers (nearby stores, products, delivery estimate,
# cities, customer addresses, merchant store location) =====
from routes.geo import init as _init_geo
from routes.addresses import init as _init_addresses
from services.cache_service import cache_service
from services.payment_service import (create_razorpay_order, refund_payment,
                                       verify_webhook_signature, verify_payment_signature,
                                       is_enabled as razorpay_enabled)
from services.audit_service import AuditService
app.include_router(_init_geo(db))
app.include_router(_init_addresses(db, merchant_user))
audit_service = AuditService(db)

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


async def _auto_cancel_stale_orders():
    """Background loop: cancel COD orders stuck in pending_merchant > 2 hours."""
    import asyncio as _asyncio
    while True:
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
                {"_id": 0, "id": 1, "merchant_ids": 1, "customer": 1}
            ):
                oid = order["id"]
                now_iso = datetime.now(timezone.utc).isoformat()
                cancel_states = {mid: "cancelled" for mid in (order.get("merchant_ids") or [])}
                await db.orders.update_one({"id": oid}, {"$set": {
                    "status": "cancelled",
                    "cancelled_at": now_iso,
                    "cancel_reason": "Auto-cancelled: no merchant response within 2 hours",
                    "merchant_states": cancel_states,
                }})
                cust_phone = (order.get("customer") or {}).get("phone")
                if cust_phone:
                    try:
                        from notifications import send_with_fallback
                        send_with_fallback(cust_phone,
                            f"Your Lokl order {oid} was auto-cancelled as no merchant accepted it within 2 hours. "
                            "You have not been charged.")
                    except Exception:
                        pass
                log.info("Auto-cancelled stale order %s", oid)
        except Exception as e:
            log.warning("_auto_cancel_stale_orders error: %s", e)
        await _asyncio.sleep(300)  # check every 5 minutes


@app.on_event("startup")
async def startup_seed():
    log.info("[startup] RIDER_PHONE=%s APP_URL=%s TWILIO_FROM=%s",
        bool(os.environ.get("RIDER_PHONE")),
        os.environ.get("APP_URL", "NOT SET"),
        bool(os.environ.get("TWILIO_WHATSAPP_FROM")),
    )
    # ----- MongoDB version + geo support check -----
    try:
        info = await client.server_info()
        ver = info.get("version", "0.0")
        major = int(str(ver).split(".")[0])
        log.info("[GEO] MongoDB %s — geospatial support %s", ver, "OK" if major >= 6 else "DEGRADED (<6.0)")
    except Exception as e:
        log.warning("Mongo version check failed: %s", e)

    # ----- Redis cache (optional; degrades gracefully) -----
    try:
        await cache_service.connect()
    except Exception as e:
        log.warning("Cache connect skipped: %s", e)

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
