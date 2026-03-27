#!/bin/sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Load .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; . "$PROJECT_DIR/.env"; set +a
fi

echo "============================================"
echo " AI Agent Orchestrator — startup check"
echo "============================================"

# ── helpers ───────────────────────────────────────────────────────────────────
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: '$1' not found. $2" >&2; exit 1
  fi
}

install_pkg() {
  CMD="$1"; PKG="${2:-$1}"
  if command -v "$CMD" >/dev/null 2>&1; then return; fi
  echo "==> Installing $PKG..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y "$PKG"
  elif command -v brew >/dev/null 2>&1; then
    brew install "$PKG"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "$PKG"
  else
    echo "ERROR: Cannot install $PKG — install manually" >&2; exit 1
  fi
}

# ── 1. Node.js ────────────────────────────────────────────────────────────────
NODE_NEED=22
install_node() {
  echo "==> Installing Node.js $NODE_NEED..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_NEED}.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node@${NODE_NEED}
    brew link node@${NODE_NEED} --force --overwrite 2>/dev/null || true
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs npm
  else
    echo "ERROR: Cannot install Node.js — install manually: https://nodejs.org" >&2; exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  install_node
else
  NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "==> Node.js $NODE_MAJOR too old, upgrading..."
    install_node
  fi
fi
echo "==> node $(node --version) OK"

# ── 2. pnpm ───────────────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Installing pnpm..."
  sudo corepack enable pnpm 2>/dev/null || sudo npm install -g pnpm
fi
echo "==> pnpm $(pnpm --version) OK"

# ── 3. git + glab ─────────────────────────────────────────────────────────────
install_pkg git git
install_pkg ssh openssh-client

if ! command -v glab >/dev/null 2>&1; then
  echo "==> Installing glab (GitLab CLI)..."
  if command -v brew >/dev/null 2>&1; then
    brew install glab
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache glab
  elif command -v apt-get >/dev/null 2>&1; then
    if command -v snap >/dev/null 2>&1; then
      sudo snap install glab
    else
      # Download .deb — use known stable version as fallback if API fails
      GLAB_VER=$(curl -sf --max-time 5 "https://api.github.com/repos/gitlab-org/cli/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
      GLAB_VER="${GLAB_VER:-v1.90.0}"
      GLAB_ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
      curl -fsSL "https://github.com/gitlab-org/cli/releases/download/${GLAB_VER}/glab_${GLAB_VER#v}_linux_${GLAB_ARCH}.deb" -o /tmp/glab.deb
      sudo dpkg -i /tmp/glab.deb && rm -f /tmp/glab.deb
    fi
  else
    echo "ERROR: Install glab manually: https://gitlab.com/gitlab-org/cli#installation" >&2; exit 1
  fi
fi
echo "==> git $(git --version | cut -d' ' -f3), glab $(glab version | head -1 | awk '{print $3}') OK"

# ── 4. git global config (required for git push) ──────────────────────────────
if [ -z "$(git config --global user.email 2>/dev/null)" ]; then
  BOT="${GITLAB_BOT_USERNAME:-ai-agent}"
  git config --global user.email "${BOT}@noreply.local"
  git config --global user.name "$BOT"
  echo "==> git global config set (${BOT}@noreply.local)"
fi

# ── 5. glab auth ──────────────────────────────────────────────────────────────
if [ -n "${GITLAB_URL}" ] && [ -n "${GITLAB_TOKEN}" ]; then
  GITLAB_HOST=$(echo "${GITLAB_URL}" | sed 's|^https\?://||' | sed 's|/.*||')
  echo "${GITLAB_TOKEN}" | glab auth login \
    --hostname "$GITLAB_HOST" --stdin --git-protocol https 2>/dev/null \
    && echo "==> glab auth OK" \
    || echo "WARNING: glab auth failed (non-fatal)"
else
  echo "WARNING: GITLAB_URL or GITLAB_TOKEN not set — configure via Web UI"
fi

# ── 6. Claude Code auth ───────────────────────────────────────────────────────
if ! claude --version >/dev/null 2>&1; then
  echo "ERROR: 'claude' CLI not found. Install: npm install -g @anthropic-ai/claude-code" >&2
  exit 1
fi
if ! claude config get 2>/dev/null | grep -q "email\|account\|logged" 2>/dev/null; then
  # Best-effort check — don't fail if check itself errors
  echo "WARNING: Claude may not be logged in. Run: claude auth login"
fi
echo "==> claude $(claude --version) OK"

# ── 7. Redis ──────────────────────────────────────────────────────────────────
REDIS_HOST=$(echo "${REDIS_URL:-redis://localhost:6379}" | sed 's|redis://||' | cut -d: -f1)
REDIS_PORT=$(echo "${REDIS_URL:-redis://localhost:6379}" | sed 's|redis://||' | cut -d: -f2)

if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  echo "==> Redis at $REDIS_HOST:$REDIS_PORT OK"
else
  echo "==> Starting Redis via Docker..."
  docker compose up -d redis
  for i in $(seq 1 20); do
    if docker compose exec redis redis-cli ping 2>/dev/null | grep -q PONG; then
      echo "==> Redis ready"; break
    fi
    sleep 1
  done
fi

# ── 8. Workspace dir ──────────────────────────────────────────────────────────
WS="${WORKSPACE_PATH:-$PROJECT_DIR/workspace}"
mkdir -p "$WS"
echo "==> Workspace: $WS"

# ── 9. Build ──────────────────────────────────────────────────────────────────
if [ "$1" = "--build" ] || [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
  echo "==> Building..."
  pnpm install --frozen-lockfile
  pnpm build
  pnpm ui:build
fi

# ── 10. Start ─────────────────────────────────────────────────────────────────
echo "============================================"
echo "==> Starting orchestrator on port ${PORT:-3000}..."
echo "============================================"

if [ "$1" = "--daemon" ] || [ "$2" = "--daemon" ]; then
  # Chạy ngầm bằng pm2
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "==> Installing pm2..."
    sudo npm install -g pm2
  fi
  pm2 start ecosystem.config.cjs
  pm2 save
  # Tự khởi động cùng server (chạy 1 lần)
  pm2 startup 2>/dev/null | grep "sudo" | sh 2>/dev/null || true
  echo "==> Running in background. Commands:"
  echo "    pm2 logs ai-agent-orchestrator   # xem logs"
  echo "    pm2 status                       # xem status"
  echo "    pm2 restart ai-agent-orchestrator"
  echo "    pm2 stop ai-agent-orchestrator"
else
  exec node dist/index.js
fi
