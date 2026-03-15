# Improvement Plan: AI Agent Coding Orchestrator

**Ngày phân tích**: 2026-03-12
**Nguồn tham khảo**: `spect-kit/spec-kit/templates/` (spec-kit v2.x từ GitHub)

---

## 1. Tổng quan về spec-kit

Spec-kit là một toolkit mã nguồn mở áp dụng **Spec-Driven Development** — spec trở thành "executable artifacts" thay vì chỉ là tài liệu hướng dẫn. Luồng làm việc chính:

```
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.plan → /speckit.tasks → /speckit.analyze → /speckit.implement
```

Mỗi bước tạo ra một artifact cụ thể trong thư mục `specs/[###-feature-name]/`:

| Artifact | Command | Mô tả |
|----------|---------|-------|
| `constitution.md` | `speckit.constitution` | Nguyên tắc bất biến của dự án |
| `spec.md` | `speckit.specify` | User stories + acceptance criteria (KHÔNG có tech stack) |
| `plan.md` | `speckit.plan` | Tech context + research.md + data-model.md + contracts/ |
| `tasks.md` | `speckit.tasks` | Task list theo user story với ID, parallel markers [P] |
| `checklists/` | `speckit.checklist` | "Unit test cho requirements" |
| Analysis | `speckit.analyze` | Cross-artifact consistency check (READ-ONLY) |

---

## 2. Hiện trạng dự án AI-agent-coding

### Những gì đã có

- `design.md` — thiết kế kiến trúc tổng quan
- `requirement-agent-coding.md` — yêu cầu ban đầu
- `plan/00-overview.md` đến `plan/14-docker-deployment.md` — 15 file plan chi tiết
- Code đã implement một phần trong `src/` (webhook server, Redis queue, state manager, agent runner)

### Những gì còn thiếu so với spec-kit

| Thiếu | Impact |
|-------|--------|
| `constitution.md` | Không có nguyên tắc bất biến → agent dễ drift |
| `spec.md` theo format user-story | Khó validate "done" cho từng feature |
| `tasks.md` với Task IDs + [P] markers | Không track được progress, không biết cái nào parallel |
| `checklists/` | Không có requirements quality gate |
| `research.md` | Các quyết định tech không được document rõ ràng |
| `data-model.md` | Data entities phân tán trong nhiều plan files |
| `contracts/` | API contracts chưa formal |
| `CLAUDE.md` auto-update | Agent context file bị stale |

---

## 3. Phân tích từng template và áp dụng

### 3.1 `constitution-template.md` → Tạo ngay

Template yêu cầu: tên principle, mô tả non-negotiable rules, governance section.

**Constitution cho AI-agent-coding nên có:**

```
I.  Library-First — mỗi component (queue, state, webhook) là module độc lập
II. Webhook Safety — LUÔN validate X-Gitlab-Token trước khi xử lý
III. Stateless Agent — agent runner không giữ state, state thuộc Redis
IV. Graceful Degradation — server HTTP bắt đầu trước Redis connection
V.  Observability — structured logging với correlation ID cho mọi event
VI. Test-First cho business logic — queue, state manager phải có unit test
```

**Action**: Tạo file `.specify/memory/constitution.md` từ template.

---

### 3.2 `spec-template.md` → Refactor requirement-agent-coding.md

Spec-kit tách biệt rõ **WHAT** (spec) vs **HOW** (plan). File `requirement-agent-coding.md` hiện pha trộn cả hai.

**Format cần refactor sang:**

```
## User Story 1 - GitLab MR Trigger (P1) 🎯 MVP
Given: Developer mở MR trên GitLab
When: GitLab gửi webhook event
Then: Orchestrator tạo coding session và assign agent

Independent Test: Gọi webhook endpoint với payload MR → kiểm tra event vào Redis queue

Acceptance Scenarios:
1. Given valid webhook token, When MR opened, Then event enqueued trong 500ms
2. Given invalid token, When webhook received, Then 401 response, nothing enqueued
```

**Cần tách thành 4-5 user stories độc lập:**
- US1: GitLab MR webhook trigger → enqueue event
- US2: Agent runner xử lý coding phase (Phase 1 - Init)
- US3: Agent runner xử lý implement phase (Phase 2 - Code)
- US4: Agent runner xử lý review phase (Phase 3 - Review)
- US5: State persistence + resume sau crash

---

### 3.3 `plan-template.md` → Consolidate 15 plan files

