# Bharat Fashion OS — Product Requirements (PRD)

## Vision
"The future operating system for hyperlocal fashion commerce in Bharat." Premium AI-powered marketplace combining Myntra discovery + Nykaa visuals + Blinkit hyperlocal + Instagram boutiques + Shopify merchant tooling — pilot launch in **Bhilai & Raipur (Chhattisgarh)**.

## Personas
- **Consumer** (Tier-2/3 Gen-Z + millennial): hyperlocal fashion + fast delivery
- **Merchant** (offline fashion store): AI-powered storefront in minutes; KYC → approval → publish
- **Ops/Admin**: manual KYC review/approval inside `/admin` console
- **Rider** (Phase 2): deferred

## Pilot Cities
**Bhilai** (3 boutiques) and **Raipur** (3 boutiques) only. Geo-detection: browser GPS → IP fallback (ipapi.co). Other cities show friendly "we're not live here yet" banner.

## Tech Stack
- Frontend: React 19 + Tailwind + Sonner + Lucide. Fonts: Clash Display + Satoshi (Fontshare).
- Backend: FastAPI + Motor (MongoDB). JWT auth (PyJWT + bcrypt).
- AI: Emergent Universal LLM Key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images & try-on).

## What's Implemented

### Consumer Marketplace
- Compact city-customised hero (image + tagline + dynamic "fastest store ETA" pill)
- Shop by Category (8) → Stores in your neighborhood (filtered by city) → Trending nearby → thin merchant strip → footer
- Store detail (Instagram-boutique feel), PLP, PDP with sizes/AI badge, cart, mock checkout (UPI/Card/COD), order tracking timeline
- Geo-detect endpoint (`/api/geo/detect`) with GPS + IP fallback

### Merchant SaaS (Complete Onboarding Flow)
1. **Signup** (`/merchant/register`) → lands on `/merchant/onboarding`
2. **KYC wizard** (`/merchant/kyc`) — 3 steps:
   - Business: PAN, GST, registered name, category, type, address, PAN/GST doc uploads (base64)
   - Bank: account holder, account #, IFSC, cancelled cheque upload
   - Review & submit
3. **Pending state**: status card + in-app notification feed (mocked email/WhatsApp — toasted on screen)
4. **Admin Console** (`/admin/login`, hardcoded `admin@bharat-os.com / Admin@2026`): Pending/Approved/Rejected tabs, view full merchant docs, **Approve** or **Reject with reason** — fires notification to merchant
5. **Storefront setup** (`/merchant/storefront`) — tagline, story, locality, timing, specialties, banner picker
6. **Products** (`/merchant/products`):
   - Add single product
   - **CSV bulk upload** (`name, description, category, mrp, price, sizes, stock_per_size`) + sample CSV download
   - Per-product image manager with **AI Model Try-On** (Gemini Nano Banana — strict prompt: "do not change design/colour/pattern, only show worn by model")
7. **Go Live** — requires storefront + ≥1 product. Sets `published=true`, returns 1-hour propagation ETA, pushes "going live" notification.
8. **Sales Analytics** (`/merchant/analytics`) — periods Yesterday/7d/30d/Quarter, revenue/orders/AOV/repeat KPIs, bar chart, top products, **CSV report download**. Demo data shown until real orders flow in.

### AI Catalog Studio (`/merchant/ai-studio`)
- Gemini Nano Banana raw-photo enhancement
- Claude Sonnet 4.5 product copy (title, description, tags, highlights, SEO meta, campaign hook)

### Visibility Rule
Stores are publicly visible iff `seeded=true` OR (`kyc_status='approved'` AND `published=true` AND `product_count ≥ 1`).

## Test Credentials
- Demo merchant (auto-approved on startup): `demo@bharat-os.com / Demo@123`
- Admin: `admin@bharat-os.com / Admin@2026`

## Status
✅ All features tested. Backend: 25/25 pytest passing. Frontend: full onboarding flow + admin approve/reject + storefront + bulk + analytics verified by testing agent.

## Backlog
### P0
- Real email/WhatsApp via Resend/Twilio for approval notifications
- Object storage (Cloudinary) for KYC docs instead of base64 in Mongo (current is fine for pilot scale)
### P1
- Real geo-IP via paid service for higher accuracy
- Rider operational app (pickup/navigation/OTP)
- Razorpay live integration
- Store-side merchant chat with consumer
### P2
- Live rider tracking
- Influencer partnerships
- WhatsApp campaign builder
- Multi-warehouse stock per merchant
