# T15 — Multi-Repository Support per Project

> **Version:** 1.1 | **Date:** 2026-03-19
> **Mô tả:** Refactor toàn bộ hệ thống từ mô hình 1 project = 1 repository sang 1 project = N repositories. Bao gồm migrate UI từ Vanilla JS sang React + Vite.

---

## Vấn đề hiện tại

`projectId: number` (GitLab integer ID) đang là primary key xuyên suốt toàn bộ hệ thống: config, state, DB, events, queue, API, UI. Điều này khiến một "project" thực tế (có thể gồm frontend + backend + infra) bị buộc phải tách thành nhiều project độc lập, không có sự liên kết hay điều phối chung.

---

## Mục tiêu

- Một project có thể chứa nhiều repositories (frontend, backend, infra, docs...)
- Có thể chỉ định rõ **repo nào chứa requirement/document**, theo **branch** và **path pattern** nào
- Khi requirement thay đổi → tự động trigger đúng project group
- State tracking theo 2 tầng: group-level phase + per-repo phase
- UI migrate từ Vanilla JS → **React + Vite + TypeScript** để dễ maintain
- UI phản ánh đúng cấu trúc multi-repo mới

---

## Data Model mới

### Khái niệm

```
ProjectGroup (projectSlug: string)   ← primary key mới
├── docs_repo: string                ← tên repo chứa requirement
├── docs_branch: string              ← branch cần watch (default: "main")
├── docs_path_pattern: string        ← glob pattern (default: "requirement*")
└── repositories: RepositoryConfig[]
    ├── { name, gitlab_project_id, local_path, type, role: "docs" }
    └── { name, gitlab_project_id, local_path, type, role: "code" }
```

### Config YAML mới

```yaml
# Trước
repositories:
  - name: frontend
    gitlab_project_id: 101
    local_path: /workspace/frontend
    type: frontend

# Sau
projects:
  - id: "bssd-platform"
    name: "BSSD Platform"
    docs_repo: "bssd-docs"
    docs_branch: "main"
    docs_path_pattern: "requirements/**"
    repositories:
      - name: bssd-docs
        gitlab_project_id: 100
        local_path: /workspace/bssd-docs
        type: fullstack
        role: docs
      - name: bssd-backend
        gitlab_project_id: 101
        local_path: /workspace/bssd-backend
        type: backend
        role: code
      - name: bssd-frontend
        gitlab_project_id: 102
        local_path: /workspace/bssd-frontend
        type: frontend
        role: code
```

### State mới (2 tầng)

```
ProjectGroupState  (key: projectSlug)
├── projectSlug: string
├── phase: ProjectPhase        ← phase chung của cả group
├── requirementFile?: string
├── startedAt: string
├── updatedAt: string
└── error?: string

RepoState  (key: projectSlug + repoName)
├── projectSlug: string
├── repoName: string
├── gitlabProjectId: number
├── phase: ProjectPhase        ← phase riêng của repo này
├── issueIids: number[]
├── issueStatuses: Record<number, IssueStatus>
├── currentIssueIid?: number
├── mrIid?: number
└── error?: string
```

---

## Danh sách thay đổi theo layer

### Phase A — Foundation (config + DB + state types)

#### A1. `src/config/schema.ts`

- Thêm `RepositoryRoleSchema = z.enum(['docs', 'code'])`
- Thêm field `role` vào `RepositoryConfigSchema` (default: `'code'`)
- Thêm `ProjectGroupSchema`:
  ```typescript
  const ProjectGroupSchema = z.object({
    id: z.string(),                            // projectSlug
    name: z.string(),
    docs_repo: z.string(),                     // tên repo là docs
    docs_branch: z.string().default('main'),
    docs_path_pattern: z.string().default('requirement*'),
    repositories: z.array(RepositoryConfigSchema),
  })
  ```
- Đổi top-level `ConfigSchema.repositories` → `ConfigSchema.projects: z.array(ProjectGroupSchema)`
- **Backward compat:** Trong `loadConfig`, nếu YAML có `repositories` mà không có `projects` → tự động wrap thành project group singleton

#### A2. `src/config/index.ts`

- `ensureAllReposCloned()`: flatten repos từ tất cả project groups
- `getConfig()` type signature không đổi, nhưng trả về config với `projects` thay vì `repositories`

#### A3. `src/db/index.ts`

