# T09 — Orchestrator

> **Phụ thuộc:** T05, T06, T07
> **Output:** `src/orchestrator/index.ts`

---

## Mục tiêu

Trung tâm điều phối: consume events từ Redis queue, dispatch đến đúng phase handler, manage state transitions. Orchestrator **không** làm việc với GitLab trực tiếp — chỉ invoke agent với prompt phù hợp.

---

## Key Interface

```typescript
// Event dispatch map
interface PhaseHandlers {
  REQUIREMENT_PUSHED: (event: RequirementPushedEvent) => Promise<void>
  ISSUE_COMMENT:      (event: IssueCommentEvent) => Promise<void>
  MR_REVIEW:          (event: MRReviewEvent) => Promise<void>
  MR_MERGED:          (event: MRMergedEvent) => Promise<void>
  TRIGGER_PHASE:      (event: TriggerPhaseEvent) => Promise<void>
}
```

---

## Các bước

### Bước 1: Consumer loop (`src/orchestrator/index.ts`)

Main loop:
```
while (true):
  event = await eventQueue.dequeue(timeout=30)
  if no event: continue
  try:
    await dispatch(event)
    await eventQueue.ack(event.id)
  catch error:
    log error
    await eventQueue.nack(event, reason)
    await notifyError(event, error)  // gọi agent để post error comment via glab
```

### Bước 2: Event dispatch

Routing theo `event.type`:
- `REQUIREMENT_PUSHED` → Phase 1 coordinator (nếu phase là `IDLE`)
- `ISSUE_COMMENT`:
  - Parse body: nếu chứa "approve" và phase là `AWAITING_REVIEW` → start Phase 2
  - Nếu phase là `IMPLEMENTING` → gọi agent xử lý feedback
- `MR_REVIEW`:
  - `approved` + phase `AWAITING_MR_REVIEW` → Phase 4 (merge)
  - `changes_requested` + phase `AWAITING_MR_REVIEW` → xử lý review comments
- `MR_MERGED` → Phase 4 cleanup
- `TRIGGER_PHASE` → force trigger phase bất kỳ (dùng cho testing/manual)

### Bước 3: Repo resolution
- Từ `event.projectId` → tìm `RepositoryConfig` trong config
- Xác định `local_path` (absolute) để truyền vào agent `cwd`
- Nếu không tìm thấy repo → log warning, skip event

### Bước 4: Error notification
- Khi event processing fail, invoke agent với prompt ngắn:
  > "Post a comment on GitLab issue/MR with error details: {error message}"
- Agent sẽ dùng `glab issue note` hoặc `glab mr note` để notify user

### Bước 5: Startup sequence (`src/index.ts`)
1. `loadConfig()`
2. Kết nối Redis (getRedis())
3. Khởi động webhook server (serve app on PORT)
4. Setup glab auth:
   - Spawn `glab auth login --stdin` với `GITLAB_TOKEN`
   - `glab config set host {GITLAB_URL}`
5. Start consumer loop (orchestrator)

---

## Acceptance Criteria

- [ ] Consumer loop chạy vô hạn, không crash khi 1 event fail
- [ ] Event được ack sau khi xử lý thành công
- [ ] Event được nack và move sang dead-letter khi fail
- [ ] `ISSUE_COMMENT` với body "approve" → trigger Phase 2 đúng lúc
- [ ] Error notification được post lên GitLab (agent dùng glab)
- [ ] glab được authenticate khi startup trước khi consumer loop bắt đầu
