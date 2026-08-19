# VasyERP Inventory Integration — Plan

## 0. What VasyERP's API actually provides (confirmed from docs.vasyerp.com)

- **Auth**: static `api-token` per merchant account, no OAuth — merchant generates it in their own VasyERP dashboard and provides it to Lokl.
- **Multi-branch**: inventory calls require `branchId`. A merchant may have 1+ branches; Lokl needs to know which branch maps to their Lokl store.
- **Products**: `GET /api/v1/products` (paginated) — name, item code, MRP, selling price, discount, HSN code, brand (free text), category (free text), department, measurement unit. **No image field.**
- **Inventory**: `GET /api/v1/product/products-inventory` — same fields + `qty`, branch-scoped, supports `fromDate`/`toDate` for incremental sync (built for polling, not just one-time pull).
- **Variants**: `GET /api/v1/product/{id}` returns `productVariantDetails[]` — free-text `variantName` (e.g. `"32GB Green"`), own price/stock per variant. Not a structured size field.
- **Order push**: `Order Create`, `Update Order Status`, `Shipping Details` endpoints exist — two-way sync is technically supported by the API, not just pull.
- **Rate limits**: documented 429 responses — backoff/retry required.

## 1. Locked decisions

1. **Image gap**: imported products land as **drafts (unpublished)** until a merchant adds photos manually — **applies only when the source provider doesn't supply a real image (e.g. VasyERP). When a source provides a real photo (Zoho, Shopify), the import skips the mandatory photo-upload gate and becomes publish-eligible immediately after category confirmation.**
2. **Sync direction**: **one-way import first (Phase A/B), two-way later (Phase C)** — push Lokl sales back to decrement source-system stock, preventing overselling across channels, once one-way is proven stable.
3. **Category/Brand mapping**: **auto-match by name where possible**, reusing the existing bulk-upload name-match pattern (lowercased comparison against Lokl's L1/L2/Brand names). Unmatched items are flagged for manual merchant review, never silently dropped or auto-created (brand stays a closed, admin-curated vocabulary per the earlier locked decision — an unmatched source brand name does NOT auto-create a new Lokl Brand).
4. **Multi-provider architecture**: `MerchantIntegration`, `IntegrationMapping`, and `StagedImport` are all provider-agnostic (built with a `provider` field from the start). Each new integration (VasyERP, Shopify, Zoho) only needs its own client adapter + connect-flow UI — the staging/review/publish pipeline is shared, not rebuilt per provider.

## 2. New data models needed

- **`MerchantIntegration`**: `merchant_id`, `provider` ("vasyerp"), `api_token` (encrypted at rest — see Section 4), `branch_id`, `connected_at`, `last_synced_at`, `sync_status`.
- **`IntegrationMapping`**: per-merchant, persisted once and reused across all future syncs — `merchant_id`, `provider`, `source_value` (VasyERP's category/brand text), `mapped_type` ("l1" | "l2" | "brand"), `mapped_id` (Lokl's category/brand id), `unmatched` (bool, for the review queue).
- **`StagedImport`**: one row per VasyERP product pulled in, before it becomes a real Lokl `Product` — holds raw VasyERP data + resolved mapping + status (`pending_review`, `pending_photos`, `published`, `skipped`).

## 3. Import flow (Phase A)

1. Merchant connects: enters their VasyERP `api-token`, Lokl calls `GET /api/v1/branch` to list branches, merchant picks the one that's their Lokl store.
2. Lokl pulls `GET /api/v1/product/products-inventory` (paginated) for that branch.
3. For each product: resolve category/brand via `IntegrationMapping` (auto-match by name on first sync, reuse mapping on subsequent syncs). Unmatched → flagged, product still staged but held for review.
4. All pulled products land in `StagedImport` as drafts — never auto-published.
5. Merchant reviews a staging dashboard: confirms/corrects unmatched category-brand mappings, uploads at least one photo per product, then publishes individually or in bulk.
6. Once published, a `StagedImport` row becomes a real Lokl `Product` with `brand_id`/`l1_id`/`l2_id` set, `store_id` = the merchant's store, stock populated from VasyERP's `qty`.

## 4. Security

- `api_token` must be encrypted at rest, not stored as plaintext in Mongo — this is a third-party credential with write-adjacent implications (Phase C will use it to push orders).
- Token never returned to the frontend after initial save — merchant can revoke/reconnect, not view the stored value.
- Standard secret-handling discipline from the Razorpay work applies here too: test the integration against a real (or sandbox, if VasyERP offers one) account before any merchant-facing rollout, never hardcode a token anywhere in committed code.

## 5. Ongoing sync (Phase B)

- Scheduled job (frequency TBD — hourly is a reasonable starting point) polls `products-inventory` with `fromDate` = last successful sync time, `toDate` = now.
- Only updates **already-published** products (price, stock) — never touches items still sitting in `StagedImport` awaiting photos/review, and never re-drafts a published product.
- If a previously-synced product disappears from VasyERP's response (deleted/discontinued on their end), decide explicitly whether to auto-pause it on Lokl or leave it — flag this as an open question for Phase B's build prompt, not assumed now.

## 6. Two-way push (Phase C — later, after A/B are proven stable)

- On Lokl order creation, call VasyERP's order/stock-decrement mechanism so their system reflects the sale.
- Needs its own investigation pass before building: confirm exactly what `Order Create`'s request contract expects (does it require full customer/address data, or just line items + stock decrement?), and whether there's a lighter-weight "just decrement stock" endpoint rather than creating a full mirrored order in VasyERP.
- Real risk surface: a failed or partial push here could cause stock drift between the two systems — needs the same rigor (idempotency, retry, reconciliation) as the Razorpay webhook work.

## 9. Shopify integration (researched, not yet built)

**Auth**: not full OAuth/app-review — a merchant can create a "custom app" directly in their own Shopify admin (Settings → Apps → Develop apps), grant `read_products`/`read_inventory` scopes, and hand Lokl a static Admin API access token. Same paste-a-token simplicity as VasyERP. Header: `X-Shopify-Access-Token`.

**Query style**: GraphQL, not REST. Cursor-based pagination (`first`/`after`), not offset-based.

**Images**: real — `Product.images`/media fields return actual photo URLs. Per the locked decision (Section 1 update below), imports with a real image skip the mandatory photo-upload gate and become publish-eligible right after category confirmation.

**Variants/sizes**: genuinely better than VasyERP. Each `ProductVariant` has structured `selectedOptions: [{name: "Size", value: "M"}, {name: "Color", value: "Red"}]` — clean, named attributes, not a free-text string requiring parsing.

**Category**: `productType` (free-text, merchant-set) — same name-matching approach as VasyERP/bulk-upload applies.

**Rate limiting**: cost-based, not request-count. ~1,000-point bucket, ~50 pts/sec refill (roughly double on Shopify Plus), **1,000-point hard ceiling per single query regardless of bucket size**. For catalogs too large for paginated queries to stay under that ceiling, Shopify's async Bulk Operations API is the documented path — not needed for a first version, flagged as a future upgrade if a merchant's catalog demands it.

**Build sequencing**: build before Zoho (simpler auth, proves the pattern a second time before Zoho's real OAuth work begins).

## 10. Zoho integration (partially researched, auth model confirmed)

**Auth**: real OAuth2 (authorize → redirect → refresh token) — genuinely new infrastructure for Lokl, nothing like this exists in the codebase today (confirmed absent during VasyERP's discovery pass).

**Multi-org**: `organization_id` required on every call — same shape as VasyERP's `branchId`.

**Multi-datacenter**: 8 regional API domains. An Indian merchant is almost certainly on `.in` (`https://www.zohoapis.in/inventory/`) but this needs confirming per merchant, not hardcoded.

**Images**: real — dedicated upload/retrieve/delete/reorder endpoints on the Items API, including a distinct "back image" for a second angle.

**Rate limits**: clean and explicit — 100 req/min always, daily cap scales with the merchant's Zoho plan (1,000/day free → 10,000/day on top tiers), plus a concurrent-call limit (5 on free, 10 on paid).

**Still needed before building**: exact Items endpoint field list (name, SKU, rate, stock_on_hand, category structure — only have the doc's table of contents so far, not the actual field reference), OAuth scope names needed for Items read access, redirect URI registration process.

**Build sequencing**: after Shopify — this is where the new OAuth infrastructure gets built, informed by having already shipped one working integration on the shared pipeline.

**Phase A: built, mock-verified, not live-verified.** Connect flow, branch selection, one-way pull, category/brand auto-match with self-healing mapping corrections, draft staging (pending_review/pending_photos/published/skipped), manual review UI, single + bulk publish — all implemented and tested end-to-end against a faithful local mock server matching VasyERP's confirmed API contract (envelope shape, field names, pagination params all reconciled against the real published docs, not a paraphrase).

**Two known field-mapping bugs, deliberately left unfixed pending live testing** (found during client reconciliation, business-logic fix intentionally out of scope for that pass):
- `_vasyerp_item_to_fields` reads `item.get("id")` — the real field is `productId`. Falls through to `itemCode` today, meaning a merchant-editable SKU stands in for VasyERP's stable product identity. Real risk: if a merchant edits an item code in VasyERP, re-import could lose track of an already-staged/published item and create a duplicate.
- Same function reads `measurementUnit` — the real field is `measurement`. Will silently come back empty against a real account.
Both are one-line fixes, sitting ready — fix before any real merchant connects.

**Not yet possible: live verification.** Requires (1) the real VasyERP API base URL — not published anywhere in their docs, must come directly from a VasyERP account/dashboard or their support team, and (2) a real merchant `api-token`. Until both exist, this is mock-verified only, same category of gap as Razorpay had before real test credentials arrived.

**Phase B (scheduled incremental sync) and Phase C (two-way push-back) not started.**
