# Bharat Fashion OS — Product Requirements (PRD)

## Vision
"The future operating system for hyperlocal fashion commerce in Bharat." A premium AI-powered marketplace combining Myntra discovery + Nykaa visuals + Blinkit hyperlocal + Instagram boutiques + Shopify merchant tooling — designed for Tier-2/Tier-3 India.

## User Personas
- **Consumer** (Tier-2/3 Gen-Z + millennial): discovers nearby boutiques, fast delivery, AI-styled inspiration
- **Merchant** (offline fashion store): launches AI-powered storefront in minutes, manages catalog, runs campaigns
- **Rider** (Phase 2): operational tool for pickup/delivery (deferred)
- **Admin** (Phase 2): platform ops (deferred)

## Tech Stack
- Frontend: React 19 + Tailwind + Sonner + Lucide. Fonts: Clash Display + Satoshi (Fontshare).
- Backend: FastAPI + Motor (MongoDB). JWT auth (PyJWT + bcrypt).
- AI: Emergent Universal LLM Key → Claude Sonnet 4.5 (copy) + Gemini Nano Banana (images).

## Design Tokens
- Background: `#FDFBF7` warm pearl
- Primary: `#1A2B4C` deep indigo
- Accent: `#E68910` marigold
- No purple/violet gradients. No Inter/Roboto.

## What's Implemented (Phase 1 — Feb 2026)
### Consumer Marketplace
- Homepage: hero with delivery widget, 8 categories, 4 nearby stores, AI banner (before/after), trending products
- `/stores` boutique grid, `/store/:id` Instagram-boutique style profile
- `/shop` PLP with category filter + sort (trending/price/rating)
- `/product/:id` PDP with sizes, AI Enhanced badge, similar products
- Cart (localStorage), Checkout (UPI/Card/COD mock), `/orders/:id` tracking with timeline

### Merchant SaaS
- `/merchant/register` & `/merchant/login` (JWT)
- `/merchant/dashboard` KPIs (revenue, orders, repeat rate, conversion) + bar chart + top products
- `/merchant/products` list + create modal
- **`/merchant/ai-studio` (the wow moment)**: Raw photo → Gemini Nano Banana enhances; product name+notes → Claude Sonnet 4.5 generates title/description/tags/highlights/SEO/campaign copy

### Backend APIs (all under `/api`)
Auth: register, login, me · Catalog: categories, stores, stores/:id, products, products/:id · Cart: orders (create + read) · Merchant: dashboard, products (list/create), ai/copy, ai/enhance-image · Admin: seed

### Data
Auto-seeds on startup: 8 categories, 6 boutiques (Jaipur), 12 products.

## Backlog
### P0
- Real merchant→store linkage on registration (currently merchant products use merchant_id as store_id)
- Real-time merchant analytics from `orders` collection (currently mocked KPIs)
- WhatsApp/SMS OTP for consumers
### P1
- Rider operational interface (pickup, navigation, OTP)
- Super Admin dashboard (GMV, city heatmaps, merchant health)
- Razorpay live integration
- Merchant subscription tiers (Basic/Growth/Premium)
- AI catalog: model photos + lifestyle shots + ad creatives via Gemini multi-output
### P2
- Live rider tracking on map
- Influencer collaborations + sponsored listings
- WhatsApp campaign builder
- Try-at-doorstep workflow

## Test Credentials
See `/app/memory/test_credentials.md`. Demo merchant: `demo@bharat-os.com` / `Demo@123`.

## Status
✅ MVP complete & tested. Backend 20/20 pytest passing. All critical consumer + merchant + AI flows verified E2E.
