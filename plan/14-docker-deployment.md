# T14 — Docker Deployment

> **Phụ thuộc:** T13
> **Output:** `Dockerfile`, `docker-compose.yml`, `scripts/setup-glab.sh`

---

## Mục tiêu

Đóng gói toàn bộ hệ thống trong Docker container. Đặc biệt cần cài `glab` CLI và authenticate với GitLab khi container startup.

---

## Các bước

### Bước 1: Dockerfile

Base: `node:22-alpine`

Multi-stage build:
1. **deps stage**: install pnpm, install node_modules
2. **builder stage**: copy code, `pnpm build` (tsup)
3. **runner stage**: production image

Packages cần install trong runner stage:
- `git` — git operations
- `openssh-client` — SSH cho git
- `glab` — GitLab CLI

**Cách install glab trên Alpine:**
```dockerfile
# Download glab binary từ GitHub releases
ARG GLAB_VERSION=1.x.x
RUN wget -qO /tmp/glab.tar.gz \
    "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_Linux_x86_64.tar.gz" \
  && tar -xzf /tmp/glab.tar.gz -C /usr/local/bin glab \
  && rm /tmp/glab.tar.gz \
  && chmod +x /usr/local/bin/glab
```

ENV vars được truyền vào runtime:
- `ANTHROPIC_API_KEY`
- `GITLAB_TOKEN`
- `GITLAB_URL`
- `GITLAB_BOT_USERNAME`
- `WEBHOOK_SECRET`
- `REDIS_URL`
- `WORKSPACE_PATH`

Expose port `3000`.

CMD: `node dist/index.js`

### Bước 2: docker-compose.yml

Services:
- **orchestrator**: image build từ Dockerfile, port 3000, volumes: workspace + config
- **redis**: `redis:7-alpine`, volume redis-data, healthcheck

Volumes:
- `workspace` → bind mount từ `${WORKSPACE_PATH}` host (chứa các git repos)
- `config.yaml` → bind mount readonly
- `logs` → volume cho logs

Network: bridge network `agent-net`

Orchestrator depends_on redis với `condition: service_healthy`.

### Bước 3: `scripts/setup-glab.sh`

Script chạy **trước** khi start Node.js app (thêm vào entrypoint hoặc CMD):
```bash
#!/bin/sh
# Authenticate glab với GITLAB_TOKEN
echo "${GITLAB_TOKEN}" | glab auth login \
  --hostname "${GITLAB_URL}" \
  --stdin \
  --git-protocol https

# Set default host
glab config set host "${GITLAB_URL}"

# Verify auth
glab auth status

# Start app
exec node dist/index.js
```

Dùng script này làm CMD trong Dockerfile: `CMD ["sh", "/app/scripts/setup-glab.sh"]`

### Bước 4: Cài glab cho development (non-Docker)

Thêm vào README.md:
```bash
# macOS
brew install glab

# Configure
glab auth login
glab config set host https://gitlab.company.com
```

### Bước 5: Health check & monitoring endpoints

Server đã có:
- `GET /health` — liveness check
- `GET /status` — readiness + queue length

docker-compose healthcheck:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

---

## Environment Variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `GITLAB_TOKEN` | ✅ | GitLab personal access token (api scope) |
| `GITLAB_URL` | ✅ | Self-hosted GitLab URL |
| `GITLAB_BOT_USERNAME` | ✅ | GitLab username của bot account |
| `WEBHOOK_SECRET` | ✅ | Secret token validate webhook |
| `REDIS_URL` | ✅ | Redis connection string |
| `WORKSPACE_PATH` | ✅ | Absolute path chứa git repos |
| `PORT` | — | Webhook server port (default: 3000) |
| `LOG_LEVEL` | — | pino log level (default: info) |
| `NODE_ENV` | — | production/development |

---

## Acceptance Criteria

- [ ] `docker compose up -d` khởi động thành công
- [ ] `glab auth status` thành công khi container start
- [ ] `/health` endpoint trả 200 sau khi container healthy
- [ ] `workspace` volume mount đúng path, agent có thể đọc/ghi files
- [ ] Redis healthcheck pass trước khi orchestrator start
- [ ] Logs có thể xem qua `docker compose logs -f orchestrator`
- [ ] Restart container → state được preserve (Redis persist qua redis-data volume)
