#!/bin/sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── 1. Redis via Docker ──────────────────────────────────────────────────────
echo "==> Starting Redis..."
docker compose up -d redis
# Wait until Redis is healthy
for i in $(seq 1 20); do
  if docker compose exec redis redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "==> Redis ready"
    break
  fi
  sleep 1
done

# ── 2. Build (nếu dist/ chưa có hoặc truyền --build) ─────────────────────────
if [ "$1" = "--build" ] || [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
  echo "==> Building..."
  pnpm build
  pnpm ui:build
fi

# ── 3. Start orchestrator ────────────────────────────────────────────────────
echo "==> Starting orchestrator on port ${PORT:-3000}..."
exec node dist/index.js
