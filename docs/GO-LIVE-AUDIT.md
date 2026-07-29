# Lokl Go-Live Readiness Audit

**Context:** Pre-launch hyperlocal fashion marketplace, Bhilai. Launch model is
**cash-on-delivery / pay-at-delivery only** — Razorpay is integrated in the
backend but dormant (business not yet registered to hold/accept money
online). No real customers yet. No confirmed error monitoring in production.
Stack: Next.js 15 (frontend), FastAPI (backend, single `server.py` monolith),
MongoDB Atlas, Railway, Twilio WhatsApp, Cloudinary.

This document is filled in across multiple audit passes. Pass 0 (this pass)
only scopes the system and maps risk areas — it does not render a verdict.

---

## Scope & Risk Map  (Pass 0 — this pass)

### 1. Backend map — `backend/server.py` (5,711 lines, single file)

| Section | Lines | Size | Notes |
|---|---|---|---|
| Bootstrap (health probe, rate limiter, security headers, merchant activity tracker) | 1–147 | 147 | |
| Models (Pydantic schemas) | 147–258 | 111 | |
| Customer OTP auth (WhatsApp-delivered, bcrypt-hashed OTP, JWT issuance) | 258–555 | 297 | Includes merchant phone-OTP login sub-block (555–710) |
| Categories | 710–724 | 14 | |
| Homepage feeds (V2 dynamic feed engine) | 724–1,407 | 683 | Large — powers the whole homepage rail system |
| Upload security + Cloudinary endpoints | 1,407–1,529 | 122 | |
| Homepage Asset CMS | 1,529–1,733 | 204 | |
| Click analytics | 1,733–1,839 | 106 | |
| Site CMS | 1,839–1,962 | 123 | |
| Public catalog (product/store browse, search) | 1,962–2,586 | 624 | Second-largest block |
| **Orders — core lifecycle** (FSM, money helpers, create/get/rate order, merchant accept/handoff, pickup flow) | 2,586–3,449 | 863 | **Largest single block; the actual order-creation and Razorpay-adjacent code lives here, under a stale `# ===== Soft delete helpers =====` header — see Finding F1** |
| Admin order management (mark-delivered, cancel) | 3,449–3,565 | 116 | |
| Merchant KYC | 3,565–3,616 | 51 | |
| Change requests (bank/address) | 3,616–3,633 | 17 | |
| Merchant storefront / products / publish | 3,633–4,125 | 492 | |
| Merchant AI (image enhance, copy, try-on) | 4,125–4,142 | 17 | |
| Analytics | 4,142–4,353 | 211 | |
| Waitlist | 4,353–4,377 | 24 | |
| Page views | 4,377–4,396 | 19 | |
| Admin (merchant approvals, store/product moderation) | 4,396–4,739 | 343 | |
| OTP-protected delete (mocked email) | 4,739–4,989 | 250 | |
| Returns | 4,989–5,246 | 257 | |
| Complaints | 5,246–5,320 | 74 | |
| Internal health check (INTERNAL_API_KEY-gated) | 5,320–5,346 | 26 | |
| Admin: live users + customers directory | 5,346–5,425 | 79 | |
| Geo | 5,425–5,464 | 39 | |
| Root / router mounting / CORS | 5,464–5,711 | 247 | |

Supporting backend modules: `auth.py` (96), `notifications.py` (504, Twilio
WhatsApp templates), `feeds.py` (171), `observability.py` (48, Sentry init),
`routes/addresses.py` (201), `routes/geo.py` (278), `services/payment_service.py`
(Razorpay wrapper).

**F1 — stale section comment.** The block from line 2,708 onward is still
headed `# ===== Soft delete helpers =====`, but it actually contains the
entire order lifecycle: `razorpay_create_payment_order`, `create_order`,
`get_order`, `rate_order_product`, `merchant_accept_order`,
`merchant_handed_to_rider`, `accept_pickup`, `verify_pickup`,
`confirm_pickup`, `cancel_pickup_reservation`, `expire_pickups`. Not a
functional bug, but it means anyone navigating by section headers (as this
audit initially tried to) will miss the most important code in the file.
Worth a one-line comment fix before this file gets much bigger.

### 2. Frontend map — `frontend/src/app`

| Route group | Pages | ~LOC |
|---|---|---|
| `(consumer)` — public shopping app | 19 | 3,094 |
| `merchant` — seller dashboard | 12 | 3,258 |
| `admin` — internal ops (+ `admin/login`) | 2 | 1,020 |

`/account` is split unusually: a top-level `app/account/` (own `layout.tsx`)
holds the main account page, while `app/(consumer)/account/{orders,support}`
sit inside the consumer route group. Not a bug, just an inconsistency worth
a look in Pass 3/6 (two different layout contexts for what a user would
consider one flow).

### 3. Razorpay dormancy — CONFIRMED DORMANT BY CODE, PENDING ONE OPERATIONAL CONFIRMATION

