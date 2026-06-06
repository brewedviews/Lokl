# Lokl — Deployment & Release Guide

## Frontend Cutover (Session E — Feb 2026)

The Next.js 15 App Router app is now the canonical `frontend/` directory and is
served on **port 3000** in all environments (local, staging, production).

- **Active**: `/app/frontend/` — Next.js 15 + React 19 + Tailwind v4. Dockerfile
  uses `output: "standalone"`, ships a ~140 MB image, runs `node server.js`.
- **Preserved for rollback (2-week window)**: `/app/frontend-legacy/` — the
  original CRA app with its own Dockerfile (`yarn build` + `serve`). To roll
  back, edit `docker-compose.yml` and change `context: ./frontend` to
  `context: ./frontend-legacy`, then `docker compose build frontend && docker compose up -d frontend`.
- **Delete window**: `frontend-legacy/` will be removed after 2 weeks of stable
  production operation on the Next.js build (target: end of Feb 2026).

### Env vars rename
All `REACT_APP_*` variables are gone. Replacements (same value, new name):

| Old (CRA)                       | New (Next.js)                       |
| ------------------------------- | ----------------------------------- |
| `REACT_APP_BACKEND_URL`         | `NEXT_PUBLIC_API_URL`               |
| `REACT_APP_SENTRY_DSN`          | `NEXT_PUBLIC_SENTRY_DSN`            |
| `REACT_APP_SENTRY_ENVIRONMENT`  | `NEXT_PUBLIC_SENTRY_ENVIRONMENT`    |
| `REACT_APP_RAZORPAY_KEY_ID`     | `NEXT_PUBLIC_RAZORPAY_KEY_ID`       |
| `REACT_APP_APP_ENV`             | `NEXT_PUBLIC_APP_ENV`               |

Update `.env`, `.env.staging`, and any CI / Vercel / GHCR secrets accordingly
before the next deploy. The CRA names will fail-fast in the Next.js build.

This document is the source of truth for how Lokl is built, shipped, and rolled
back across local, staging, and production environments.

## 1. Environments

| Environment | Branch     | Auto-deploy | DB                       | Sentry env  | Notes                            |
|-------------|------------|-------------|--------------------------|-------------|----------------------------------|
| local       | any        | manual      | local Mongo (compose)    | disabled    | `docker compose up`              |
| staging     | `main`     | yes (CI)    | Atlas (`lokl_staging`)   | `staging`   | post-merge smoke test            |
| production  | `release`* | manual      | Atlas (`lokl_prod`)      | `production`| tag-gated deploy                 |

\* Production is fenced behind a release tag — see §5.

## 2. Local development (Docker)

```bash
cp .env.example .env             # fill in real values
docker compose --env-file .env up --build
# Frontend:  http://localhost:3000
# Backend:   http://localhost:8001/api/heartbeat
# Mongo:     localhost:27017 (volume: mongo_data)
```

Hot-reload note: the supervisor-managed dev pods (`/var/log/supervisor/`) are
the canonical local-dev runtime for this preview environment. The Docker
compose stack above is for portable local builds and CI parity.

## 3. Staging

### 3.1 Configuration
1. Copy `.env.staging.example` → `.env.staging` on the staging host.
2. Generate a unique `JWT_SECRET` (>= 32 chars random).
3. Point `MONGO_URL` at the staging Atlas cluster.
4. Set a separate `SENTRY_DSN` for the staging project.
5. Set GHCR image tags via `BACKEND_IMAGE` / `FRONTEND_IMAGE`.

### 3.2 GitHub repository secrets/vars
Required **secrets** (Settings → Secrets and variables → Actions → Secrets):

