# Lokl — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS branded **Lokl**. **Pilot locked to Bhilai (Chhattisgarh)**.

## Latest Iteration (Feb 2026 — Iter-16) — Merchant Onboarding overhaul (Phases A + B + C + AI quality)

### Phase A — Smart redirect & quick UX fixes
- **Smart post-login redirect** (`GET /api/merchant/next-route`): brand-new → `/kyc`, on-hold/submitted → `/onboarding`, approved + no storefront → `/storefront`, storefront + no live product → `/products`, ≥1 live product → `/orders`. No more "always onboarding".
- **Auto-publish store**: every product mutation (create/update/bulk) now calls `_maybe_autopublish_store` — flips `store.published=true` once kyc=approved + storefront exists + ≥1 unpaused product. Killed the "live products but invisible store" bug (Ujjwal Fashion).
- **Double-click protection**: Save, Delete, Go-live, Bulk-action buttons disable while in-flight + show "Saving…" / "Working…".
- **Products tab skeleton**: module-level cache of last products list + animated skeleton on cold-load. No more 2-3s empty flash on tab juggle.
- **Revenue trend gap-fill**: `trend` is now always 14 continuous days with `revenue:0` on empty days (no more broken chart).

### Phase B — Onboarding & KYC UX
- **Phone now mandatory + unique** on register (`phone_canonical` indexed for fast lookup); email still primary login until Phase D.
- **KYC pre-fill**: `GET /merchant/kyc/status` now returns `docs_present` flags (pan_doc, gst_doc, cancelled_cheque) so the form shows "✓ already uploaded"; on-hold banner shows admin's `hold_comment` inline at the top.
- **KYC resubmission preserves docs**: `pan_doc_b64`/`gst_doc_b64`/`cancelled_cheque_b64` are now optional in `KycSubmit` and the backend keeps the previously-stored blob when the field is empty this time.
- **Big Online/Offline toggle** in merchant sidebar (`OnlineToggle.jsx`): renders only when fully launched (approved + storefront + ≥1 live product + not admin-paused). When offline: store remains visible on `/api/stores` but tagged `online:false` + "Offline — back soon", and ALL their products are hidden from `/api/products`. New endpoints: `GET /api/merchant/store/state`, `POST /api/merchant/store/online`.

### Phase C — xlsx bulk upload
- Replaced CSV with **xlsx** as the merchant-facing format. New `GET /api/merchant/products/template.xlsx` returns a workbook with 4 native Excel data-validation dropdowns: l1 (Category), l2 (Sub-category), gender, returnable Yes/No + 3 example rows + a "How to fill" instructions sheet.
- `POST /api/merchant/products/bulk` now accepts **both xlsx and legacy csv**, includes a `returnable` column, returns `created_ids`, and bulk-uploaded products start `paused:true, needs_image:true` so they don't go live until the merchant adds an image / confirms details.
- New **Edit details** button (`data-testid="edit-product-{pid}"`) on every product card opens the existing Add modal pre-filled — supports tweaking name/sizes/returnable/category for bulk-uploaded rows.

### AI Image Enhancer quality update (item 7 partial)
- Dropped 4 → **2 images** (1 outdoor + 1 studio) for higher per-call success rate and faster wall-time.
- New **model-on-product** prompt: when source has no human, AI now adds a real-looking adult model (age/gender matched to category); when source already has a model, AI keeps the same person and adjusts pose.
- Documented in finish summary: 100% success requires either fal.ai Flux Kontext Pro (stronger product-preservation editor, ~$0.04/img) or Gemini 3 Pro Image (when GA).

### Tests
- New `/app/backend/tests/test_phaseA_redirect.py` (3), `test_phaseB_kyc_phone.py` (7), `test_phaseC_xlsx.py` (3) + `test_iter11_extras.py` (3 — online toggle round-trip + AI 2-output) = **34/34 pytest pass** (verified by iter-11 testing agent — zero defects, zero action items).

## Latest Iteration (Feb 2026 — Iter-15) — Phase 3 of 3 (AI Catalog Image Enhancer) + Perf pass

