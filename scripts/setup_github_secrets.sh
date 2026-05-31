#!/usr/bin/env bash
# scripts/setup_github_secrets.sh — register all secrets + variables the
# Deploy Staging workflow needs, using the GitHub CLI.
#
# Prerequisites:
#   • `gh` installed (https://cli.github.com/) and authenticated:
#       gh auth login
#   • You're in a checkout of the repo (so `gh` infers owner/repo), OR
#     set GH_REPO=owner/name before running.
#   • Each VALUE is read from your local shell env so secrets never hit disk.
#
# Usage (paste your real values inline, do NOT commit):
#   STAGING_HOST=staging.lokl.in \
#   STAGING_SSH_USER=deploy \
#   STAGING_SSH_KEY="$(cat ~/.ssh/lokl_ci_ed25519)" \
#   STAGING_DEPLOY_PATH=/opt/lokl \
#   STAGING_SMOKE_URL=https://api.staging.lokl.in \
#   STAGING_API_URL=https://api.staging.lokl.in \
#   STAGING_REACT_SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/XXX \
#     bash scripts/setup_github_secrets.sh
set -euo pipefail

command -v gh >/dev/null 2>&1 || {
  echo "Install GitHub CLI first: https://cli.github.com/" >&2
  exit 1
}

REPO_ARG=()
[[ -n "${GH_REPO:-}" ]] && REPO_ARG=(-R "$GH_REPO")

required=(STAGING_HOST STAGING_SSH_USER STAGING_SSH_KEY STAGING_DEPLOY_PATH \
          STAGING_SMOKE_URL STAGING_API_URL STAGING_REACT_SENTRY_DSN)

missing=()
for k in "${required[@]}"; do
  [[ -n "${!k:-}" ]] || missing+=("$k")
done

if (( ${#missing[@]} )); then
  printf "❌ Missing required env vars:\n"
  printf "    %s\n" "${missing[@]}"
  echo
  echo "Set each one and re-run, e.g.:"
  echo "   export STAGING_HOST=staging.lokl.in"
  exit 2
fi

set_secret() {
  local name="$1" value="$2"
  printf "%s" "$value" | gh secret set "$name" "${REPO_ARG[@]}" --body -
  echo "✅ secret  $name"
}

set_var() {
  local name="$1" value="$2"
  gh variable set "$name" "${REPO_ARG[@]}" --body "$value"
  echo "✅ var     $name=$value"
}

echo "Registering secrets…"
for k in "${required[@]}"; do
  set_secret "$k" "${!k}"
done

echo
echo "Registering variables…"
set_var STAGING_DEPLOY_ENABLED true
set_var STAGING_SMOKE_ENABLED  true

echo
echo "🎉  All secrets + variables registered."
echo "    Next: push to main (or run the workflow manually) to trigger deploy."
