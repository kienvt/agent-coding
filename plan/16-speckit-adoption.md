# Plan 16: Spec-Kit Adoption

**Ngày tạo**: 2026-03-13
**Dựa trên**: `improve.md` (phân tích ngày 2026-03-12)
**Mục tiêu**: Áp dụng Spec-Driven Development via spec-kit cho dự án AI-agent-coding

---

## Hiện trạng thực tế

### Code đã implement (DONE)

| Module | Files | Trạng thái |
|--------|-------|-----------|
| Entry | `src/index.ts` | ✅ HTTP-first startup + graceful shutdown |
| Config | `src/config/index.ts`, `schema.ts` | ✅ Zod validation, singleton |
| Queue | `src/queue/event-queue.ts`, `redis.ts`, `types.ts` | ✅ BLPOP + ack/nack |
| State | `src/state/manager.ts`, `types.ts` | ✅ Redis-persisted, 7-day TTL |
| Utils | `src/utils/logger.ts`, `errors.ts`, `retry.ts` | ✅ pino structured logging |
| Webhook | `src/webhook/server.ts` + handlers (mr/note/push) | ✅ Hono + X-Gitlab-Token |
| Orchestrator | `src/orchestrator/index.ts` + phase1-4 | ✅ Event dispatch loop |
| Agent Runner | `src/agent/runner.ts` | ✅ Claude SDK query() + deployClaudeConfig |
| Claude Skills | `claude-config/skills/` (4 skills) | ✅ commit, create-issues, create-mr, review-comments |

### Những gì còn thiếu

| Loại | Thiếu | Impact |
|------|-------|--------|
| **Tests** | Zero test files | Không có safety net khi refactor |
| **Spec-kit artifacts** | `specs/` directory không tồn tại | Agent drift khi implement thêm |
| **CLAUDE.md** | `claude-config/CLAUDE.md` có thể stale | Agent thiếu context |
| **Error recovery** | Phase transitions không có rollback | Crash mid-phase → stuck state |

---

## Phạm vi công việc

Plan này **chỉ tập trung vào spec-kit adoption** — tạo documentation artifacts theo spec-kit format. Code implementation (tests, web UI, error recovery) là plan riêng.

---

## Bước 1: Setup directory structure

Tạo cấu trúc thư mục spec-kit:

```
.specify/
└── memory/
    └── constitution.md      ← nguyên tắc bất biến

specs/
└── 001-orchestrator-core/
    ├── spec.md              ← WHAT (user stories)
    ├── plan.md              ← HOW (tech decisions)
    ├── tasks.md             ← task list với IDs + [P] markers
    ├── research.md          ← tech decision rationale
    ├── data-model.md        ← formal entities
    └── checklists/
        ├── requirements.md  ← auto-generated bởi speckit.specify
        ├── security.md
        ├── reliability.md
        └── integration.md
```

**Action**: `mkdir -p .specify/memory specs/001-orchestrator-core/checklists`

---

## Bước 2: Tạo constitution.md

**File**: `.specify/memory/constitution.md`
**Dựa trên**: `constitution-template.md` + các nguyên tắc đã implicit trong code

**6 nguyên tắc cần điền:**

```
I.   Module-First
     Mỗi component (queue, state, webhook, agent) là module độc lập,
     có interface riêng, testable independently.
     → Hiện tại: src/queue/, src/state/, src/webhook/ đã tách tốt ✅

II.  Webhook Safety (NON-NEGOTIABLE)
     LUÔN validate X-Gitlab-Token trước khi xử lý bất kỳ webhook nào.
     Token invalid = 401, không enqueue, không log payload.
     → Hiện tại: src/webhook/server.ts đã implement ✅

III. Stateless Agent
     AgentRunner không giữ state giữa các lần chạy.
     State thuộc StateManager (Redis). Agent chỉ nhận prompt + trả kết quả.
     → Hiện tại: src/agent/runner.ts đúng pattern ✅

IV.  HTTP-First Startup
     HTTP server khởi động TRƯỚC khi kết nối Redis/external services.
     Health check phải trả về 200 ngay lập tức.
     → Hiện tại: src/index.ts thứ tự đúng ✅

V.   Observability
     Mọi event phải có structured log với correlation ID (eventId + projectId).
     Agent cost phải được log sau mỗi run.
     → Hiện tại: pino logger đã có, eventId tracking ✅

VI.  Test-First cho business logic
     Queue và StateManager PHẢI có unit tests trước khi thêm logic mới.
     Agent runner PHẢI có integration test với mock SDK.
     → Hiện tại: KHÔNG có tests ❌ (gap cần address)
```

**Governance**: Constitution supersedes mọi plan file. Sửa đổi phải increment version.

---

