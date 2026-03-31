# Kế hoạch: Implement Flow v2 (Demo-ready)

**Mục tiêu**: Sửa đúng flow cốt lõi, đủ để demo. Không over-engineer.
**Phức tạp / advanced**: xem `plan-implement-flow-v3.md`

---

## Tổng quan thay đổi

| # | Vấn đề hiện tại | Thay đổi |
|---|-----------------|----------|
| 1 | IMPLEMENTING trigger bằng comment "approve" | Trigger khi docs MR được **approved** |
| 2 | Issue close ngay khi agent xong | Issue chỉ close khi MR của task **merged** |
| 3 | `implement-issue` không tạo MR | Thêm Step 8: tạo MR sau khi implement xong |
| 4 | Tasks chạy tuần tự dùng chung 1 directory | Git worktree per task — workspace sạch |
| 5 | Không có priority ordering | Sắp xếp tasks theo `priority` label |
| 6 | Agent hết token → mất trạng thái | Checkpoint đơn giản: lưu branch, resume được |
| 7 | `mr.ts` vẫn dùng fallback bot username | Require `GITLAB_BOT_USERNAME` như `note.ts` |

---

## Phần 1 — Trigger IMPLEMENTING từ docs MR approved

### Luồng mới

```
User approve docs MR trên GitLab
  → mr.ts enqueue MR_REVIEW { action: 'approved', mrIid }
  → dispatch: mrIid === state.docsMrIid && phase === 'AWAITING_REVIEW'
  → transitionGroupPhase('PLANNING')
  → startPlanningPhase(projectSlug)
```

### Thay đổi

**DB migration** — thêm cột `docs_mr_iid INTEGER` vào `project_group_state`

**`src/state/types.ts`** — thêm field `docsMrIid?: number` vào `ProjectGroupState`

**`src/state/manager.ts`** — thêm method `setDocsMrIid(slug, mrIid)`

**`src/orchestrator/phase1-init.ts`** — sau `agentRunner.run`, parse `MR_IID:` từ output:
```typescript
const mrIid = parseMrIid(result.output)
if (mrIid) await stateManager.setDocsMrIid(event.projectSlug, mrIid)
```

**`src/orchestrator/index.ts`** — sửa `MR_REVIEW` handler:
```typescript
// Docs MR approved → trigger planning
if (e.action === 'approved'
    && state.docsMrIid === e.mrIid
    && state.phase === 'AWAITING_REVIEW') {
  await stateManager.transitionGroupPhase(e.projectSlug, 'PLANNING')
  startPlanningPhase(e.projectSlug).catch(...)
  break
}
// Code MRs (phase 3) — giữ nguyên
if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_CREATED') {
  await handleMRReviewEvent(e)
}
```

**`src/orchestrator/index.ts`** — xóa block `e.body?.trim().toLowerCase() === 'approve'`

---

## Phần 2 — Planning phase (priority ordering)

### Mục tiêu

Sắp xếp issues theo `priority` label trước khi implement. **Không có dependency graph** — để v3.

### Phase mới: `PLANNING`

Thêm `'PLANNING'` vào `ProjectPhase` trong `src/state/types.ts`.

### Thêm `planned_order` vào state

**DB migration** — thêm cột `planned_order TEXT NOT NULL DEFAULT '[]'` vào `repo_state`

**`src/state/manager.ts`** — thêm methods:
- `setPlannedOrder(slug, repoName, iids: number[])`
- `getNextPlannedIssue(slug, repoName): number | null` — lấy IID đầu tiên chưa `DONE`/`CLOSED`/`MR_OPEN`, ưu tiên `INTERRUPTED` trước `OPEN`

### Tạo `src/orchestrator/phase2-plan.ts`

```typescript
export async function startPlanningPhase(projectSlug: string): Promise<void> {
  // 1. Fetch issues từ GitLab API: title + labels
  // 2. Sort theo priority label: critical=4, high=3, medium=2, low=1
  // 3. setPlannedOrder() cho từng code repo (filter theo repo: label)
  // 4. transitionGroupPhase('IMPLEMENTING')
  // 5. startImplementationLoop()
}
```

---

## Phần 3 — Git worktree per task (sequential)

### Vấn đề

Dùng chung một directory → tasks kế tiếp nhau vẫn có thể conflict nếu branch cũ chưa được clean.

### Giải pháp

Mỗi task tạo worktree riêng, cleanup sau khi MR merged. **Sequential** — không parallel.

### Cấu trúc workspace

