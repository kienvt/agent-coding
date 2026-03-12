# ─── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Build TypeScript ─────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ─── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install git, openssh, and glab CLI
ARG GLAB_VERSION=1.48.0
RUN apk add --no-cache git openssh-client wget ca-certificates \
  && wget -qO /tmp/glab.tar.gz \
       "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_Linux_x86_64.tar.gz" \
  && tar -xzf /tmp/glab.tar.gz -C /usr/local/bin glab \
  && rm /tmp/glab.tar.gz \
  && chmod +x /usr/local/bin/glab \
  && glab version

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
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
