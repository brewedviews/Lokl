# Lokl — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS branded **Lokl**. **Pilot locked to Bhilai (Chhattisgarh)**.



## Iter-27 (Feb 2026) — Deferred features Items 3, 5, 7 (3-of-7 chosen)

User selected 3 items to ship properly with E2E verification rather than 7 half-baked. All passed `testing_agent_v3_fork` iteration_28.json (backend 11/11 pytest, frontend 100% Items 3/5/7).

### Item 3 — Customer Account Auth Flow hardening (P0)
**Bug found by testing agent**: zustand-persist `name` collided with the state field `token`. `_syncFromStorage` read the persist-envelope JSON back into `state.token` and persist re-wrote, nesting up to 4 levels deep. Logout silently failed because `state.token` remained a non-empty (envelope) string.

**Fix** (`/app/frontend/src/stores/customer-auth.store.ts`):
- Persist key renamed to `bf_customer_auth_v1` (zustand envelope only).
- `bf_customer_token` is now a RAW-JWT mirror — set by `setAuth`, removed by `clearAuth`. Legacy api-client + CRA app continue to read this key directly.
- `_syncFromStorage` reads ONLY the raw mirror; non-JWT values are treated as signed-out.
- `cleanupLegacyEnvelope()` runs once at module init and unwraps up to 5 nested envelopes from older builds.

### Item 5 — KYC Approval polling UX polish (P1)
- `/app/frontend/src/app/merchant/onboarding/page.tsx` — submitted-state card now shows a pulsing dot (`data-testid="kyc-pulse"`) and the copy "Your KYC is being reviewed" + "This usually takes a few hours. We'll move you forward automatically the moment you're approved — no need to refresh." The 10-second poll → redirect to `/merchant/storefront` was already wired and verified.

### Item 7 — CMS Link + Paused + Non-clickable toggles (P2)
**Backend** (`/app/backend/server.py`):
- `ALLOWED_OFFER_FIELDS`, `ALLOWED_CATEGORY_FIELDS`, and `DEFAULT_HERO` extended with `paused` + `non_clickable`.
- `_get_site_config` backfills both flags onto legacy hero docs.
- `public_homepage_config` strips paused hero to `{paused: true}` only (so the consumer hides it rather than rendering a default placeholder).
- `list_offers` filters `paused=true`. `list_categories` + `categories_with_counts` filter paused L1 and paused L2.
- PUTs for offer/category/subcategory now persist `paused` + `non_clickable`.

**Admin UI** (`/app/frontend/src/components/admin/cms/*Editor.tsx`):
- Hero/L1/L2/Offers editors each expose a "Make non-clickable" checkbox and a "Paused" checkbox with stable testids (`cms-hero-paused`, `cms-l1-paused-<slug>`, `cms-l2-paused-<id>`, `cms-offer-paused-<id>`, and `-nonclick-` mirrors). Paused rows get `opacity-50` + "Hidden from customers" badge.
- `DestinationPicker.tsx` no longer auto-opens the autocomplete dropdown on focus — manual text input by default, "Pick" button still available.

**Consumer rendering**:
- `HeroV2.tsx` → returns `null` when `hero.paused`; renders `<div data-testid="hero-static">` instead of `<Link data-testid="hero-redirect-link">` when `non_clickable`.
- `ShopByCategory.tsx` → skips paused L1; renders non-clickable tiles as `<div>`.
- `CategoryClient.tsx` → renders non-clickable L2 tiles as `<div>`.
- `OffersStrip.tsx` → skips paused offers; renders non-clickable offers as `<div>` (CTA arrow hidden).



## Iter-26c (Feb 2026) — 422 hotfix on Admin CMS image upload

**Reported by user**: "Request failed with status code 422" when uploading L1 category tile images.

**Root cause**: The shared axios singleton (`src/lib/api-client.ts:189`) sets a default `Content-Type: application/json` header on every request. In the browser, FormData uploads must let the browser set `Content-Type: multipart/form-data; boundary=...` itself — the app/json default overrides this so FastAPI's `File(...)` parser sees an empty body and 422s with `body.file required`. (Backend was fine; backend curl tests have always passed.)

**Fix**: `uploadCmsImage` in `src/lib/api/admin.ts` now passes `headers: { 'Content-Type': undefined }` at the request level. Axios 1.x then lets the browser set the multipart Content-Type with the correct boundary.

**Regression test**: Browser-accurate Node repro (using global `FormData`/`Blob` from undici) confirms the bug → 422 and the fix → 200. Test script at `/app/frontend/scripts-browser-repro.js` (deleted after run; logic preserved in this PRD entry for future debugging).



## Iter-26b (Feb 2026) — Full Homepage Asset CMS + Click Analytics

**Done** (iter-26 testing agent: 100% backend 16/16 pytest, 100% admin CMS UI + consumer click tracking):

**Rollback first**
- New seed `/app/backend/seeds/rollback_homepage_assets.py` restores pre-iter26 Bhilai Globe Chowk hero + original Unsplash L1 category images + original offer images. Removed the now-superseded `refresh_homepage_assets.py`.

**Backend (server.py:1056-1230 + cloudinary_service.py:FOLDER_MAP)**
- `GET /api/admin/categories`, `PUT /api/admin/categories/{id}` — name, image, redirect_url, order.
- `GET /api/admin/subcategories[?l1_id=]`, `PUT /api/admin/subcategories/{id}` — same shape for L2.
- `GET /api/admin/offers` (incl. unpublished), `PUT /api/admin/offers/{id}` — title, subtitle, image, cta_label, cta_link, redirect_url, background, rank, published, expires_at.
- `POST /api/admin/cms/upload` — Cloudinary multipart upload, lands in `lokl/cms/*`, returns `{image_url, public_id, format, width, height, bytes}`. 5 MB ceiling enforced.
- `GET /api/admin/cms/search-destinations?q=` — unified picker, returns 5 buckets (stores/products/categories/subcategories/offers), max 8/bucket.
- `POST /api/analytics/click` (public) — logs `{asset_type, asset_id, redirect_url, ts, ua}` to `asset_clicks`. Returns 400 on invalid asset_type (hardened in post-test review).
- `GET /api/admin/analytics/top-clicks?asset_type=<>&days=7|30&limit=10` — admin aggregation.
- DEFAULT_HERO extended with `mobile_image` and `redirect_url` keys.
- `migrations/006_cloudinary_cleanup.py` now also cleans `lokl/cms` prefix.

**Frontend (Admin → CMS → Homepage Assets)**
- `CmsTab.tsx` rewritten as a parent with 5 sub-tabs: Sections | Hero | L1 Categories | L2 Sub-Categories | Offers (`cms-subtab-<id>`).
- `cms/ImageUploadField.tsx` — dual Cloudinary upload + URL paste, recommended-dimensions hint, 5 MB validation, live preview, remove button.
- `cms/DestinationPicker.tsx` — debounced search across 5 destination buckets + Custom URL free-text field (mandatory per spec).
- `cms/HeroEditor.tsx` — desktop image (1920×700), mobile image (1080×1350), eyebrow, two-line title, subtitle, primary CTA label + link, redirect URL via DestinationPicker, live preview pane that links to the configured redirect.
- `cms/L1CategoriesEditor.tsx` — 9 L1 rows, per-row image (800×800) + name + redirect + save + preview.
- `cms/L2SubcategoriesEditor.tsx` — collapsible by parent L1, per-L2 image (600×600) + name + redirect + save.
- `cms/OffersEditor.tsx` — full CRUD (create, edit, reorder up/down, publish toggle, delete) with image (1200×675) + destination picker + per-row save.
- `cms/TopClicksWidget.tsx` — 3-column 7d/30d top-clicks dashboard at the bottom of the CMS tab.

**Consumer-side wiring**
- `HeroV2.tsx` — wraps banner in `<Link href={hero.redirect_url}>` when set; uses `mobile_image` on mobile; fires `trackAssetClick("hero","homepage",url)` on click. Falls back to `cta_primary_link` when redirect blank.
- `ShopByCategory.tsx` — uses `category.redirect_url` when set (defaults to `/c/{slug}`); fires `trackAssetClick("category", row.id, url)` on every click.
- `OffersStrip.tsx` — uses `offer.redirect_url` (falls back to `cta_link`); fires `trackAssetClick("offer", offer.id, url)`.

**Test artefacts**
- `/app/backend/tests/test_iter26_cms.py` (new) — 16 tests covering rollback, admin reads/writes, Cloudinary upload + size validation, analytics POST/GET with validation.
- `/app/test_reports/iteration_26.json` — full pass report.

**Known follow-ups (non-blocking, deferred)**:
- Add a TTL index on `asset_clicks` to keep the collection lean (~90d retention).
- Optional: server-side allow-list for `redirect_url` (must start with `/` or known host) — currently admins are trusted.
- Optional: require `q.length >= 2` on the destination picker once DB is populated to avoid large scans.



## Iter-26 (Feb 2026) — Homepage CMS + Test-data wipe

**Done** (iter-25 testing agent: 100% backend 12/12 pytest, 100% admin+consumer e2e):

**Database**
- All test products / stores / merchants / customers / orders / returns / complaints / OTPs wiped via `/app/backend/migrations/005_delete_test_data.py`. Only `admin@lokl.in` preserved.
- Order IDs are UUIDs, no counter reset required.

**Backend**
- `GET /api/site/homepage-config` (public) and `GET/PUT /api/admin/site/homepage-config` (admin) at `server.py:1152-1188`. PUT validates section/hero shape and merges hero fields against `DEFAULT_HERO` allow-list.
- `_get_site_config()` auto-heals missing section IDs into existing docs so CMS schema additions never break the public render.
- `DEFAULT_HOMEPAGE_SECTIONS` order corrected to match spec: hero, popular_in_city, categories, selling_fast, offers, recently_viewed, stores, customer_love (ranks 10-80).
- New seed `/app/backend/seeds/homepage_config.py` (idempotent) — `python -m seeds.run homepage_config` inserts default config on a fresh DB, prints "already up-to-date" on repeat runs, and merges newly-added hero fields without clobbering admin edits.
- New migration `/app/backend/migrations/006_cloudinary_cleanup.py` — deletes `lokl/products`, `lokl/stores`, `lokl/banners` prefixes from Cloudinary; explicitly preserves `lokl/kyc`. Requires explicit `--force` to run destructively; `--dry-run` enumerates only.

**Admin UI**
- New `/app/frontend/src/components/admin/CmsTab.tsx` — Homepage CMS panel (`data-testid=cms-panel`) with reorder (up/down per section), enable/disable toggle, hero banner editor (image URL, eyebrow, subtitle, two-line title, primary+secondary CTAs), live preview, and Publish action. All controls carry stable `data-testid`s: `cms-section-<id>`, `cms-toggle-<id>`, `cms-up-<id>`, `cms-down-<id>`, `cms-hero-*`, `cms-save`.
- Wired into `/app/frontend/src/app/admin/page.tsx` as a new "Homepage CMS" tab (`admin-tab-cms`).