Bỏ bảng `project_state`. Thêm 2 bảng mới:

```sql
CREATE TABLE IF NOT EXISTS project_group_state (
  project_slug   TEXT    PRIMARY KEY,
  phase          TEXT    NOT NULL DEFAULT 'IDLE',
  req_file       TEXT,
  error          TEXT,
  started_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_state (
  project_slug   TEXT    NOT NULL,
  repo_name      TEXT    NOT NULL,
  gitlab_proj_id INTEGER NOT NULL,
  phase          TEXT    NOT NULL DEFAULT 'IDLE',
  issue_iids     TEXT    NOT NULL DEFAULT '[]',
  issue_statuses TEXT    NOT NULL DEFAULT '{}',
  current_issue  INTEGER,
  mr_iid         INTEGER,
  error          TEXT,
  started_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (project_slug, repo_name)
);
```

**Migration khi startup:** Nếu bảng `project_state` tồn tại và `project_group_state` chưa có → migrate dữ liệu cũ, map `project_id` sang `project_slug` qua config, rồi drop bảng cũ.

#### A4. `src/state/types.ts`

- Thêm `ProjectGroupState` interface
- Thêm `RepoState` interface
- Giữ `ProjectState` như deprecated alias trong giai đoạn chuyển tiếp

#### A5. `src/state/manager.ts`

Thêm methods mới:

| Method cũ | Method mới |
|-----------|-----------|
| `initProjectState(projectId)` | `initGroupState(slug, reqFile?)` |
| `getProjectState(projectId)` | `getGroupState(slug)` + `getRepoState(slug, repoName)` |
| `transitionPhase(projectId, phase)` | `transitionGroupPhase(slug, phase)` + `transitionRepoPhase(slug, repoName, phase)` |
| `setIssueList(projectId, iids)` | `setIssueList(slug, repoName, iids)` |
| `updateIssueStatus(projectId, iid, status)` | `updateIssueStatus(slug, repoName, iid, status)` |
| `getNextPendingIssue(projectId)` | `getNextPendingIssue(slug, repoName)` |
| `areAllIssuesDone(projectId)` | `areAllIssuesDone(slug, repoName)` |
| `setMR(projectId, mrIid)` | `setMR(slug, repoName, mrIid)` |
| `resetProjectState(projectId)` | `resetGroupState(slug)` (xóa group + tất cả repo states) |

---

### Phase B — Event routing

#### B1. `src/queue/types.ts`

```typescript
// Trước
interface BaseEvent {
  id: string
  type: EventType
  projectId: number      // GitLab int
  timestamp: string
}

// Sau
interface BaseEvent {
  id: string
  type: EventType
  projectSlug: string    // group identity
  timestamp: string
}

// Các event cần gọi GitLab API thêm field:
interface RequirementPushedEvent extends BaseEvent {
  type: 'REQUIREMENT_PUSHED'
  gitlabProjectId: number    // repo nhận push
  commitSha: string
  filePath: string
  repositoryName: string
}

interface IssueCommentEvent extends BaseEvent {
  type: 'ISSUE_COMMENT'
  gitlabProjectId: number    // repo có comment
  issueIid: number
  noteId: number
  authorUsername: string
  body: string
}

interface MRReviewEvent extends BaseEvent {
  type: 'MR_REVIEW'
  gitlabProjectId: number
  mrIid: number
  action: 'approved' | 'changes_requested' | 'commented'
  authorUsername: string
}

interface MRMergedEvent extends BaseEvent {
  type: 'MR_MERGED'
  gitlabProjectId: number
  mrIid: number
  mergedBy: string
}
```

**`EnqueueInput`:** Cập nhật union type theo shapes mới.

#### B2. `src/webhook/resolve.ts` ← **File mới**

```typescript
interface ResolvedRepo {
  projectSlug: string
  repoConfig: RepositoryConfig
  projectGroup: ProjectGroupConfig
  isDocsRepo: boolean
}

export function resolveGitlabProject(
  gitlabProjectId: number,
  config: Config,
): ResolvedRepo | null
```

Logic: duyệt `config.projects`, tìm group có repo với `gitlab_project_id === gitlabProjectId`. Trả về group slug, repo config, và `isDocsRepo = repo.name === group.docs_repo`.

#### B3. `src/webhook/handlers/push.ts`

