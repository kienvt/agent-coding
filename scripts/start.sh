#!/bin/sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── 1. Check & install dependencies ──────────────────────────────────────────
install_if_missing() {
  CMD="$1"
  PKG="${2:-$1}"
  if ! command -v "$CMD" >/dev/null 2>&1; then
    echo "==> Installing $PKG..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y "$PKG"
    elif command -v brew >/dev/null 2>&1; then
      brew install "$PKG"
    elif command -v apk >/dev/null 2>&1; then
      apk add --no-cache "$PKG"
    else
      echo "ERROR: Cannot install $PKG — please install it manually" >&2
      exit 1
    fi
  fi
}

install_if_missing git git
install_if_missing ssh openssh-client

# glab (GitLab CLI) — tên package khác nhau tùy OS
if ! command -v glab >/dev/null 2>&1; then
  echo "==> Installing glab (GitLab CLI)..."
  if command -v apt-get >/dev/null 2>&1; then
    # Ubuntu/Debian
    curl -s https://packagecloud.io/install/repositories/gitlab/cli/script.deb.sh | sudo bash
    sudo apt-get install -y glab
  elif command -v brew >/dev/null 2>&1; then
    brew install glab
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache glab
  else
    echo "ERROR: Cannot install glab — see https://gitlab.com/gitlab-org/cli#installation" >&2
    exit 1
  fi
fi

echo "==> Dependencies OK (git=$(git --version), glab=$(glab --version | head -1))"

# ── 2. glab auth ──────────────────────────────────────────────────────────────
if [ -n "${GITLAB_URL}" ] && [ -n "${GITLAB_TOKEN}" ]; then
  GITLAB_HOST=$(echo "${GITLAB_URL}" | sed 's|^https\?://||' | sed 's|/.*||')
  echo "${GITLAB_TOKEN}" | glab auth login \
    --hostname "$GITLAB_HOST" \
    --stdin \
    --git-protocol https 2>/dev/null \
    && echo "==> glab auth OK" \
    || echo "WARNING: glab auth failed"
fi

# ── 3. Redis ──────────────────────────────────────────────────────────────────
REDIS_HOST=$(echo "${REDIS_URL:-redis://localhost:6379}" | sed 's|redis://||' | cut -d: -f1)
REDIS_PORT=$(echo "${REDIS_URL:-redis://localhost:6379}" | sed 's|redis://||' | cut -d: -f2)

if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  echo "==> Redis already running at $REDIS_HOST:$REDIS_PORT"
else
  echo "==> Starting Redis via Docker..."
  docker compose up -d redis
  for i in $(seq 1 20); do
    if docker compose exec redis redis-cli ping 2>/dev/null | grep -q PONG; then
      echo "==> Redis ready"
      break
    fi
    sleep 1
  done
fi

# ── 4. Build ──────────────────────────────────────────────────────────────────
if [ "$1" = "--build" ] || [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
  echo "==> Building..."
  pnpm build
  pnpm ui:build
fi

# ── 5. Start orchestrator ─────────────────────────────────────────────────────
echo "==> Starting orchestrator on port ${PORT:-3000}..."
exec node dist/index.js