Every Razorpay code path was traced end-to-end:

- **`services/payment_service.py`** — `is_enabled()` returns `True` only if
  both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` env vars are non-blank.
  If either is unset, every Razorpay function returns `None`/refuses to run.
  There's also a hard `SystemExit` guard: if `RAZORPAY_MODE=live` but the key
  doesn't start with `rzp_live_`, the process refuses to start.
- **`POST /api/payments/razorpay/create-order`** — returns `503 "Online
  payment unavailable. Try COD."` immediately if `razorpay_enabled()` is
  false. This is the *only* endpoint that can mint a real Razorpay order.
- **`POST /api/orders`** — will only set `payment_method="razorpay"` if the
  request includes `razorpay_payment_id`, `razorpay_order_id`, AND
  `razorpay_signature`, and the signature HMAC-verifies against
  `RAZORPAY_KEY_SECRET` server-side. An attacker without the real secret
  cannot forge this even if they know the exact algorithm.
- **`POST /api/webhooks/payment`** — Razorpay webhook receiver; also
  signature-gated (`RAZORPAY_WEBHOOK_SECRET`) and only actionable if a
  Razorpay order already exists to match against.
- **Frontend — fully COD-only, confirmed by direct code trace:**
  - `checkout/page.tsx:61` — `const [payment] = useState<"COD">("COD");`
    — the array-destructure **omits the setter entirely**. There is no UI
    control anywhere that can change this value. The payment section of the
    checkout page renders a single static "Pay at Delivery" block (no radio
    group, no method switcher).
  - `checkout/page.tsx:56` — `const razorpay = useRazorpay();` is called,
    but the returned `openCheckout` function is **never invoked anywhere in
    the codebase** (confirmed by grep across all of `frontend/src`). The
    hook's only real side effect is that it injects the
    `checkout.razorpay.com/v1/checkout.js` `<script>` tag into every
    checkout-page visit — dead weight, not a payment risk, since nothing
    ever calls `.open()`.
  - `components/consumer/ProductActions.tsx:124` — the buy-now/reserve path
    also hardcodes `payment_method: "COD"`.
  - No other frontend file references `payment_method` with any value other
    than `"COD"`.

**Conclusion:** there is no reachable UI path, anywhere in the current
frontend, that can produce a live Razorpay charge. The backend is
correctly self-gating — it will refuse to process Razorpay payments unless
real API keys are present in the environment.

**⚠️ One thing this audit cannot verify from code alone:** whether
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` are
actually **set** in the live Railway environment right now. Neither
`backend/` nor `frontend/` ships a committed `.env` — only
`frontend/.env.example`, which documents GA4 only and says nothing about
Razorpay. If those keys happen to be populated in Railway (e.g. left over
from earlier integration testing) with **live** (`rzp_live_`) credentials,
someone with API access (not the public UI — a direct authenticated API
call) could still mint a real charge via `/api/payments/razorpay/create-order`
directly. **Action item for Pass 5: manually confirm in the Railway
dashboard that these three env vars are unset, or set to test-mode
(`rzp_test_`) values only.** This is the single highest-priority regulatory
check in the entire audit and is outside what a code read can settle.

### 4. Observability — code exists, activation is unverified

- **Backend:** `observability.py` wires up `sentry_sdk` with FastAPI/Starlette
  integrations, called unconditionally at import time (`server.py:47`), but
  is a documented no-op if `SENTRY_DSN` is blank. Structured logging exists
  (`logging.basicConfig(level=logging.INFO)`, named logger `"lokl"`, ~42
  `log.info/warning/error` call sites) — this is **not** "just print
  statements"; there are only 2 raw `print()` calls in the entire file (both
  debug counters in the homepage feed code). There's even an admin-only
  endpoint to manually verify Sentry connectivity.
- **Frontend:** `components/SentryBoot.tsx` lazy-loads `@sentry/react` only
  if `NEXT_PUBLIC_SENTRY_DSN` is set; also a documented no-op otherwise.
- **The catch:** both are opt-in via env var, and — same as Razorpay — this
  audit cannot see Railway's actual environment. **If `SENTRY_DSN` /
  `NEXT_PUBLIC_SENTRY_DSN` are not set in production, the net effect is
  exactly what was assumed going in: no error monitoring, full stop**,
  regardless of how solid the integration code looks.
- **Independent of the Sentry question:** found **41 instances** of
  `except Exception: pass` (or bare `except: pass`) in `server.py` — mostly
  wrapping outbound notification sends (WhatsApp/SMS). These silently
  swallow failures *before* Sentry's automatic uncaught-exception capture
  would ever see them (deliberately caught exceptions need an explicit
  `capture_exception()` call, which none of these have). So even with
  Sentry fully wired and DSN set, these 41 sites would stay invisible. This
  is very likely a Pass 1 blocker candidate on its own.

### 5. Order state map

Two-layer status model:

**Per-merchant slice state** (multi-store cart support) — `_STATE_RANK`:
`pending → accepted → handed_off → delivered` (+ `cancelled`, excluded from
ranking). The **global** order status shown to the customer is derived as
the *minimum*-ranked active (non-cancelled) merchant state.

**Global order status** — `ORDER_STATUS_TRANSITIONS` FSM:

```
pending_merchant → accepted → on_the_way → delivered → { returned, completed }
                 ↘ cancelled           ↘ cancelled
