# Backend Dockerfile — FastAPI + Motor + Gunicorn/Uvicorn workers.
# Multi-stage build to keep the runtime image lean (no compiler toolchain).
FROM python:3.11-slim AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libffi-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install --prefer-binary \
        --prefix=/install \
        -r requirements.txt
RUN pip install --prefer-binary \
    --prefix=/install \
    "gunicorn==23.0.0" "uvicorn[standard]==0.30.6"
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r lokl && useradd -r -g lokl -d /app -s /sbin/nologin lokl
WORKDIR /app
COPY --from=deps /install /usr/local
COPY --chown=lokl:lokl . /app/
USER lokl
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8001/api/heartbeat || exit 1
# Single worker by default (Motor is async); scale via WEB_CONCURRENCY env.
# Override CMD freely for one-off scripts (migrations, seeds, etc.)
CMD ["sh", "-c", "gunicorn server:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8001 --workers ${WEB_CONCURRENCY:-2} --timeout 60 --access-logfile -"]
