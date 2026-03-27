# ─── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Native build tools required for better-sqlite3 compilation
RUN apk add --no-cache python3 make g++

RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY src/web/client/package.json ./src/web/client/
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Build TypeScript + React ─────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/web/client/node_modules ./src/web/client/node_modules
COPY . .
# Build backend (tsup)
RUN pnpm build
# Build React frontend → public-dist/
RUN pnpm ui:build

# ─── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install git, openssh, and glab CLI (glab is in Alpine community repo)
RUN apk add --no-cache git openssh-client glab \
  && glab version

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Copy React build output (built by Vite to public-dist/)
COPY --from=builder /app/public-dist ./dist/public-dist
# claude-config/ contains CLAUDE.md + skills + settings.json
# mounted as /workspace/.claude via docker-compose volume; also bundled here as fallback
COPY --from=builder /app/claude-config ./claude-config

# Copy startup script
COPY scripts/setup-glab.sh /app/scripts/setup-glab.sh
RUN chmod +x /app/scripts/setup-glab.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["/app/scripts/setup-glab.sh"]