- Gọi `resolveGitlabProject()` ở đầu handler
- Nếu không resolve được → return (HTTP 200, bỏ qua)
- Nếu `!resolved.isDocsRepo` → bỏ qua (push vào code repo không trigger requirement)
- Thay `REQUIREMENT_PATTERN` hardcode bằng `resolved.projectGroup.docs_path_pattern` (dùng `minimatch`)
- Thay `projectId: number` → `projectSlug: string` + `gitlabProjectId: number` khi enqueue

#### B4. `src/webhook/handlers/note.ts`

- Thêm `resolveGitlabProject()` call
- Enqueue với `projectSlug` + `gitlabProjectId`

#### B5. `src/webhook/handlers/mr.ts`

- Thêm `resolveGitlabProject()` call
- Enqueue với `projectSlug` + `gitlabProjectId`

#### B6. `src/webhook/server.ts`

- Endpoint `POST /trigger`: đổi body từ `project_id: number` → `project_slug: string`
- `GET /status`: iterate `config.projects` thay vì `config.repositories`

---

### Phase C — Orchestrator

#### C1. `src/orchestrator/index.ts`

- Tất cả lookup `config.repositories.find(r => r.gitlab_project_id === event.projectId)` → `config.projects.find(g => g.id === event.projectSlug)`
- `notifyError`: resolve qua `projectSlug`
- `dispatch()`: route events dùng `event.projectSlug`

#### C2. `src/orchestrator/phase1-init.ts`

- Resolve `projectGroup` từ `event.projectSlug`
- Tìm docs repo: `projectGroup.repositories.find(r => r.name === projectGroup.docs_repo)`
- Agent chạy trong **docs repo** (`cwd = docsRepo.local_path`)
- `stateManager.initGroupState(event.projectSlug, event.filePath)`
- Issues tạo ra phải có label `repo:<repoName>` để phase 2 biết route

#### C3. `src/orchestrator/phase2-implement.ts`

`startImplementationLoop(projectSlug: string)`:

1. Lấy danh sách code repos: `projectGroup.repositories.filter(r => r.role === 'code')`
2. Với mỗi pending issue, đọc label `repo:<name>` để xác định target repo
3. Chạy agent với `cwd = targetRepo.local_path`
4. Track state theo `(projectSlug, repoName)`

**Chiến lược triển khai:** Sequential (Option A) trước — một issue tại một thời điểm, xác định repo qua label. Parallel (Option B) để làm sau.

#### C4. `src/orchestrator/phase3-review.ts`

`runPhase3(projectSlug: string)`:

1. Với mỗi code repo có commits trên feature branch → tạo MR riêng
2. `stateManager.setMR(projectSlug, repoName, mrIid)`
3. Group phase chuyển sang `AWAITING_MR_REVIEW` khi **tất cả** code repos đã có MR

#### C5. `src/orchestrator/phase4-done.ts`

`runPhase4(projectSlug: string)`:

1. Merge tất cả MRs của các code repos
2. Close tất cả issues
3. `stateManager.transitionGroupPhase(projectSlug, 'COMPLETE')`

---

### Phase D — Agent runner + Logs + API

#### D1. `src/agent/runner.ts`

- `AgentRunOptions.projectId?: number` → `AgentRunOptions.projectSlug?: string`
- Log store calls dùng `projectSlug`

#### D2. `src/utils/log-store.ts`

- `append(projectId: number, ...)` → `append(projectSlug: string, ...)`
- `query(projectId: number, ...)` → `query(projectSlug: string, ...)`
- `clear(projectId: number)` → `clear(projectSlug: string)`
- DB table `agent_logs`: đổi column `project_id INTEGER` → `project_slug TEXT`

#### D3. `src/web/api/projects.ts`

- Đổi route param `:id` (number) → `:slug` (string)
- `GET /api/projects` → trả về array project groups, mỗi group có sub-array repos:

```json
[
  {
    "slug": "bssd-platform",
    "name": "BSSD Platform",
    "phase": "IMPLEMENTING",
    "repositories": [
      {
        "name": "bssd-docs",
        "role": "docs",
        "gitlab_project_id": 100,
        "phase": "IDLE"
      },
      {
        "name": "bssd-backend",
        "role": "code",
        "gitlab_project_id": 101,
        "phase": "IMPLEMENTING",
        "issues": { "total": 5, "done": 2, "inProgress": 1, "pending": 2 },
        "mrIid": null
      },
      {
        "name": "bssd-frontend",
        "role": "code",
        "gitlab_project_id": 102,
        "phase": "AWAITING_REVIEW",
        "issues": { "total": 3, "done": 3, "inProgress": 0, "pending": 0 },
        "mrIid": 7
      }
    ],
    "lastActivity": "2026-03-19T10:30:00Z",
    "hasError": false
  }
]
```

