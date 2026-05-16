# Lokl — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS branded **Lokl**. **Pilot locked to Bhilai (Chhattisgarh)**.

## Latest Iteration (Feb 2026 — Iter-8)

### Demo Data — 10 Stores + 55 Products
- New script `/app/backend/demo_seed.py` (idempotent: wipes & re-seeds only its own docs identified by email `*@lokl.demo` and id prefix `mer-demo-*`)
- **10 Bhilai stores** across real localities: Sector 1/6/10, Civic Centre, Smriti Nagar, Nehru Nagar, Supela, Power House, Junwani, Kohka
  - Anjali Boutique (women ethnic), Menscape (men formal/casual), Step & Sole (footwear), Street Bazaar (streetwear), Little Stars (kids), Shringaar Accessories, Glow & Co. (beauty), TechWorld Bhilai (electronics), HomePlus Appliances, Playfield Sports
- **55 products** covering every L1 with at least 5 each (women 7 · men 6 · footwear 7 · streetwear 5 · kids 5 · accessories 5 · beauty 5 · electronics 11 · sports 6)
- Each store has KYC approved, storefront published, real lat/lng around Bhilai, ratings 4.2–4.9, ETA 30–50 mins
- Demo merchant credentials: `<slug>@lokl.demo` / `Demo@2026` (e.g. `menscape@lokl.demo`)

### Brand: Star Icon Removed, Logo Larger
- Removed the round-blue-Sparkles icon from ConsumerHeader, MerchantLayout sidebar, MerchantAuth (left panel + mobile), Footer
- "lokl." wordmark is now larger (text-2xl mobile / text-3xl desktop) and always visible — including on mobile (was `hidden sm:inline`)

### Mobile Polish — Header
- City pill `Bhilai` hidden on mobile (replaced by hero badge)
- New compact **mobile search input** (`data-testid=search-input-mobile`) sits between logo and account/cart icons
- All header elements use `shrink-0` to prevent collapse

### Admin Panel — Live + Delivered Tabs
- New `GET /api/admin/orders?status=live|delivered|rejected|all` enriches orders with store names
- AdminPanel tab list expanded: **Approvals · Stores · Live orders · Delivered**
- OrdersTab component (auto-refresh every 12s) renders cards with order id, total, customer, store name(s), payment method, lifecycle-colored status badge
- Empty-state copy per kind

## Latest Iteration (Feb 2026 — Iter-7) — REBRAND TO LOKL
- Frontend logo wordmark `bharat.` → `lokl.` (Consumer header, Footer, Merchant layout, MerchantAuth left panel + form)
- Page `<title>` → "Lokl · Fashion delivered in minutes"
- Home: "Sell on Bharat." → "Sell on Lokl."
- Merchant Onboarding welcome → "Welcome to Lokl"
- Order push notification copy → "New order on Lokl"
- Backend API root response `{app: "Lokl", status: "ok"}`, FastAPI title, logger name (`lokl`, `lokl.notify`)
- WhatsApp templates updated to use "Lokl" instead of "Bharat"; tracking URL → `lokl.in/orders/{id}`
- AI copy system prompt: "Lokl-first product copy"
- Admin email migrated `admin@bharat-os.com` → `admin@lokl.in` (server.py constants + UI default)
- CSV export filenames → `lokl-sales-{period}.csv`, `lokl-products-sample.csv`
- Demo merchant notification body → "Welcome to Lokl!"
- **Kept intentionally**: "Hyperlocal fashion for Bharat" + "Trusted by 2,400+ stores across Bharat" (Bharat = country, not brand)

## Stack
React + FastAPI + MongoDB. Emergent LLM key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images & try-on with strict-preservation prompt). **AI try-on UI currently hidden** pending prompt overhaul.

## Latest Iteration (Feb 2026 — Iter-6)

### New L1 Categories
- **Electronics** (12 L2): Mobiles & Tablets · Laptops · Audio · Wearables · Cameras · TV · Large/Kitchen/Small/Personal-Care Appliances · Mobile-Computer Accessories · Gaming
- **Sports** (10 L2): Fitness · Yoga · Cricket · Football · Badminton & Tennis · Cycling · Running · Outdoor · Swimming · Sports Nutrition
- Total: **9 L1 + 40 L2** categories