**Consumer**
- `/app/frontend/src/components/consumer/HomeClient.tsx` rewritten to render homepage sections dynamically from the CMS payload (`config.sections` ordered by rank, filtered by enabled flag). Per-section renderers map CMS section IDs → React nodes (hero, popular_in_city, categories, selling_fast, offers, recently_viewed, stores, customer_love). DEFAULT_SECTIONS fallback ensures the page never goes blank if the CMS endpoint fails.
- Verified end-to-end: hero subtitle edit + Publish → consumer homepage shows new subtitle on next load; section toggle hides the corresponding rail; rank reorder swaps the visible order.

**Known follow-ups (non-blocking)**:
- `_get_site_config()` writes inside an unauthenticated GET — fine for cold start but could be moved to seed/startup.
- CMS doesn't yet offer an in-admin live preview pane (next nice-to-have).
- Cloudinary cleanup destructive run still requires manual operator confirmation (`--force`).



## Iter-25 (Feb 2026) — Header/Location UX polish + Footer breathing room

**Done** (smoke-verified across all 8 viewports, 320 → 1920 px):

- **LocationChip is now SINGLE-LINE everywhere** — no eyebrow "DELIVERING TO" row, no vertical stack.
  - **Mobile (<lg)**: `"Delivering in <value>"` prefix included.
    - Cluster: `"Delivering in Smriti Nagar"`
    - Saved address: `"Delivering in Home · <preview>"`
    - Fallback: `"Delivering in Bhilai"`
  - **Desktop (≥lg)**: just `<value>` — chip stays compact (max-w 200 px).
    - Saved address → title only (`"Home"`)
    - Cluster → cluster name (`"Smriti Nagar"`)
    - Fallback → `"Bhilai"`
  - Chip height is **35 px** on every viewport (was 50 px on the two-line layout).

- **Desktop search bar expanded** — switched from `flex-[3]` to `flex-1` and shrunk LocationChip's desktop width to fixed `200 px`. Search input at 1440 px now renders **569 px wide** (was 526 px). The wrapper `gap-4` keeps proper breathing room before Stores · For Merchants · Profile · Cart.

- **Footer spacing restored** — `Footer.tsx` now applies `mt-12 md:mt-16` by default (was `mt-8`). HomeClient passes `topGap=true` (was `false`), so when testimonials are absent the gap between Popular Stores and the dark footer block is **48 px on mobile / 64 px on desktop** (was 0 px, which read as clipped).



## Iter-24 (Feb 2026) — Header + Location UX refinement

**Done** (verified iter-24, backend 9/9, frontend 100% across 8 viewports):

**Backend**
- **`GET /api/v1/location/cluster?lat&lng`** — new reverse-lookup that maps coordinates to the nearest Bhilai neighbourhood from a 14-entry hardcoded table (Smriti Nagar, Junwani, Risali, Nehru Nagar, Supela, Vaishali Nagar, Kohka, Power House, Sectors 6/10, Bhilai 3, Khursipar, Hudco, Jamul). Returns `{cluster, nearest_cluster, distance_km, in_service, city_slug}`. Out-of-Bhilai coords surface `cluster=null` so the UI falls back to a city label.
- **Testimonials zero-state** — depublished the 4 seeded testimonials (`db.testimonials.update_many({}, $set: published=false)`) and updated `seed_v2_offers_testimonials.py` to insert NEW rows with `published=false`. Public `/api/testimonials` now returns `[]`.

**Frontend**
- **Mobile header (<lg)** — collapsed to a SINGLE row `[Logo · LocationChip (flex-1) · Cart]`. Permanent row-2 search bar DELETED. Header height 55 px.
- **Desktop header (≥lg)** — search input promoted to `flex-[3]` so it claims the slack between LocationChip and Stores; no wasted whitespace. Header height 68 px.
- **`LocationChip`** — now auto-detects on mount via new `useLocationStore.autoDetectIfGranted()` (silent — only fires when `navigator.permissions` says geolocation is already granted; first-time visitors are never surprise-prompted). After lat/lng lands the chip resolves to the nearest Bhilai cluster and shows `DELIVERING TO · <Cluster>`. Logged-in customers with saved addresses see `<Label> · <Address preview>`. Popover content adapts: Detect button HIDDEN when permission already granted; Saved-address list shown when phone present; guest CTA otherwise.
- **`SearchOverlay`** (new) — Zepto/Blinkit-style slide-up panel. Full-width sticky input, Recent searches (localStorage `lokl_recent_searches`, max 6, clear-all), Popular searches (`GET /api/search/trending`), live debounced suggestions (`GET /api/search?q=`). Submit (`Enter`) tracks via `POST /api/search/track`. ESC + X + outside-click close.
- **`StickyBottomNav`** — items now `[Home · Categories · Search · Wishlist · Profile]`. Wallet removed. Central Search button opens the overlay via tiny new `useSearchOverlay` Zustand store.
- **`SearchOverlayHost`** (new) — wires the overlay into the consumer layout without making the layout client.
- **Testimonials** — `CustomerLove` already self-collapses when `items.length === 0` — confirmed gap between `home-stores` and `<footer>` is `0 px` at every viewport when no published rows exist; section auto-reappears when even ONE published row lands.

**Code-review fixes** — deduplicated `BHILAI_CLUSTERS` (`Bhilai Nagar` had the exact same centroid as `Smriti Nagar`; now `Smriti Nagar` is the single canonical name → `min()` is deterministic).



## Iter-47 (Feb 2026) — Home reorder + responsive header audit

**Done** (verified iter-23, 100% pass — backend 8/8, frontend 100% across 8 viewports):

**Section order** on BOTH desktop & mobile (HomeClient.tsx):
1. Hero → 2. Trending Now → 3. Shop by Category → 4. Selling Fast → 5. Offers For You → 6. Recently Added → 7. Popular Stores → 8. Testimonials (conditional) → 9. Footer.

**New `ShopByCategory.tsx`** — Six tiles only: Men, Women, Footwear, Accessories, Kids, Beauty & Personal Care. Streetwear/Electronics/Sports remain seeded but are filtered OUT of the home grid (their `/c/<slug>` pages still load — paused, not deleted). Mobile = 3×2 grid; Desktop = 1×6 row.

**Consumer Header redesign** (ConsumerHeader.tsx, rewritten):
- Breakpoint moved from `md:` (768px) to `lg:` (1024px) so tablets (768px) get the cleaner 2-row layout — fixed the prior tablet overflow.
- **Mobile/Tablet (<lg)**: Row 1 = Logo + LocationChip + Cart; Row 2 = full-width sticky search input.
- **Desktop (≥lg)**: single row — Logo + Location + Search + Stores + For Merchants + Profile + Cart (height 68px).
- **Search typeahead** — 250 ms debounced calls to `api.search.suggest`; dropdown shows store + product rows with `search-sugg-store-<id>` / `search-sugg-product-<id>` test ids; ESC + outside-click dismiss; Enter navigates to `/search?q=…`.
- **LocationChip popover** — `Detect my location` button (uses geolocation API via `useLocationStore.requestLocation`), saved-address list (`GET /api/v1/addresses/<phone>`) when logged in, login CTA when guest.

**Testimonials conditional** — `CustomerLove.tsx` early-returns `null` when `items.length === 0`; spec confirms the section collapses entirely (no heading, no spacing, no container) and will auto-reappear when reviews land.

**Responsiveness audit** — `scrollWidth ≤ innerWidth + 1` at 320 / 375 / 390 / 430 / 768 / 1024 / 1440 / 1920 px. No clipped CTAs, no overlap.



## Iter-46 (Feb 2026) — Phase 2: Three reported UI bugs — FIXED

**Done** (verified iter-22, 100% pass):
- **Bug 1 — Wishlist badge mirrored cart count**: `StickyBottomNav.tsx` was reading `useCartStore.getItemCount()` for the heart icon. Switched to `useWishlistStore.products.length`. Badge data-testid renamed `cart-badge` → `wishlist-badge`.
- **Bug 2 — Wishlist empty after hard refresh**: `wishlist.store.ts` initialized phone="guest" at module load and never re-bound to the authenticated customer. New `initialPhone()` reads `bf_customer_phone` on init. New listeners on `customer-auth:change` (same-tab) and the native `storage` event (cross-tab) auto-swap the bucket when the customer logs in/out.
- **Bug 3 — Merchant Product edit modal opened blank**: `openEdit()` was reading `r.data.name` directly from `GET /api/products/{pid}`, but the response shape is `{product:{...}, similar:[...]}`. Now unwraps `r.data.product` before populating the form.

## Iter-45 (Feb 2026) — Backlog: Order #, Location gate, Dynamic ETA

**Done** (verified iter-21, 100% pass):
- **Order ID prefix migration BFO → LOKL**: `server.py:1531` generates `LOKL-XXXXXXXX`. Existing BFO orders remain valid (id-based lookups, no prefix constraint).
- **Soft serviceability banner**: New `LocationBanner.tsx` mounted in consumer layout. Calls `GET /api/v1/cities/detect?lat&lng` whenever the location store updates; surfaces a dismissable amber banner for non-Bhilai shoppers. Checkout still enforces Bhilai-only server-side.
- **Dynamic ETA on cards**: New `useCityConfig` (session-cached) + `useDeliveryEta` hooks. `ProductCardV2` and `StoreCardV2` now compute ETA from `distance_km` × city `eta_config` (base_prep + per_km + peak_multiplier). Caps at `max_delivery_radius_km` so out-of-footprint distances return the static fallback (fixes the 3,600-minute display bug observed during development).

### Still deferred (post-launch)
- **AI Product Image Enhancement** (Gemini Nano Banana) — separate session.
- **`bf_` localStorage key cleanup** — intentional cross-app compat with legacy CRA; clean up after CRA is decommissioned.
- Minor: investigate the 400/404 console noise on consumer pages (non-blocking, surfaced by iter-22).



## Iter-44 (Feb 2026) — Phase 3: Feature Parity Recovery (Customer + Merchant)

**Done** (verified via iter-19 testing agent, 100% pass on all 3 features):
- **Multi-store cart limit (max 2 stores)** — `src/stores/cart.store.ts` refactored: `addItem` now uses `distinctStores(items)` and rejects a 3rd unique `store_id` with `{success:false, conflict}`. `CartConflict` extended with `existing_store_names[]` and `max_stores`. Conflict toast wording updated in `ProductCardV2.tsx` and `ProductActions.tsx`.
- **Inline size-selector on product cards** — `ProductCardV2.tsx`: when `p.sizes.length > 1`, the CTA reads "Select size" and tapping it reveals an inline pill strip (`p-card-sizes-<id>` + `p-card-size-<id>-<size>`) instead of silently adding `sizes[0]`. Single-size / sizeless products still use the immediate "Add" path.
- **Merchant Online/Offline toggle** — New `src/components/merchant/OnlineToggle.tsx` (ported from legacy CRA `OnlineToggle.jsx`), mounted in `app/merchant/layout.tsx` sidebar above the user block. Only renders when `state.can_toggle === true` (published + ≥1 product + not paused). Wires `api.merchant.storeState()` + `api.merchant.setOnline()`.