```
/workspace/
  repos/                  ← main branch, READ-ONLY reference
    docs/
    backend/
    frontend/
  tasks/                  ← active worktrees
    5-backend/            ← issue #5, repo backend
    7-frontend/           ← issue #7, repo frontend
```

### Tạo/cleanup worktree

```typescript
// Tạo worktree:
git -C /workspace/repos/backend \
  worktree add /workspace/tasks/5-backend \
  -b feature/issue-5-auth origin/main

// Cleanup sau MR merged:
git -C /workspace/repos/backend worktree remove /workspace/tasks/5-backend
```

### System prompt cho agent

```
Working directory (write target): /workspace/tasks/5-backend

Read-only references (DO NOT commit to these):
  docs:           /workspace/repos/docs
  backend-common: /workspace/repos/backend-common
```

### Thay đổi

**`src/state/types.ts`** — thêm `worktreePath?: string` vào `CheckpointData`

**`src/utils/worktree.ts`** — tạo mới:
- `createWorktree(repoName, issueIid, branch): string`
- `removeWorktree(repoName, worktreePath): void`

**`src/orchestrator/phase2-implement.ts`** — dùng worktree path làm `cwd`, update system prompt với read-only refs

**`src/orchestrator/index.ts`** — `MR_MERGED` handler: gọi `removeWorktree` sau khi close issue

---

## Phần 4 — Task lifecycle tied to MR

### Luồng mới

```
implement-issue xong
  → agent tạo MR (Step 8 mới), output "MR_IID: {n}"
  → orchestrator: lưu issueToMr[iid] = mrIid, updateIssueStatus('MR_OPEN')

MR_MERGED
  → tìm issue có issueToMr[iid] === mergedMrIid
  → glab issue close {iid}
  → updateIssueStatus('DONE')
  → removeWorktree

Comment vào issue DONE
  → updateIssueStatus('REOPENED')
  → prependToPlannedOrder (priority cao)
  → nếu phase IMPLEMENTING → trigger loop
```

### Thay đổi

**`src/state/types.ts`** — thêm statuses: `'MR_OPEN' | 'INTERRUPTED' | 'REOPENED'`

**DB migration** — thêm cột `issue_to_mr TEXT NOT NULL DEFAULT '{}'` vào `repo_state`

**`src/state/manager.ts`** — thêm:
- `setIssueMr(slug, repoName, iid, mrIid)`
- `prependToPlannedOrder(slug, repoName, iid)`
- `getIssueOwnerRepo(slug, iid): string | null` — tìm repoName từ issueToMr map

**`src/orchestrator/phase2-implement.ts`** — sau agent run:
```typescript
const mrIid = parseMrIid(result.output)
if (mrIid) await stateManager.setIssueMr(projectSlug, docsRepo.name, nextIid, mrIid)
await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'MR_OPEN')
// Không mark DONE ở đây
```

**`src/orchestrator/index.ts`** — `MR_MERGED` handler:
```typescript
case 'MR_MERGED': {
  const repoStates = await stateManager.getAllRepoStates(e.projectSlug)
  for (const rs of repoStates) {
    const entry = Object.entries(rs.issueToMr ?? {})
      .find(([, mrIid]) => mrIid === e.mrIid)
    if (entry) {
      const iid = Number(entry[0])
      await stateManager.updateIssueStatus(e.projectSlug, rs.repoName, iid, 'DONE')
      await closeIssueOnGitLab(iid, ...)
      await removeWorktree(rs.repoName, checkpoint?.worktreePath)
    }
  }
  // Giữ logic phase4 nếu tất cả issues DONE
  break
}
```

**`src/orchestrator/index.ts`** — `ISSUE_COMMENT` handler, thêm xử lý DONE/REOPENED:
```typescript
const ownerRepo = await stateManager.getIssueOwnerRepo(e.projectSlug, e.issueIid)
if (ownerRepo) {
  const issueStatus = stateManager.getIssueStatusInRepo(e.projectSlug, ownerRepo, e.issueIid)
  if (issueStatus === 'DONE') {
    await stateManager.updateIssueStatus(e.projectSlug, ownerRepo, e.issueIid, 'REOPENED')
    await stateManager.prependToPlannedOrder(e.projectSlug, ownerRepo, e.issueIid)
    if (state.phase === 'IMPLEMENTING') startImplementationLoop(e.projectSlug).catch(...)
    break
  }
}
```