## Bước 3: Tạo spec.md (WHAT)

**File**: `specs/001-orchestrator-core/spec.md`
**Nguồn**: Refactor từ `requirement-agent-coding.md`, LOẠI BỎ tech details

**5 User Stories cần viết:**

### US1 — GitLab MR Trigger (P1) 🎯 MVP
```
Given: Developer push code lên GitLab và mở Merge Request
When: GitLab gửi webhook event đến orchestrator
Then: Hệ thống tạo coding session và bắt đầu xử lý

Independent Test: POST webhook với MR payload → kiểm tra event được nhận và xử lý

Acceptance Scenarios:
1. Given valid token + MR opened event, When webhook received,
   Then event được xử lý trong 500ms
2. Given invalid token, When webhook received, Then 401 response
3. Given duplicate MR event, When same projectId đã có active session,
   Then event bị bỏ qua với warning log
```

### US2 — Agent Analyze & Plan (P1) 🎯 MVP
```
Given: MR event đã được nhận
When: Orchestrator chạy Phase 1 (Init)
Then: Agent đọc requirements, tạo plan, post comment lên GitLab issue

Independent Test: Trigger Phase 1 với mock repo → kiểm tra comment xuất hiện trên issue

Acceptance Scenarios:
1. Given valid repo + requirements file, When Phase 1 runs,
   Then agent posts plan comment trong 5 phút
2. Given agent timeout, When Phase 1 exceeds max_turns,
   Then error comment được post và state = ERROR
3. Given human feedback "approve" comment, When Phase 1 awaiting review,
   Then Phase 2 được trigger tự động
```

### US3 — Agent Implement (P2)
```
Given: Plan đã được human approve
When: Orchestrator chạy Phase 2 (Implement)
Then: Agent viết code, commit, push branch, tạo MR

Independent Test: Trigger Phase 2 với empty repo + spec → kiểm tra MR được tạo

Acceptance Scenarios:
1. Given approved plan, When Phase 2 runs,
   Then agent creates feature branch, commits code, opens MR
2. Given implementation error, When agent fails a subtask,
   Then agent tự retry tối đa 3 lần trước khi báo lỗi
3. Given human comment during Phase 2, When ISSUE_COMMENT event,
   Then agent nhận context và tiếp tục
```

### US4 — Agent Review & Merge (P2)
```
Given: MR đã được tạo
When: Orchestrator chạy Phase 3 (Review)
Then: Agent review code, fix comments, approve/merge MR

Acceptance Scenarios:
1. Given MR với review comments, When Phase 3 runs,
   Then agent addresses all comments và mark resolved
2. Given MR approved by human, When MR_REVIEW event với approved status,
   Then Phase 4 (Done) được trigger
```

### US5 — State Persistence & Recovery (P3)
```
Given: Orchestrator crash giữa chừng
When: Service restart
Then: Active sessions resume từ đúng phase, không mất progress

Acceptance Scenarios:
1. Given crash during Phase 2, When restart, Then resume Phase 2 từ checkpoint
2. Given Redis disconnect, When reconnect, Then pending events được reprocess
3. Given event stuck in queue > 1 giờ, When TTL expires, Then move to dead-letter
```

---

## Bước 4: Tạo plan.md (HOW)

**File**: `specs/001-orchestrator-core/plan.md`
**Nguồn**: Consolidate từ `plan/00-overview.md` đến `plan/15-web-ui.md`

**Cấu trúc:**

```markdown
## Technical Context
- Runtime: Node.js 22 + TypeScript 5.8
- Framework: Hono 4.x (webhook server) — chọn vì lightweight, type-safe
- Queue: Redis + ioredis v5 + BLPOP pattern — chọn vì reliable, no polling overhead
- Agent SDK: @anthropic-ai/claude-agent-sdk query() function
- Auth: X-Gitlab-Token header validation
- Config: Zod schema + YAML file

## Constitution Check (gate trước khi code thêm)
- [ ] Module-First: feature mới có tách module không?
- [ ] Webhook Safety: có validate token ở entry point không?
- [ ] Stateless Agent: feature mới có để agent giữ state không?
- [ ] Test-First: có test trước khi implement không?

## Project Structure (thực tế)
src/
├── index.ts          — startup sequence
├── config/           — Zod config loader
├── queue/            — Redis BLPOP event queue
├── state/            — Redis state manager
├── utils/            — logger, errors, retry
├── webhook/          — Hono server + GitLab handlers
├── orchestrator/     — phase1-4 dispatch loop
└── agent/            — Claude SDK runner

## Complexity Tracking
- Phase 2 (implement loop): stateful loop với re-entrant support → justified bởi US3 requirement
- deployClaudeConfig: side effect trong AgentRunner → justified bởi isolation requirement
```