**Build note**: Frontend supervisor runs `next start`, so source edits require `cd /app/frontend && yarn build && sudo supervisorctl restart frontend` to surface in the preview bundle (testing agent enforced this).

**Open (deferred to Phase 4)**:
- Admin Gap-Filling: Bank approvals, store deletion, cancel order, Returns tab, Delivery OTP UI, Customers tab, live metrics.
- Backlog: Location/serviceability gate (Bhilai geofence), Dynamic ETA, Order Number migration (BFO→LOKL), `bf_` key cleanup, AI Image Enhancement (Gemini Nano Banana).
- Phase 2 (3 reported UI bugs): Wishlist count, Wishlist page empty, Product edit blank — still pending manual reproduction.


## Latest Iteration (Feb 2026 — Iter-39) — Stabilization: Cloudinary + Admin MVP + Merchant Products Restore

**Done**:
- **Cloudinary backend integration** (`backend/services/cloudinary_service.py`):
  upload_image / delete_image / signed_kyc_url / is_configured. KYC docs use
  `type=private`; products/storefront banners are public. All assets
  organised under `lokl/products`, `lokl/stores`, `lokl/banners`, `lokl/kyc`.
- New endpoints (server.py ~lines 950-1000):
  - `POST /api/merchant/upload-image` (multipart, requires merchant JWT,
    asset_type ∈ {product, store_logo, store_banner, kyc})
  - `DELETE /api/merchant/upload-image?public_id=...`
  - `GET /api/admin/kyc/{merchant_id}/signed-url?doc=pan_doc|gst_doc|cancelled_cheque`
- **Mongo schema migration** (backwards-compatible):
  - `products`: new `image_public_id` (string), `image_public_ids` (array)
    paired with existing `image` / `images` URL fields.
  - `stores`: new `banner_public_ids` (array), `logo_public_id` (string).
  - `merchants`: new `pan_doc_public_id`, `gst_doc_public_id`,
    `cancelled_cheque_public_id` for private KYC refs.
- **PUT /api/merchant/products** now deletes the previous Cloudinary asset
  when the merchant uploads a replacement (`image_public_id` differs) and
  prunes any carousel ids no longer in the payload — no Cloudinary orphans.
- **Merchant Products page rebuilt** (`app/merchant/products/page.tsx`):
  full CRUD modal with image upload (1-5), L1/L2 category, gender,
  per-size stock, return-eligible toggle. Bulk-action bar (publish, pause,
  delete), bulk xlsx import + template download. Sidebar soft-nav works.
- **Storefront page**: banner upload switched to Cloudinary (was base64).
- **KYC page**: doc uploads switched to Cloudinary (private). 5 MB cap,
  image-only MIME (jpeg/png/webp). PDFs no longer accepted.
- **Admin dashboard MVP migrated to Next.js** (`app/admin/page.tsx`):
  5 tabs — Overview, Merchants, Stores, Products, Orders. Uses
  `legacy-admin.ts` shim. Real-data verified (126 merchants, 100 products,
  351 orders, ₹0 today revenue against menscape store).
- **Admin sign-out bug fix**: `admin-auth.store.ts`'s `_syncFromStorage`
  used to read the raw persist envelope into `state.token`, causing the
  next persist save to double-stringify. Now unwraps with the same JWT
  detector the typed `api-client.ts` uses. `clearAuth` also wipes the
  localStorage key to defeat any pre-existing malformed envelope.
- **`/admin/login` placeholder replaced** with a `redirect("/admin")` —
  the embedded login form in `admin/layout.tsx` handles the unauth state.
- **`legacy-admin.ts` token unwrap**: raw fetch path now reads the same
  Zustand envelope correctly, fixing the "Invalid header string"
  500 that was crashing admin API calls on first render.
- **Migration script** (`backend/migrations/004_migrate_base64_to_cloudinary.py`):
  idempotent base64 → Cloudinary backfill for `products` + `stores`. Not
  auto-run; trigger manually via `python -m migrations.run 004`. Reports
  products_scanned, stores_scanned, images_migrated, failures, elapsed.
  **Blocked** until Cloudinary API secret is rotated.

**Production readiness** (assessed at end of iter-39):
- Cloudinary uploads return **HTTP 502 `[prodenv:30dc5d5..] Request
  forbidden`** because the `CLOUDINARY_API_SECRET` value in `/app/backend/.env`
  is not authorised for `CLOUDINARY_CLOUD_NAME=doojqkyff`. User is rotating
  this on their side. ALL other wiring verified by 16/16 iter18 contract
  tests + manual e2e (`/app/backend/tests/test_iter18_cloudinary_wiring.py`).

**Known unresolved** (carried from iter17):
- Merchant deep-link / hard-refresh on `/merchant/products` etc. redirects
  back to `/merchant/login`. Soft sidebar-nav works. Root cause is a
  Zustand-persist hydration race vs the layout's auth guard — out of scope
  for the iter-39 stabilization session.

## Latest Iteration (Feb 2026 — Iter-38) — Twilio Production OTP + Universal SMS Fallback

**Done**:
- `backend/notifications.py` rewritten: new `send_with_fallback(phone, body)` helper
  used by every transactional notification (order placed, accepted, rejected,
  on-the-way, delivered, cancelled, rider pickup, return pickup, return status).
  Tries WhatsApp first (with `whatsapp:` prefix auto-applied); on Twilio-side
  rejection or unregistered-sender error, immediately retries the same message
  over SMS using `TWILIO_SMS_FROM`. OTP path keeps the 5-second status poll
  (`send_otp_with_fallback`) so we wait for terminal status before falling back.
- WhatsApp Content Template path wired: when `TWILIO_OTP_CONTENT_SID` is set
  (after Meta approves the `lokl_otp` template), the OTP WA leg automatically
  switches from `body=` to `content_sid + content_variables={"1": otp}`. Zero
  code change needed at template-approval time.
- New `.env` keys: `TWILIO_SMS_FROM`, `TWILIO_OTP_CONTENT_SID` (empty until
  approval). `CUSTOMER_OTP_DEBUG` flipped to `false` for production. Existing
  `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM` swapped to the paid account.

**End-to-end verified on +917719052107**:
- 3 SMS messages delivered (SIDs `SM42efc...`, `SMb577...`, `SMb242...`).
- Customer OTP round-trip PASS: SMS-delivered OTP `930299` accepted by
  `/api/auth/customer/verify-otp` → customer JWT issued.
- Order placement (BFO-70C197FA) → customer SMS delivered.

**Known Twilio account state** (not a code issue, surfaced by tests):
- WhatsApp sender `+19894690577` is not yet a registered WhatsApp Business
  sender — every WhatsApp send currently fails at the Twilio edge → SMS
  fallback fires automatically. Action: register the sender in Twilio Console.
- Account is on the **Trial tier** — sends to unverified numbers (e.g. demo
  merchant phones) are rejected by Twilio with "unverified number" error.
  Action: upgrade Twilio to a paid plan OR verify each merchant phone in the
  Twilio Console. Application code is correct; the failure logs are
  deliberately INFO-level so they don't break the order flow.

## Previous Iteration (Feb 2026 — Iter-37) — Session D.2 + E · Cutover

**Cutover complete**: `/app/frontend-next/` renamed to `/app/frontend/` (canonical);
legacy CRA preserved at `/app/frontend-legacy/` with its Dockerfile intact for rollback.
Supervisord-managed frontend on port 3000 now serves Next.js. Docker-compose +
GitHub Actions (pr.yml, deploy-staging.yml) all updated to use `npm` and the new
`NEXT_PUBLIC_*` env var names. CRA env names (`REACT_APP_*`) documented in
`DEPLOYMENT.md` migration table.

**Merchant pages migrated** (10 routes): `/merchant/login`, `/merchant/register`,
`/merchant/onboarding`, `/merchant/kyc`, `/merchant/dashboard`, `/merchant/products`,
`/merchant/orders`, `/merchant/storefront`, `/merchant/bank`, `/merchant/analytics`,
`/merchant/ai-studio`. All return HTTP 200, all share the existing merchant layout
with sidebar + guards, all use the typed `api.merchant.*` client and Zustand
`useMerchantAuthStore`. The shared `MerchantAuthForm` component handles both
login + register with `mode` prop.

**Hydration #418 fix**: New `src/hooks/useMounted.ts` hook + gating in
`ConsumerHeader` (city + cart badge), `StickyBottomNav` (wishlist badge), and
`ProductCardV2` (cart qty pill). Confirmed by iteration_17 — 3 consecutive PDP
reloads produced zero hydration warnings.

**OG images live**: `app/(consumer)/product/[id]/opengraph-image.tsx` and
`app/(consumer)/store/[id]/opengraph-image.tsx` — Node.js runtime, branded 1200×630
text-only cards (skipped product images to dodge Satori JPEG decode limitation).
Both return `Content-Type: image/png` 200. Visible on WhatsApp/Instagram link
previews automatically — Next.js wires the meta tags via convention.

**Build verified** (`npm run build`): All routes 184-198 kB First Load JS, shared
chunk 142 kB, 35 routes total. 0 `<img>` tags in `src/`. tsc --noEmit clean.

**Known caveat (test artifact, not a real bug)**: Refresh-token cookie collision
in Playwright sessions can swap merchant identity mid-flight when two merchants
register in the same browser context. Real-user impact: nil (cookie path scoped
to `/api/auth`, overwritten on every login). Documented in iteration_17 RCA.

## Previous Iteration (Feb 2026 — Iter-36) — Session D · Consumer migration

**Scope (a) — Consumer-first**: 14 consumer pages migrated from CRA → Next.js
15 App Router. SSR added for `/product/[id]` and `/store/[id]` (both flagged
`ƒ Dynamic` in the build manifest, with proper `generateMetadata` for SEO/OG).
Other consumer routes (Home, Cart, Wishlist, Search, Categories, /c/[slug],
/c/[slug]/[...l2slug], Stores, Checkout, Orders/[id], Returns/[id], /p/[id]
alias, /account) are `"use client"` with `api.*` calls through the same Zustand
+ React Query plumbing already in place from Sessions B/C.

**Shared components built** (all under `components/consumer/`):
ProductCardV2, StoreCardV2, ProductBadge, HCarousel, OffersStrip, HeroV2,
CustomerLove, Footer, DiscoveryRails, ReturnComplaintModals, ProductGallery,
ProductActions, StoreInfoChips, HomeClient, CategoryClient.