- `GET /api/projects/:slug` → full group state + per-repo states
- `POST /api/projects/:slug/trigger`
- `DELETE /api/projects/:slug/state`

#### D4. `src/web/api/logs.ts`

- Routes dùng `:slug` thay `:id`
- SSE endpoint: `GET /api/projects/:slug/logs/stream`
- Thêm optional query param `?repo=<repoName>` để filter logs theo repo

#### D5. `src/web/api/config.ts`

- `GET /api/config` trả về `projects[]` thay `repositories[]`
- `PUT /api/config` nhận `projects[]`

#### D6. `src/index.ts`

- `ensureAllReposCloned()`: nhận flatten của tất cả repos từ `config.projects`

---

### Phase E — Migrate UI sang React + Vite

> Thực hiện **trước** Phase F (multi-repo UI) để có nền tảng tốt hơn.
> UI cũ (Vanilla JS) sẽ bị xóa hoàn toàn và thay bằng React app.

#### E1. Cấu trúc thư mục mới

```
src/
├── web/
│   ├── client/                     ← React app (mới)
│   │   ├── src/
│   │   │   ├── main.tsx            ← entry point
│   │   │   ├── App.tsx             ← router + layout
│   │   │   ├── api/
│   │   │   │   └── client.ts       ← typed API client (fetch wrapper)
│   │   │   ├── types/
│   │   │   │   └── index.ts        ← shared types (ProjectGroup, RepoState, ...)
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   └── Topbar.tsx
│   │   │   │   └── ui/
│   │   │   │       ├── Badge.tsx
│   │   │   │       ├── Toast.tsx
│   │   │   │       └── Modal.tsx
│   │   │   └── pages/
│   │   │       ├── Dashboard.tsx
│   │   │       ├── ProjectDetail.tsx
│   │   │       ├── Queue.tsx
│   │   │       └── Settings.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── api/                        ← Hono API routes (không đổi)
│   │   ├── projects.ts
│   │   ├── logs.ts
│   │   ├── config.ts
│   │   └── queue.ts
│   └── static.ts                   ← serve Vite build output
└── ...
```

#### E2. Setup Vite + React

**`src/web/client/package.json`** — dependencies:
```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "typescript": "^5",
    "vite": "^6"
  }
}
```

**`src/web/client/vite.config.ts`:**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../public-dist',   // output ra ngoài để Hono serve
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
```

**`src/web/static.ts`** — update để serve từ `public-dist/` (Vite build output) thay vì `public/` cũ.

**`package.json` gốc** — thêm scripts:
```json
"ui:dev": "vite --config src/web/client/vite.config.ts",
"ui:build": "vite build --config src/web/client/vite.config.ts",
"dev": "concurrently \"npm run ui:build -- --watch\" \"tsx watch src/index.ts\""
```

#### E3. Typed API client (`src/web/client/src/api/client.ts`)

Wrap fetch với đầy đủ TypeScript types, dùng lại types từ backend:

```typescript
// types khớp với response shape từ src/web/api/projects.ts
export interface ProjectGroupSummary {
  slug: string
  name: string
  phase: ProjectPhase
  repositories: RepoSummary[]
  lastActivity: string | null
  hasError: boolean
  error?: string
}