---

## Bước 5: Tạo research.md

**File**: `specs/001-orchestrator-core/research.md`
**Mục đích**: Document lý do chọn các tech decisions

**Nội dung cần viết:**

| Decision | Chosen | Alternatives Rejected | Reason |
|----------|--------|-----------------------|--------|
| Queue mechanism | Redis BLPOP | - Bull/BullMQ<br>- RabbitMQ<br>- Redis SUBSCRIBE | BLPOP: simple, reliable, no extra deps. Bull: overkill for single worker. SUBSCRIBE: no persistence. |
| HTTP framework | Hono | - Express<br>- Fastify | Hono: type-safe, Cloudflare-compatible, minimal. Express: no native TS. Fastify: more complex setup. |
| Redis client | ioredis v5 | - node-redis<br>- ioredis v4 | ioredis v5: named exports, better TypeScript, auto-reconnect built-in. |
| Config format | YAML + Zod | - env vars only<br>- JSON | YAML: human-readable, supports multi-repo config. Zod: runtime validation + TypeScript types. |
| Agent isolation | Docker volume mount | - process.env CLAUDE_CONFIG_DIR | Volume mount: production-grade isolation. Dev fallback via deployClaudeConfig(). |
| State storage | Redis | - PostgreSQL<br>- SQLite | Redis: already in stack, TTL support, fast for phase tracking. No SQL needed for KV state. |

---

## Bước 6: Tạo data-model.md

**File**: `specs/001-orchestrator-core/data-model.md`
**Mục đích**: Formal definition của các entities

**Entities cần document:**

### AgentEvent (union type)
```
Fields: id, type, projectId, timestamp
Subtypes: REQUIREMENT_PUSHED | ISSUE_COMMENT | MR_REVIEW | MR_MERGED | TRIGGER_PHASE
Source: src/queue/types.ts
```

### ProjectState
```
Fields: projectId, repoName, phase, currentIssueIid?, mrIid?,
        lastActivity, errorCount, metadata?
Phase enum: IDLE | AWAITING_REVIEW | IMPLEMENTING | AWAITING_MR_REVIEW |
            MR_CREATED | MR_APPROVED | DONE | ERROR
TTL: 7 days in Redis
Key pattern: "project:state:{projectId}"
Source: src/state/types.ts
```

### AgentRunOptions / AgentRunResult
```
Options: prompt, cwd, allowedTools?, maxTurns?, systemPrompt?, onProgress?
Result: success, output, cost?, durationMs?, turns
Source: src/agent/runner.ts
```

### Config Schema
```
gitlab: { url, webhook_token }
repositories[]: { name, gitlab_project_id, local_path }
redis: { url }
agent: { model, max_retries, timeout_seconds }
Source: src/config/schema.ts
```

---

## Bước 7: Tạo tasks.md

**File**: `specs/001-orchestrator-core/tasks.md`

**Lưu ý**: Phase 1-4 code đã DONE. Tasks list này tập trung vào những gì còn thiếu.

```markdown
## Phase A: Spec-Kit Artifacts (P1 — unblocks everything)
- [ ] A001 Create .specify/memory/constitution.md
- [ ] A002 [P] Create specs/001-orchestrator-core/spec.md
- [ ] A003 [P] Create specs/001-orchestrator-core/research.md
- [ ] A004 Create specs/001-orchestrator-core/plan.md
- [ ] A005 [P] Create specs/001-orchestrator-core/data-model.md
- [ ] A006 [P] Create contracts/webhook-api.md
- [ ] A007 Create specs/001-orchestrator-core/tasks.md (this file)

## Phase B: Quality Gates (P2)
- [ ] B001 [P] Create checklists/security.md
- [ ] B002 [P] Create checklists/reliability.md
- [ ] B003 [P] Create checklists/integration.md
- [ ] B004 Run cross-artifact analysis (speckit.analyze)
- [ ] B005 Update claude-config/CLAUDE.md to agent-file-template format

## Phase C: Tests (P2 — highest code quality ROI)
- [ ] C001 Setup vitest + test infrastructure
- [ ] C002 [P] Unit test: EventQueue (enqueue/dequeue/ack/nack/dead-letter)
- [ ] C003 [P] Unit test: StateManager (init/transition/getState/TTL)
- [ ] C004 [P] Unit test: Webhook token validation
- [ ] C005 Integration test: AgentRunner with mocked query()
- [ ] C006 E2E test: webhook → enqueue → dispatch → phase1

## Phase D: Resilience (P3)
- [ ] D001 Phase state rollback on crash (checkpoint mechanism)
- [ ] D002 Dead-letter queue monitoring endpoint
- [ ] D003 Redis reconnection handling in orchestrator loop
- [ ] D004 Agent timeout per-phase (configurable in schema)

## Phase E: Web UI (P4 — per plan/15-web-ui.md)
- [ ] E001 [P] GET /api/projects endpoint
- [ ] E002 [P] GET /api/projects/:id/state endpoint
- [ ] E003 Minimal dashboard HTML (plan/ui-mockup.html reference)
```