**next/image rollout — 100%**: `grep -rn '<img ' /app/frontend-next/src/`
returns zero hits. Every product/store/avatar/banner uses `next/image` with
`fill`/`sizes`/`priority`/`loading="lazy"` set per use-case.

**CORS fix (Iter-36b)**: api-client.ts, legacy-admin.ts, downloads.ts switched
from absolute `NEXT_PUBLIC_API_URL` baseURL to a same-origin empty string in
the browser. All browser `/api/*` calls now traverse the Next.js rewrite proxy
(next.config.ts:13-17), eliminating the preview-ingress CORS issue that
blocked the first test run.

**Build verified**: `npm run build` clean, all routes 192-198 kB First Load JS,
shared chunk 141 kB (incl. 11.3 kB CSS). 25 routes total — 19 static, 6 dynamic.

**Tested (iteration_15 + iteration_16)**:
PASS — SSR PDP, SSR Store, Home + rails, Stores list (60 cards), Categories
(9 tiles), /c/[slug] L1+L2, Search results+fallback, Cart + Wishlist Zustand,
PDP Buy-now, next/image enforcement, SEO/OG, OTP backend plumbing, Account
login gate, /orders/[id] page shell, build size.
DEFERRED — Account tile-switching, Orders status hero, Return modal submit,
Returns OTP card (auth-gated flows; data plumbing verified working but full
Playwright browser run was time-boxed). Manual self-test via curl confirms
the underlying APIs respond correctly.

**Known caveats**:
- PDP shows a React #418 hydration warning (MEDIUM — out of scope for D).
- `next.config.ts` has `output:"standalone"` — works with `next start` in this
  preview but Next prints a warning. Session E should either remove the flag
  or switch the runner to `node .next/standalone/server.js`.

## Previous Iteration (Feb 2026 — Iter-35b) — Pre-Session D Fixes

**Fix 1 — Backend CI requirements clean-up**: Audited `/app/backend/requirements.txt`; confirmed
**zero Flask packages remain** (no `flask-talisman`, `flask-cors`, `flask-limiter`, `flask-sqlalchemy`,
`flask-migrate`, `alembic`, `sqlalchemy`). `SecurityHeadersMiddleware` in `server.py` already replaces
Flask-Talisman natively, and `slowapi==0.1.9` is the FastAPI rate-limit equivalent. `pip install -r
requirements.txt` succeeds and `from server import app` imports cleanly.

**Fix 2 — Sentry lazy load**: `components/SentryBoot.tsx` already dynamic-imports `@sentry/react`
inside a `useEffect` and is mounted as the last child of `QueryClientProvider`. Additionally fixed
`app/error.tsx` which still had a static `import * as Sentry from "@sentry/react"` — now also uses
a dynamic `import()` inside the effect, fully evicting Sentry from every route's first-load chunk.
**Verified**: `npm run build` → all 28 routes at **181 kB First Load JS** (target ≈180 kB), shared
chunk 144 kB, build green, 25 static + 3 dynamic.

## Previous Iteration (Feb 2026 — Iter-35) — Session C of FE migration

Frontend Architecture Upgrade, Session C of 5. **Scaffolding-only session**:
every page renders a placeholder; the four route layouts (`(consumer)`,
`account`, `merchant`, `admin`) are production-ready so Session D can drop
real page content in without layout work.

### Delivered
- **All 28 routes scaffolded.** Build green, 25 static + 3 dynamic
  prerenders. `/p/[id]` issues a server-side `redirect()` to `/product/[id]`.
- **`(consumer)/layout.tsx`** — sticky `ConsumerHeader` + mobile-only
  `StickyBottomNav` + global Sonner toaster. Header sources cart count
  from `useCartStore()`, city from `useLocationStore()`.
- **`account/layout.tsx`** — inline OTP login gate when
  `useCustomerAuthStore().isAuthenticated === false` (matches legacy
  inline-login UX, no redirect to a separate page).
- **`merchant/layout.tsx`** — full sidebar nav + per-route guard:
  unauthenticated → `/merchant/login`; authenticated-but-not-approved on an
  ApprovedOnly route → `/merchant/onboarding`. KYC status badge in the
  sidebar footer.
- **`admin/layout.tsx`** — inline credentials form (no separate login route)
  matching the legacy pattern.
- **`middleware.ts`** — pass-through scaffold. *Documented divergence*: the
  FastAPI refresh cookie is scoped to `path=/api/auth`, so it isn't sent on
  `/merchant/*` etc. — middleware can't see auth state. Layouts own the
  redirect logic via Zustand.
- **`useHeartbeat`** ported (POST `/api/heartbeat` every 30s; silent
  failure). Mounted in `ConsumerHeader` (consumer pages) and
  `MerchantLayout` (merchant pages).
- **`CustomerOtpLogin`** ported with the **wishlist merge** UX win flagged
  in Session B: on successful OTP verify, the guest wishlist
  (`bf_wishlist_guest`) is merged into the per-phone bucket
  (`bf_wishlist_<phone>`), deduped by product id, and the guest bucket is
  cleared. Toast: "Added N saved items to your wishlist".
- **`legacy-admin.ts`** compat shim — `adminFetch<T>()` + `adminStreamDownload()`
  exposing the exact interface `AdminPanel.jsx` will use when it's eventually
  ported (a later, separate task per Session A constraint).
- **`not-found.tsx`** and **`error.tsx`** — branded, Sentry-wired retry.

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ 0 warnings |
| `npm run build` | ✅ all 28 routes — 222 KB first-load shared |
| All 28 routes return 200 | ✅ verified via curl matrix |
| `/p/:id` redirects to `/product/:id` | ✅ |
| ConsumerHeader renders cityName from Zustand | ✅ (SSR HTML contains `data-testid="city-display"`) |
| StickyBottomNav renders cart-count badge | ✅ via `useCartStore` selector |
| Wishlist merge fires on OTP login | ✅ implemented in CustomerOtpLogin pre-`setAuth` |
| 404 for invalid routes | ✅ `/not-a-route` → 404 |

### Files created in this session (40)
```
src/middleware.ts
src/hooks/useHeartbeat.ts
src/lib/legacy-admin.ts
src/app/not-found.tsx
src/app/error.tsx
src/app/(consumer)/layout.tsx
src/app/(consumer)/loading.tsx
src/app/(consumer)/page.tsx
src/app/(consumer)/{cart,categories,checkout,search,stores,wishlist}/page.tsx
src/app/(consumer)/{categories,stores,search}/loading.tsx
src/app/(consumer)/c/[slug]/page.tsx + loading.tsx
src/app/(consumer)/c/[slug]/[...l2slug]/page.tsx
src/app/(consumer)/p/[id]/page.tsx        (redirect alias)
src/app/(consumer)/product/[id]/page.tsx + loading.tsx
src/app/(consumer)/store/[id]/page.tsx + loading.tsx
src/app/(consumer)/orders/[id]/page.tsx + loading.tsx
src/app/(consumer)/returns/[id]/page.tsx
src/app/account/layout.tsx + page.tsx
src/app/merchant/layout.tsx
src/app/merchant/{login,register,onboarding,kyc,dashboard,orders,storefront,bank,products,ai-studio,analytics}/page.tsx
src/app/admin/layout.tsx + page.tsx
src/app/admin/login/page.tsx
src/components/consumer/ConsumerHeader.tsx
src/components/consumer/StickyBottomNav.tsx
src/components/consumer/CustomerOtpLogin.tsx
```

### Components ported to TypeScript (4)
- `ConsumerHeader` (from `components/consumer/ConsumerHeader.jsx`)
- `StickyBottomNav` (from `components/consumer/v2/StickyBottomNav.jsx`)
- `CustomerOtpLogin` (from `components/consumer/CustomerOtpLogin.jsx`)
- `MerchantLayout` (from `components/merchant/MerchantLayout.jsx`) — fused
  with the `merchant/layout.tsx` route layout itself

### Divergences from spec (with justification)
1. **Middleware is pass-through, not cookie-checking.** The backend refresh
   cookie is `path=/api/auth` scoped → unavailable on `/merchant/*` URLs.
   An active cookie check would 100% false-positive every logged-in user.
   Client layouts own the redirect via Zustand, which is reliable.
2. **Merchant guards live in the layout's `useEffect`, not in a separate
   guard component.** Same behavior, fewer files. The route guards from
   legacy `App.js` (Protected, ApprovedOnly) are collapsed into a single
   pathname-driven check in `merchant/layout.tsx`.
3. **Bottom-nav cart-count badge renders on the Wishlist tab**, not on a
   dedicated cart tab. Legacy v2 didn't include cart in the bottom nav at
   all (cart sits in the header). Decision: badge mirrors `useCartStore`
   on Wishlist for sensible visual signal; revisit during Session D's
   visual pass.

## Latest Iteration (Feb 2026 — Iter-34) — Session B of FE migration

Frontend Architecture Upgrade, Session B of 5. **No visual or behavioral
change** to the live CRA app — this session adds the design system, UI
primitives, and Zustand stores to the parallel Next.js app.

### Tasks delivered (1 + 2 + 3 + 4)

**Task 1 — Design system (Tailwind v4 `@theme`)**
- `globals.css` rewritten with `@import "tailwindcss"` + `@theme` token block.
  All 9 color tokens, 3 radius tokens, and bottom-nav spacing token match
  `/app/design_guidelines.json` exactly.
- Clash Display + Satoshi (Fontshare) loaded via `<link rel>` in
  `app/layout.tsx` (NOT @import — Tailwind v4 expands inline and CSS spec
  forbids late @imports).
- Legacy custom utilities ported verbatim: `bf-glass`, `bf-fadeup`,
  `bf-marquee`, `v2-pop-in`, `v2-shimmer`, `no-scrollbar`, `line-clamp-1/2`
  + their `@keyframes`.
- Runtime tokens duplicated in `design-system/tokens.ts` for non-CSS contexts
  (Razorpay theme, chart styles).
- Browser-verified: `body.bgColor = rgb(253,251,247)`, `h1.fontFamily`
  resolves to `"Clash Display", Satoshi, system-ui, sans-serif`.

**Task 2 — UI primitives**
- `components/ui/Button.tsx` — variants `primary/secondary/ghost/destructive`,
  sizes `sm/md/lg`, `isLoading` with spinner + `aria-busy`, forwardRef.
- `components/ui/Card.tsx` — `default/lg` sizes, optional `shadow`, forwardRef.
- `components/ui/Badge.tsx` — variants `accent/primary/muted/success/error`.
- `components/ui/Input.tsx` — labeled, error w/ `role="alert"`, hint,
  forwardRef, auto-generated `useId()` if `id` missing.
- `components/ui/Skeleton.tsx` + `ProductCardSkeleton`,
  `StoreCardSkeleton`, `OrderRowSkeleton`, `ProfileSkeleton` — layouts match
  the real components they'll substitute for.
