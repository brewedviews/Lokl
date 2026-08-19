# Lokl Redesign Plan — v3
### Incorporating the Quickee benchmark analysis (16 reference screenshots), the color system pivot, and corrections learned during Phase 2 (Bag/Checkout merge)

---

## 0. The pivot this document makes explicit

Earlier design work on Lokl established **orange as a repeating decorative signature** — intended as a hand-drawn underline beneath every section header, a diagonal ribbon tag on every product card. A later codebase audit confirmed **neither pattern was ever actually built** — so there's no cleanup work here, just a forward-looking rule.

The Quickee benchmark uses its accent color narrowly and functionally: the primary CTA, a selected-state border, the savings number, one background glow. Everywhere else — heroes, brand campaigns, mood tiles — carries its own color story, unrelated to the brand accent.

**This document keeps that direction: orange is a narrow, functional color, not a decorative motif.**

---

## 1. Business fundamentals — held constant, not touched by this redesign

- Merchant subscription model (flat fee, no commission)
- Hyperlocal Bhilai identity — real local stores, not warehouse fulfillment
- Try & Buy as a first-class feature (note: true trial-before-payment is a separate, larger scoping conversation — see Section 6)
- Lowercase bold typographic voice — a genuine Lokl signature, not touched by the color pivot
- Existing type family (Archivo Black / Clash Display / DM Sans)

---

## 2. Color system

### 2.1 What orange is FOR (functional only)
- Primary CTA button fill (Add to Bag, Pay, Shop Now)
- Selected-state border/fill (chosen size, chosen delivery option, active filter, active payment method)
- Savings/discount emphasis (the number itself, not a badge wrapper)
- The wordmark dot — brand mark only, one place, never repeated as a motif

### 2.2 What orange is NOT for
- Decorative underlines beneath section headers — use plain bold headers + whitespace instead
- A repeating "signature" ribbon/badge on every product card regardless of what it communicates
- Default fill for every badge/tag without asking what it's functionally signaling

### 2.3 Neutrals do the structural heavy lifting
Cream/white background, near-black text and primary UI, gray for secondary text and borders — unchanged foundation. Stop reaching for orange as the default answer to "this needs a color."

### 2.4 Discount/status badges — reassign by function
| Signal | Color |
|---|---|
| Discount % / savings | Moss green (existing tokens: `moss-green` / `moss-green-tint`) |
| Try & Buy / status tags | Small black tag, not a full-width ribbon |
| Selected state (size, filter, delivery option, payment method) | Orange border/fill |
| Primary CTA | Orange fill |

**Token consolidation:** `#E68910` = the single functional orange (primary). `#F3C887` = its light tint, for background washes behind badges/selected chips. `#F59E0B` (`brand-accent-alt`) is deprecated as redundant — sweep any remaining usages to one of the two above.

### 2.5 Campaign/editorial content gets its own color freedom
Heroes and promo banners are not required to incorporate orange at all. The one constant across any banner: the CTA button *within* it stays the one consistent orange button component (3.2), so it's always recognizable as "the tappable thing" regardless of surrounding color.

---

## 3. Component rules

