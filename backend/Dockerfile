FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libffi-dev curl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -r lokl && useradd -r -g lokl -d /app -s /sbin/nologin lokl
WORKDIR /app
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --prefer-binary -r requirements.txt && \
    pip install "gunicorn==23.0.0" "uvicorn[standard]==0.30.6"
COPY --chown=lokl:lokl . /app/
USER lokl
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8001/api/heartbeat || exit 1
CMD ["sh", "-c", "gunicorn server:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8001 --workers ${WEB_CONCURRENCY:-2} --timeout 60 --access-logfile -"]
