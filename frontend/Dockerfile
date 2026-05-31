# Frontend Dockerfile — React (CRA) build, served by nginx.
# Multi-stage so the final image carries only the static bundle + nginx.
FROM node:20-alpine AS build

WORKDIR /build
# Cache deps layer: copy manifests first
COPY frontend/package.json frontend/yarn.lock* frontend/package-lock.json* ./
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    else npm ci || npm install; fi

COPY frontend/ .
# REACT_APP_* are baked at build time. Pass real values via --build-arg or
# the CI workflow; never commit them.
ARG REACT_APP_BACKEND_URL
ARG REACT_APP_SENTRY_DSN
ARG REACT_APP_SENTRY_ENVIRONMENT=production
ARG REACT_APP_SENTRY_RELEASE
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL \
    REACT_APP_SENTRY_DSN=$REACT_APP_SENTRY_DSN \
    REACT_APP_SENTRY_ENVIRONMENT=$REACT_APP_SENTRY_ENVIRONMENT \
    REACT_APP_SENTRY_RELEASE=$REACT_APP_SENTRY_RELEASE
RUN if [ -f yarn.lock ]; then yarn build; else npm run build; fi

FROM nginx:1.27-alpine AS runtime
# Drop privileges — nginx-alpine runs as nginx by default; keep that.
COPY --from=build /build/build /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