export const apiClient = {
  projects: {
    list: (): Promise<ProjectGroupSummary[]> => get('/api/projects'),
    get: (slug: string): Promise<ProjectGroupDetail> => get(`/api/projects/${slug}`),
    trigger: (slug: string, body: TriggerBody) => post(`/api/projects/${slug}/trigger`, body),
    resetState: (slug: string) => del(`/api/projects/${slug}/state`),
    clearLogs: (slug: string) => del(`/api/projects/${slug}/logs`),
    streamLogs: (slug: string) => new EventSource(`/api/projects/${slug}/logs/stream`),
  },
  config: {
    get: (): Promise<AppConfig> => get('/api/config'),
    update: (partial: Partial<AppConfig>) => put('/api/config', partial),
  },
  queue: {
    get: (): Promise<QueueStatus> => get('/api/queue'),
    clearDeadLetter: () => del('/api/queue/dead-letter'),
  },
}
```

#### E4. Component mapping từ Vanilla JS sang React

| Vanilla JS (cũ) | React component (mới) |
|-----------------|----------------------|
| `renderDashboard()` | `pages/Dashboard.tsx` |
| `projectCard(p)` | `components/ProjectCard.tsx` |
| `renderProject(id, name)` | `pages/ProjectDetail.tsx` |
| `renderPhaseTimeline(phase)` | `components/PhaseTimeline.tsx` |
| `renderIssueTable(state)` | `components/IssueTable.tsx` |
| `startSSE(projectId)` | custom hook `useLogStream(slug)` |
| `renderQueue()` | `pages/Queue.tsx` |
| `renderSettings()` | `pages/Settings.tsx` |
| `renderRepoList()` | `components/RepoList.tsx` |
| `openTriggerModal()` | `components/TriggerModal.tsx` |
| `toast(msg, type)` | `components/ui/Toast.tsx` + context |
| `checkHealth()` | custom hook `useHealth()` |
| global `navigate(page)` | React Router hoặc simple state router |

**Không dùng external router** — dùng `useState` đơn giản cho navigation (SPA nhỏ, 4 pages):
```typescript
// App.tsx
const [page, setPage] = useState<Page>('dashboard')
const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
```

#### E5. Custom hooks

```typescript
// hooks/useLogStream.ts — SSE log streaming
function useLogStream(slug: string | null) {
  const [lines, setLines] = useState<LogEntry[]>([])
  useEffect(() => {
    if (!slug) return
    const es = apiClient.projects.streamLogs(slug)
    es.onmessage = (e) => setLines(prev => [...prev, JSON.parse(e.data)])
    return () => es.close()
  }, [slug])
  return lines
}

