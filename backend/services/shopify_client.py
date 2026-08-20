"""Thin GraphQL client for Shopify's Admin API (mirrors vasyerp_client.py's
shape — httpx + tenacity backoff — adapted for GraphQL, cursor pagination,
and cost-based throttling).

IMPORTANT — testing caveat, same category as VasyERP: no real Shopify
store/app credentials were available while building this. Query shapes
below match Shopify's confirmed public GraphQL schema (Admin API,
products/variants/images/selectedOptions), and the request/response
plumbing (auth header, envelope, throttle handling) matches Shopify's
documented contract, but none of this has been exercised against a live
store — only against a hand-built local mock. Confirm against a real
store before this ships to an actual merchant.

Confirmed contract (from Shopify's public docs, not paraphrased):
  - Auth: `X-Shopify-Access-Token: <token>` header on every Admin API call.
  - Endpoint: https://{shop}.myshopify.com/admin/api/{version}/graphql.json
  - Every request is a POST with {"query": ..., "variables": ...}.
  - GraphQL-level errors return HTTP 200 with a top-level "errors" array —
    NOT an HTTP 4xx/5xx. A cost-throttled query specifically carries
    {"extensions": {"code": "THROTTLED"}} on its error entry.
  - Successful responses carry {"extensions": {"cost": {"requestedQueryCost",
    "actualQueryCost", "throttleStatus": {"maximumAvailable",
    "currentlyAvailable", "restoreRate"}}}} — the throttle signal to watch
    is the THROTTLED error code above, not a raw budget threshold (Shopify
    itself decides when a query is too expensive to run right now).
  - Pagination is cursor-based (first/after), not offset-based.

  As of the custom-app auth changes Shopify rolled out effective
  2026-01-01, a static access token is no longer shown in the UI for
  newly-created apps. Instead the app has a Client ID + Client Secret, and
  the actual access token is obtained via OAuth's Client Credentials Grant:
  - Endpoint: POST https://{shop}.myshopify.com/admin/oauth/access_token
    (note: NOT under /admin/api/{version}/ — this is a REST-shaped OAuth
    endpoint, not part of the GraphQL surface).
  - Request: Content-Type: application/x-www-form-urlencoded, body
    `grant_type=client_credentials&client_id=...&client_secret=...`.
  - Response (JSON): {"access_token": "...", "scope": "...",
    "expires_in": 86399} — the token is valid for ~24h (Shopify's docs
    show this exact expires_in value), so it must be re-exchanged rather
    than treated as permanent.
  - Prerequisites: the app must already be installed on the store, and
    the app and the store must belong to the same Shopify organization —
    a merchant using this integration has to create their own app inside
    their own Shopify Organization, not use a shared/hosted Lokl app.

  Bidirectional inventory sync (added after the "stock stuck at the
  imported quantity" bug report — see server.py's _sync_shopify_delta and
  the /webhooks/shopify/inventory endpoint):
  - Scopes: read_products + read_inventory were enough for the original
    one-way pull; sync additionally needs write_inventory (to push a
    delta out) — merchants who connected before this must add that scope
    to their app in the Dev Dashboard and reconnect, same as any Shopify
    scope change.
  - Outbound (Lokl order -> Shopify): inventoryAdjustQuantities takes a
    signed DELTA against one (inventoryItemId, locationId) pair.
  - Inbound (Shopify change -> Lokl): the INVENTORY_LEVELS_UPDATE webhook
    topic posts the new ABSOLUTE "available" count for one (inventory
    item, location) pair — not a delta. Lokl's handler SETS its own stock
    to match rather than incrementing, which is what makes an outbound
    adjustment safely idempotent when its own resulting webhook echoes
    back: setting a stock value to what it was already about to become is
    a no-op, not a double-count.
  - Multi-location stores: only the first location Shopify returns is
    used, for both directions. A documented simplification, not a bug.
"""
import base64
import hashlib
import hmac
import os
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2024-10")


class ShopifyAuthError(Exception):
    """Shopify rejected the access token (401/403, or a GraphQL-level
    access-denied error) — merchant must reconnect with a fresh token."""


class ShopifyClientError(Exception):
    """Any other non-2xx response, GraphQL-level error, malformed
    response, network failure, or config problem."""


class _RetryableThrottle(Exception):
    """Raised on either throttle signal: a plain HTTP 429, or a GraphQL
    error carrying extensions.code == "THROTTLED" inside an HTTP 200."""