### 3.1 Scrim-label tile — one component, two variants
- **Generous variant** (Home category tiles, mood tiles, search category browsing): portrait photo, bottom gradient scrim, white text baked into the image.
- **Dense variant** (Categories page grid): plain white label below the image, no scrim.
- Build once with a `density` prop, not as two separate components.
- **Status as of Phase 2: not yet built.** Category tiles are still duplicated 3× in the codebase (`CategoryTileRow.tsx`, `CategoryClient.tsx`, `HomeClient.tsx`'s `GenderBentoSection`) — this is Phase 3's first real consolidation target.

### 3.2 One CTA button, no exceptions
Solid orange fill (`#E68910`), tag/label proportions — not full-width, not a rounded pill.
- **Status as of Phase 2: partially built.** `Button.tsx` exists as a shared component but defaulted to `rounded-full` with zero usages anywhere in the app. Phase 2 added a `cta` variant (rounded-lg, solid orange) and used it for the first time on the merged checkout screen. **Phase 3 should migrate every other primary-action button in the app to this same `cta` variant**, retiring ad hoc button styling wherever it's found.

### 3.3 Mixed-weight headlines as a system rule
Every major headline mixes exactly one contrasting type treatment. Not yet applied anywhere — a Phase 3+ content/copy task, not a component build.

### 3.4 Trust icon row
**Correction from the original plan:** the original assumption was "one shared 3-icon component already used on PDP and Bag." Reality, confirmed in Phase 2: `TrustSignalsCompact.tsx` is real, but it's a **4-item vertical list** (secure payments, 24h returns, verified seller, made in Bhilai), not 3 icons, and it carries a deliberate "never fabricate a claim" discipline in its copy. Phase 2 correctly reused it verbatim on the merged checkout screen rather than inventing a 3-item version to match this doc. **Standing rule: 4 items, as currently built, reused verbatim everywhere trust signals are needed — do not shrink to 3 without a real product reason.**

### 3.5 Emoji/decorative marks — one designated moment app-wide
Reserved exclusively for the savings-celebration line in the bill breakdown (e.g. "You're saving ₹X (Y%) ✨"). **Status: built and verified** on the merged checkout screen, confirmed unused anywhere else in the app.

### 3.6 Wishlist scope
**Correction from the original plan:** the original assumption was "wishlist is PDP-only, remove from all cards." Reality, confirmed in Phase 2: hearts are used broadly via `ProductCard`, including on rails inside checkout itself. Phase 2 added a `showWishlist={false}` opt-out prop to `ProductCard` and used it only on checkout's impulse rail — every other surface still shows the heart. **This is a real open decision, not yet resolved app-wide: does "PDP-only" become the actual target state (a larger Phase 3+ sweep across every rail/grid in the app), or was that original assumption wrong and hearts-everywhere is fine?** Needs an explicit call before Phase 3 touches ProductCard broadly.

### 3.7 ETA header
**Correction from the original plan:** the original assumption was "a shared component already used on Home and PDP." Reality, confirmed in Phase 2: no such component existed — Home's ETA is inline markup inside `HeroV2.tsx`; PDP's `DeliveryServiceability.tsx` renders nothing in the common happy-path case. Phase 2 built `ETAHeaderCard.tsx` as a new, generic, reusable component, used so far only on the merged checkout screen. **Phase 3 should retrofit Home and PDP to use this same component**, retiring the inline/dormant versions — this is real, scoped work, not a quick copy-paste.

### 3.8 Tab styling is context-dependent
Home's L1 tabs (secondary to the hero below) can stay as-is or move toward a quieter text+underline treatment; the dedicated Categories page can keep a more prominent filled-tab treatment since it IS the primary content there. Intentional divergence, not inconsistency — no change needed unless revisited deliberately.

### 3.9 Decorative borders — reserved for exactly one purpose
Reserve a stamp/postage-border treatment exclusively for a future "new boutiques on Lokl" spotlight — never used generically on regular product or category cards. Not yet built; low priority.

---

## 4. Locked decisions (recap)

1. **Brand ≠ Store** — separate entities, still pending (Phase 1, not yet started).
2. **No rating system this phase** — stripped from all card specs until a real reviews system exists.
3. **Bag/Checkout merge** — done (Phase 2), including real Razorpay payment wiring, pickup/delivery selector, delivery-fee total-consistency fix, and a soft guest-checkout gate.

---

## 5. Known outstanding items from Phase 2 (small, unresolved)

- Cosmetic: `ConsumerLayout`'s bottom-nav-safe padding still reserves space on `/checkout` even though the bottom nav is hidden there — small extra whitespace below the sticky CTA bar. Cheap fix, fold into Phase 3's first pass.
- Rider order-detail page has a "cash collected" checkbox but never displays the amount to collect — pre-existing gap, unrelated to this redesign, worth its own small fix separately.

---

## 6. Open decision, still unresolved

**"Shop the Look" flat-lay device** (background-removed product photography, knolled into a single composed image) requires either committing to ongoing photo-editing production, or being explicitly scoped out. Needs a call before any phase assumes it exists.

**True "pay only for what you keep" Try & Buy** (as opposed to the pickup/delivery fulfillment toggle already built) — needs its own dedicated scoping conversation on payment timing (authorize-and-capture-later vs. deposit vs. COD-only for this mode) before any code gets written.

---

## 7. Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0 — Discovery** | Full audit of cart/checkout, schema, components, search, PDP, tokens | Done |
| **2 — Bag/Checkout merge + payment** | Real Razorpay, pickup/delivery selector, delivery-fee fix, guest gate, single-screen merge | Done |
| **1 — Foundational data** | New `Brand` entity, `brand_id` on products, merchant-facing brand field, mood/occasion tags | Not started |
| **3 — Component library** | Consolidate category tile (3.1), roll out `Button.tsx` cta variant everywhere (3.2), retrofit ETA header to Home/PDP (3.7), resolve wishlist scope (3.6), fix bottom-nav padding gap (Section 5) | Not started |
| **4 — New pages** | Store page, Brand page, Mood/Occasion landing pages | Depends on 1, 3 |
| **5 — Search redesign** | Trending searches, visual category browsing, results spanning products + stores + brands | Depends on 1, 3 |
| **6 — Homepage hyperlocal rails** | "Around You," "Popular in [City]," "Just Landed Nearby" | Depends on 3, 4 |
| **7 — Full visual identity pass** | Consistency audit against Sections 2-3; resolve Section 6 open items | All prior |

---

## 8. Immediate next step

Phase 3 (component library) is next. Before writing that build prompt: resolve the wishlist-scope question (3.6) explicitly, since it determines whether Phase 3's `ProductCard` work is a small opt-out prop rollout or a full app-wide sweep.