### UI Polish
- Hero: full-bleed Bhilai Globe Chowk landmark stretched to fill entire curved tile
- Empty-state copy: "Building it — coming soon" badge + reassuring message
- **Admin link removed** from `/merchant/login` page — admin console (`/admin/login`) is now a private URL only known to ops
- Accessories tile: working Unsplash photo

### Twilio WhatsApp Integration ✅ LIVE
- New `notifications.py` module with helpers: `notify_order_placed`, `notify_merchant_new_order`, `notify_order_accepted`, `notify_order_rejected`, `notify_order_delivered`
- Wired into `POST /api/orders` (notifies customer + merchant), `POST /merchant/orders/{oid}/accept`, `/reject`, `/delivered`
- New endpoint **`POST /merchant/orders/{oid}/delivered`** + UI "Mark delivered" button on accepted orders
- Phone normalization: accepts 10-digit or +91-prefixed numbers, converts to `whatsapp:+91XXXXXXXXXX`
- Fire-and-forget: if Twilio is down or recipient hasn't joined sandbox, order flow is unaffected (logged warning, no error)
- **Tested**: Order BFO-18108C2D placed → both customer + merchant WhatsApp messages accepted by Twilio (SID returned)

### Twilio Sandbox Notice
- Phone numbers must first send `join <sandbox-code>` to `+1 415 523 8886` to receive messages
- Sandbox code visible in Twilio Console → Messaging → Try it out → Send a WhatsApp message

## Latest Iteration (Feb 2026 — Iter-5)

### Hero Banner Redesign (Bhilai Globe Chowk)
- Full-bleed photo of **Bhilai Globe Chowk** landmark fills the entire rounded hero
- `object-cover object-[70%_40%]` on mobile + `md:object-[55%_35%]` on desktop keeps the globe focal point centered across breakpoints
- Light cream wash for text legibility (top-to-bottom on mobile, left-to-right on desktop)
- SERVING BHILAI badge + headline + description + 4 feature pills (Trusted Stores · Lightning Fast · Try at Your Doorstep · Easy Returns) overlaid on left
- Floating ETA card (Fast delivery / 45 minutes / LIVE) center-right on desktop, in-flow on mobile
- Shop Now button removed (user request)

### Merchant Loud Order Ping (P1 ✓)
- Replaced the inline-wav single beep with a **Web Audio API two-tone bell loop** (3 pulses spaced 0.8s apart, gain 0.7 — significantly louder than the prior beep)
- Persistent **mute toggle** in the header (`data-testid=toggle-ping-mute`, persisted via localStorage `bf_orders_muted`)
- **Test sound** button so merchants can preview/unlock browser audio permission
- Initial-load suppression: ping no longer blasts on tab-open with stale backlog — only fires when a genuinely new order arrives after the page is open
- Browser Notification fires alongside ping; in-app toast lasts 6s

## Latest Iteration (Feb 2026 — Iter-4)

### Bhilai-only Locked Pilot
- Hero badge shortened to **SERVING BHILAI** (pilot "coming soon to your city" copy removed from hero)
- Backend `POST /api/orders` strictly rejects non-Bhilai addresses (HTTP 400)
- Frontend Checkout guards with toast before API call
- Away-banner softened: "Bharat currently serves Bhilai. We'll let you know when we're in {city}." Falls back to "your area" when geo detection returns Unknown.

### Merchant Add Product — Reworked
- **File upload** (FileReader → base64 data URL) instead of URL text input
- **Size + Quantity grid**: apparel uses XS/S/M/L/XL/XXL, footwear uses 6–11. Each cell collects a per-size quantity → sent to backend as `stock: {S: 5, M: 3, …}` dict
- Image preview thumbnail inline in modal; 5MB client-side limit

