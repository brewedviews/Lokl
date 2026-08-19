"""Thin HTTP client for VasyERP's inventory API (Phase A: read-only pull).

Request/response shapes below are CONFIRMED (auth header, envelope shape,
per-endpoint response keys, limit/offset pagination) — no longer a
paraphrase-based guess. What is still NOT confirmed, and can't be until a
real account exists: the base URL (VASYERP_API_BASE_URL — not in public
docs, must come from the merchant's own VasyERP dashboard/support) and
whether any of this actually round-trips against a live server. See
docs/integrations/vasyerp-integration-plan.md.

Confirmed contract:
  - Auth: `api-token: <token>` header (lowercase, hyphenated — not
    Authorization/Bearer).
  - Every response wraps as {"status": bool, "message": str, "code": str,
    "response": ...}. `response`'s shape is endpoint-specific:
      GET /api/v1/branch                          -> response is a bare
        array of {"branchId": ..., "branchName": ...}.
      GET /api/v1/products                        -> response is
        {"totalCount": N, "productList": [...]}. (Not called by Phase A —
        products-inventory below is the branch-scoped, qty-bearing one
        Phase A actually needs — documented here for completeness/future
        reference only.)
      GET /api/v1/product/products-inventory      -> response is
        {"totalCount": N, "items": [...]} — note the key is "items", NOT
        "productList", despite both endpoints otherwise looking similar.
  - Pagination is `limit`/`offset` (not page/pageSize) — sent as required
    params on every paginated call, never omitted even at defaults.
"""
import os
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type


class VasyERPAuthError(Exception):
    """VasyERP rejected the api-token (401/403) — merchant must reconnect
    with a fresh token, not something a retry can fix."""


class VasyERPClientError(Exception):
    """Any other non-2xx response, malformed envelope, API-level failure
    (status: false inside an HTTP-200 envelope), network failure, or
    config problem."""


class _RetryableStatus(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"retryable status {status_code}")


def _base_url() -> str:
    # NOT in public VasyERP docs — must be obtained directly from the
    # merchant's VasyERP dashboard or VasyERP support before any real
    # connection attempt. See .env.example.
    url = os.environ.get("VASYERP_API_BASE_URL", "").strip()
    if not url:
        raise VasyERPClientError("VASYERP_API_BASE_URL is not configured")
    return url.rstrip("/")


def _headers(api_token: str) -> dict:
    return {"api-token": api_token, "Accept": "application/json"}


def _unwrap_envelope(data: object, path: str) -> object:
    """Every VasyERP response is {"status": bool, "message": str, "code":
    str, "response": ...} — unwrap it here, once, so every endpoint
    function below only ever deals with the real payload. Deliberately
    NOT tolerant of other shapes anymore (an earlier version guessed at
    multiple possible envelopes when the real one wasn't confirmed yet) —
    a response that doesn't match this confirmed contract is a real
    problem and should fail loudly, not be silently reinterpreted."""
    if not isinstance(data, dict) or "response" not in data:
        raise VasyERPClientError(f"Unexpected response shape from {path}: missing 'response' envelope")
    if data.get("status") is False:
        raise VasyERPClientError(data.get("message") or f"VasyERP returned an error from {path}")
    return data["response"]


@retry(
    retry=retry_if_exception_type(_RetryableStatus),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def _get(path: str, api_token: str, params: Optional[dict] = None) -> dict:
    url = f"{_base_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers=_headers(api_token), params=params or {})
    except httpx.HTTPError as e:
        raise VasyERPClientError(f"Network error calling VasyERP: {e}")
    if r.status_code == 429:
        # tenacity catches this and retries with exponential backoff
        # (1s, 2s, 4s, capped at 10s) up to 4 attempts total, per the
        # plan's "documented 429 responses — backoff/retry required."
        raise _RetryableStatus(429)
    if r.status_code in (401, 403):
        raise VasyERPAuthError("VasyERP rejected the API token")
    if r.status_code >= 400:
        raise VasyERPClientError(f"VasyERP returned {r.status_code}: {r.text[:200]}")
    try:
        return r.json()
    except Exception:
        raise VasyERPClientError("VasyERP returned a non-JSON response")


async def list_branches(api_token: str) -> list[dict]:
    """GET /api/v1/branch -> [{"id": ..., "name": ...}, ...].

    The real response's `response` array uses `branchId`/`branchName` —
    renamed to `id`/`name` here (the ONLY place in the whole integration
    that touches raw branch fields; nothing downstream reads
    branchId/branchName directly) so callers get a stable, self-explanatory
    shape regardless of VasyERP's own field naming."""
    path = "/api/v1/branch"
    data = await _get(path, api_token)
    response = _unwrap_envelope(data, path)
    branches = response if isinstance(response, list) else []
    return [{"id": b.get("branchId"), "name": b.get("branchName")} for b in branches]


async def fetch_products_inventory_page(
    api_token: str,
    branch_id: str,
    limit: int = 100,
    offset: int = 0,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> dict:
    """GET /api/v1/product/products-inventory -> one page, normalized to
    {"items": [...], "has_more": bool}. `limit`/`offset` are always sent
    (never omitted at their defaults) — that's the real pagination
    contract, confirmed against actual VasyERP responses, replacing an
    earlier page/pageSize guess. Item fields inside `items` are passed
    through completely unmodified (productId, productName, mrp,
    sellingPrice, qty, hsnCode, brand, category, measurement, etc.) — the
    caller (server.py's staging/mapping logic) reads those directly and is
    out of scope for this client-layer fix.

    `from_date`/`to_date` support incremental sync (Phase B) — accepted
    here already since the endpoint takes them either way, unused by
    Phase A's full pull."""
    path = "/api/v1/product/products-inventory"
    params: dict = {"branchId": branch_id, "limit": limit, "offset": offset}
    if from_date:
        params["fromDate"] = from_date
    if to_date:
        params["toDate"] = to_date
    data = await _get(path, api_token, params)
    response = _unwrap_envelope(data, path)
    if not isinstance(response, dict):
        raise VasyERPClientError(f"Unexpected 'response' shape from {path}: expected an object with 'items'")
    items = response.get("items") or []
    total = response.get("totalCount")
    has_more = (offset + limit < total) if isinstance(total, int) else (len(items) == limit)
    return {"items": items, "has_more": has_more}