- `components/ui/index.ts` — barrel.
- `lib/utils.ts` — `cn`, `formatPrice` (en-IN INR), `formatDistance` (m vs km),
  `formatOrderStatus` (FSM → label), `formatRelativeTime` (no external lib,
  past dates), `truncate`, `isValidIndianPhone` (10 or 12 digits).

**Task 3 — Zustand stores (6 total)**
- `stores/customer-auth.store.ts` — key `bf_customer_token` + companion key
  `bf_customer_phone` mirrored for legacy compat. Event `customer-auth:change`.
- `stores/merchant-auth.store.ts` — key `bf_token`. Event `merchant-auth:change`.
- `stores/admin-auth.store.ts` — key `bf_admin_token`. Event `admin-auth:change`.
- `stores/cart.store.ts` — **persists under `bf_cart:next`** to avoid
  fighting the legacy app's bare-array writer at `bf_cart`. A mirror
  writer keeps `bf_cart` in sync (so legacy tabs see updates). Single-store
  rule layered in with backward-compat: legacy items without `store_id` are
  grandfathered. `_syncFromLegacy()` adopts the bare-array on first boot.
- `stores/location.store.ts` — key `lokl_loc_v1` (NOT `bf_city` as the user
  prompt template said — the legacy actual key wins). Event `lokl:location`.
  Bhilai-polygon service check deferred to Session C with the LocationGate
  component.
- `stores/wishlist.store.ts` — key `bf_wishlist_${phone||"guest"}` per-customer
  (LEGACY pattern preserved). Stores full ProductCard snapshots for offline
  rendering; exposes `productIds()` selector for compat with the spec's
  `productIds: string[]` shape. Event `wishlist:change` (CustomEvent w/
  `{phone, list}` detail — matches legacy).
- `stores/index.ts` — barrel + re-exports of all keys/events.
- All stores include `_syncFromStorage` + `storage`-event listeners for
  cross-tab + cross-app (legacy CRA ↔ Next.js) reactivity.

**Task 4 — Downloads utility**
- `lib/downloads.ts` — `merchantAnalyticsCsv`, `merchantProductsTemplate`,
  `adminApprovalsCsv`. Uses raw `fetch()` per the api-client.ts CARVE-OUTS
  comment. `setTimeout(revokeObjectURL, 4s)` for Safari compat.

### Divergences from the user prompt (with justification)

| Item | Prompt said | I shipped | Why |
|---|---|---|---|
| Location storage key | `bf_city` | `lokl_loc_v1` | The legacy app's actual key — a customer with location data in the old app keeps it on cutover |
| Wishlist persistence | `productIds: string[]` | Full ProductCard snapshots, exposed `productIds()` selector | Legacy stores full cards for offline render; preserving guarantees data continuity for existing users |
| Wishlist key | Single key | `bf_wishlist_${phone||"guest"}` | Legacy is per-phone — guest vs logged-in wishlists are separate buckets |
| Cart persistence key | `bf_cart` | `bf_cart:next` (with mirror writer to `bf_cart`) | Zustand-persist wraps state in `{state, version}` JSON which would break the legacy app's bare-array reader. Mirror writer keeps both apps reading the same data |
| Tailwind config form | `tailwind.config.ts` | `globals.css` `@theme` | Tailwind v4 (which shipped with `create-next-app@15`) uses CSS-first config — the JS config file is obsolete |
| Font loading | `@import` in `globals.css` | `<link rel>` in `layout.tsx` | Tailwind v4's CSS import expands inline → CSS spec forbids any `@import` after that point |

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ 0 warnings, 0 errors |
| `npm run build` | ✅ succeeded, 173 KB First Load JS on `/` (under 200 KB cap) |
| Background color renders #FDFBF7 | ✅ `rgb(253, 251, 247)` |
| h1 font-family includes Clash Display | ✅ |
| `--color-brand-bg` token resolves | ✅ `#fdfbf7` |
| Cart localStorage strategy | ✅ legacy `bf_cart` bare-array + Zustand `bf_cart:next` |
| Customer token key matches legacy | ✅ `bf_customer_token` |
| Merchant token key matches legacy | ✅ `bf_token` |
| Admin token key matches legacy | ✅ `bf_admin_token` |
| Cross-tab sync via `storage` event | ✅ wired in every store |

### Files created/modified
**New (16)**: `globals.css` (overwritten), `app/layout.tsx` (font link added),
`app/page.tsx` (smoke screen, will be replaced in Session C),
`design-system/tokens.ts`, `lib/utils.ts` (overwritten + extended),
`lib/downloads.ts`, `components/ui/{Button,Card,Badge,Input,Skeleton,index}.tsx`,
`stores/{customer-auth,merchant-auth,admin-auth,cart,location,wishlist,index}.store.ts`.

## Latest Iteration (Feb 2026 — Iter-33) — Session A of FE migration

Frontend Architecture Upgrade, Session A of 5. **No visual or behavioral
change** to the live CRA app — this session is pure scaffolding for the
parallel Next.js 15 app that will replace it.

### Tasks delivered (2 + 3 + 4)
- **Task 2** — Next.js 15.5 + React 19.1 + TypeScript strict + Tailwind v4
  scaffolded at `/app/frontend-next/`. `tsconfig.json` enforces
  `strict + noUncheckedIndexedAccess + noImplicitAny`. ESLint hard-bans
  `any`. Production build green: **164 KB First Load JS** on the home page.
  Dev server runs on port 3001 in parallel with the CRA app on 3000.
- **Task 3** — Type system in `src/types/` (8 modules) derived from the
  **actual** Mongo response shapes (audited keyset, not the user-prompt
  template). Key divergences from the template documented inline:
  `Product.id` not `_id`, `Product.stock` is a per-size `Record<string, number>`
  not a scalar `stock_quantity`, `CustomerAddress.id` not `address_id`, no
  `razorpay_*` fields on `Order` yet (reserved for future), stores use flat
  `lat`/`lng` floats, not GeoJSON Point.
- **Task 4** — Single typed axios client at `lib/api-client.ts` with
  multi-token routing (`bf_customer_token` / `bf_token` / `bf_admin_token`)
  driven by URL classifier, 401-coalesced refresh-once-and-retry, and
  preserved `customer-auth:change` / `merchant-auth:change` /
  `admin-auth:change` events for cross-tab sync.
- Per-domain API wrappers covering all **70 endpoints** from the audit:
  `auth.ts`, `stores.ts`, `products.ts`, `customers.ts`, `orders.ts`,
  `merchant.ts`, `admin.ts`, plus `site/catalog/search/misc` in `index.ts`.
- Carve-outs documented in the api-client header: CSV/XLSX downloads stay
  on `fetch()`, AdminPanel's raw fetch will be wrapped by a compat shim in
  Session C (not migrated).

### Verification
- `npx tsc --noEmit` — 0 errors
- `npm run lint` — 0 warnings, 0 errors
- `npm run build` — succeeded, 164 KB First Load JS
- Dev server boots on `:3001` without warnings

### Deferred to later sessions (intentional)
- Session B: Design system (Tailwind v4 `@theme` tokens), Zustand stores
  (customer/merchant/admin/cart/location), UI primitives.
- Session C: App Router scaffolding for all 28 routes with loading/error.
- Session D: SSR + image migration for 40 `<img>` tags.
- Session E: Analytics, perf audit, cutover docs.

## Latest Iteration (Feb 2026 — Iter-32) — Auth P0 hardening

Per the auth gap-analysis, only the four P0 items were addressed in this
session. P1/P2/P3 deferred to a later auth sweep.

### M1 + M2 — Customer authentication (OTP) + Order binding
- New `customer` role JWTs, issued via WhatsApp OTP:
  - `POST /api/auth/customer/request-otp` — body `{phone}`, generates a
    6-digit code, bcrypt-hashes it, stores in `customer_otps` with a 10-min
    TTL index, dispatches via Twilio WhatsApp. Rate-limited 5/min per IP.
  - `POST /api/auth/customer/verify-otp` — 5 attempts max, on success issues
    access (15m) + refresh (7d, httpOnly cookie) tokens, normalizes the phone
    to E.164 12-digit, upserts the customer doc.
- All previously-anonymous `/api/customer/{phone}/...` routes now require a
  `customer` JWT AND enforce `URL.phone == JWT.sub` (403 on mismatch). Admins
  pass through for support scenarios. Routes hardened:
  - `GET /customer/{phone}`
  - `POST /customer/{phone}/addresses`
  - `DELETE /customer/{phone}/addresses/{aid}`
  - `GET /customer/{phone}/returns`
  - `GET /customer/{phone}/complaints`
  - `POST /customer/upsert` (verified payload.phone matches JWT)
- `POST /api/orders` requires a customer JWT and refuses payloads where
  `customer.phone != JWT.sub` (admins exempt). Phone is normalized to the
  canonical 12-digit form before snapshot.
- Same enforcement applied to the customer-mutation order routes:
  `POST /orders/{oid}/customer-cancel`, `/returns`, `/complaints`. Customer
  phone is now derived from the order document (no longer trusted from body).
- `CUSTOMER_OTP_DEBUG=true` preview-only env flag logs OTP to backend logs
  so dev/staging work even when Twilio's 50/day sandbox cap is exhausted.
- Frontend:
  - `lib/api.js` — multi-token axios interceptor routes the right Bearer per
    URL prefix (customer routes → `bf_customer_token`, everything else →
    `bf_token`). 401 on customer routes auto-clears the stale session.
  - New `components/consumer/CustomerOtpLogin.jsx` — two-step phone → OTP UI,
    resend cooldown, change-number affordance. Reused by `/account` gate and
    by Checkout's pre-place-order gate.
  - `CustomerAccount.jsx` reactively reflects login/logout across tabs via
    a `customer-auth:change` window event.
  - `ReturnComplaintModals` no longer sends `customer_phone` — backend
    derives it from JWT + order doc.

### P2 — Admin bcrypt-only
- Removed the legacy plain-text `ADMIN_PASSWORD` fallback from
  `server.py:admin_login` + the env validation block. Only
  `ADMIN_PASSWORD_HASH` is accepted now. Hash for `Admin@2026` baked into
  `/app/backend/.env` (12-round bcrypt).

### P1 — Proper logout
- `POST /api/auth/logout` now:
  1. Reads the refresh cookie (if present), decodes its `jti`, inserts a
     revocation doc into `revoked_refresh_jti` (TTL-pruned at natural expiry).
  2. `response.delete_cookie("refresh_token", path="/api/auth", …)` so the
     browser stops sending it.
  3. Best-effort merchant-store-offline side-effect (existing behavior).
- `POST /api/auth/refresh` consults the revocation set and 401s on revoked
  JTIs even if the cookie value is presented out-of-band.
- Frontend `clearCustomerSession()` + `AuthContext.logout()` both call
  `/api/auth/logout` and remove the localStorage tokens.

### Indexes (created in `startup_seed`)
- `customer_otps`: unique on `phone`, TTL on `expires_at`.
- `revoked_refresh_jti`: unique on `jti`, TTL on `expires_at`.