### Consumer header / Home
- Account became an **icon-only button** (User icon, no "Account" text)
- Single hero badge: **SERVING BHILAI**
- L2 category page: no "All" option (Women/Men show 9 L2 tiles only)

### AI Try-On Hidden
- ImageManager modal no longer renders AI try-on panel — only plain upload + save
- AI backend endpoints (`/api/merchant/ai/tryon`, `/enhance-image`, `/copy`) still exist but UI-decoupled

## Test Credentials
- Admin: `admin@bharat-os.com` / `Admin@2026` (pre-seeded constant)
- Demo merchant `demo@bharat-os.com` was wiped — startup only re-approves if doc exists. See `/app/memory/test_credentials.md`.

## Latest Iteration (Pre-Iter-4)

### Consumer Marketplace
- Compact city-customised hero, auto geo-detect (no manual selector) — pill is read-only with ↻ re-detect
- **L1 categories (fixed 7)**: Women, Men, Footwear, Streetwear, Kids, Accessories, Beauty
- **L2 sub-categories** for Women (9) and Men (9). Other L1s use gender filter (women/men/unisex/kids)
- `/c/:slug` Category page: shows L2 tile grid for Women/Men OR gender chips for others, then filtered listings
- Products require `l1_id` + (`l2_id` for W/M, `gender` for others) — enforced server-side
- Stores+products visible iff `kyc_status=approved AND published=true AND paused=false AND product_count ≥ 1`
- Empty states everywhere when no live merchants in the city
- `/account` — phone-based customer profile (name, age, email, address) + past orders by phone
- Checkout captures customer into profile silently
- **Slim footer** + mobile hides brand text (logo only)

### Merchant SaaS
- After register → `/merchant/onboarding` → 3-step KYC wizard (Business → Bank → Review)
- **Sidebar reshapes after approval**: Order Requests · Products · AI Studio · Sales Analytics · Storefront · Bank (Onboarding+KYC hidden)
- **Storefront**: tagline/story/banner/specialties editable. **Store name & business address LOCKED** — changes require a `change-request` → admin approval
- **Bank tab**: any update needs a new cancelled-cheque upload → `change-request` → admin verifies
- **Products**: cascading L1 → L2/gender selector enforced; CSV bulk import (`name,description,l1,l2,gender,mrp,price,sizes,stock_per_size`); per-product image manager
- **Order Requests** page: pending order cards with Accept/Reject + Web Audio beep + Notification API on new orders (polls every 8s)
- **Sales Analytics** with periods + CSV report download; demo data shown until real orders flow

### Admin Console
- **Approvals tab** with sub-tabs KYC + Bank/Address changes, period dropdown, **CSV/Excel export** of approvals history. Modal shows all uploaded docs for review.
- **Stores tab**: every onboarded store + drill-down products. Pause/Unpause/Delete per product. Pause/Unpause store. **Delete store** → 6-digit OTP (mocked email — shown in modal).

## Mocked (pilot scope)
- Approval notifications: in-app only (no real email/WhatsApp/SMS)
- Delete-store OTP: shown in modal + logged (no real email)
- KYC docs + product images stored as base64 in Mongo (no object storage yet — Cloudinary backlog)
- Sales analytics: demo trend for new merchants
- "1-hour propagation" on publish flips immediately

## Backlog
- **P1**: Merchant order "loud ping" audio (Future Task 1 from handoff)
- **P1**: Admin approvals Excel download (.xlsx) on top of CSV
- **P2**: Merchant sales report Excel download
- **P2**: Fix + re-enable AI try-on (Gemini prompt overhaul to preserve original garment)
- **P2**: Cloudinary/object storage for product & KYC images (base64 in Mongo will bloat as catalog grows)
- **P2**: Real email/WhatsApp via Resend/Twilio
- **P2**: Split server.py (820 lines) into routers (auth, merchant, admin, catalog, customer, geo)
- **P3**: Real-time order push via WebSocket · Razorpay live · Rider app
- P2: Live rider tracking · Influencer partnerships · WA campaigns

## Status
✅ Backend 18/18 pytest passing · all frontend flows verified by testing agent (iteration_3.json)