---

## Bước 8: Tạo checklists

### `checklists/security.md`

```markdown
## Security Requirements Checklist

- [ ] Có spec định nghĩa GitLab webhook token rotation policy không?
  → Gap: requirement-agent-coding.md không mention rotation
- [ ] Có rate limiting cho webhook endpoint không?
  → Gap: hiện tại không có rate limiting trong server.ts
- [ ] Secret management: env vars vs secrets manager được document không?
  → Partial: config.yaml dùng env vars nhưng không có secrets management spec
- [ ] Agent prompt injection prevention được spec không?
  → Gap: không có validation trên issue/MR body trước khi inject vào prompt
- [ ] Dead-letter queue access control được define không?
  → Gap: không có auth cho internal endpoints
```

### `checklists/reliability.md`

```markdown
## Reliability Requirements Checklist

- [ ] Behavior khi Redis disconnect mid-processing được spec không?
  → Gap: orchestrator loop có error handling nhưng không có reconnect spec
- [ ] Dead-letter queue retention policy được define không?
  → Partial: TTL mention nhưng không có explicit retention spec
- [ ] Agent timeout per phase được define không?
  → Gap: max_retries trong config nhưng không có per-phase timeout
- [ ] Phase transition rollback khi crash được spec không?
  → Gap: không có checkpoint/rollback mechanism spec
- [ ] Concurrent event processing behavior được define không?
  → Partial: single worker by design nhưng không documented
```

### `checklists/integration.md`

```markdown
## Integration Requirements Checklist

- [ ] GitLab webhook payload format được spec chính xác không?
  → Partial: handlers/mr.ts handle payload nhưng không có formal schema
- [ ] Claude SDK version compatibility được spec không?
  → Gap: package.json có ^0.2.74 nhưng không có compatibility matrix
- [ ] glab CLI commands được test không?
  → Gap: agent dùng glab nhưng không có mock/test
- [ ] Multi-repository config được spec đầy đủ không?
  → Partial: repositories[] array trong schema nhưng concurrent handling chưa spec
- [ ] Docker volume mount contract được document không?
  → Gap: claude-config/ volume mount path assumed nhưng chưa formal
```

---

## Bước 9: Cập nhật CLAUDE.md

**File**: `claude-config/CLAUDE.md`
**Format**: Theo `agent-file-template.md` của spec-kit

**Cấu trúc mới:**

```markdown
# AI Agent Coding Orchestrator

## Active Technologies
- Node.js 22 / TypeScript 5.8
- Hono 4.x (webhook server)
- ioredis v5 (Redis client)
- @anthropic-ai/claude-agent-sdk (query() function)
- pino (structured logging)
- Zod (config validation)
- Docker + docker-compose

## Project Structure
[actual structure từ src/]

## Commands
- Dev: pnpm dev (tsx watch)
- Build: pnpm build (tsup)
- Start: pnpm start (node dist/)
- Type check: pnpm typecheck

## Code Style
- Named exports (không dùng default export)
- Async/await (không dùng callback)
- createLogger('module-name') cho mỗi module
- AgentError cho domain errors

## Recent Changes
[tự update sau mỗi feature]

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
```

---

## Thứ tự thực hiện

```
Tuần 1:
  Day 1-2: Bước 1-3 (setup + constitution + spec.md)
  Day 3-4: Bước 4-6 (plan + research + data-model)
  Day 5:   Bước 7 (tasks.md)

Tuần 2:
  Day 1-2: Bước 8 (checklists + analyze)
  Day 3:   Bước 9 (CLAUDE.md update)
  Day 4-5: Phase C (tests — bắt đầu với EventQueue + StateManager)
```

---

## Câu hỏi cần confirm trước khi bắt đầu

1. **Thư mục `.specify/` hay `specs/`?** — Spec-kit CLI dùng `.specify/`, nhưng có thể đổi thành `specs/` cho readable hơn. Chọn cái nào?

2. **Constitution ngay bây giờ hay spec trước?** — Improve.md ưu tiên constitution trước, nhưng spec.md có value ngay lập tức hơn vì unblock tasks.md.

3. **Tests là P2 hay P3?** — Improve.md không đề cập tests. Nhưng với code hiện tại đã có logic phức tạp, tests là gap nghiêm trọng.

4. **Web UI có trong scope plan này không?** — Plan/15 đã có web UI design. Có muốn include vào tasks.md không?
