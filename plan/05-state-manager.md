# T05 — State Manager

> **Phụ thuộc:** T04
> **Output:** `src/state/types.ts`, `src/state/manager.ts`

---

## Mục tiêu

Theo dõi trạng thái của project (phase hiện tại) và từng issue (status). Persist trong Redis để survive restart.

---

## Key Types / Interfaces

```typescript
// src/state/types.ts

type ProjectPhase =
  | 'IDLE'
  | 'ANALYZING'
  | 'GENERATING_DOCS'
  | 'AWAITING_REVIEW'       // chờ user approve plan
  | 'IMPLEMENTING'          // đang implement issues
  | 'ALL_ISSUES_DONE'
  | 'MR_CREATED'
  | 'AWAITING_MR_REVIEW'    // chờ user review MR
  | 'MERGING'
  | 'COMPLETE'
  | 'ERROR'

type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CLOSED'

interface ProjectState {
  projectId: number
  repositoryName: string
  phase: ProjectPhase
  requirementFile?: string
  currentIssueIid?: number
  mrIid?: number
  issueIids: number[]                       // ordered list (implement order)
  issueStatuses: Record<number, IssueStatus> // iid → status
  startedAt: string
  updatedAt: string
  error?: string
}
```

---

## Các bước

### Bước 1: State types (`src/state/types.ts`)
- Định nghĩa `ProjectPhase` và `IssueStatus` enums
- Định nghĩa `ProjectState` interface

### Bước 2: StateManager class (`src/state/manager.ts`)

**Redis key pattern:** `state:project:{projectId}` với TTL 7 ngày

**Methods:**
- `initProjectState(projectId, repoName, reqFile?)` → tạo state mới, phase: `IDLE`
- `getProjectState(projectId)` → return `ProjectState | null`
- `transitionPhase(projectId, newPhase)` → update + log transition
- `setIssueList(projectId, iids)` → set danh sách issues theo thứ tự
- `updateIssueStatus(projectId, iid, status)` → update 1 issue
- `getNextPendingIssue(projectId)` → return iid của issue `OPEN` tiếp theo (theo thứ tự `issueIids`)
- `areAllIssuesDone(projectId)` → boolean
- `setMR(projectId, mrIid)` → lưu MR IID
- `setError(projectId, message)` → phase → `ERROR`, lưu error message

### Bước 3: Singleton export
- Export `stateManager = new StateManager()`

---

## Acceptance Criteria

- [ ] `transitionPhase` log `{ from, to, projectId }` mỗi lần transition
- [ ] `getNextPendingIssue` trả về đúng issue theo thứ tự `issueIids`, bỏ qua các issue đã DONE
- [ ] `areAllIssuesDone` return `true` khi tất cả DONE hoặc CLOSED
- [ ] State persist sau khi restart (TTL 7 ngày)
- [ ] `initProjectState` không ghi đè state đang có (check trước khi init)