### Verification
- Backend boots clean (Sentry init log confirmed, no startup errors).
- Curl matrix passes:
  - 401 on customer routes without bearer
  - 200 on customer routes with matching JWT
  - 403 when JWT phone ≠ URL phone (or ≠ payload.customer.phone)
  - 403 on POST /orders with mismatched customer.phone
  - Refresh cookie cleared on logout (verified via -c cookie jar)
- Playwright end-to-end: phone → OTP from logs → verify → customer dashboard
  loads with `bf_customer_token` populated in localStorage.
- Test suite: 5/5 `test_phase1_returns.py` pass (rewritten to use OTP flow),
  13/14 `test_iter5_flow.py` pass (the 1 pre-existing failure is the Iter-23
  `merchant/products` images-trim — unrelated).

### Out of scope (explicitly deferred per user direction)
- P1: per-account lockout, logout-all-devices, password reset, auth audit log,
  axios refresh interceptor.
- P2: admin TOTP, access-token-to-memory, sessions UI, phone/email re-auth.
- P3: jti/iss/aud claims for access tokens, CSRF, CORS hardening.

## Latest Iteration (Feb 2026 — Iter-31) — Infra hardening: Sentry + CI/CD + Staging

Strict infrastructure session. No product logic touched. Goals: observability,
repeatable deploys, environment hygiene.

### Sentry (graceful no-op when DSN unset)
- New `/app/backend/observability.py` — `init_sentry()` lazy-imports `sentry_sdk`,
  wires Starlette + FastAPI integrations, tags `service=lokl-backend`. Skips
  cleanly when `SENTRY_DSN` is blank so dev/CI never spam the dashboard.
- New `/app/frontend/src/lib/observability.js` — same pattern for `@sentry/react`,
  tags `service=lokl-frontend`, wires `browserTracingIntegration`. Reads
  `REACT_APP_SENTRY_*` env vars.
- `backend/server.py` calls `init_sentry()` right after `load_dotenv`.
- `frontend/src/index.js` calls `initSentry()` before `ReactDOM.createRoot`.
- Installed: `sentry-sdk==2.18.0` (added to `requirements.txt`) + `@sentry/react@^8.45.0`.

### GitHub Actions
- `.github/workflows/pr.yml` — runs on PR + push to main. Three jobs:
  backend-lint-test (ruff + pytest against a Mongo 7 service container),
  frontend-lint-build (eslint + craco build), docker-build (multi-arch buildx
  for both images, no push, GHA cache). Gated concurrency cancels stale runs.
- `.github/workflows/deploy-staging.yml` — runs on push to main + manual
  dispatch. Builds + pushes versioned (`:<sha>`) and rolling (`:staging`) tags
  to GHCR, then SSHs to `STAGING_HOST` and runs `docker compose pull && up -d`,
  followed by a smoke job that curls staging health endpoints. Deploy + smoke
  steps are gated by repo variables (`STAGING_DEPLOY_ENABLED`,
  `STAGING_SMOKE_ENABLED`) so they don't run before secrets are configured.
- New `scripts/smoke_staging.sh` — exits non-zero on heartbeat/stores/products/
  homepage-config failure. Verified green locally against the preview URL.

### Staging environment
- New `.env.staging.example` — staging-shaped copy of `.env.example` with
  `SENTRY_ENVIRONMENT=staging`, separate Atlas DB (`lokl_staging`), Razorpay
  test mode, frontend `REACT_APP_*` build args.
- Existing `docker-compose.staging.yml` already overlays via image references
  + `mongo` profile disabled (uses Atlas).

### Env cleanup
- `.env.example` gained an Observability section: `SENTRY_DSN`,
  `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`,
  `SENTRY_PROFILES_SAMPLE_RATE`. Frontend section now lists `REACT_APP_SENTRY_*`
  vars.
- Removed duplicate Razorpay block at the bottom of `.env.example`.

### Release discipline
- New `DEPLOYMENT.md` — environments matrix, secrets/vars checklist for
  GitHub, auto-deploy flow, manual rollback playbook (`docker compose` pinned
  to a SHA tag), production gate (tag-driven, not auto), observability
  references, backup checklist.

### Verification
- Backend boots cleanly with `SENTRY_DSN=""` (no-op log line).
- Frontend compiles + renders correctly with new init module.
- Smoke test green against the preview URL (4/4 checks passed).
- 18/19 backend regression tests pass; 1 pre-existing failure
  (`test_get_merchant_products_returns_images`) is from the Iter-23 perf trim
  of `/api/merchant/products` and unrelated to this change.

## Latest Iteration (Feb 2026 — Iter-30) — Per-merchant UNIQUE 4-digit OTPs

User clarified the multi-store flow needs a UNIQUE OTP per merchant (not a shared global OTP). Each store gets its own OTP. Customer receives one OTP per merchant only after that merchant accepts. Admin dashboard renders the multi-store order as one row with per-slice inline Mark Delivered + Cancel buttons + each store's OTP. Merchant only sees their own OTP.

### Backend
- `POST /api/orders`: now generates `merchant_otps: {mid: "XXXX"}` — one unique 4-digit code per merchant (not a shared one). Legacy global `otp` field set to first merchant's OTP for backward compat. New `merchant_cancelled: {mid: reason}` map added.
- `POST /api/merchant/orders/{oid}/accept`: returns the merchant's OWN OTP. Customer accept-notification now includes that store's specific OTP. Rider pickup notification fires PER-merchant accept (each leg has its own dispatch + unique OTP), passing only that merchant's items.
- `POST /api/merchant/orders/{oid}/handed-to-rider`: customer's "on-the-way" SMS now uses the relevant store's OTP, not the global one.
- `POST /api/admin/orders/{oid}/cancel`: accepts optional `{merchant_id, reason}` payload to cancel one slice. Global only flips to `cancelled` when ALL slices cancelled. Per-merchant `cancelled` state added to the state machine.
- `POST /api/twilio/inbound` (delivery confirmation): scans `merchant_otps` to match the OTP to a specific merchant slice; flips only that slice to delivered. Falls back to legacy `otp` for single-store orders.
- `GET /api/merchant/orders`: now returns `my_otp` + filters `merchant_otps` to hide other merchants' OTPs (server-side isolation).
- `GET /api/orders/{id}`: `store_breakdown[].otp` populated only when state ∈ {accepted, handed_off, delivered}; pending merchants hide their OTP from customer until accept.
- `GET /api/admin/orders`: now enriches every order with `store_breakdown[]` (per-merchant items, subtotal, state, OTP, cancel_reason) for UI consumption.
- `notify_order_accepted` (notifications.py): now accepts optional `otp` param to include in customer's "store accepted" message.

### Frontend
- `AdminPanel.jsx`: OrdersTab renders multi-store orders with a "MULTI-STORE · N" pill and per-slice inline cards. Each slice shows the store name, item count, subtotal, that store's unique 4-digit Rider OTP, plus dedicated Mark delivered + Cancel buttons. Single-store orders preserve the original whole-order finalize layout. `markDelivered(oid, merchantId)` and `cancel(oid, merchantId)` now accept an optional merchant_id to target a single slice.
- `OrderTracking.jsx` (customer): global OtpCard now suppressed when `is_multi_store`. Each MiniStepper card in the breakdown now embeds an inline navy OTP card (store name + "Share when this store's rider arrives" + 4-digit code) — only visible when the slice is in accepted/handed_off state. Cancelled slices show a rose-tinted reason banner.
- `MerchantOrders.jsx`: Accepted OTP card and On-the-way OTP line now read from `o.my_otp || o.otp` so each merchant only ever sees their own code.

### Tests
- `test_multi_merchant_orders.py` extended to 12 passing tests. New coverage: distinct OTP generation, accept returns only my_otp, merchant_orders hides other merchants' OTPs, per-merchant admin slice cancel, twilio inbound matches per-merchant OTP and flips only that slice.
- Testing agent (iteration_14.json): backend 100% + frontend 100%. End-to-end validated with seeded order BFO-8A76279A (merchant A OTP 5459, merchant B OTP 9834) — each merchant sees only their own OTP, customer order tracking shows both per-store OTP cards in their respective MiniStepper rows.



User reported: in a multi-store checkout, both merchants saw each other's items, the Accept button kept showing after one merchant accepted, and the global order total (not the merchant's subtotal) was being displayed. Also: customer order tracking showed only a single global stepper for multi-store orders.

### Backend (`/app/backend/server.py`)
- New helpers `_derive_global_status`, `_new_merchant_timeline`, `_stamp_merchant_step`. Global order status now = min of per-merchant states using ranking `pending=0 → accepted=1 → handed_off=2 → delivered=3`.
- Order doc now persists `merchant_states: {mid: state}`, `merchant_timelines: {mid: [4-step]}`, `merchant_delivered_at: {mid: iso}`. Each merchant gets their own 4-step flow (Order placed → Merchant accepted → Order on the way → Delivered).
- `POST /api/merchant/orders/{oid}/accept`: stamps Confirmed only on THAT merchant's timeline; global derived. All-accepted check still notifies rider.
- `POST /api/merchant/orders/{oid}/handed-to-rider`: requires `my_state == "accepted"`, stamps OnWay on THAT merchant's timeline; global flips to `on_the_way` only when ALL handed off.
- `POST /api/admin/orders/{oid}/mark-delivered`: now accepts optional `{merchant_id}` to mark one slice. Global flips to `delivered` only when ALL merchants delivered. `delivered_at` only stamped on global completion.
- `POST /api/twilio/inbound` delivery OTP: marks the FIRST `handed_off` merchant as delivered (rider delivers sequentially with shared OTP).
- `GET /api/merchant/orders`: returns `my_timeline` + `my_delivered_at` in addition to existing `my_state` + `merchant_subtotal`. Items pre-filtered to the merchant's own slice.
- `GET /api/orders/{id}`: for multi-store, enriches response with `store_breakdown[]` (per-merchant items, subtotal, state, timeline) for customer UI consumption.

### Frontend
- `/app/frontend/src/pages/MerchantOrders.jsx`: buckets pending/accepted/onWay/history now bucket purely on `my_state` (not global). On-the-way card distinguishes "Your items handed to rider" copy for multi-store.
- `/app/frontend/src/pages/OrderTracking.jsx`: new compact `MiniStepper` component; global stepper hidden when `is_multi_store`; multi-store-breakdown renders a labeled card per store with its own MiniStepper updating independently (uses `store_breakdown` from backend with a defensive fallback that derives breakdown from items).