Hiện tại có 15 file plan riêng lẻ. Spec-kit dùng một `plan.md` duy nhất per feature với cấu trúc:

```
## Technical Context       ← tech stack, constraints, performance goals
## Constitution Check      ← gate trước khi code
## Project Structure       ← layout thực tế
## Complexity Tracking     ← justify nếu vi phạm constitution
```

Ngoài ra cần tạo các artifact phụ:
- `research.md` — document tại sao chọn BLPOP thay vì SUBSCRIBE, tại sao Hono không phải Express, etc.
- `data-model.md` — formal entities: `ProjectEvent`, `AgentSession`, `PhaseState`
- `contracts/webhook-api.md` — schema của GitLab webhook payload + response format

**Action**: Merge các plan file vào format spec-kit, giữ nội dung nhưng restructure.

---

### 3.4 `tasks-template.md` → Tạo tasks.md từ plan hiện tại

Đây là gap lớn nhất. Hiện tại không có task list có thể track được.

**Format tasks.md cần theo:**

```markdown
## Phase 1: Setup
- [ ] T001 Initialize TypeScript project với pnpm + tsup
- [ ] T002 [P] Configure ESLint + Prettier
- [ ] T003 [P] Setup Dockerfile và docker-compose.yml

## Phase 2: Foundational (blocks tất cả user stories)
- [ ] T004 Implement config loader với Zod validation (src/config/)
- [ ] T005 [P] Setup Redis client với ioredis (src/queue/redis-client.ts)
- [ ] T006 [P] Setup structured logger với pino (src/utils/logger.ts)
- [ ] T007 Implement EventQueue với BLPOP + ack/nack (src/queue/event-queue.ts)

## Phase 3: US1 - Webhook Trigger (P1) 🎯 MVP
- [ ] T008 [P] [US1] Implement Hono webhook server (src/webhook/server.ts)
- [ ] T009 [P] [US1] Implement X-Gitlab-Token validator (src/webhook/validator.ts)
- [ ] T010 [US1] Implement MR event parser (src/webhook/parsers/mr-event.ts)
- [ ] T011 [US1] Wire webhook → enqueue (src/webhook/handlers/mr-handler.ts)

## Phase 4: US2 - Agent Runner (P2)
- [ ] T012 [P] [US2] Deploy Claude skills templates (src/agent/template-deployer.ts)
- [ ] T013 [US2] Implement query() wrapper với error handling (src/agent/runner.ts)
- [ ] T014 [US2] Handle agent result + cost tracking

...
```

**Parallel opportunities trong dự án này:**
- Config + Redis + Logger setup (T004-T006): tất cả files khác nhau → [P]
- Webhook server + Token validator: độc lập → [P]
- State manager + Queue: độc lập → [P]

---

### 3.5 `agent-file-template.md` → Cập nhật CLAUDE.md

Template này rất quan trọng: nó là "living document" được auto-generate từ tất cả plan.md files. Cấu trúc:

```markdown
# AI Agent Coding Orchestrator - Development Guidelines
## Active Technologies    ← extract từ plan files
## Project Structure      ← actual structure từ plans
## Commands               ← chỉ lệnh cho tech đang dùng
## Code Style             ← language-specific
## Recent Changes         ← 3 features gần nhất
<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
```

**Điểm quan trọng**: Phần giữa markers là manual, phần còn lại được generate lại mỗi khi chạy `speckit.plan`. Dự án hiện tại nên áp dụng pattern này để CLAUDE.md không bị outdated.

---

### 3.6 `checklist-template.md` → Tạo requirements checklists

Spec-kit định nghĩa checklist là **"Unit Tests for Requirements"** — KHÔNG phải test implementation, mà test xem requirements có đủ rõ ràng không.

**Checklists cần tạo cho dự án này:**

**`security.md`** — kiểm tra requirements về security:
- Có spec định nghĩa cách rotate GitLab webhook token không? [Gap]
- Có định nghĩa rate limiting cho webhook endpoint không? [Gap]
- Có spec về secret management (env vars vs secrets manager) không? [Completeness]

**`reliability.md`** — kiểm tra requirements về độ tin cậy:
- Có spec về behavior khi Redis bị disconnect không? [Gap]
- Có định nghĩa dead-letter queue behavior không? [Completeness]
- Có spec về agent timeout handling không? [Gap]