### Phase 3 — AI Product Image Enhancer (Gemini Nano Banana via Emergent LLM key)
- New `POST /api/merchant/ai/enhance-image/one` — generates **one** of `outdoor_1 | outdoor_2 | studio_1 | studio_2`. Frontend fires **4 parallel** calls (each ~10-25s) to stream tiles in and dodge the 60s ingress gateway cap.
- Legacy `POST /api/merchant/ai/enhance-image` retained for backwards compat (returns all 4; can hit 60s cap on slow runs).
- New prompts (`/app/backend/ai_enhance.py`): strict preservation — garment shape/colour/print/texture/neckline/sleeves/length unchanged; no collages, watermarks or text overlays; no fabricated models unless source already contains one; 2 outdoor (natural daylight + neutral backdrop), 2 studio (white seamless / soft grey).
- New `_resolve_to_b64` helper auto-fetches HTTP(S) source URLs (every Lokl demo product cover is a CDN URL) via httpx and base64-encodes the bytes — fixes the iter9 critical bug.
- Per-kind single-shot retry to absorb transient Gemini blips. Backend returns 422 with a clear user-facing message when all 4 sub-calls fail.
- **Streaming UI** (`AIEnhanceModal.jsx`): renders 4 placeholders immediately, replaces each with the generated image (or a "Failed" tag) as that call resolves. Each tile is independently ★-pickable.
- Triggers wired into **both** flows: (a) **Add product modal** via `[data-testid="ai-enhance-draft-btn"]` (appears after cover upload), (b) **ImageManager** via `[data-testid="ai-enhance-mgr-btn"]`. Existing product card AI button still works.
- No usage cap (per user spec).

### Perf pass (site felt slow)
- `/api/products` list response went from **~13 MB → ~10 MB** by stripping the heavy `images` carousel array (full array still returned on PDP).
- `/api/stores` strips `banner_images` array.
- Nested product lists in `/api/stores/{id}` and similar list in `/api/products/{pid}` also strip `images`.
- Frontend: added `loading="lazy"` to Home, SearchPage, StorePage, StoreCard images.

### Test coverage
- `/app/backend/tests/test_phase3_ai_enhance.py` — 10 tests covering auth, validation, 4-output ordering, per-kind endpoint, invalid `kind`, perf-trim sanity (products/stores/store-products/similar).
- Phase 1 regression (`test_phase1_returns.py`) — 5/5 still pass.
- iter5 flow regression — 14/14 still pass.
- Total: **28/29 pytest pass** (1 ingress-timeout safeguard skip).

## Latest Iteration (Feb 2026 — Iter-14) — Phase 2 of 3 (Returns & Complaints Dashboards)

### Admin Console (NEW tabs)
- **Returns tab** (`data-testid="admin-tab-returns"`): paginated list of all return requests with status pills, status filter dropdown, by-status stat cards, **Reasons** + **By merchant** breakdown. Each row has next-action button driving the state machine (Assign pickup → Mark arriving → Mark picked up → Mark completed). On completion, parent order is auto-flipped to `status='returned'` and Twilio notifications fire to customer + rider where applicable.
- **Complaints tab** (`data-testid="admin-tab-complaints"`): Open/Resolved/All filter; Resolve action with optional note prompt. Server stores `resolution_note` + `resolved_at`.

### Merchant Orders (enhanced)
- **Returning** section now shows return reason, Return ID, pickup OTP, and the exact items being returned (per-order, fetched from `/api/merchant/returns`).
- **Returned** section displays reason inline next to each completed-return order.
- **Customer complaints** section (new, `data-testid="merchant-complaints"`) lists customer complaints raised against the merchant's orders. Customer phone is **redacted server-side** to `(hidden)`.

### Test coverage
- `/app/backend/tests/test_phase2_returns_dashboard.py` — 9 new tests (state-machine progression, status flip to `returned`, complaint resolve, merchant redaction).
- Phase 1 regression (`test_phase1_returns.py`) — 5/5 still pass.
- Frontend E2E validated by `testing_agent_v3_fork` (iteration_8.json) — 0 console errors, admin state-machine drove a return end-to-end via UI clicks, merchant phone redaction confirmed.

## Latest Iteration (Feb 2026 — Iter-13) — Phase 1 of 3 (Returns + Complaints + UX polish)

