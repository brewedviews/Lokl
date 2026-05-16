# Bharat Fashion OS — PRD

## Vision
Premium AI-powered hyperlocal fashion commerce OS for Bharat. Pilot in **Bhilai & Raipur (Chhattisgarh)**.

## Stack
React + FastAPI + MongoDB. Emergent LLM key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images & try-on with strict-preservation prompt).

## Latest Iteration (Feb 2026)

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
- **Products**: cascading L1 → L2/gender selector enforced; CSV bulk import (`name,description,l1,l2,gender,mrp,price,sizes,stock_per_size`); per-product image manager with **AI Try-On** (strict prompt: don't alter design)
- **AI Catalog Studio** (`/merchant/ai-studio`): strict-preservation enhance + Claude copy generation. Failed AI calls now show clear error (no misleading fallback image)
- **Order Requests** page: pending order cards with Accept/Reject + Web Audio beep + Notification API on new orders (polls every 8s)
- **Sales Analytics** with periods + CSV report download; demo data shown until real orders flow

### Admin Console (`/admin/login`: admin@bharat-os.com / Admin@2026)
- **Approvals tab** with sub-tabs KYC + Bank/Address changes, period dropdown (yesterday/7d/30d/quarter), **CSV/Excel export** of approvals history. Modal shows all uploaded docs (PAN/GST/cheque/change docs) for review.
- **Stores tab**: every onboarded store + drill-down products. Pause/Unpause/Delete per product. Pause/Unpause store. **Delete store** → 6-digit OTP "emailed" to admin@bharat-os.com (mocked → shown in modal). Cascade-deletes products on confirmation.

## Test Credentials
- Demo merchant (auto-approved on startup): `demo@bharat-os.com` / `Demo@123`
- Admin: `admin@bharat-os.com` / `Admin@2026`

## Mocked (pilot scope)
- Approval notifications: in-app only (no real email/WhatsApp/SMS)
- Delete-store OTP: shown in modal + logged (no real email)
- KYC docs stored as base64 in Mongo (no object storage yet)
- Sales analytics: demo trend for new merchants
- "1-hour propagation" on publish flips immediately

## Backlog
- P0: Real email/WhatsApp via Resend/Twilio · Cloudinary for docs
- P1: Real-time order push via WebSocket · Razorpay live · Rider app
- P2: Live rider tracking · Influencer partnerships · WA campaigns

## Status
✅ Backend 18/18 pytest passing · all frontend flows verified by testing agent (iteration_3.json)
