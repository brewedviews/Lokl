#!/usr/bin/env bash
# scripts/bootstrap_staging.sh — one-time host setup for the Lokl staging VM.
#
# Run this ONCE on a fresh Ubuntu 22.04/24.04 host as a sudo-capable user.
# Idempotent — safe to re-run if it fails partway through.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/scripts/bootstrap_staging.sh \
#        | DEPLOY_PATH=/opt/lokl bash
#
# Env vars (with defaults):
#   DEPLOY_PATH=/opt/lokl   absolute path where the compose stack lives
#   DEPLOY_USER=deploy      service user that owns DEPLOY_PATH and runs docker
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/lokl}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

log() { printf "\033[1;34m[bootstrap]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[bootstrap]\033[0m %s\n" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash bootstrap_staging.sh)."

log "Updating apt + installing prerequisites…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release ufw fail2ban

# ---- Docker Engine + Compose plugin (official repo) -------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker already installed — skipping."
fi

# ---- Deploy user + directory ------------------------------------------------
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating service user $DEPLOY_USER…"
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

log "Provisioning $DEPLOY_PATH…"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 "$DEPLOY_PATH"

# ---- SSH key for CI deploys -------------------------------------------------
SSH_DIR="/home/$DEPLOY_USER/.ssh"
if [[ ! -f "$SSH_DIR/authorized_keys" ]]; then
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SSH_DIR"
  touch "$SSH_DIR/authorized_keys"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$SSH_DIR/authorized_keys"
  chmod 0600 "$SSH_DIR/authorized_keys"
  log "Created empty $SSH_DIR/authorized_keys — paste the CI deploy public key into it."
fi

# ---- Firewall ---------------------------------------------------------------
log "Configuring ufw (allow 22, 80, 443; default deny inbound)…"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---- GHCR pull credentials --------------------------------------------------
cat >/etc/cron.daily/lokl-docker-prune <<'CRON'
#!/usr/bin/env bash
docker image prune -af --filter "until=168h" >/dev/null
docker container prune -f >/dev/null
CRON
chmod +x /etc/cron.daily/lokl-docker-prune

# ---- Final hand-off message -------------------------------------------------
cat <<EOF

\033[1;32m[bootstrap]\033[0m Host bootstrap complete.

Next steps (run as $DEPLOY_USER):
  1. Paste the CI deploy public key into:
       $SSH_DIR/authorized_keys
  2. Copy .env.staging.example to:
       $DEPLOY_PATH/.env.staging
     and fill in real secrets (Atlas URL, JWT, Sentry DSN, etc.).
  3. Authenticate to GHCR so docker compose can pull private images:
       echo \$GHCR_TOKEN | docker login ghcr.io -u <github-user> --password-stdin
  4. Copy docker-compose.yml + docker-compose.staging.yml into $DEPLOY_PATH/.
     (The CI workflow does this automatically on first deploy.)
  5. Trigger the Deploy Staging workflow from GitHub Actions.

EOF
