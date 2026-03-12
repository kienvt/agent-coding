# AI Agent Coding — Implementation Plan Overview

> **Version:** 2.0 | **Date:** 2026-03-12 | **Source:** [design.md](../design.md)

---

## Kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────┐
│                        GitLab                                │
│    Webhooks ──► Hono Server ──► Redis Queue                 │
└─────────────────────────────────────────────────────────────┘
                                        │
                              Orchestrator (Node.js)
                              State Manager (Redis)
                                        │
                              Claude Agent SDK (query())
                                        │
                    ┌──────────────────────────────────┐
                    │     Claude Code Agent             │
                    │  Built-in Skills:                 │
                    │  • Read / Write / Edit / Glob     │
                    │  • Bash (glab CLI + git)          │
                    │  Custom /Skills:                  │
                    │  • /commit, /create-issues        │
                    │  • /create-mr, /review-comments   │
                    └──────────────────────────────────┘
```

**Nguyên tắc thiết kế:**
- Orchestrator chỉ điều phối (webhook → state → invoke agent), không gọi GitLab API trực tiếp
- Agent tự thực hiện mọi thứ: code, git, glab, file ops — thông qua built-in skills
- `glab` CLI được agent gọi qua Bash skill để tương tác GitLab (tạo issue, MR, comment...)
- Custom `/skills` encapsulate các workflow phức tạp (commit, create-issues, review...)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 + TypeScript |
| Web Framework | Hono (webhook server) |
| AI Agent | Claude Agent SDK (`@anthropic-ai/claude-code`) |
| GitLab CLI | `glab` (thay thế hoàn toàn REST API client) |
| Event Queue | Redis (ioredis) |
| State Store | Redis |
| Package Manager | pnpm |
| Deploy | Docker + docker-compose |

---

## Cấu trúc thư mục

```
ai-agent-coding/
├── src/
│   ├── index.ts                    # Entry point
│   ├── config/
│   │   ├── schema.ts               # Zod schema
│   │   └── index.ts                # Config loader
│   ├── webhook/
│   │   ├── server.ts               # Hono app
│   │   └── handlers/               # push / note / mr handlers
│   ├── queue/
│   │   ├── redis.ts                # Redis connection
│   │   ├── types.ts                # Event type definitions
│   │   └── event-queue.ts          # Enqueue / dequeue
│   ├── state/
│   │   ├── types.ts                # Phase / IssueStatus enums
│   │   └── manager.ts              # State CRUD
│   ├── agent/
│   │   └── runner.ts               # Claude Agent SDK wrapper
│   └── orchestrator/
│       ├── index.ts                # Consumer loop + event dispatch
│       ├── phase1-init.ts          # Phase 1 coordinator
│       ├── phase2-implement.ts     # Phase 2 coordinator
│       ├── phase3-review.ts        # Phase 3 coordinator
│       └── phase4-done.ts          # Phase 4 coordinator
├── .claude/
│   └── skills/                     # Custom Claude Code /skills
│       ├── commit.md               # /commit skill
│       ├── create-issues.md        # /create-issues skill
│       ├── create-mr.md            # /create-mr skill
│       └── review-comments.md      # /review-comments skill
├── config.example.yaml
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

---

## Danh sách Micro Tasks

| # | File | Mô tả | Phụ thuộc |
|---|------|--------|-----------|
| T01 | [01-project-setup.md](./01-project-setup.md) | Init project, cài packages, tsconfig | — |
| T02 | [02-config-loader.md](./02-config-loader.md) | Config loader từ YAML + env vars | T01 |
| T03 | [03-logger-utils.md](./03-logger-utils.md) | Logger, retry, error classes | T01 |
| T04 | [04-redis-queue.md](./04-redis-queue.md) | Redis + Event Queue (enqueue/dequeue) | T02, T03 |
| T05 | [05-state-manager.md](./05-state-manager.md) | State machine (phase + issue tracking) | T04 |
| T06 | [06-webhook-server.md](./06-webhook-server.md) | Hono server + webhook handlers | T04 |
| T07 | [07-agent-runner.md](./07-agent-runner.md) | Claude Agent SDK wrapper | T02, T03 |
| T08 | [08-claude-skills.md](./08-claude-skills.md) | Custom /skills cho các workflow | T07 |
| T09 | [09-orchestrator.md](./09-orchestrator.md) | Consumer loop + event dispatch | T05, T06, T07 |
| T10 | [10-phase1-init.md](./10-phase1-init.md) | Phase 1: analyze + docs + mockup + issues | T08, T09 |
| T11 | [11-phase2-implement.md](./11-phase2-implement.md) | Phase 2: implement issues loop | T08, T09 |
| T12 | [12-phase3-review.md](./12-phase3-review.md) | Phase 3: MR creation + review handling | T08, T09 |
| T13 | [13-phase4-done.md](./13-phase4-done.md) | Phase 4: merge + cleanup + report | T09 |
| T14 | [14-docker-deployment.md](./14-docker-deployment.md) | Dockerfile + docker-compose + env | T13 |

---

## 4 Phases workflow

```
Phase 1 INIT:
  agent: analyze requirement → generate docs → generate mockup → glab issue create (×N) → await approval

Phase 2 IMPLEMENT:
  for each issue:
    agent: git checkout branch → implement code → write tests → git commit → glab issue update

Phase 3 REVIEW:
  agent: glab mr create → await review → glab mr note (feedback addressed) → re-request

Phase 4 DONE:
  agent: glab mr merge → glab issue close (×N) → git branch delete → post report
```

---

## Acceptance Criteria tổng thể

- [ ] Webhook server nhận events từ GitLab và enqueue đúng loại event
- [ ] Push `requirement.md` → tự động trigger Phase 1
- [ ] Phase 1 tạo docs, mockup HTML, và issues trên GitLab qua `glab`
- [ ] User comment "approve" → tự động chạy Phase 2
- [ ] Phase 2 implement từng issue, commit, push theo đúng thứ tự dependency
- [ ] Phase 3 tạo MR và xử lý review comments
- [ ] Phase 4 merge, đóng issues, cleanup, post final report
- [ ] Toàn bộ chạy được trong Docker container
- [ ] `glab` được config đúng với GitLab instance và token
