# Lokl — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS branded **Lokl**. **Pilot locked to Bhilai (Chhattisgarh)**.

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