**`claude-config/skills/implement-issue/SKILL.md`** — thêm Step 8:
```bash
glab mr create \
  --source-branch "$BRANCH" \
  --target-branch "main" \
  --title "feat: implement #$ISSUE_IID - $ISSUE_TITLE" \
  --description "Closes #$ISSUE_IID" \
  --assignee "@me"
# Output: MR_IID: {number}
```

---

## Phần 5 — Checkpoint đơn giản khi hết token

### Cơ chế

Khi `error_max_turns` → lưu branch name, mark `INTERRUPTED`. Khi resume → agent đọc git log tự recover.

### Thay đổi

**`src/agent/runner.ts`** — detect `error_max_turns`:
```typescript
} else if (message.type === 'result' && message.subtype === 'error_max_turns') {
  interrupted = true
}
// AgentRunResult thêm: interrupted: boolean
```

**`src/state/types.ts`** — thêm interface:
```typescript
interface CheckpointData {
  branch: string
  worktreePath?: string
  interruptedAt: string
}
```

**DB migration** — thêm cột `checkpoints TEXT NOT NULL DEFAULT '{}'` vào `repo_state`

**`src/state/manager.ts`** — thêm:
- `saveCheckpoint(slug, repoName, iid, data: CheckpointData)`
- `getCheckpoint(slug, repoName, iid): CheckpointData | null`

**`src/orchestrator/phase2-implement.ts`** — khi `result.interrupted`:
```typescript
const branch = execSync('git branch --show-current', { cwd: worktreePath }).toString().trim()
await stateManager.saveCheckpoint(projectSlug, targetRepo.name, nextIid, {
  branch, worktreePath, interruptedAt: new Date().toISOString()
})
await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'INTERRUPTED')
```

Khi resume (issue `INTERRUPTED`), inject vào system prompt:
```
Previously interrupted on branch: feature/issue-5-auth
Resume from where you left off. Run: git log --oneline -10 to see what was done.
```

---

## Phần 6 — Fix mr.ts bot username

**`src/webhook/handlers/mr.ts`** — đồng bộ với `note.ts`:
```typescript
const botUsername = process.env['GITLAB_BOT_USERNAME']
if (!botUsername) {
  log.error('GITLAB_BOT_USERNAME is not set — refusing to process MR events')
  return
}
```

---

## DB migrations tổng hợp

```sql
ALTER TABLE project_group_state ADD COLUMN docs_mr_iid INTEGER;
ALTER TABLE repo_state ADD COLUMN planned_order  TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repo_state ADD COLUMN issue_to_mr    TEXT NOT NULL DEFAULT '{}';
ALTER TABLE repo_state ADD COLUMN checkpoints    TEXT NOT NULL DEFAULT '{}';
```

---

## Danh sách file cần thay đổi

| File | Thay đổi |
|------|---------|
| `src/state/types.ts` | Thêm `PLANNING`, `MR_OPEN`, `INTERRUPTED`, `REOPENED`, `CheckpointData` |
| `src/state/manager.ts` | Thêm 7 methods mới |
| `src/db/index.ts` | Migration 4 cột mới |
| `src/config/schema.ts` | Thêm `workspace_path` (thay env var) |
| `src/utils/worktree.ts` | **Tạo mới** — createWorktree, removeWorktree |
| `src/agent/runner.ts` | Detect `error_max_turns`, thêm `interrupted` vào result |
| `src/orchestrator/index.ts` | Sửa MR_REVIEW, MR_MERGED, ISSUE_COMMENT handlers |
| `src/orchestrator/phase1-init.ts` | Parse và lưu docs MR IID |
| `src/orchestrator/phase2-plan.ts` | **Tạo mới** — priority sort, setPlannedOrder |
| `src/orchestrator/phase2-implement.ts` | Dùng worktree, getNextPlannedIssue, checkpoint, parse MR_IID |
| `src/webhook/handlers/mr.ts` | Require GITLAB_BOT_USERNAME |
| `claude-config/skills/implement-issue/SKILL.md` | Thêm Step 8: tạo MR |

---

## Thứ tự implement

1. DB migration + `types.ts`
2. `StateManager` methods mới
3. `src/utils/worktree.ts`
4. `AgentRunner` detect `error_max_turns`
5. `phase1-init.ts` — lưu docs MR IID
6. `phase2-plan.ts` — priority sort
7. `dispatch` — trigger từ docs MR approved
8. `phase2-implement.ts` — worktree + planned order + checkpoint + parse MR_IID
9. `MR_MERGED` handler — close issue + cleanup worktree
10. `ISSUE_COMMENT` handler — reopen
11. `implement-issue` skill — Step 8 tạo MR
12. Fix `mr.ts`