### Returns flow (NEW)
- **Backend**: `POST /api/orders/{oid}/returns` enforces order=delivered, ≥1 `return_eligible` item, within 24h of `delivered_at`, reason required. Generates 4-digit `otp` + 5-step `timeline` (`requested → pickup_assigned → arriving → picked_up → completed`).
- **Item snapshot**: each order item snapshots `return_eligible` at order time so future product edits don't change historical eligibility.
- **Admin state machine**: `POST /api/admin/returns/{rid}/{action}` (action ∈ `assign|arriving|picked_up|complete`). On `complete`, parent order is marked `status='returned'` AND `return_status='completed'`.
- **Twilio inbound webhook** extended: `<OTP> - Picked Up` from `RIDER_PHONE` flips a `pickup_assigned`/`arriving` return to `picked_up` (mirrors existing `<OTP> - Delivered` for deliveries). Non-rider senders silently dropped.
- **Rider notification** `notify_rider_return_pickup` sends a structured WhatsApp with return ID, OTP, customer name, pickup address, items, reason.
- **Customer notification** `notify_return_status` pings the customer on every state transition.

### Complaints (NEW)
- Types: `return`, `missing_item`, `damaged_item`, `delivery_issue`, `general`.
- `POST /api/orders/{oid}/complaints` (customer), `GET /api/admin/complaints` (admin queue), `GET /api/merchant/complaints` (merchant view with customer_phone redacted), `GET /api/customer/{phone}/complaints` (customer's own list).
- Admin `POST /api/admin/complaints/{cid}/resolve` closes with note.

### Customer UX
- **OrderTracking page** rewritten: REMOVED the static SVG rider map; status pills + timeline + OTP card retained. New "Need help with this order?" card with three states:
  - Within 24h + has return-eligible items + no return in progress → **Return product** CTA (opens `ReturnModal` with reason chips).
  - Past 24h with return-eligible items → "Return window has expired. Please reach out to Customer Care…" message.
  - No return-eligible items → "None of the items in this order are return-eligible."
  - Always shows **Contact Customer Care** CTA (opens `ComplaintModal`).
- **Return tracking page** `/returns/{rid}` — mirror of order tracking with 5-step timeline + navy OTP card when status ∈ {`pickup_assigned`, `arriving`}.
- **Customer Account → Past orders** — each row now shows up to 5 item thumbnails. Clicking any thumbnail navigates to PDP (`/p/{product_id}` with route alias added).
- **OrderTracking bag items** — clickable links to PDP for active/delivered/returned orders.

### Merchant UX
- `MerchantProducts` Add modal now has a **Return-eligible** checkbox (`data-testid="prod-return-eligible"`). Persists to product. Listing endpoint surfaces it via `GET /api/merchant/products`.

### Routing
- **`/p/:id` alias** added next to existing `/product/:id` so spec-mandated short PDP links work without breaking existing components.

### Test coverage
- `/app/backend/tests/test_phase1_returns.py` — 5/5 tests pass (order snapshot, can't-return-non-delivered, full state machine, Twilio inbound picked-up, complaint create + admin resolve).
- `/app/backend/tests/test_iter5_flow.py` regression — 14/14 still pass.
- Frontend E2E validated by `testing_agent_v3_fork` (iteration_7.json) — 1 critical routing bug found + immediately fixed (`/p/:id` route alias).

## Latest Iteration (Feb 2026 — Iter-12) — Deferred Batch Cleanup

### AdminPanel Build Repair (P0)
- The previous fork left `/app/frontend/src/pages/AdminPanel.jsx` with a missing `</div>` (the expanded store row's wrapper). Repaired — admin console compiles cleanly again.
- **Critical regression fixed**: `admin_change_requests` handler in `server.py` had lost its `@api.get` decorator → endpoint returned 404 → AdminPanel Promise.all surfaced a "body stream already read" overlay that blocked every admin interaction. Decorator restored.
- New `safeJson(promise, fallback)` helper in AdminPanel.jsx defensively guards `r.ok` + try/catch around every `Promise.all` fetch chain so a single failing sub-endpoint can never crash the admin UI again.

### Admin KYC "Hold with comment" (NEW)
- KycModal now shows three buttons for `submitted` / `on_hold` merchants: **Reject** · **Hold with comment** · **Approve**
- "Hold with comment" reveals a textarea; empty comment triggers a "Comment required" toast; non-empty `POST /api/admin/merchants/{mid}/hold` flips `kyc_status` to `on_hold`, stores `hold_comment`/`hold_at`, and pushes a `kyc-on-hold` notification to the merchant
- "On hold" added to the Approvals status filter
- On-hold merchants are visible in the same KycModal with an orange "Currently on hold" banner showing the prior hold reason

### Merchant Onboarding — On-Hold View (NEW)
- `MerchantOnboardingStatus.jsx` recognises `kyc_status === "on_hold"` with a dedicated card: orange `PauseCircle` icon, "KYC on hold — action needed" headline, the admin's hold_comment surfaced verbatim
- Two CTAs: **Update KYC details** (link to `/merchant/kyc` to re-upload) and **I've fixed it — re-review now** (POSTs `/merchant/kyc/resubmit`, flips status back to `submitted`)
- Re-submitting via `/merchant/kyc/submit` (full form) also clears `hold_comment` + `hold_at` server-side

### PDF Document Download Fix (P1)
- New `decodeDocMime(b64)` helper sniffs base64 magic bytes to detect mime: PDF (`JVBER…`) / PNG (`iVBOR…`) / JPEG (`/9j/…`) / WebP / GIF, with fallback to `image/jpeg`
- New `DocPreview` component renders images inline and PDFs as a clickable "Open PDF" card that opens in a new tab. Download link uses correct extension (`.pdf`, `.jpg`, `.png`)
- Used in **both** Approvals KYC modal AND Stores tab's expanded merchant card
- `/api/admin/stores` enriched merchant snapshot now exposes `hold_comment`, `hold_at`, `pan_doc_b64`, `gst_doc_b64`, `cancelled_cheque_b64`

### Multi-Image Product Upload (NEW)
- Merchant **Add product** modal supports up to **5 images** per product (file picker, 5 MB cap each, no URL input)
- Thumbnails render with COVER badge on the first; X-button removes individual images; submit sends both `image` (first) and `images: [...]` array for backwards-compat
- `ImageManager` modal rewritten: add/remove + ★ "Make cover" reorder. Saves via `PUT /merchant/products/{pid}` with `image: images[0], images: [...]`
- Product detail carousel (`/product/{id}`) already supported `product.images` (chevrons + dot pagination) — verified no regression for single-image products

### Twilio Inbound Webhook (existed, now validated)
- `POST /api/twilio/inbound` accepts Twilio's form-encoded webhook. Regex parses `<4-digit OTP> - Delivered` from message body, finds matching live order, flips status to `delivered` with `delivered_via=rider-whatsapp`, fires WhatsApp delivery confirmation to customer
- Production-safety: optionally restricts sender via `RIDER_PHONE` env var (unset in preview → accepts any sender — set before production launch)

### Test Coverage
- New backend regression suite `/app/backend/tests/test_iter5_flow.py` — 14/14 pytest passing
- E2E UI flows validated by testing_agent_v3_fork (iteration_6.json) — 0 pageerrors across admin + merchant flows

## Latest Iteration (Feb 2026 — Iter-11)

### Search (NEW)
- Backend: `GET /api/search?q=` returns matching products + stores
- Header: live typeahead (debounced 200ms, min 2 chars) — drop-down shows up to 4 stores + 6 products with thumbnails
- Clicking a suggestion → store/product page; pressing Enter → `/search?q=…` results page
- New `/search` page lists matching stores + products + a "Didn't find?" L1 tile grid fallback (same 9 tiles as home)

### Home — Thinner Hero
- Removed the 4 feature pills; reduced hero height (300px desktop) so Shop-by-category is above the fold
- ETA card retained on desktop right

### Floating Order Strip (NEW)
- `OrderStatusStrip` rendered globally by `ConsumerHeader`. Polls `/api/customer/{phone}` every 15s for the latest non-final order. Sticky bottom-right on desktop, full-width on mobile. Hides when nothing is in flight.

### Order Tracking — Stylized SVG Map
- Hero tile shows illustrative SVG "map" with dashed road, Store + Customer pins, animated 🛵 rider marker by status. "illustrative · not GPS" caption.

### Storefront — Multi-banner + Store hours
- Up to 5 banner uploads (5 MB cap each, file-only). Opens-at / Closes-at time pickers with 30-min buffer. Locality auto-derived from `business_address` first segment.

### Store visibility — Open / Offline split
- `/api/stores` returns `is_open` + `next_open_label`. Sorts open first. PDP shows "Out of delivery hours · Opens at HH:MM AM" when offline.

### StorePage simplified + banner carousel
- Removed rating/reviews/Follow/Specialties chips. ETA computed from `distance_km`. Snap-x banner carousel.

### Per-product Go Live + Bulk multi-select
- Checkbox + hover-only "Go live" pill on each card. Sticky bulk-action bar (Go live / Pause / Delete / Cancel) when ≥1 selected. New `POST /api/merchant/products/bulk-action`.

### Merchant order privacy
- `GET /api/merchant/orders` redacts customer PII server-side (name + pincode + landmark + coarse area only).

## Latest Iteration (Feb 2026 — Iter-10) — Cascade Delete + Live Users
- Admin deleting a store wipes stores+products+merchants+orders+change_requests+admin_otps. Same email can re-register fresh.
- New Admin tabs: **Live users** (`/api/admin/live-users` via heartbeat) and **Customers** (`/api/admin/customers?q=` searchable directory, click-through to lifetime spend + order history).
- Merchant Analytics revenue/AOV now only counts delivered orders.
- `/account` Multi-address: Add/Remove saved addresses with Label + Landmark; checkout pre-fills.

## Latest Iteration (Feb 2026 — Iter-9) — OTP-based Rider Handoff
- New lifecycle: `pending_merchant` → `accepted` → `on_the_way` → `delivered` · `cancelled`
- 4-digit OTP generated on `POST /api/orders` — same OTP across admin/merchant/customer
- Merchant cannot reject or mark delivered any more — only Accept + Handed-to-rider
- Admin: Mark delivered + Cancel (with reason)
- Customer: large OTP card when `on_the_way`
- CSV bulk: per-size stock via `S;M;L;XL` + `50;100;39;10`

## Latest Iteration (Feb 2026 — Iter-8) — Demo Data + Star Removed
- 10 Bhilai demo stores (all approved + published) + 55 products. Demo creds: `<slug>@lokl.demo` / `Demo@2026`.
- Star/Sparkles icon removed everywhere; "lokl." wordmark sized up (text-2xl / text-3xl).
- Admin tabs: Approvals · Stores · Live orders · Delivered (auto-refresh 12s).

## Latest Iteration (Feb 2026 — Iter-7) — REBRAND TO LOKL
- All `bharat.` wordmarks → `lokl.`; admin email migrated to `admin@lokl.in`; WhatsApp/AI copy now Lokl-branded.
- Intentionally kept: "Hyperlocal fashion for Bharat" (Bharat = country, not brand).

## Stack
React + FastAPI + MongoDB. Emergent LLM key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images, currently hidden due to garment-preservation issues). Twilio WhatsApp (outbound order updates + inbound rider-delivery webhook).

## Test Credentials
See `/app/memory/test_credentials.md`.
A seeded Phase 2 merchant (with delivered order + open return + complaint) is created on demand via `/app/tests/seed_phase2.py` (artefacts dumped to `/tmp/phase2_seed.json`).

## Mocked (pilot scope)
- KYC docs + product images stored as base64 in Mongo (Cloudinary still on backlog)
- Sales analytics shows real data only after delivered orders
- "1-hour propagation" on publish flips immediately

## Backlog (priority order)
- **P1**: Cloudinary/object storage migration (base64 in Mongo will bloat as catalog grows past 5 imgs × N products)
- **P1**: Production: set `RIDER_PHONE` env so Twilio inbound webhook rejects non-rider senders
- **P1**: Lazy-load admin doc previews — `/api/admin/merchants/{mid}/docs` instead of inlining b64 in every `/admin/stores` response
- **P2**: Split `server.py` (1294 lines) into routers/*: auth, admin, merchant, customer, twilio, geo — prevents missing-decorator regressions
- **P2**: Real OTP/Google auth integration (currently password-based for merchants, phone-only for customers)
- **P2**: Fix + re-enable AI Try-on (Gemini garment-preservation prompt overhaul)
- **P2**: Real-time order push via WebSocket
- **P2**: `toast.error` on safeJson failures so admins notice silently-dying endpoints
- **P3**: Razorpay live · independent rider app · live GPS tracking · influencer partnerships · WhatsApp campaigns

## Status
✅ Backend regression: 14/14 iter5 pytest + curl smoke for change-requests=200 + twilio/inbound TwiML response verified
✅ Frontend: all iter5-blocked admin/merchant flows now pass (iter6.json — 0 pageerrors)
