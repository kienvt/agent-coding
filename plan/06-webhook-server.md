# T06 — Webhook Server

> **Phụ thuộc:** T04
> **Output:** `src/webhook/server.ts`, `src/webhook/handlers/push.ts`, `src/webhook/handlers/note.ts`, `src/webhook/handlers/mr.ts`

---

## Mục tiêu

Hono HTTP server nhận webhook events từ GitLab, validate, parse, và enqueue vào Redis.

---

## Key Types / Interfaces

```typescript
// GitLab webhook payload structure (chỉ cần các fields quan trọng)

interface PushPayload {
  object_kind: 'push'
  project: { id: number; name: string }
  commits: Array<{
    id: string
    added: string[]
    modified: string[]
  }>
}

interface NotePayload {
  object_kind: 'note'
  project: { id: number; name: string }
  user: { username: string }
  object_attributes: {
    noteable_type: 'Issue' | 'MergeRequest'
    noteable_iid: number
    id: number
    body: string
  }
}

interface MRPayload {
  object_kind: 'merge_request'
  project: { id: number; name: string }
  user: { username: string }
  object_attributes: {
    iid: number
    state: string
    action: 'merge' | 'approved' | 'unapproved' | 'changes_requested' | 'open' | 'update'
  }
}
```

---

## Các bước

### Bước 1: Hono server (`src/webhook/server.ts`)

**Endpoints:**
- `GET /health` → `{ status: 'ok', timestamp }`
- `GET /status` → `{ phase, queue_length }` (lấy từ state + redis)
- `POST /webhook` → main webhook receiver
- `POST /trigger` → manual trigger: `{ phase, project_id }`

**Webhook validation:**
- Check header `X-Gitlab-Token` match với `config.gitlab.webhook_secret`
- Trả 401 nếu sai token
- Parse JSON body, route theo `object_kind`

### Bước 2: Push handler (`src/webhook/handlers/push.ts`)
- Scan tất cả `commit.added` + `commit.modified` của mỗi commit
- Nếu tìm thấy file match pattern `requirement*.md` → enqueue `REQUIREMENT_PUSHED`
- Pattern match: case-insensitive, chứa "requirement"

### Bước 3: Note handler (`src/webhook/handlers/note.ts`)
- Bỏ qua nếu `user.username === BOT_USERNAME` (env: `GITLAB_BOT_USERNAME`)
- Nếu `noteable_type === 'Issue'` → enqueue `ISSUE_COMMENT`
- Nếu `noteable_type === 'MergeRequest'` → enqueue `MR_REVIEW` với action `commented`

### Bước 4: MR handler (`src/webhook/handlers/mr.ts`)
- Bỏ qua bot's own actions
- `action === 'merge'` → enqueue `MR_MERGED`
- `action === 'approved'` → enqueue `MR_REVIEW` với action `approved`
- `action === 'changes_requested'` → enqueue `MR_REVIEW` với action `changes_requested`

---

## Acceptance Criteria

- [ ] `GET /health` luôn trả 200, không cần auth
- [ ] `POST /webhook` với token sai → 401
- [ ] Push event với `requirement.md` → enqueue `REQUIREMENT_PUSHED`
- [ ] Note event từ bot → **không** enqueue (tránh infinite loop)
- [ ] MR merged event → enqueue `MR_MERGED`
- [ ] `/trigger` endpoint hoạt động cho manual testing