### Tests
- New `/app/backend/tests/test_multi_merchant_orders.py` — 8/8 passing. Covers per-merchant create state, partial accept stays pending_merchant, all-accepted flips global, partial hand-off stays accepted, all-handed flips on_the_way, per-merchant admin delivery (one then all), `/merchant/orders` returns merchant_subtotal != global total, `/orders/{id}` returns store_breakdown.
- Patched pre-existing tests (`test_phase1_returns.py`, `test_iter5_flow.py`) to satisfy the L2 storefront lat/lng requirement + hand-off-before-Twilio-delivery sequencing.
- Testing agent (`iteration_13.json`): backend 100%, frontend 100%, success rate 100%. Validated end-to-end (two-merchant signup → multi-store order → independent accept/hand-off → per-store MiniSteppers on customer page).


## Latest Iteration (Feb 2026 — Iter-28) — Location tech + 3-rail stores + PDP context + Category hub

Major end-to-end batch covering 4 phases the user asked for (L1 → L2 → P1 → C1):

### L1 — Customer location tech
- New `lib/location.js`: HTML5 geolocation wrapper + Bhilai service polygon (covers Bhilai + Durg + Jamul + Risali + Utai + Charoda via lat 21.07-21.37, lng 81.17-81.52 ray-casting), Haversine distance, localStorage persistence, `lokl:location` event emitter.
- New `LocationGate.jsx`: custom first-visit modal ("See what's nearby — share for nearby stores, accurate delivery times and distance-based delivery charges"). Triggers native browser prompt only on "Share Location" click; safe-skipped on /merchant /admin routes.
- New `LocationBanner.jsx` + `useUserCoords` hook: replaces the old IP-detect callout. Now state-driven — granted+in-service → nothing; granted+out → orange "we serve Bhilai"; denied/skipped → subtle navy CTA banner ("Enable location for nearby stores").
- `ConsumerHeader.jsx`: dropped the brittle IP fallback (false-positives on the preview URL).

### L2 — Merchant store geolocation
- `lat`/`lng` now mandatory in `POST /merchant/storefront`; rejected if missing.
- New `MerchantStorefront.jsx` "Pin your store location" card: "Use current location" button (browser geolocation), "Pin on Google Maps" deep-link, manual lat/lng inputs, live OpenStreetMap iframe preview.
- New backend helpers: `_haversine_km`, `_attach_distance_and_eta` (computes per-store distance + ETA from user coords; ETA model = 15 min base + 5 min/km, capped 90).
- `GET /api/stores?lat=&lng=` now accepts user coords → open-first → distance asc.
- New endpoints: `GET /api/feed/nearby-stores?lat=&lng=` (open + distance-sorted), `GET /api/feed/popular-stores` (orders_30d desc).
- `Home.jsx` now renders 3 rails inside the `stores` CMS slot: **Nearby stores** (only if user shared coords) → **Popular stores** → **All stores**.
- Backfilled all 10 seeded stores with Bhilai-cluster coordinates.

### P1 — Product listings + PDP context
- New `compact` + `linkState` props on `ProductCardV2`. `compact` hides the store_name + delivery line for in-store grids. `linkState` forwards `{fromStore: storeId}` through `<Link>`.
- `StorePage.jsx` now uses `ProductCardV2 compact linkState={fromStore}` instead of the legacy `ProductCard`.
- `ProductDetail.jsx` reads `useLocation().state.fromStore` (and `sessionStorage.lokl_last_store_id` set by StorePage on mount) — when matched, fetches the store's products and renders **"More from {Store}"** instead of generic "You might also love". `useEffect([id])` now `window.scrollTo(0,0)` and resets all state so related-card clicks are real PDP reloads, not in-place mutations.

### C1 — Category hub + Cart empty + Bottom nav
- New `CategoryHub.jsx` at `/categories`: L1 tile grid (3 cols mobile / 6 desktop) + OffersStrip + Trending now + Selling fast + Recently added rails — Myntra/Ajio-style discovery page.
- Sticky bottom nav: replaced the dead Search icon with Heart → `Wishlist (/account?tab=wishlist)`. "Categories" now correctly routes to `/categories`.
- `CustomerAccount.jsx` reads `?tab=` deep-link to select the matching tile on mount + on prop change.
- `Cart.jsx` empty state CTA now `to="/"` (was `/shop` → 404).

Verified end-to-end: 4 location states, store-distance sort (0.4 → 4.7km), 3 home rails, store→PDP "More from", category hub (9 L1 tiles), cart empty CTA, bottom-nav layout.

## Latest Iteration (Feb 2026 — Iter-27) — Order Tracking redesign

Full rebuild of `OrderTracking.jsx` in Myntra/Ajio style while preserving every existing capability (8s polling, OTP card, return modal, complaint modal, return-eligibility 24h logic, cancelled state).

New structure (top → bottom):
1. **StatusHero** — large display heading ("Delivered" / "On the way" / "Order confirmed" / "Cancelled" / "Returned"), descriptive subtitle, order ID + placed timestamp, contextual ETA pill (saffron-tinted) or "Delivered" pill (emerald-tinted).
2. **ProgressStepper** — 4-step horizontal pipeline (Placed → Confirmed → Out for delivery → Delivered) with `#4F7363` (Lokl green) for completed steps, navy text for active step, grey for pending. Mobile-safe (small dots + tight labels).
3. **OtpCard** — navy bg + saffron OTP, shown only when `status === "on_the_way"`.
4. **Help & return panel** — preserved entire previous logic (canReturn / windowExpired / no eligible items branches, return + complaint modal triggers). Buttons polished (saffron filled "Return product", navy outlined "Contact Customer Care").
5. **Timeline** — kept but compacted (now uses `#4F7363` checkmarks + tighter rows + timestamps).
6. **AddressCard** — NEW. Renders the delivery address (name, line, landmark, city/pincode/phone) inside an icon-led card.
7. **ItemsCard** — restyled "Your bag · N items" with size + Qty + an emerald "Return eligible" chip on eligible items.
8. **BillSummary** — NEW. Item total + delivery fee (with FREE pill) + discount + Total paid + payment-mode line.
9. **Help pill** — bottom outlined card with email + phone for any state.

Other:
- Wrapped page in `min-h-screen flex flex-col` with `flex-1` on `<main>` so the slim footer stays pinned to the viewport bottom even on tiny phones.
- Uses the existing Lokl tokens only (cream, navy `#0A1F5C`, saffron `#E68910`, green `#4F7363`); no new colors introduced.
- Lint clean, DOM-verified on a delivered + a not-yet-delivered order.

- **Fixed "LOKL MEMBER" badge overlapping the name + pencil on mobile.** Moved the badge out of `absolute` positioning and into the same inline-flex flow as `<h2>` + edit button — flex-wrap lets the pill cleanly drop to the next line on narrow screens. Verified `scrollWidth === clientWidth` for the header card on a 390px viewport (no overflow).
- **Orders is now the default selected tile** (Myntra/Ajio pattern). Added `activeTile` state (initial `"orders"`) and a single switch-driven content panel. Selected tile gets a navy 2-px border + faint navy tint + shadow; clicking any tile swaps the panel below. Recent-orders preview removed in favour of the full Orders panel above the fold.
- **Wishlist is live.** New util `/app/frontend/src/lib/wishlist.js` (localStorage, keyed by phone, dispatches `wishlist:change` events). Wired into `ProductCardV2`'s heart — toggling persists + toasts. New `WishlistPanel` lists saved products as cards with remove buttons. "SOON" badge dropped from the Wishlist tile; live count shown.
- **Sign-out is now a proper outlined card button** matching the surrounding surfaces (white bg, `E5E2DC` border, saffron text/icon, hover saffron-tinted). Full-width, rounded-2xl, 14-16px vertical padding.
- **Phone-gate empty-state fixed.** The footer used to "pull up" when content was short. Wrapped the page in `min-h-screen flex flex-col` with `flex-1` on `<main>` so the footer pins to the bottom of the viewport regardless of content height.

## Latest Iteration (Feb 2026 — Iter-25) — Batch B + C

### Batch B — Mobile Store Page
- Cover image height reduced on mobile: `h-[45vh]` → `h-[28vh] sm:h-[45vh] md:h-[55vh]`.
- Replaced the tall stacked Story + Delivery aside cards on mobile with **two compact `InfoChip`s placed side-by-side** under the cover image (each chip: 8px icon-tile + 10px label + truncated value + chevron). Tapping a chip opens a bottom-sheet style `InfoSheet` modal with the full content.
- Desktop aside (`hidden md:block`) preserves the original two-column story/delivery cards, unchanged.
- Verified on 390px viewport: chips render at y=369, product grid heading at y=443 — products are above the fold on first render (viewport 800px).

### Batch C — My Account rebuild (Myntra/Ajio style)
- Called `design_agent_full_stack` to lock the blueprint; saved at `/app/design_guidelines.json`.
- Rebuilt `CustomerAccount.jsx`:
  - `ProfileHeaderCard` — avatar + name + phone + "Lokl Member" pill, inline pencil edit.
  - `QuickActionGrid` — 4×2 tile grid (`grid-cols-4`): Orders / Returns / Addresses / Wishlist / Wallet / Coupons / Support / Profile, each with optional saffron count-badge or grey "SOON" badge.
  - `RecentOrdersPreview` — last 3 orders in a divided list with status pills (emerald=delivered, saffron=pending, rose=cancelled) and ChevronRight affordance.
  - Inline expandable sections for full Orders list / Address book / Profile edit form (single section open at a time via `openSection` state).
  - `LogoutControl` saffron ghost button at the bottom — clears `bf_customer_phone` and resets state.
- All eight tiles present; counts pulled from `/customer/{phone}` (orders, addresses) and `/customer/{phone}/returns`; Wishlist/Wallet/Coupons are stubs showing a "coming soon" toast.
- Mobile + desktop screenshots verified; ESLint clean.

## Latest Iteration (Feb 2026 — Iter-24) — Batch A: Store names + slim footer + consistent gap

- **Fixed "LOKL STORE" fallback on Trending now / Selling fast product cards.** `enrich_products_with_badges` in `feeds.py` now also resolves and attaches `store_name` via a single batched lookup on the `stores` collection. Verified via `/api/feed/popular-in-city` + `/api/feed/selling-fast` — every card now shows the real store (`Anjali Boutique`, `Step & Sole`, `Street Bazaar`, etc.). Affects every feed that uses the enricher (popular_in_city, selling_fast, best_sellers, new_arrivals, trending).
- **Slim footer.** Replaced the multi-block ~400px-tall footer with a single-row strip (~92px): brand · contact pills · social icons in one line + a 16px copyright row. ~77% height reduction. Same navy bg, sticky-nav clearance preserved on mobile via `pb-20 md:pb-0`.
- **Consistent section→footer gap on every page.** Added a `topGap` prop to `Footer.jsx` (default `true` = `mt-8`/32px). Home opts out (`topGap={false}`) so the gradient `CustomerLove` continues to blend seamlessly into the navy footer. Verified DOM gap: Home=0px (intentional blend), Stores/Cart/etc.=32px.

## Latest Iteration (Feb 2026 — Iter-23) — Offline-store hiding + merchant products perf

