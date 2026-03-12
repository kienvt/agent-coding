# T04 — Redis Event Queue

> **Phụ thuộc:** T02, T03
> **Output:** `src/queue/redis.ts`, `src/queue/types.ts`, `src/queue/event-queue.ts`

---

## Mục tiêu

Redis connection + FIFO event queue để nhận sự kiện từ webhook và xử lý tuần tự, tránh race condition.

---

## Key Types / Interfaces

```typescript
// src/queue/types.ts

type EventType =
  | 'REQUIREMENT_PUSHED'   // push event với requirement file
  | 'ISSUE_COMMENT'        // user comment trên issue
  | 'MR_REVIEW'            // user approve/request changes MR
  | 'MR_MERGED'            // MR được merge
  | 'TRIGGER_PHASE'        // manual trigger từ /trigger endpoint

interface BaseEvent {
  id: string               // UUID
  type: EventType
  projectId: number        // GitLab project ID
  timestamp: string        // ISO 8601
}

interface RequirementPushedEvent extends BaseEvent {
  type: 'REQUIREMENT_PUSHED'
  commitSha: string
  filePath: string          // path của requirement file
  repositoryName: string
}

interface IssueCommentEvent extends BaseEvent {
  type: 'ISSUE_COMMENT'
  issueIid: number
  noteId: number
  authorUsername: string
  body: string
}

interface MRReviewEvent extends BaseEvent {
  type: 'MR_REVIEW'
  mrIid: number
  action: 'approved' | 'changes_requested' | 'commented'
  authorUsername: string
  body?: string
}

interface MRMergedEvent extends BaseEvent {
  type: 'MR_MERGED'
  mrIid: number
  mergedBy: string
}

interface TriggerPhaseEvent extends BaseEvent {
  type: 'TRIGGER_PHASE'
  phase: 'init' | 'implement' | 'review' | 'done'
}

type AgentEvent =
  | RequirementPushedEvent
  | IssueCommentEvent
  | MRReviewEvent
  | MRMergedEvent
  | TriggerPhaseEvent
```

---

## Các bước

### Bước 1: Redis connection (`src/queue/redis.ts`)
- Singleton Redis instance dùng `ioredis`
- URL từ `REDIS_URL` env var
- Log connect/disconnect/error events
- Export `getRedis()` và `closeRedis()`

### Bước 2: EventQueue class (`src/queue/event-queue.ts`)

**Queue keys:**
- `agent:events` — main FIFO queue (Redis list)
- `agent:processing:{id}` — event đang xử lý (với TTL 1 giờ)
- `agent:dead-letter` — event fail quá nhiều lần

**Methods:**
- `enqueue(event)`: thêm event vào cuối queue, return UUID
- `dequeue(timeout)`: blocking pop từ đầu queue (`BLPOP`), lưu processing key
- `ack(eventId)`: xóa processing key sau khi xử lý thành công
- `nack(event, reason)`: move sang dead-letter queue
- `queueLength()`: return số event đang chờ

### Bước 3: Singleton export
- Export `eventQueue = new EventQueue()` để dùng trong toàn hệ thống

---

## Acceptance Criteria

- [ ] `enqueue` → `dequeue` giữ đúng thứ tự FIFO
- [ ] `dequeue` blocking (không poll liên tục, không burn CPU)
- [ ] `ack` xóa processing key; `nack` move sang dead-letter
- [ ] Khi Redis down → ioredis tự retry kết nối (built-in)
- [ ] Event có UUID unique mỗi lần enqueue