**`integration.md`** — kiểm tra requirements về integration:
- Có spec định nghĩa GitLab webhook payload format cụ thể không? [Completeness]
- Có spec về Claude SDK version compatibility không? [Gap]

---

### 3.7 `commands/analyze.md` → Cross-artifact consistency

Sau khi có spec.md + plan.md + tasks.md, chạy analyze để phát hiện:
- Requirements không có tasks coverage
- Tasks không map được về requirement nào
- Terminology drift giữa các files

**Pattern phát hiện trong dự án hiện tại:**
- `design.md` dùng "orchestrator" nhưng plan files dùng "coordinator" và "manager" lẫn lộn
- `requirement-agent-coding.md` mention "phase" nhưng không define rõ số lượng phases
- Không có formal acceptance criteria nào

---

## 4. Plan cập nhật Implementation

### Bước 1: Tạo Constitution (1-2 giờ)

```
specs/
└── memory/
    └── constitution.md    ← tạo từ constitution-template.md
```

Điền các nguyên tắc cốt lõi đã identify ở mục 3.1.

### Bước 2: Tạo Formal Spec (2-3 giờ)

```
specs/
└── 001-orchestrator-core/
    └── spec.md            ← refactor từ requirement-agent-coding.md
```

Tách thành 5 user stories với acceptance scenarios đo lường được.

### Bước 3: Tạo Plan theo spec-kit format (2-3 giờ)

```
specs/001-orchestrator-core/
├── plan.md               ← merge 15 plan files hiện tại
├── research.md           ← document tech decisions (Hono, BLPOP, ioredis)
├── data-model.md         ← ProjectEvent, AgentSession, PhaseState entities
└── contracts/
    ├── webhook-api.md    ← GitLab webhook payload schema
    └── agent-protocol.md ← Claude SDK query() interface
```

### Bước 4: Tạo tasks.md (1-2 giờ)

```
specs/001-orchestrator-core/
└── tasks.md              ← task breakdown với IDs và [P] markers
```

Từ plan hiện tại, estimate ~60-80 tasks total. Parallel opportunities chủ yếu trong Phase 2 (config + logger + redis) và Phase 3 (webhook server + validator).

### Bước 5: Tạo Checklists (1 giờ)

```
specs/001-orchestrator-core/
└── checklists/
    ├── security.md
    ├── reliability.md
    └── integration.md
```

### Bước 6: Cập nhật CLAUDE.md

Rebuild `CLAUDE.md` theo `agent-file-template.md` format với:
- Tech stack chính xác từ plan
- Actual project structure
- Chỉ commands đang dùng (pnpm, tsx, ioredis, hono)
- Recent changes section

### Bước 7: Chạy Analyze + Fix

Sau khi có đủ artifacts, chạy cross-artifact analysis để phát hiện gaps trước khi tiếp tục implementation.

---

## 5. Thứ tự ưu tiên

```
P1 (ngay): constitution.md + tasks.md        ← unblock implementation tracking
P2 (ngắn): spec.md refactor + checklists     ← quality gates
P3 (sau):  research.md + data-model.md       ← documentation
P4 (cuối): analyze + CLAUDE.md rebuild       ← maintenance
```

**Lý do P1 là constitution + tasks:**
- `constitution.md` giúp agent không drift khi implement
- `tasks.md` với IDs giúp track progress và biết cái nào chạy song song được ngay

---

## 6. Điểm khác biệt quan trọng so với cách làm hiện tại

| Hiện tại | Với spec-kit |
|----------|-------------|
| 15 plan files riêng lẻ | 1 `plan.md` + separate artifacts |
| Requirements và tech details trộn lẫn | Spec = WHAT, Plan = HOW tách biệt |
| CLAUDE.md static | CLAUDE.md auto-regenerate từ plan |
| Không có task IDs | Task IDs (T001, T002) + parallel markers [P] |
| Không có quality gates | Checklists là "unit tests for requirements" |
| Tech decisions chưa documented | `research.md` document mọi quyết định |
| Không có formal API contracts | `contracts/` folder với schemas |

---

## 7. Ghi chú về Extension Hooks

Spec-kit hỗ trợ `.specify/extensions.yml` với hooks:
- `before_tasks`, `after_tasks`
- `before_implement`, `after_implement`

Với dự án AI-agent-coding, có thể dùng hooks để:
- `before_implement`: chạy `speckit.analyze` tự động
- `after_implement`: chạy linter + type check
- `after_tasks`: tạo GitHub issues tự động via `speckit.taskstoissues`