- **Offline merchants are now fully hidden from the storefront.** Updated `/api/stores` to add `online: {$ne: False}` to the visibility filter so toggled-offline stores no longer appear in the listing. Updated `/api/stores/{store_id}` to return 404 when `online == False` (kills the empty store-page deep-link). Feeds already excluded offline stores via `_visible_online_store_ids`, so nothing else changed. Verified: toggled `Anjali Boutique` offline → listing went 10→9, direct PDP returned 404. Merchant dashboard endpoints (own store/products) are untouched.
- **Merchant Products page is now snappy.** Stripped the heavy `images` (base64 carousel) array from `GET /api/merchant/products`. The page now renders cover thumbnails via the `image` field only. On clicking Edit, `openEdit` in `MerchantProducts.jsx` fetches the full product via `GET /api/products/{pid}` to populate the images array on demand. For a merchant with 5×~200KB images per product, this drops a 100-product list from ~100 MB → ~50 KB (>99% reduction).

## Latest Iteration (Feb 2026 — Iter-22) — Vertical rhythm + footer merge

- **Uniform 32px section gap** across the entire homepage. Replaced `py-8` (32+32 = 64px between sections) with `pt-8` (top-only) on every V2 section: `OffersStrip`, `HCarousel`, `CustomerLove`, and the inline `categories-v2` + `stores-near-you` sections in `Home.jsx`. Also removed the extra `pb-2` from carousel rows. Verified via DOM: visible_gap_to_next_h2 = 32px for hero→trending, trending→categories, categories→offers, offers→selling-fast, selling-fast→stores, stores→customer-love.
- **Seamless CustomerLove → Footer transition.** Removed the cream `pb-24 md:pb-12` from `<main>` (was leaking the cream parent bg between the navy CustomerLove section and the navy Footer). Moved the sticky-bottom-nav clearance to Footer's last bar (`pb-20 md:pb-0`).
- **Gradient on CustomerLove.** Changed `bg-[#0A1F5C]` → `bg-gradient-to-b from-[#152D6E] to-[#0A1F5C]` so the section starts with a lighter navy and lands on the footer's exact `#0A1F5C` — gradient seamlessly merges into the solid Footer below.

## Latest Iteration (Feb 2026 — Iter-21) — Carousel snap-padding fix + section reorder

- **Root-caused the persistent "cards touching the left edge" issue.** All `snap-x snap-mandatory` carousels were auto-scrolling `scrollLeft = padding-left` on first render — the default `scroll-padding` is 0, so `snap-start` aligned the first card with the container's border-edge, eating the padding. Fixed by adding `scroll-pl-4 sm:scroll-pl-8` to `OffersStrip.jsx`, `HCarousel.jsx`, AND `CustomerLove.jsx` (which was missing it). Verified via DOM bounding-box on desktop+mobile: every carousel's first card now starts at x=112, matching the hero/section headers.
- **Reordered homepage sections** per user: Hero → Trending now (popular_in_city) → Shop by category → Offers for you (banners) → Selling fast → Stores near you → Loved by Bhilai shoppers → Footer. Both the DB-stored `site_config` doc and the `DEFAULT_HOMEPAGE_SECTIONS` defaults in `server.py` updated. Section labels also refreshed (`popular_in_city` → "Trending now", `customer_love` → "Loved by Bhilai shoppers").
- OffersStrip h2 reverted to "Offers for you" — the user wanted the WHOLE asset moved (not a text swap); the rail itself was relocated below Categories.

## Latest Iteration (Feb 2026 — Iter-20) — Consistency + copy + footer cleanup

User-requested polish round:
- **Hero subtitle** scrubbed — "· 45-minute delivery." removed; now reads "Hand-picked fashion from trusted Bhilai stores." (CMS default updated, existing site_config doc reset).
- **Global "boutique" → "store"** rename across `/app/frontend/src/**` and `/app/backend/**` source + the seeded testimonial quote that mentioned "boutique" (DB row updated).
- **Footer trimmed** to brand + tagline + social + contact strip + copyright. Removed the 4-chip trust bar AND the Shop / Company / Help columns as requested.
- **Consistent boundary + spacing** — every section (hero, offers, categories, carousels, stores, customer love) now uses `max-w-7xl mx-auto px-4 sm:px-8 py-8` for uniform horizontal padding and vertical rhythm. Categories grid gets `gap-3 sm:gap-4` to align with carousel gaps.
- Hero card switched from `rounded-[24px] md:rounded-[28px]` to a single `rounded-2xl` to align with all other section cards.

## Latest Iteration (Feb 2026 — Iter-19) — Hero rollback to v1 card style

User-requested rollback of the hero only — restored the previous Bhilai-Globe-Chowk card style hero:
- Single rounded card (`rounded-[24px] md:rounded-[28px]`) on a cream backdrop.
- Cream gradient wash (vertical on mobile, horizontal-from-left on desktop) so the headline sits on a soft fade and the image breathes on the right.
- Eyebrow chip "SERVING BHILAI" with map-pin.
- Headline: "Delivered in minutes from **stores next door.**" (orange second clause).
- Subtitle: "Hand-picked fashion from trusted Bhilai boutiques · 45-minute delivery."
- Floating "Fast delivery in Bhilai · 30 minutes · LIVE" pill (desktop on right, mobile inline under copy).
- **No Shop Men / Shop Women CTAs, no metric strip, no USP chips** — per the user's screenshot.
- CMS overrides preserved — admin can still edit eyebrow / title lines / subtitle / image URL from `/admin → Site CMS`.
- Backend `DEFAULT_HERO` updated to match; existing `site_config` doc was reset to pick up the new defaults.
- Body bg of Home reverted to `#FDFBF7` so the cream card sits on the right surface.

## Latest Iteration (Feb 2026 — Iter-18) — Homepage fixes + Site CMS

### Homepage user-feedback fixes
- **Hero image restored** to the previous Bhilai Globe Chowk ChatGPT image (not the gold Unsplash boutique that crept in).
- **Desktop responsive** — `max-w-7xl mx-auto` container, `lg:` breakpoints across hero / carousels / categories grid. Hero scales to text-6xl on desktop, metric strip widens to `max-w-3xl` centered, USP chips space out properly.
- **Spacing fixed** on `Shop Women / Shop Men` CTAs (`gap-3 sm:gap-4`) and metric strip (`gap-4 sm:gap-8`).
- **Removed**: Why Lokl, How Lokl Works, Trending, New Arrivals, Best Sellers (per user spec).
- **Carousels no longer hug the left edge** — `px-4 sm:px-8` + `max-w-7xl mx-auto` on Popular, Selling Fast, Customer Love, Offers strip.
- **Hero CTAs** route correctly: Shop Women → `/c/women`, Shop Men → `/c/men`.
- **Add to cart on every home product card** — ProductCardV2 now has an inline orange "Add" button → switches to a `+ / qty / −` stepper after first add. Updates the global cart via CartContext.
- **Footer rebuilt** — 4-column structure (Brand / Shop / Company / Help) + trust strip at top (delivery, returns, secure, verified) + contact strip + copyright.
- **"See all" links fixed** — Popular / Selling Fast now point to `/products?sort=trending`.
- **Removed** the offer-strip and feed carousel "always-render" behaviour — they hide when data empty.

### PDP fixes (compact + bug squash)
- Image placeholder shown when product has no image (was previously a 0-height div).
- Fallback values for `store_eta_min` (45) and `store_distance_km` (1.5) — fixes the "min, km" with-no-numbers bug from the user's screenshot.
- Smaller H1 (`text-2xl md:text-3xl`), tighter button heights, `whitespace-nowrap` on Add to bag / Buy now to kill the text-wrap.
- New tokens applied (#0A1F5C navy / #F59E0B orange / white background).

### Site CMS (new — "developer dashboard")
- New `site_config` collection (singleton doc id=`homepage`) — backfilled with defaults so admins start with a working homepage out of the box.
- Public endpoint `GET /api/site/homepage-config` — homepage reads section order + on/off + hero overrides at load time.
- Admin endpoints `GET/PUT /api/admin/site/homepage-config` — controls section visibility, ordering (numeric rank), and full hero override (image URL, eyebrow, title lines, subtitle, both CTA labels + links, show_stats, show_usp_chips).
- **New `/admin` → Site CMS tab** with toggle + rank-edit per section, hero text/image editor, and live save.
- Home.jsx now respects the CMS — `orderedIds.map(...)` renders sections in admin-controlled order; disabled sections are skipped.

## Latest Iteration (Feb 2026 — Iter-17) — Lokl V2 Marketplace UI (Phase 1 + 2)

### Phase 1 — Dynamic data engine (backend)
- **Badge engine** (`/app/backend/feeds.py`): one primary badge per product (never stacked) chosen from {best_seller / selling_fast / top_rated / trending / best_deal / new_arrival / low_stock} with deterministic priority ordering. Derived from real orders + product_views — no hardcoded values.
- **Social-proof** + `low_stock_size` derived per product (e.g. "Only 2 left in size M", "12 purchased this week").
- New endpoints: `/api/stats/home`, `/api/feed/{popular-in-city, selling-fast, best-sellers, new-arrivals, trending}`, `/api/offers`, `/api/testimonials`, `/api/categories/counts`, `/api/search/trending`, `/api/search/track`, `/api/track/view`, `/api/me/recently-viewed` (GET+POST).
- Admin CRUD for offers + testimonials. Seeded 4 starter offers + 4 testimonials so the homepage doesn't show empties on day one.

### Phase 2 — Homepage rebuild (mobile-first, ~9/10 conversion-focused)
- **New design tokens** (#0A1F5C navy, #F59E0B orange, white surfaces) bridged from the existing palette via the design_agent blueprint at `/app/design_guidelines.json`.
- **15 sections** in spec order: HeroV2 (with floating metric strip + 3 USP chips) → Why Lokl → Offers carousel → Categories with counts → Popular in Bhilai → Selling Fast → Stores Near You → Trending → New Arrivals → Best Sellers → Recently Viewed (logged-in only) → Customer Love → How Lokl Works → Sticky Bottom Nav → Sticky Cart pill.
- New V2 components in `/app/frontend/src/components/consumer/v2/`: HeroV2, ProductCardV2 (80/20 image-content with single badge + wishlist micro-anim), StoreCardV2, OffersStrip, HCarousel, WhyLokl + HowLoklWorks, CustomerLove, ProductBadge, StickyBottomNav, StickyCart.
- Sticky bottom nav (Home/Categories/Search/Orders/Profile) — safe-area aware, hidden on merchant/admin routes.
- Sticky cart pill appears after first add, persistent across browsing.

### Test coverage
- New `/app/backend/tests/test_v2_homepage_feeds.py` (7 tests).
- iter-12 testing agent: **backend 100% (24/24)**, **frontend ~95%** — 2 trivial fixes applied (React duplicate-key in StickyBottomNav, ProductCardV2 image-area to 70%+).

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
