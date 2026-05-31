#!/usr/bin/env bash
# scripts/smoke_staging.sh — quick post-deploy verification of staging.
# Exits non-zero on any failure so CI flips red.
#
# Required env:
#   STAGING_SMOKE_URL — root URL of the staging backend (e.g. https://api.staging.lokl.in)
set -euo pipefail

if [[ -z "${STAGING_SMOKE_URL:-}" ]]; then
  echo "STAGING_SMOKE_URL is required" >&2
  exit 2
fi

# Strip trailing slash for clean concatenation.
BASE="${STAGING_SMOKE_URL%/}"

check() {
  local label="$1" url="$2" expect_status="${3:-200}" method="${4:-GET}" body="${5:-}"
  local status
  if [[ -n "$body" ]]; then
    status=$(curl -s -o /tmp/smoke_body -w "%{http_code}" -X "$method" \
      -H 'Content-Type: application/json' -d "$body" --max-time 15 "$url")
  else
    status=$(curl -s -o /tmp/smoke_body -w "%{http_code}" -X "$method" --max-time 15 "$url")
  fi
  if [[ "$status" != "$expect_status" ]]; then
    echo "❌ $label — expected $expect_status, got $status"
    echo "Response body:"
    sed 's/^/    /' /tmp/smoke_body || true
    return 1
  fi
  echo "✅ $label — $status"
}

echo "Smoke testing $BASE"

# 1. Heartbeat (POST with empty body) — confirms the FastAPI app is up.
check "POST /api/heartbeat" "$BASE/api/heartbeat" 200 POST '{}'

# 2. Public storefront listing — exercises the Mongo connection.
check "GET /api/stores"     "$BASE/api/stores"            200
check "GET /api/products"   "$BASE/api/products?limit=1"  200

# 3. CMS homepage config — exercises the site_config singleton.
check "GET /api/site/homepage-config" "$BASE/api/site/homepage-config" 200

echo ""
echo "All smoke checks passed."
