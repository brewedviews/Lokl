# Bharat Fashion OS — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS for Bharat. **Pilot locked to Bhilai (Chhattisgarh)**.

## Stack
React + FastAPI + MongoDB. Emergent LLM key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images & try-on with strict-preservation prompt). **AI try-on UI currently hidden** pending prompt overhaul.

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