```

Plus a parallel **pickup-order** status track (`order_type == "pickup"`,
not governed by the same FSM object): `pending_pickup → reserved →
delivered`, or `→ cancelled` from either state, with an admin/cron sweep
(`GET /admin/expire-pickups`) that force-cancels expired reservations.

| Status | Set by | Endpoint |
|---|---|---|
| `pending_merchant` | Order creation | `POST /api/orders` |
| `accepted` | Merchant accepts (all merchant slices ≥ accepted) | `POST /api/merchant/orders/{oid}/accept` |
| `on_the_way` | Merchant hands to rider (all slices ≥ handed_off) | `POST /api/merchant/orders/{oid}/handed-to-rider` |
| `delivered` | Admin marks delivered, OR rider WhatsApp reply `"<OTP> - Delivered"` | `POST /api/admin/orders/{oid}/mark-delivered`, `POST /api/twilio/inbound` |
| `cancelled` | Admin cancel, pickup expiry, pickup cancel | `POST /api/admin/orders/{oid}/cancel`, `GET /api/admin/expire-pickups`, `POST /api/merchant/orders/{oid}/cancel-pickup` |
| `returned` | Return flow reaches `completed` | `POST /api/admin/returns/{rid}/complete` |
| `completed` | **No code path sets this — dead FSM state** | — |
| `pending_pickup` | Pickup order creation | `POST /api/orders` (`order_type=pickup`) |
| `reserved` | Merchant accepts pickup request | `POST /api/merchant/orders/{oid}/accept-pickup` |

Notable things surfaced while mapping this (detail deferred to Pass 2):

- **`verify_pickup` and `confirm_pickup` are near-duplicate endpoints** —
  both flip `reserved → delivered`, but `verify_pickup` requires the
  customer's 4-digit code in the request body while `confirm_pickup` has
  no code check at all (docstring says "after visual code verification",
  i.e. trusts the merchant to have checked manually). Worth confirming
  intent in Pass 2 — two ways to close the same state with different
  integrity guarantees is exactly the kind of thing that causes disputes.
- **Two different admin-auth mechanisms coexist**: `mark-delivered`,
  `cancel`, and the returns action endpoint use a manual
  `_check_admin(request.headers.get("authorization"))` header check, while
  `expire_pickups` uses the JWT-based `Depends(admin_user)`. Flagging for
  Pass 3.
- **The Twilio inbound webhook is a real state-transition entry point**,
  not just a notification receiver — a WhatsApp reply matching
  `<OTP> - Delivered` or `<OTP> picked up` (regex-matched) will mark an
  order delivered / a return picked-up. Gated by Twilio HMAC-SHA1 signature
  (only enforced if `TWILIO_AUTH_TOKEN` is set) and restricted to a single
  `RIDER_PHONE` env var. Same "is this env var actually set in prod"
  question as Razorpay/Sentry applies here — if `TWILIO_AUTH_TOKEN` is
  blank, signature checking is skipped entirely. Flagging for Pass 3.
- `order.status == "completed"` is allowed by the FSM but no endpoint ever
  writes it — dead state, low priority, but worth a note in code cleanup.

---

## Pass 1 — Observability & "do we find out when it breaks"

_Not started. Seed findings from Pass 0: Sentry code exists on both ends but
activation depends on env vars this audit cannot see; 41 swallowed
exceptions in `server.py` bypass it regardless._

## Pass 2 — Order Lifecycle & Failure Modes (COD + pickup)

_Not started. Seed findings from Pass 0: duplicate pickup-confirmation
endpoints with different integrity guarantees; dead `completed` state;
Twilio-driven delivery confirmation as an unusual side-channel state
transition._

## Pass 3 — Auth, Authorization & Data Integrity

_Not started. Seed findings from Pass 0: two coexisting admin-auth
mechanisms (`_check_admin` header parsing vs. `Depends(admin_user)` JWT);
Twilio webhook signature check is conditionally skipped if
`TWILIO_AUTH_TOKEN` is unset; `/account` route-group placement is
inconsistent._

## Pass 4 — Merchant & Admin Operational Readiness

_Not started._

## Pass 5 — Razorpay Dormancy & Config/Secrets

_Not started. Seed findings from Pass 0: code-level dormancy is solid and
verified; the one open item is a manual, non-code confirmation that
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` are
unset (or test-mode only) in the live Railway environment._

## Pass 6 — Customer Buy-Journey Completeness

_Not started._

## Verdict

_Not rendered — this is a scoping pass only. No pass/fail judgment yet._