// hooks/useHealth.ts — polling health check
function useHealth() {
  const [status, setStatus] = useState<'ok' | 'error'>('ok')
  useEffect(() => {
    const check = () => fetch('/health').then(r => setStatus(r.ok ? 'ok' : 'error')).catch(() => setStatus('error'))
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [])
  return status
}
```

#### E6. Xóa files cũ

Sau khi React app hoạt động đúng:
- Xóa `src/web/public/app.js`
- Xóa `src/web/public/index.html`
- Xóa `src/web/public/style.css`

---

### Phase F — Multi-repo UI (React)

> Chạy sau Phase E. Lúc này đã có React components, dễ implement hơn nhiều.

#### F1. `pages/Dashboard.tsx`

**Trước (Phase E):** Mỗi card = 1 repo
**Sau:** Mỗi card = 1 project group, liệt kê repos bên trong

```
┌─────────────────────────────────────────────┐
│ BSSD Platform                  IMPLEMENTING  │
├─────────────────────────────────────────────┤
│ 📄 bssd-docs      [docs]       IDLE          │
│ ⚙️  bssd-backend  [code]       IMPLEMENTING  │
│ 🖥️  bssd-frontend [code]  MR#7  AWAITING     │
├─────────────────────────────────────────────┤
│ Issues: ████████░░ 5/8                       │
│ [Logs] [⚡ Trigger] [Reset]                  │
└─────────────────────────────────────────────┘
```

- `ProjectCard` nhận `ProjectGroupSummary`, hiển thị sub-list repos
- Issue progress tổng hợp từ tất cả code repos trong group
- Navigate dùng `projectSlug` thay `projectId`

#### F2. `pages/ProjectDetail.tsx`

- Phase timeline ở group level
- Section "Repositories": tabs hoặc accordion, mỗi tab = 1 repo
  - Component `RepoTab`: phase badge, issue table, MR link
- Log terminal: dropdown filter theo `repoName` (hoặc "All repos")
  - SSE endpoint: `/api/projects/:slug/logs/stream?repo=<name>`

#### F3. `components/TriggerModal.tsx`

- Đổi API call dùng `projectSlug`
- Phase `init`: hint text hiển thị tên docs repo
- Ví dụ: `"e.g. requirements/sprint-1.md (in bssd-docs)"`

#### F4. `pages/Settings.tsx` — 2-level project config

```
Projects
├── [+ Add Project]
│
└── BSSD Platform  (bssd-platform)           [Edit] [Delete]
    ├── Docs repo:    bssd-docs
    ├── Branch:       main
    ├── Path pattern: requirements/**
    │
    ├── Repositories:
    │   ├── bssd-docs    [docs]  ID: 100  /workspace/bssd-docs    [Delete]
    │   ├── bssd-backend [code]  ID: 101  /workspace/bssd-backend  [Delete]
    │   └── bssd-frontend [code] ID: 102  /workspace/bssd-frontend [Delete]
    │
    └── [+ Add Repository]
```

Components cần tạo:
- `ProjectGroupForm` — form thêm/sửa project group (slug, name, docs_repo, docs_branch, docs_path_pattern)
- `RepoForm` — form thêm repo vào group (name, gitlab_project_id, local_path, type, role)
- `ProjectGroupItem` — row hiển thị 1 group với accordion repos

#### F5. `pages/Queue.tsx`

- Dead-letter entries: hiển thị `projectSlug` thay số GitLab ID

---

### Phase F — Skills / Templates

#### F1. `src/agent/templates/skills/init-plan.md`

Thêm context về multi-repo:
- Agent biết nó đang chạy trong docs repo
- Issues cần có label `repo:<name>` để phase 2 route đúng
- List code repos trong system prompt để agent biết target repos nào

#### F2. `src/agent/templates/skills/implement-issue.md`

- Thêm `repoName` vào context prompt
- Agent biết repo hiện tại là gì (để commit message, branch name đúng)

---

## Thứ tự implement

```
Phase A: Config schema + DB schema + State types + State manager
         → Không break runtime, chỉ thêm code mới

Phase B: Event types + Webhook resolver + Webhook handlers
         → Sau khi A xong, events bắt đầu dùng projectSlug

Phase C: Orchestrator dispatch + Phase 1-4 handlers
         → Core workflow chuyển sang multi-repo

Phase D: Agent runner + Log store + API endpoints
         → Backend hoàn chỉnh, có thể test via curl

Phase E: Migrate UI sang React + Vite
         → Setup Vite, tạo components, port tính năng cũ sang React
         → Xóa src/web/public/ (Vanilla JS) sau khi xong

Phase F: Multi-repo UI (React)
         → Implement UI mới: project group cards, repo tabs, 2-level settings
         → Dùng lại components từ Phase E

Phase G: Skill templates update
         → Agent có đủ context để hoạt động đúng
```

---

## Files cần thay đổi — Summary

| File | Loại thay đổi | Phase |
|------|--------------|-------|
| `src/config/schema.ts` | Thêm `ProjectGroupSchema`, field `role`, `docs_*` | A |
| `src/config/index.ts` | Flatten repos từ groups, backward compat | A |
| `src/db/index.ts` | Bảng mới + migration | A |
| `src/state/types.ts` | Thêm `ProjectGroupState`, `RepoState` | A |
| `src/state/manager.ts` | Methods mới theo 2 tầng | A |
| `src/queue/types.ts` | `projectId: number` → `projectSlug: string` | B |
| `src/queue/event-queue.ts` | `EnqueueInput` union update | B |
| `src/webhook/resolve.ts` | **File mới** — lookup helper | B |
| `src/webhook/handlers/push.ts` | Dùng resolver, configurable pattern | B |
| `src/webhook/handlers/note.ts` | Dùng resolver, projectSlug | B |
| `src/webhook/handlers/mr.ts` | Dùng resolver, projectSlug | B |
| `src/webhook/server.ts` | /trigger dùng slug, /status iterate projects | B |
| `src/orchestrator/index.ts` | Dispatch theo projectSlug | C |
| `src/orchestrator/phase1-init.ts` | Agent trong docs repo, init group state | C |
| `src/orchestrator/phase2-implement.ts` | Loop qua code repos, route theo issue label | C |
| `src/orchestrator/phase3-review.ts` | MR per code repo | C |
| `src/orchestrator/phase4-done.ts` | Merge all MRs, complete group | C |
| `src/agent/runner.ts` | `projectId` → `projectSlug` | D |
| `src/utils/log-store.ts` | `projectId: number` → `projectSlug: string` | D |
| `src/web/api/projects.ts` | Routes dùng slug, response 2 tầng | D |
| `src/web/api/logs.ts` | Routes dùng slug, filter by repo | D |
| `src/web/api/config.ts` | GET/PUT dùng `projects[]` | D |
| `src/index.ts` | Flatten repos cho ensureAllReposCloned | D |
| `src/web/client/` | **Thư mục mới** — toàn bộ React app | E |
| `src/web/client/vite.config.ts` | **File mới** — Vite config với proxy đến backend | E |
| `src/web/client/src/api/client.ts` | **File mới** — Typed API client thay fetch thuần | E |
| `src/web/client/src/App.tsx` | **File mới** — Root component + simple state router | E |
| `src/web/client/src/pages/Dashboard.tsx` | **File mới** — Port từ `renderDashboard()` | E |
| `src/web/client/src/pages/ProjectDetail.tsx` | **File mới** — Port từ `renderProject()` | E |
| `src/web/client/src/pages/Queue.tsx` | **File mới** — Port từ `renderQueue()` | E |
| `src/web/client/src/pages/Settings.tsx` | **File mới** — Port từ `renderSettings()` | E |
| `src/web/client/src/components/` | **Thư mục mới** — Sidebar, PhaseTimeline, IssueTable, Modal, Toast... | E |
| `src/web/static.ts` | Đổi serve path từ `public/` → `public-dist/` (Vite output) | E |
| `src/web/public/` | **Xóa** — app.js, index.html, style.css (Vanilla JS cũ) | E |
| `src/web/client/src/pages/Dashboard.tsx` | Multi-repo cards với repo sub-list | F |
| `src/web/client/src/pages/ProjectDetail.tsx` | Repo tabs, per-repo issues, log filter by repo | F |
| `src/web/client/src/pages/Settings.tsx` | 2-level project group config | F |
| `src/web/client/src/components/TriggerModal.tsx` | Dùng projectSlug, hint docs repo | F |
| `src/web/client/src/pages/Queue.tsx` | Hiển thị projectSlug thay number ID | F |
| `src/agent/templates/skills/init-plan.md` | Multi-repo context, repo labels | G |
| `src/agent/templates/skills/implement-issue.md` | repoName context | G |

---

## Quyết định thiết kế chính

| Quyết định | Lựa chọn | Lý do |
|-----------|---------|-------|
| Primary key type | `projectSlug: string` | Human-readable, stable, enable multi-repo grouping |
| Docs repo | Designated `docs_repo` field trong config | Tránh false positives khi code repo có file tên requirement |
| Issue-to-repo routing | Label `repo:<name>` trên GitLab issue | Agent-controlled, visible trong GitLab, không cần extra state |
| Implementation mode | Sequential (1 issue tại 1 thời điểm) | Đơn giản hơn, parallel làm follow-up |
| DB migration | Drop old + create new | Local SQLite, không có external consumer |
| Queue structure | Single queue `agent:events` | Đủ cho scale hiện tại |
| Backward compat config | Auto-migrate `repositories[]` → `projects[]` khi load | Không break config cũ |
| UI framework | React + Vite + TypeScript | Component-based, type-safe, dễ maintain hơn Vanilla JS khi UI phức tạp |
| UI routing | Simple `useState` (không dùng React Router) | SPA chỉ có 4 pages, không cần external router |
| Vite build | Output vào `public-dist/`, Hono serve static | Không thêm web server riêng, giữ đơn giản |

---

## Acceptance Criteria

- [ ] Config YAML hỗ trợ `projects[]` với nhiều repos mỗi project
- [ ] Config cũ với `repositories[]` vẫn load được (auto-migrate)
- [ ] Push file match `docs_path_pattern` vào `docs_repo` → trigger `REQUIREMENT_PUSHED`
- [ ] Push vào code repo không trigger gì
- [ ] State tracking hoạt động theo 2 tầng (group + per-repo)
- [ ] Phase 2 route đúng issue đến đúng repo qua label `repo:<name>`
- [ ] Mỗi code repo có MR riêng trong Phase 3
- [ ] API `/api/projects` trả về group structure với per-repo sub-states
- [ ] UI migrate sang React + Vite, build output được Hono serve đúng
- [ ] UI dev mode (`npm run ui:dev`) có hot-reload và proxy đến backend
- [ ] UI dashboard hiển thị project group cards với repos bên trong
- [ ] UI project detail có tabs per-repo với phase, issues, MR riêng
- [ ] UI settings cho phép thêm/xóa project group và repos trong group (2-level)
- [ ] Log streaming hỗ trợ filter theo repo
- [ ] Dead-letter queue hiển thị `projectSlug` thay số GitLab ID
