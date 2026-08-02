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
- **Independent of the Sentry question:** a structural scan (not just grep —
  walked every `except` block's actual body) found **46 exception-swallowing
  sites** in `server.py` — both bare `except Exception: pass` and blocks
  whose only action is a local `print()`/`log.warning()` call (which stays
  on Railway's stdout/log stream but is never forwarded to Sentry unless the
  logging integration is explicitly configured to bridge WARNING+ records).
  These silently swallow failures *before* Sentry's automatic
  uncaught-exception capture would ever see them (deliberately caught
  exceptions need an explicit `capture_exception()` call, which none of
  these have). So even with Sentry fully wired and DSN set, these 46 sites
  would stay invisible. **Full location-by-location breakdown and
  HIGH/LOW risk classification: see Pass 2.**

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

**Read-only pass.** Full read of `create_order`, the order FSM, every
merchant/admin/rider order-transition endpoint, and both pickup-confirmation
endpoints. No code changed.

### 2.1 — The silent excepts (46 total; HIGH-risk subset below)

Structural scan of every `except Exception:` / bare `except:` block in
`server.py` whose entire body is a no-op or a local print/log call (i.e.
nothing re-raises, nothing pages anyone, nothing calls
`sentry_sdk.capture_exception`). **19 of the 46 sit directly in the
order / merchant-transition / notification / stock path** and are classed
HIGH; the other 27 are peripheral (login OTP delivery, feed/analytics
endpoints, support tickets, live-session tracking, merchant subscription
lookups, startup migrations — all logged and/or not order-critical) and are
classed LOW.

**HIGH — order/merchant-transition/notification/stock path (19 sites, 11 functions):**

| # | Line(s) | Function | What it hides | User-visible consequence | Severity |
|---|---|---|---|---|---|
| 1 | 2870 | `create_order()` | Any exception in the Bhilai delivery-geofence check (`_is_in_bhilai_delivery_zone`) | **Not a notification — a validation check.** A bug here doesn't block the order, it silently *lets it through*. Fails open instead of closed on a business rule (only deliver within Bhilai). | **BLOCKER** |
| 2 | 3106 (customer) | `create_order()` | `notify_order_placed` / `notify_pickup_pending` failure | Customer gets no WhatsApp confirmation their order was placed. Order itself is fine (see 2.2). | WARNING |
| 3 | 3120 (merchant) | `create_order()` | `notify_merchant_new_order` / `notify_merchant_pickup_pending` failure | Merchant is never pinged that a new order exists. Nothing else pings them — see 2.4. | **BLOCKER** (compounds with 2.3's finding on `accepted`/`pending_merchant` having no safety net for non-COD) |
| 4 | 3131 | `create_order()` | `notify_merchant_first_order` failure | Cosmetic — a "congrats on your first order" message is lost. Order + #3's notification are separate calls. | NOTE |
| 5 | 1351 | `_handle_payment_captured()` (Razorpay webhook handler) | `notify_merchant_new_order` failure, *after* a paid order is released to the merchant queue | Same as #3 but on the (currently dormant) Razorpay path, with no COD-style auto-cancel safety net at all (see 2.3). | **BLOCKER** (dormant today, live risk if Razorpay is ever enabled) |
| 6 | 3339 | `merchant_accept_order()` | `notify_order_accepted` failure — this message carries the delivery OTP | Customer never receives the OTP the rider/merchant needs to confirm delivery. Downstream OTP-matching (incl. the Twilio-inbound rider-reply flow) has nothing to match against. | **BLOCKER** |
| 7 | 3371 | `merchant_accept_order()` | `notify_rider_pickup` failure (logged via `log.error`, not fully silent, but still no alerting) | Rider is never dispatched/informed for this leg. Order can sit in `accepted` indefinitely — see 2.3, this state has no timeout. | **BLOCKER** |
| 8 | 3408 | `merchant_handed_to_rider()` | `notify_order_on_the_way` failure — also carries the OTP | Same OTP-loss risk as #6, at the next stage. | **BLOCKER** |
| 9 | 3434 | `accept_pickup()` | `notify_pickup_reserved` failure — carries the pickup code, store address, maps link | Customer never learns their reservation was accepted or their pickup code. Moot in practice today since the live UI uses `confirm_pickup`, which never checks the code anyway — see 2.5. | WARNING |
| 10 | 3554 | `admin_mark_delivered()` | `notify_order_delivered` failure | Order state is correctly updated; only the "delivered" message is lost. | NOTE |
| 11 | 3613 | `admin_cancel_order()` | `notify_order_cancelled` failure | Order correctly cancelled + stock restocked; customer isn't told why a COD order they expected never shows up. | WARNING |
| 12 | 4517 | `admin_approve()` (merchant KYC approval) | `notify_merchant_approved` failure | Merchant-transition, not order — approved in DB, but never told via WhatsApp. Lower severity since logging into their dashboard shows it directly. | NOTE |
| 13 | 4931 | `twilio_inbound()` (rider WhatsApp delivery confirmation) | `notify_order_delivered` failure | Order state already correctly flipped to `delivered`; only the customer's confirmation message is lost. | NOTE |
| 14 | 5556 | `_auto_cancel_stale_orders()` (background job) | `send_with_fallback` failure — the auto-cancellation notice | Order is correctly auto-cancelled + restocked; customer isn't told why it vanished. Looks like a silently lost order from their side even though the system behaved correctly. | WARNING |

(Line numbers above are the `except` line itself for single-line sites, or
the first notification call inside the block for multi-line sites; see
`create_order()` full read in 2.2 for exact call sites.)

**Also worth a look, borderline HIGH (order-adjacent, not core FSM):**
`admin_return_action()` (lines 5203, 5213) has two `except Exception: pass`
blocks around outbound rider/customer notifications in the returns flow —
same silent-notification pattern as the delivery path, one step removed.

### 2.2 — `create_order()` deep read (`server.py:2828-3136`)

**(a) DB write partially fails.** The stock-reservation loop and the final
`db.orders.insert_one(doc)` are **both inside the same `try` block**
(`server.py:2933-3100`). A `reservations: list[tuple[str, str, int]]` tracks
every successful atomic stock decrement (`find_one_and_update` with a
`$gte` filter — genuinely atomic per item, safe against concurrent
last-unit checkouts). On **any** exception in that block — a later item
being out of stock, a Mongo error, the insert itself failing — the `except`
clause rolls back every reservation made so far via `$inc` and re-raises.
**Verdict: for the stock-vs-order-document relationship, order creation is
correctly atomic.** No state is reachable where stock is decremented but no
order exists, or where a partially-built order document is persisted. NOTE
(no fix needed here).

**(b) Merchant WhatsApp/Twilio notification fails.** All notification calls
(`server.py:3106` onward) are **strictly after** the `insert_one` at line
3092, in their own separate block with per-call `try/except`. A failure here
can never roll back or corrupt the already-committed order. **Can a customer
get a confirmed order the merchant never sees? Not via the database/API** —
the order exists and is queryable through the merchant's normal order-list
endpoint regardless of notification success. **Via the WhatsApp ping —
yes**, functionally: if #3 in 2.1 fires, the merchant is never proactively
told, and must happen to check their dashboard. Combined with 2.3's finding
that `accepted` has no timeout, this is a real (not theoretical) way for an
order to sit unnoticed.

**(c) Stock/plan validation throws mid-way.** Covered by (a) — the rollback
covers this case exactly the same way. GOOD.

**(d) The one genuine "customer charged, no order" path — Razorpay only,
currently dormant.** `create_order` requires the Razorpay payment to already
be captured and signature-verified *before* this endpoint runs (frontend
calls `/payments/razorpay/create-order`, completes payment client-side,
*then* calls `POST /orders`). If anything in the try block fails **after**
that payment is already captured by Razorpay (stock sold out in the gap,
a DB error, anything) — the customer has been charged and **no Lokl order
is ever created**, and nothing in this failure path issues a refund
(`_restock_order_items`/refund logic only exists inside
`customer_cancel_order`, which requires an order to exist first). The
independent webhook path confirms this is a real gap, not a one-off: if the
`POST /orders` call never completes (app crash, network drop after payment
succeeds), the `payment.captured` webhook later fires
`_handle_payment_captured`, which does `db.orders.find_one({razorpay_order_id...})`,
finds nothing, and raises `ValueError("No Lokl order for razorpay_order_id=...")`
— caught by the webhook's outer handler (`server.py:1299-1303`), **logged
and stored with an `error` field in `webhook_events`, but the webhook still
returns `{"status": "ok"}` (200) so Razorpay stops retrying.** Money taken,
order permanently missing, nobody paged, no retry. **BLOCKER — scoped to
"if/when Razorpay is turned on."** Confirmed via Pass 0's dormancy finding
that this cannot happen today (COD-only, no live UI path to Razorpay), but
this needs to be fixed *before* Razorpay is ever flipped on, not discovered
after the first real charge.

**Is order creation atomic overall?** COD: yes, effectively — either a
fully-formed order with correct stock exists, or nothing does. Razorpay
(dormant): no — payment capture and order creation are two separate,
non-transactional steps with no compensating refund wired into either
failure path.

### 2.3 — Stuck-order analysis (dead-end states)

| State | Automatic recovery? | Manual escape hatch | Verdict |
|---|---|---|---|
| `pending_merchant` (COD) | Yes — `_auto_cancel_stale_orders()` cancels + restocks after 2h, checked every 5 min | `POST /admin/orders/{oid}/cancel` | Self-healing |
| `pending_merchant` (Razorpay, paid) | **No** — the auto-cancel job filters `payment_method == "COD"` only (`server.py:5536`), so a paid online order a merchant never accepts has **no timeout at all** | Admin cancel only | **BLOCKER** (dormant today, live gap if Razorpay activates) |
| `accepted` | **None** | Admin `mark-delivered` or `cancel` only. Customer **cannot** self-cancel past `pending_merchant` (`customer_cancel_order` only allows `awaiting_payment`/`pending_merchant`, `server.py:1409`). Merchant has **no reject/cancel endpoint at all** once accepted. | **Dead-end** — relies entirely on an admin noticing |
| `on_the_way` | None | Rider's WhatsApp OTP reply (`twilio_inbound`), or admin mark-delivered/cancel | **Dead-end**, same caveats as `accepted` |
| `pending_pickup` | **Designed but never wired up** — `GET /admin/expire-pickups` force-cancels past `pickup_expires_at`, but it is **not** in the `asyncio.create_task()` startup list (only `_auto_cancel_stale_orders` and `_send_notify_me_messages` are scheduled) — confirmed via grep, this endpoint only runs if a human manually hits the URL | Merchant/customer `cancel-pickup` | **BLOCKER-adjacent** — the fix exists in code, it's just never called |
| `reserved` (pickup accepted) | Same never-scheduled `expire-pickups` gap | Customer or merchant can self-cancel via `cancel-pickup` | Not fully dead-ended — self-service exists, but relies on someone remembering |
| `cancelled` / `delivered` / `returned` | — | — | Correctly terminal by FSM design (`ORDER_STATUS_TRANSITIONS` gives all three an empty transition set) |
| `completed` | — | — | **Dead FSM state** — no endpoint anywhere ever sets it (confirmed again this pass). Cosmetic, not a launch risk. |

**Bottom line:** `accepted` and `on_the_way` are the two live, reachable
dead-ends today — no timeout, no customer self-service, no merchant
self-service, admin-only recovery with no automated nudge that anything
needs attention. `pending_pickup`/`reserved` have a *designed* safety net
that is simply switched off (never scheduled).

### 2.4 — Notification failure = silent order?

**No — the order is never silently lost, only the notification is.**
Confirmed directly from the `create_order` read: the DB write
(`insert_one`) always happens before any notification is attempted, in a
separate code block with independent error handling. A merchant or customer
can always find the order by querying/listing normally, regardless of
whether any WhatsApp message went out.

What *does* silently degrade is the human-facing signal. The real,
compounding risk is 2.1 + 2.3 stacked together: a notification fails (item
#3/#5/#6/#7/#8 above) **and** the resulting state has no timeout (`accepted`,
`on_the_way`, or non-COD `pending_merchant`) **and** the merchant isn't
proactively checking their dashboard — the order can sit invisible-in-
practice for an unbounded time even though a direct DB query would find it
instantly. Functionally indistinguishable from "lost" to the actual people
involved, even though it isn't lost in the strict data sense.

### 2.5 — `verify_pickup` vs `confirm_pickup` (`server.py:3439-3475`)

Both flip `reserved → delivered`. That's where the similarity ends:

- **`verify_pickup`** (`server.py:3439`) requires the customer's 4-digit
  `pickup_code` in the request body and returns `400 "Incorrect pickup
  code"` on mismatch. This is the integrity-checked path.
- **`confirm_pickup`** (`server.py:3460`) performs **zero** code
  verification — it only checks `status == "reserved"` and immediately
  writes `delivered`. Its docstring ("after visual code verification")
  implies the check is supposed to happen out-of-band, entirely on trust.

**Confirmed via frontend grep: `verify_pickup` is never called anywhere in
the frontend.** Only `confirm_pickup` is wired to the merchant UI's
"Confirm pickup" button (`frontend/src/app/merchant/orders/page.tsx:158`).
They are **not** used interchangeably — the safer endpoint is dead code, and
the weaker one is the only one actually reachable from the product.

**Practical consequence:** the `pickup_code` the system generates and sends
to the customer (`notify_pickup_reserved`) is **decorative in the current
production flow** — nothing ever checks it before an order is marked
delivered. Any authenticated merchant can mark *any* of their `reserved`
pickup orders as delivered with a single click, with no proof the customer
was ever present. Exploitable two ways: (a) a merchant fraudulently marks a
pickup complete without the customer ever collecting the item, or (b) plain
human error — the wrong reservation gets marked complete with nothing to
catch it. Given the audit brief names COD/pickup fraud as the specific
concern, and the whole point of generating a pickup code is defeated if
nothing checks it: **BLOCKER.**

### Pass 2 summary — BLOCKER / WARNING / NOTE tally

- **BLOCKERs (6):** geofence-check swallow (2.1 #1) · merchant-new-order
  notification swallow with no downstream safety net (2.1 #3, #5) ·
  OTP-carrying notification swallows on accept/handoff (2.1 #6, #8) ·
  rider-dispatch notification swallow feeding a state with no timeout
  (2.1 #7) · Razorpay charge-with-no-order gap, both direct and webhook
  paths (2.2d) · non-COD `pending_merchant` has no auto-cancel (2.3) ·
  `pending_pickup`/`reserved` expiry sweep never scheduled (2.3) ·
  `confirm_pickup` bypasses the pickup-code check entirely (2.5). *(Several
  of these share one root fix — see cross-cutting note below.)*
- **WARNINGs (5):** customer order-placed notification swallow (2.1 #2) ·
  pickup-reserved notification swallow (2.1 #9) · cancellation notification
  swallow (2.1 #11) · auto-cancel notice swallow (2.1 #14) · `accepted`/
  `on_the_way` dead-ends relying solely on admin attentiveness (2.3).
- **NOTEs (5):** first-order-congrats swallow (2.1 #4) · delivered-
  confirmation swallows (2.1 #10, #13) · KYC-approval notification swallow
  (2.1 #12) · dead `completed` FSM state (2.3, restated from Pass 0).

**Cross-cutting observation, not a separate finding:** most of the BLOCKER
and WARNING notification swallows share the same shape (`except Exception:`
→ `print`/`pass`, no retry, no alert, no `capture_exception`) and the same
root cause as Pass 1's 46-site count. A single shared "attempt notification,
log AND alert on failure, optionally retry once" helper — instead of 19
independent inline `try/except` blocks — would collapse most of 2.1's HIGH
list into one fix rather than nineteen. Noted for whoever designs the fix;
not acted on here per the read-only scope of this pass.

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
