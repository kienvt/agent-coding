# T01 — Project Setup

> **Phụ thuộc:** Không có
> **Output:** Project TypeScript với đầy đủ cấu trúc thư mục, configs, dependencies

---

## Mục tiêu

Khởi tạo Node.js + TypeScript project dùng pnpm. Cài đặt tất cả dependencies cần thiết.

---

## Dependencies cần cài

**Runtime:**
- `hono` + `@hono/node-server` — webhook server
- `@anthropic-ai/claude-code` — Claude Agent SDK
- `ioredis` — Redis client
- `js-yaml` — đọc config.yaml
- `pino` + `pino-pretty` — logging
- `zod` — config validation

**Dev:**
- `typescript`, `tsx`, `tsup` — build tools
- `@types/node`, `@types/js-yaml`

---

## Các bước

### Bước 1: Init project
- `pnpm init`
- Tạo cấu trúc thư mục theo overview (src/, .claude/skills/)

### Bước 2: tsconfig.json
- Target: `ES2022`, module: `NodeNext`
- strict mode bật, rootDir: `src/`, outDir: `dist/`

### Bước 3: package.json scripts
- `dev`: tsx watch
- `build`: tsup
- `start`: node dist/index.js
- `typecheck`: tsc --noEmit

### Bước 4: Tạo .env.example
```
GITLAB_URL=https://gitlab.company.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_BOT_USERNAME=ai-agent
WEBHOOK_SECRET=your-secret
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
REDIS_URL=redis://localhost:6379
WORKSPACE_PATH=/workspace
PORT=3000
LOG_LEVEL=info
NODE_ENV=production
```

### Bước 5: Tạo config.example.yaml
Nội dung theo design.md section 8.2:
- `gitlab.url`, `gitlab.token`, `gitlab.webhook_secret`
- `repositories[]` — mỗi repo có `name`, `gitlab_project_id`, `local_path`, `type`, `tags`
- `agent.model`, `agent.max_retries`, `agent.mockup.*`
- `workflow.*` — branch prefix, labels, target branch

### Bước 6: .gitignore
- `node_modules/`, `dist/`, `.env`, `config.yaml`, `workspace/`

### Bước 7: Entry point skeleton
`src/index.ts` — chỉ cần import config, khởi động server, start consumer loop

---

## Acceptance Criteria

- [ ] `pnpm install` không có lỗi
- [ ] `pnpm typecheck` pass
- [ ] Cấu trúc thư mục đúng với overview
- [ ] `.env.example` và `config.example.yaml` có đủ tất cả fields