def _shop_base_url(shop_domain: str) -> str:
    # Testing-only hook: unlike VasyERP (single unknown base URL for every
    # merchant), Shopify's base URL is well-known per shop
    # (https://{shop}.myshopify.com) — there's nothing to look up. But a
    # real store doesn't exist to test against either, so this lets local
    # testing point every shop_domain at one mock server instead.
    # Unset in every real deployment; real merchants are unaffected.
    override = os.environ.get("SHOPIFY_API_BASE_URL_OVERRIDE", "").strip()
    if override:
        return override.rstrip("/")
    domain = (shop_domain or "").strip().rstrip("/")
    if not domain:
        raise ShopifyClientError("Shop domain is required")
    domain = domain.replace("https://", "").replace("http://", "")
    if not domain.endswith(".myshopify.com") and "." not in domain:
        # Tolerate a bare store handle ("my-store") as well as the full
        # domain ("my-store.myshopify.com") — merchants commonly paste
        # either when copying from their Shopify admin URL bar.
        domain = f"{domain}.myshopify.com"
    return f"https://{domain}"


def _shop_url(shop_domain: str) -> str:
    return f"{_shop_base_url(shop_domain)}/admin/api/{API_VERSION}/graphql.json"


def _oauth_token_url(shop_domain: str) -> str:
    return f"{_shop_base_url(shop_domain)}/admin/oauth/access_token"