- `STAGING_HOST` — SSH host (e.g. `staging.lokl.in`)
- `STAGING_SSH_USER` — SSH user
- `STAGING_SSH_KEY` — PEM private key authorized on the host
- `STAGING_DEPLOY_PATH` — absolute path on the host (e.g. `/opt/lokl`)
- `STAGING_SMOKE_URL` — public URL for smoke test
- `STAGING_API_URL` — value of `REACT_APP_BACKEND_URL` baked into the frontend
- `STAGING_REACT_SENTRY_DSN` — Sentry DSN for the React build

Required **variables** (toggle deploy / smoke independently):

- `STAGING_DEPLOY_ENABLED=true` — SSH deploy step runs
- `STAGING_SMOKE_ENABLED=true` — smoke test runs

### 3.3 Auto-deploy flow

```
main push → CI builds images → push to GHCR (:staging + :<sha>)
            → SSH to STAGING_HOST → docker compose pull && up -d
            → smoke test STAGING_SMOKE_URL
```

### 3.4 Manual deploy / rollback

```bash
ssh deploy@staging.lokl.in
cd /opt/lokl
# Rollback to a specific SHA tag previously pushed to GHCR
export BACKEND_IMAGE=ghcr.io/<org>/lokl-backend:<sha>
export FRONTEND_IMAGE=ghcr.io/<org>/lokl-frontend:<sha>
docker compose -f docker-compose.yml -f docker-compose.staging.yml \
  --env-file .env.staging up -d
```

## 4. Production (manual gate)

Production is intentionally **not** auto-deployed from `main`. The release flow:

1. Cut a release branch + tag: `git tag -a v1.x.y -m "..." && git push --tags`
2. Manually run the `Deploy Staging` workflow with the release SHA against the
   production host (override `STAGING_HOST` via environment, or copy the
   workflow to `deploy-production.yml` with prod secrets).
3. Smoke-test the production URL via `scripts/smoke_staging.sh` (rename if you
   like — same script, different URL).
4. Watch Sentry for new errors over the next 30 minutes.

## 5. Observability

### 5.1 Sentry
- Backend init: `backend/observability.py`. Disabled (no-op) when `SENTRY_DSN`
  is unset, so dev/CI never spam the dashboard.
- Frontend init: `frontend/src/lib/observability.js`. Same no-op behavior.
- Every event is tagged with `service=lokl-backend` or `service=lokl-frontend`
  and `environment=<SENTRY_ENVIRONMENT>` to make filtering easy.
- `SENTRY_RELEASE` is set to the short git SHA in CI for release-health
  tracking. Set it to a semver tag for production cuts.

### 5.2 Healthchecks
- Backend: `POST /api/heartbeat` (returns `{ ok: true }`).
- Backend internal: `/internal/health/db` (requires `X-Internal-Key`).
- Frontend: `GET /healthz` (nginx returns `ok`).

### 5.3 Smoke test
`scripts/smoke_staging.sh` exercises heartbeat, public storefront listing, and
the CMS singleton. Pass `STAGING_SMOKE_URL` to point it anywhere.

## 6. Rollback playbook

If staging or prod misbehaves after a deploy:

```bash
# 1. Identify the last-known-good SHA tag from GHCR.
gh api -X GET /orgs/<org>/packages/container/lokl-backend/versions | jq '.[0].metadata.container.tags'

# 2. Pin compose to that SHA and redeploy (see §3.4).
# 3. If the bug is data-related, also check migrations applied since:
docker compose exec backend python migrations/run.py status
```

For a critical incident, flip frontend traffic to a static maintenance page in
nginx (drop a `maintenance.html` into `/usr/share/nginx/html` and add a
`return 503 /maintenance.html` in `nginx.conf`).

## 7. Backup checklist (before major releases)

- [ ] Mongo Atlas: snapshot `lokl_prod` cluster
- [ ] Confirm GHCR contains the previous prod image tag (for instant rollback)
- [ ] Sentry: clear unresolved alerts for the prior release
- [ ] Run `pytest` + smoke test against staging
- [ ] Tag the release in git and write a 1-paragraph changelog
