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

1. **Image gap**: imported products land as **drafts (unpublished)** until a merchant adds at least one real photo. Never published with a placeholder image.
2. **Sync direction**: **one-way import first (Phase A/B), two-way later (Phase C)** — push Lokl sales back to decrement VasyERP stock, preventing overselling across channels, once one-way is proven stable.
3. **Category/Brand mapping**: **auto-match by name where possible**, reusing the existing bulk-upload name-match pattern (lowercased comparison against Lokl's L1/L2/Brand names). Unmatched items are flagged for manual merchant review, never silently dropped or auto-created (brand stays a closed, admin-curated vocabulary per the earlier locked decision — an unmatched VasyERP brand name does NOT auto-create a new Lokl Brand).

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

## 7. Phasing

| Phase | Scope |
|---|---|
| **A** | Connect flow, branch selection, one-way pull, draft staging, category/brand auto-match + review queue, manual publish |
| **B** | Scheduled incremental sync for already-published products (price/stock only) |
| **C** | Two-way push — Lokl sales decrement VasyERP stock |