def _headers(access_token: str) -> dict:
    return {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json", "Accept": "application/json"}


@retry(
    retry=retry_if_exception_type(_RetryableThrottle),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def get_access_token(shop_domain: str, client_id: str, client_secret: str) -> dict:
    """OAuth Client Credentials Grant exchange -> {"access_token": str,
    "expires_in": int}. Tokens are short-lived (~24h per Shopify's docs,
    always expires_in=86399) and deliberately NOT cached/stored anywhere —
    callers exchange a fresh one right before each use (once at connect
    time to validate, then again at the start of every import run) rather
    than tracking an expiry timestamp. client_id/client_secret are the
    durable credential and are what actually gets persisted."""
    url = _oauth_token_url(shop_domain)
    body = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    except httpx.HTTPError as e:
        raise ShopifyClientError(f"Network error exchanging Shopify credentials: {e}")
    if r.status_code == 429:
        raise _RetryableThrottle("http 429")
    if r.status_code in (400, 401, 403):
        raise ShopifyAuthError("Shopify rejected the client ID/secret (or the app isn't installed on this store)")
    if r.status_code >= 400:
        raise ShopifyClientError(f"Shopify returned {r.status_code} exchanging credentials: {r.text[:200]}")
    try:
        data = r.json()
    except Exception:
        raise ShopifyClientError("Shopify returned a non-JSON response exchanging credentials")
    access_token = data.get("access_token")
    if not access_token:
        raise ShopifyClientError("Shopify's token exchange response was missing an access_token")
    return {"access_token": access_token, "expires_in": data.get("expires_in"), "scope": data.get("scope")}


@retry(
    retry=retry_if_exception_type(_RetryableThrottle),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def _post(shop_domain: str, access_token: str, query: str, variables: Optional[dict] = None) -> dict:
    url = _shop_url(shop_domain)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, headers=_headers(access_token), json={"query": query, "variables": variables or {}})
    except httpx.HTTPError as e:
        raise ShopifyClientError(f"Network error calling Shopify: {e}")
    if r.status_code == 429:
        raise _RetryableThrottle("http 429")
    if r.status_code in (401, 403):
        raise ShopifyAuthError("Shopify rejected the access token")
    if r.status_code >= 400:
        raise ShopifyClientError(f"Shopify returned {r.status_code}: {r.text[:200]}")
    try:
        body = r.json()
    except Exception:
        raise ShopifyClientError("Shopify returned a non-JSON response")

    errors = body.get("errors") or []
    if errors:
        codes = {(e.get("extensions") or {}).get("code") for e in errors}
        if "THROTTLED" in codes:
            # tenacity catches this and retries with exponential backoff —
            # cost-based throttling per Shopify's documented contract,
            # distinct from (but handled the same way as) a raw HTTP 429.
            raise _RetryableThrottle("cost-throttled")
        msgs = "; ".join(e.get("message", "") for e in errors)
        if "ACCESS_DENIED" in codes or "unauthorized" in msgs.lower() or "invalid api key or access token" in msgs.lower():
            raise ShopifyAuthError(msgs or "Shopify rejected the request")
        raise ShopifyClientError(msgs or "Shopify GraphQL error")
    return body.get("data") or {}


async def get_shop_name(shop_domain: str, access_token: str) -> str:
    """{ shop { name } } — lightweight query used only to validate a token
    at connect time, same role as VasyERP's list_branches() call."""
    data = await _post(shop_domain, access_token, "query { shop { name } }")
    return ((data.get("shop") or {}).get("name")) or ""


_PRODUCTS_QUERY = """
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        vendor
        productType
        images(first: 1) { edges { node { url } } }
        variants(first: 100) {
          edges {
            node {
              sku
              price
              compareAtPrice
              inventoryQuantity
              selectedOptions { name value }
              inventoryItem { id }
            }
          }
        }
      }
    }
  }
}
"""


async def fetch_products_page(shop_domain: str, access_token: str, first: int = 50, after: Optional[str] = None) -> dict:
    """One page of products -> {"items": [...raw product nodes...],
    "has_more": bool, "cursor": Optional[str]}. `items` are passed through
    completely unmodified — the caller (server.py's _shopify_item_to_fields)
    reads productType/vendor/images/variants directly, out of scope for
    this client-layer function."""
    data = await _post(shop_domain, access_token, _PRODUCTS_QUERY, {"first": first, "after": after})
    products = data.get("products") or {}
    edges = products.get("edges") or []
    page_info = products.get("pageInfo") or {}
    items = [e["node"] for e in edges if e.get("node")]
    return {"items": items, "has_more": bool(page_info.get("hasNextPage")), "cursor": page_info.get("endCursor")}


async def get_primary_location_id(shop_domain: str, access_token: str) -> Optional[str]:
    """The first fulfillment location Shopify returns for this shop.
    Inventory in Shopify is tracked per-(inventory item, location) pair —
    every inventory read/write below needs one to operate against. Only the
    first location is used; multi-location stores are a known, documented
    simplification (same "pick one, keep it simple" call as VasyERP's own
    single-branch-selection model elsewhere in this integration)."""
    data = await _post(shop_domain, access_token, "query { locations(first: 1) { edges { node { id } } } }")
    edges = ((data.get("locations") or {}).get("edges")) or []
    return edges[0]["node"]["id"] if edges else None


_INVENTORY_ADJUST_MUTATION = """
mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup { createdAt }
    userErrors { field message }
  }
}
"""


async def adjust_inventory(shop_domain: str, access_token: str, inventory_item_id: str, location_id: str, delta: int) -> None:
    """Applies a signed delta to one inventory item's "available" quantity
    at one location — the outbound half of sync (a Lokl order decrements,
    a Lokl cancel/return increments). Requires the write_inventory scope;
    raises ShopifyAuthError if the connected app was never granted it."""
    if delta == 0:
        return
    variables = {"input": {
        "reason": "correction", "name": "available",
        "changes": [{"inventoryItemId": inventory_item_id, "locationId": location_id, "delta": delta}],
    }}
    data = await _post(shop_domain, access_token, _INVENTORY_ADJUST_MUTATION, variables)
    errors = ((data.get("inventoryAdjustQuantities") or {}).get("userErrors")) or []
    if errors:
        msgs = "; ".join(e.get("message", "") for e in errors)
        raise ShopifyClientError(f"Shopify rejected the inventory adjustment: {msgs}")


_WEBHOOK_CREATE_MUTATION = """
mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl, format: JSON}) {
    webhookSubscription { id }
    userErrors { field message }
  }
}
"""


def verify_webhook_signature(raw_body: bytes, hmac_header: str, client_secret: str) -> bool:
    """Shopify signs every webhook with HMAC-SHA256 over the raw request
    body, keyed by the app's client secret, base64-encoded (NOT hex, unlike
    Razorpay's own webhook signature elsewhere in this codebase) — compared
    against the X-Shopify-Hmac-Sha256 header."""
    if not client_secret or not hmac_header:
        return False
    digest = hmac.new(client_secret.encode(), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, hmac_header)


def to_gid(resource: str, numeric_id) -> str:
    """Shopify's REST-shaped webhook payloads carry bare numeric ids
    (e.g. inventory_item_id: 12345); the GraphQL Admin API (used
    everywhere else in this client) only ever deals in gids
    (gid://shopify/InventoryItem/12345). Webhook handlers normalize
    through this before looking anything up against data the GraphQL
    import already stored gid-keyed."""
    return f"gid://shopify/{resource}/{numeric_id}"


async def register_inventory_webhook(shop_domain: str, access_token: str, callback_url: str) -> Optional[str]:
    """Subscribes Lokl's webhook endpoint to this store's
    INVENTORY_LEVELS_UPDATE topic — the inbound half of sync (a change made
    directly on Shopify, e.g. an in-store sale, reaches Lokl in near-real-
    time instead of waiting for the next manual "Pull latest inventory").
    Returns the subscription id, or None if Shopify reported a userError
    (e.g. this exact callback URL is already subscribed — not fatal, connect
    still succeeds; see server.py's shopify_connect)."""
    data = await _post(shop_domain, access_token, _WEBHOOK_CREATE_MUTATION,
                        {"topic": "INVENTORY_LEVELS_UPDATE", "callbackUrl": callback_url})
    result = data.get("webhookSubscriptionCreate") or {}
    errors = result.get("userErrors") or []
    if errors:
        return None
    sub = result.get("webhookSubscription") or {}
    return sub.get("id")
