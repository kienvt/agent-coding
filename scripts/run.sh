#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  AI Agent Orchestrator — deployment management script
#
#  Usage: ./scripts/run.sh <command> [args]
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${BLUE}==>${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*" >&2; }
header(){ echo -e "\n${BOLD}$*${NC}"; }

# ── Preflight checks ──────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    error "Docker not found. Install Docker Desktop or Docker Engine first."
    exit 1
  fi
  if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose v2 not found. Update Docker to a recent version."
    exit 1
  fi
}

check_env() {
  if [ ! -f "$ROOT_DIR/.env" ]; then
    warn ".env file not found."
    if [ -f "$ROOT_DIR/.env.example" ]; then
      cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
      warn "Created .env from .env.example — edit it with your credentials, then re-run."
    else
      error ".env.example also missing. Cannot continue."
    fi
    exit 1
  fi
}

# ── Commands ──────────────────────────────────────────────────────

cmd_deploy() {
  check_env
  header "Deploying AI Agent Orchestrator"
  log "Building image and starting services..."
  docker compose up -d --build
  echo ""
  ok "Deploy complete"
  ok "Web UI   → http://localhost:3000"
  ok "Health   → http://localhost:3000/health"
  echo ""
  warn "First time? Open the Web UI and configure GitLab credentials + project repositories."
}

cmd_start() {
  check_env
  log "Starting services (using existing image)..."
  docker compose up -d
  ok "Services started → http://localhost:3000"
}

cmd_stop() {
  log "Stopping services..."
  docker compose down
  ok "Services stopped"
}

cmd_restart() {
  log "Restarting services..."
  docker compose restart
  ok "Services restarted"
}

cmd_build() {
  log "Building Docker image (no cache)..."
  docker compose build --no-cache
  ok "Build complete"
}

cmd_update() {
  check_env
  header "Updating AI Agent Orchestrator"
  log "Pulling latest code..."
  git pull
  log "Rebuilding image and restarting..."
  docker compose up -d --build
  ok "Update complete → http://localhost:3000"
}

cmd_logs() {
  local service="${1:-orchestrator}"
  log "Streaming logs for: $service (Ctrl+C to stop)"
  docker compose logs -f --tail=100 "$service"
}

cmd_status() {
  header "Container Status"
  docker compose ps
  echo ""
  log "Health endpoint:"
  if curl -sf http://localhost:3000/health 2>/dev/null | python3 -m json.tool 2>/dev/null; then
    true
  else
    warn "Cannot reach http://localhost:3000/health — is the container running?"
  fi
}

cmd_shell() {
  local service="${1:-orchestrator}"
  log "Opening shell in $service..."
  docker compose exec "$service" sh
}

cmd_reset() {
  header "Reset All Data"
  warn "This will permanently delete:"
  warn "  • SQLite database (all project state + history)"
  warn "  • config.yaml (GitLab credentials + project config)"
  warn "  • Application logs"
  warn "  • Redis queue data"
  echo ""
  read -r -p "Type 'yes' to confirm: " confirm
  if [ "$confirm" = "yes" ]; then
    docker compose down -v
    ok "All volumes cleared. Next start will be a fresh install."
  else
    log "Cancelled — nothing was deleted."
  fi
}

cmd_help() {
  echo ""
  echo -e "${BOLD}AI Agent Orchestrator — run.sh${NC}"
  echo ""
  echo -e "  ${BOLD}Usage:${NC} ./scripts/run.sh <command> [args]"
  echo ""
  echo -e "  ${BOLD}Deployment:${NC}"
  echo "    deploy          Build image + start all services (use for first deploy or after code changes)"
  echo "    start           Start services using existing image (faster, no rebuild)"
  echo "    stop            Stop all services"
  echo "    restart         Restart all services without rebuilding"
  echo "    build           Build Docker image only (no-cache)"
  echo "    update          git pull + rebuild + restart"
  echo ""
  echo -e "  ${BOLD}Operations:${NC}"
  echo "    logs [service]  Tail container logs (default: orchestrator)"
  echo "    status          Show container status + health check"
  echo "    shell [service] Open shell inside a container (default: orchestrator)"
  echo "    reset           Stop all services and DELETE all persistent data"
  echo ""
  echo -e "  ${BOLD}Examples:${NC}"
  echo "    ./scripts/run.sh deploy          # first time setup"
  echo "    ./scripts/run.sh update          # deploy new version"
  echo "    ./scripts/run.sh logs            # watch orchestrator logs"
  echo "    ./scripts/run.sh logs redis      # watch redis logs"
  echo "    ./scripts/run.sh shell           # debug inside container"
  echo ""
}

# ── Entry point ───────────────────────────────────────────────────
COMMAND="${1:-help}"
shift || true

check_docker

case "$COMMAND" in
  deploy)           cmd_deploy ;;
  start)            cmd_start ;;
  stop)             cmd_stop ;;
  restart)          cmd_restart ;;
  build)            cmd_build ;;
  update)           cmd_update ;;
  logs)             cmd_logs "${1:-}" ;;
  status)           cmd_status ;;
  shell)            cmd_shell "${1:-}" ;;
  reset)            cmd_reset ;;
  help|--help|-h)   cmd_help ;;
  *)
    error "Unknown command: $COMMAND"
    cmd_help
    exit 1
    ;;
esac
