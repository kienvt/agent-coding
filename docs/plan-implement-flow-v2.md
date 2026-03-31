# Kế hoạch: Refactor Implementation Flow

## Tổng quan thay đổi

| # | Vấn đề hiện tại | Thay đổi |
|---|-----------------|----------|
| 1 | IMPLEMENTING trigger bằng comment "approve" | Trigger khi docs MR được **approved** |
| 2 | Task chạy tuần tự, không có dependency awareness | Thêm phase `PLANNING` — lên lịch theo priority + dependency |
| 3 | Agent hết token → task mất trạng thái | Lưu checkpoint khi bị interrupt, resume được |
| 4 | Issue đóng ngay khi agent xong | Issue chỉ close khi MR của task đó được **merge** |
| 5 | Issue không có lifecycle sau khi done | Reopen issue khi có comment yêu cầu update |
| 6 | Chưa có flow xử lý change request chuẩn | 4 loại change request theo Agile standard |

---

## Phần 1 — Trigger IMPLEMENTING từ docs MR approved

### Vấn đề hiện tại

`dispatch` xử lý `ISSUE_COMMENT` với body `=== 'approve'` → `IMPLEMENTING`.
Docs MR approved/merged bị **bỏ qua hoàn toàn** (không có code xử lý).

### Luồng mới

```
docs MR approved (user click Approve trên GitLab)
  → mr.ts enqueue MR_REVIEW { action: 'approved', mrIid }
  → dispatch: phát hiện mrIid === docsMrIid trong group state
  → transitionGroupPhase('PLANNING')
  → startPlanningPhase(projectSlug)
```

### Thay đổi cần làm

**1. Lưu docs MR IID vào group state**

Phase 1 agent output `MR_IID: {n}` (đã có trong init-plan skill Step 7).
`handleRequirementPushed` cần parse thêm `MR_IID` từ output và lưu vào DB.

- Thêm cột `docs_mr_iid INTEGER` vào bảng `project_group_state`
- Thêm method `setDocsMrIid(slug, mrIid)` trong `StateManager`
- Thêm field `docsMrIid?: number` vào `ProjectGroupState`

**2. Xử lý MR_REVIEW (approved) cho docs MR trong dispatch**

```typescript
case 'MR_REVIEW': {
  const e = event as MRReviewEvent
  const state = await stateManager.getGroupState(e.projectSlug)
  if (!state) break

  // Docs MR approved → trigger planning
  if (e.action === 'approved' && state.docsMrIid === e.mrIid
      && state.phase === 'AWAITING_REVIEW') {
    await stateManager.transitionGroupPhase(e.projectSlug, 'PLANNING')
    startPlanningPhase(e.projectSlug).catch(...)
    break
  }

  // Code MRs (phase 3) — giữ nguyên logic hiện tại
  if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_CREATED') {
    await handleMRReviewEvent(e)
  }
  break
}
```

**3. Bỏ "approve" comment trigger**

Xóa block xử lý `e.body?.trim().toLowerCase() === 'approve'` trong `ISSUE_COMMENT` handler.
Giữ lại `handlePlanFeedback` cho các comment khác khi phase là `AWAITING_REVIEW`.

**4. Fix mr.ts — botUsername cũng cần require env var**

`mr.ts` hiện vẫn dùng `?? 'ai-agent'` fallback. Cần đồng bộ với `note.ts`: nếu không set thì từ chối xử lý.

---

## Phần 2 — Planning phase (dependency + priority)

### Phase mới: `PLANNING`

Sau khi docs MR approved, orchestrator phân tích tất cả issues, sắp xếp theo dependency graph và priority trước khi bắt đầu implement.

### Dependency format

Trong description của mỗi GitLab issue, thêm section:

```markdown
## Dependencies
- #3
- #7
```

Agent trong `init-plan` skill cần thêm section này khi tạo issues nếu task phụ thuộc nhau.

### Thuật toán lên lịch

```
1. Fetch toàn bộ OPEN issues từ GitLab API (đã có issue_iids trong state)
2. Build dependency graph: Map<iid, Set<iid>> (adjacency list)
3. Topological sort (Kahn's algorithm):
   - Tính in-degree cho mỗi node
   - Queue các node có in-degree = 0, ưu tiên theo priority label:
       critical=4 > high=3 > medium=2 > low=1
4. Kết quả: mảng ordered issue IIDs → lưu vào state

Priority label mapping:
  priority:critical → 4
  priority:high     → 3
  priority:medium   → 2
  priority:low      → 1
```

Nếu có **cyclic dependency** → log warning, bỏ qua dependency edge đó và tiếp tục.

### Thay đổi cần làm

**1. Thêm `ProjectPhase`: `'PLANNING'`** vào `src/state/types.ts`

**2. Thêm state lưu planned order**

Thêm cột `planned_order TEXT DEFAULT '[]'` vào `repo_state` (JSON array of issue IIDs).
Thêm methods:
- `setPlannedOrder(slug, repoName, iids[])`
- `getNextPlannedIssue(slug, repoName)` — trả về IID đầu tiên trong planned_order chưa `DONE`/`CLOSED`

**3. Tạo file `src/orchestrator/phase2-plan.ts`**

```typescript
export async function startPlanningPhase(projectSlug: string): Promise<void>
  // 1. Fetch issues từ GitLab API (title, labels, description)
  // 2. Parse dependencies từ description của mỗi issue
  // 3. Topological sort + priority weighting
  // 4. setPlannedOrder() cho từng code repo
  // 5. transitionGroupPhase(projectSlug, 'IMPLEMENTING')
  // 6. startImplementationLoop()
```

**4. Sửa `startImplementationLoop`**

Thay vì `getNextPendingIssue` (lấy OPEN bất kỳ), dùng `getNextPlannedIssue` (theo thứ tự đã lên lịch).
Trước khi implement một issue, kiểm tra tất cả dependencies đã `DONE` chưa — nếu chưa thì skip và lấy task tiếp theo có thể implement.

---

## Phần 3 — Token exhaustion / Checkpoint

### Vấn đề

Khi agent bị interrupt do hết token (`error_max_turns` từ SDK), task ở trạng thái lửng — code đã viết một phần, không biết dừng ở đâu.

### Cơ chế checkpoint

**Phía orchestrator** (`AgentRunner.run`):

```typescript
for await (const message of messages) {
  if (message.type === 'result') {
    if (message.subtype === 'error_max_turns') {
      // Đánh dấu interrupted — không throw error
      interrupted = true
    }
  }
}
// Sau loop: nếu interrupted → return { success: false, interrupted: true, ... }
```

`AgentRunResult` thêm field `interrupted: boolean`.

**Phía implementation loop** (`startImplementationLoop`):

```typescript
const result = await agentRunner.run({ ... })

if (result.interrupted) {
  // Lưu checkpoint từ git
  const branch = execSync('git branch --show-current', { cwd: repoAbsPath }).toString().trim()
  const gitLog = execSync('git log --oneline -5', { cwd: repoAbsPath }).toString().trim()
  await stateManager.saveCheckpoint(projectSlug, targetRepo.name, nextIid, {
    branch,
    gitLog,
    interruptedAt: new Date().toISOString(),
  })
  await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'INTERRUPTED')
  break  // Dừng loop, chờ resume
}
```

**Resume khi orchestrator restart hoặc có trigger thủ công:**

`getNextPlannedIssue` ưu tiên status `INTERRUPTED` trước `OPEN`.
Khi pick issue `INTERRUPTED`, orchestrator đọc checkpoint và thêm vào system prompt:

```
Previously interrupted. Git state:
Branch: feature/issue-5-auth-service
Recent commits:
  abc1234 feat: add JWT validation
  def5678 feat: add user model

Continue from where you left off. Check git log and existing code before writing new code.
```

**Thay đổi DB:**

Thêm cột `checkpoints TEXT DEFAULT '{}'` vào `repo_state` — JSON map `{ [iid]: CheckpointData }`.

Thêm `IssueStatus`: `'INTERRUPTED'`

---

## Phần 4 — Task lifecycle tied to MR

### Vấn đề hiện tại

- `implement-issue` skill kết thúc ở Step 7 (update label) — **không tạo MR**
- Issue được mark `DONE` ngay khi agent run xong, không chờ MR merge

### Luồng mới

```
implement-issue xong
  → agent tạo MR trên code repo (mới)
  → agent output "MR_IID: {n}"
  → orchestrator: updateIssueStatus(iid, 'MR_OPEN'), lưu issueToMr[iid] = mrIid

MR được merge
  → mr.ts enqueue MR_MERGED { mrIid }
  → dispatch: tìm issue có issueToMr[iid] === mrIid
  → glab issue close {iid} (trong docs repo)
  → updateIssueStatus(iid, 'DONE')

Comment vào issue đã DONE
  → ISSUE_COMMENT event
  → dispatch: status === 'DONE' → updateIssueStatus(iid, 'REOPENED')
  → thêm lại vào planned order với priority cao
  → nếu phase là IMPLEMENTING → agent xử lý luôn
  → nếu phase khác → chờ đến khi IMPLEMENTING
```

### Thay đổi cần làm

**1. `implement-issue` skill — thêm Step 8: tạo MR**

```bash
# Step 8 — Create Merge Request
glab mr create \
  --source-branch "$BRANCH" \
  --target-branch "main" \
  --title "feat: implement #$ISSUE_IID - $ISSUE_TITLE" \
  --description "Closes #$ISSUE_IID" \
  --assignee "@me"
```

Output: `MR_IID: {number}` (orchestrator parse)

**2. Thêm `issueToMr` mapping vào repo state**

Thêm cột `issue_to_mr TEXT DEFAULT '{}'` vào `repo_state` — JSON `{ [iid]: mrIid }`.
Thêm method `setIssueMr(slug, repoName, iid, mrIid)`.

**3. Sửa `startImplementationLoop` — parse MR_IID sau agent run**

```typescript
const mrIid = parseMrIid(result.output)
if (mrIid) {
  await stateManager.setIssueMr(projectSlug, docsRepo.name, nextIid, mrIid)
}
await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'MR_OPEN')
// KHÔNG mark DONE ở đây nữa
```

**4. Sửa `MR_MERGED` dispatch handler**

```typescript
case 'MR_MERGED': {
  // Tìm issue nào có issueToMr[iid] === mergedMrIid
  const repoStates = await stateManager.getAllRepoStates(e.projectSlug)
  for (const rs of repoStates) {
    const iid = Object.entries(rs.issueToMr ?? {})
      .find(([, mrIid]) => mrIid === e.mrIid)?.[0]
    if (iid) {
      await stateManager.updateIssueStatus(e.projectSlug, rs.repoName, Number(iid), 'DONE')
      // Gọi glab issue close {iid} qua agentRunner
    }
  }
  // Giữ logic phase4 nếu tất cả issues DONE
  break
}
```

**5. Sửa `ISSUE_COMMENT` dispatch handler — xử lý DONE issue**

```typescript
case 'ISSUE_COMMENT': {
  // Kiểm tra issue status trước
  const issueStatus = await stateManager.getIssueStatus(e.projectSlug, e.issueIid)

  if (issueStatus === 'DONE' || issueStatus === 'CLOSED') {
    // Reopen
    await stateManager.updateIssueStatus(e.projectSlug, repoName, e.issueIid, 'REOPENED')
    await stateManager.prependToPlannedOrder(e.projectSlug, repoName, e.issueIid)
    // Nếu đang IMPLEMENTING → trigger ngay
    if (state.phase === 'IMPLEMENTING') {
      startImplementationLoop(e.projectSlug).catch(...)
    }
    break
  }
  // ... logic hiện tại
}
```

**6. Thêm `IssueStatus`: `'MR_OPEN' | 'INTERRUPTED' | 'REOPENED'`**

---

---

## Phần 5 — Change Request Flow (Agile standard)

Có 4 loại change request, mỗi loại có luồng và cách xử lý khác nhau.

---

### Loại 1 — Code review comment trên MR (phổ biến nhất)

**Trigger**: `MR_REVIEW` event với `action: 'changes_requested'` hoặc `action: 'commented'`

**Luồng**:
```
Reviewer comment/changes_requested trên code MR
  → handleMRReviewEvent → handle-review-changes skill
  → agent classify từng comment:
      Blocking   (bug, wrong logic, security issue) → phải fix
      Non-blocking (style suggestion)               → fix nếu agree, reply nếm không
      Question                                      → reply giải thích, không cần code
  → fix code, push lên branch
  → rebase nếu branch outdated so với main
  → post comment tóm tắt: "Addressed X comments, skipped Y (với lý do)"
  → re-request review từ reviewer gốc

Issue status: MR_OPEN (không thay đổi — vẫn chờ merge)
```

**MR status cycle**:
```
MR_OPEN → CHANGES_REQUESTED → MR_OPEN (sau khi agent fix) → ... → MR_APPROVED → MERGED
```

**Iteration guard**: Thêm `reviewCycles: number` vào checkpoint. Nếu vượt quá **5 vòng** mà MR vẫn chưa approved:
- Agent post comment: "⚠️ Reached maximum review cycles. Manual intervention required."
- Dừng tự động xử lý MR đó

**Thay đổi cần làm**:

- `handle-review-changes` skill: thêm bước classify (blocking/non-blocking/question) trước khi fix
- `handle-review-changes` skill: sau khi push → `glab mr request-review --reviewer {reviewer}` để re-notify
- `handle-review-changes` skill: thêm bước kiểm tra `git log origin/main..HEAD` — nếu branch lạc hậu → rebase trước khi push
- `StateManager`: thêm `reviewCycles: number` trong checkpoint data
- `handleMRReviewEvent`: tăng `reviewCycles` mỗi lần xử lý changes_requested, check guard

---

### Loại 2 — Change request khi task đang IN_PROGRESS

**Trigger**: `ISSUE_COMMENT` event, issue status = `IN_PROGRESS`

**Nguyên tắc**: Không interrupt giữa chừng — ghi nhận, xử lý khi có cơ hội.

**Luồng**:
```
Comment vào issue khi status = IN_PROGRESS
  → orchestrator ghi nhận comment vào checkpoint context (pending_comments[])
  → KHÔNG trigger agent run ngay

Khi agent run hiện tại kết thúc (hoặc checkpoint):
  → orchestrator inject pending_comments vào system prompt của lần run tiếp
  → agent đọc và xử lý:
      Scope nhỏ   → incorporate vào current branch, update acceptance criteria
      Scope lớn   → hoàn thành task hiện tại trước, reply: "Will create follow-up issue"
                    → sau khi MR merged, tạo new issue liên kết
      Clarification → ghi nhận, tiếp tục implement
```

**Thay đổi cần làm**:

- `StateManager`: thêm `pendingComments: Array<{body, author, createdAt}>` trong checkpoint data
- `startImplementationLoop`: trước khi run agent, đọc `pendingComments` và thêm vào system prompt
- `ISSUE_COMMENT` handler trong dispatch: nếu issue `IN_PROGRESS` → append vào `pendingComments`, không trigger agent

---

### Loại 3 — Change request sau khi DONE (MR đã merge)

**Trigger**: `ISSUE_COMMENT` event, issue status = `DONE`

**Luồng**:
```
Comment vào issue khi status = DONE
  → agent classify intent từ nội dung comment:

  Bug fix (nhỏ, isolated):
    → reopen issue (status = REOPENED)
    → tạo branch MỚI từ main (KHÔNG từ branch cũ đã merge)
    → implement fix → tạo MR mới
    → close issue khi MR merge

  Enhancement / new feature (scope lớn):
    → KHÔNG reopen issue cũ (giữ history sạch)
    → tạo NEW issue với title/description từ comment
    → link với issue gốc: "Related to #N"
    → thêm vào planned queue với priority phù hợp
    → reply trên issue gốc: "Created #M to track this enhancement"

  Question / clarification:
    → chỉ reply, không tạo branch hay issue mới
```

**Quy tắc phân loại** (agent tự classify):
- Mention "bug", "broken", "error", "wrong", "fix" → Bug fix
- Mention "add", "new feature", "improve", "enhance", "should also" → Enhancement
- Câu hỏi (dấu `?`, "how", "why", "what") → Question

**Thay đổi cần làm**:

- `ISSUE_COMMENT` dispatch handler: phân nhánh theo classify thay vì reopen tự động
- Thêm classify skill/prompt trước khi quyết định action
- `implement-issue` skill: khi issue là `REOPENED`, tạo branch `fix/issue-{iid}-{slug}` thay vì `feature/`

---

### Loại 4 — Branch conflict khi merge (outdated branch)

**Trigger**: Agent phát hiện khi chuẩn bị push hoặc tạo MR

**Luồng**:
```
Trước khi push (trong implement-issue hoặc handle-review-changes):
  → git fetch origin && git log origin/main..HEAD --oneline
  → nếu branch diverged (có commit mới trên main không có trên branch):
      → git rebase origin/main
      → nếu rebase thành công → push --force-with-lease
      → nếu có conflict:
          File infra/config (go.mod, package.json, migrations) → ưu tiên main
          File business logic (src/, tests/)                   → ưu tiên feature branch
          File không rõ ràng → post comment mô tả conflict, dừng, chờ manual
```

**Thay đổi cần làm**:

- `implement-issue` skill Step 6: thêm rebase check trước `git push`
- `handle-review-changes` skill Step 5: thêm rebase check trước `git push`
- Cả hai skill: nếu conflict không tự resolve được → `glab mr note {mrIid} --message "⚠️ Rebase conflict in {files}. Manual resolution required."`

---

### Tổng hợp thay đổi cho Phần 5

**Thêm vào `IssueStatus`**: `'CHANGES_REQUESTED'`

**Thêm vào checkpoint data**:
```typescript
interface CheckpointData {
  branch: string
  gitLog: string
  interruptedAt: string
  reviewCycles: number          // Loại 1
  pendingComments: Array<{      // Loại 2
    body: string
    author: string
    createdAt: string
  }>
}
```

**Thêm vào `repo_state`**: không cần cột mới — `checkpoints` column (Phần 3) đã đủ chứa data trên.

**Sửa `handle-review-changes` skill**:
- Bước classify comment (blocking / non-blocking / question)
- Bước rebase check
- Bước re-request review
- Guard check `reviewCycles`

**Sửa `implement-issue` skill**:
- Bước rebase check trước push (Step 6)
- Branch prefix `fix/` thay vì `feature/` khi issue là `REOPENED`

---

## Thay đổi DB tổng hợp

Tất cả thay đổi schema cần được thực hiện bằng migration trong `src/db/index.ts`:

```sql
-- project_group_state
ALTER TABLE project_group_state ADD COLUMN docs_mr_iid INTEGER;

-- repo_state
ALTER TABLE repo_state ADD COLUMN planned_order   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repo_state ADD COLUMN issue_to_mr     TEXT NOT NULL DEFAULT '{}';
ALTER TABLE repo_state ADD COLUMN checkpoints     TEXT NOT NULL DEFAULT '{}';
```

---

## Danh sách file cần thay đổi

| File | Loại thay đổi |
|------|--------------|
| `src/state/types.ts` | Thêm phases `PLANNING`, statuses `MR_OPEN / INTERRUPTED / REOPENED / CHANGES_REQUESTED` |
| `src/state/manager.ts` | Thêm methods: `setDocsMrIid`, `setPlannedOrder`, `getNextPlannedIssue`, `setIssueMr`, `saveCheckpoint`, `getCheckpoint`, `prependToPlannedOrder`, `appendPendingComment` |
| `src/db/index.ts` | Migration thêm 4 cột mới |
| `src/orchestrator/index.ts` | Sửa `MR_REVIEW` handler (docs MR detect + review cycle guard), `MR_MERGED` handler (close issue), `ISSUE_COMMENT` handler (classify: reopen / new issue / pending comment) |
| `src/orchestrator/phase1-init.ts` | Parse `MR_IID` từ agent output, gọi `setDocsMrIid` |
| `src/orchestrator/phase2-implement.ts` | Parse `MR_IID` sau run, dùng `getNextPlannedIssue`, xử lý `interrupted`, inject `pendingComments`, không mark `DONE` |
| `src/orchestrator/phase2-plan.ts` | **Tạo mới** — dependency graph + topological sort + `setPlannedOrder` |
| `src/orchestrator/phase3-review.ts` | Thêm review cycle guard, không mark `DONE` khi agent xong |
| `src/agent/runner.ts` | Detect `error_max_turns`, thêm `interrupted` vào `AgentRunResult` |
| `src/webhook/handlers/mr.ts` | Require `GITLAB_BOT_USERNAME` |
| `claude-config/skills/implement-issue/SKILL.md` | Thêm Step 8: tạo MR + output `MR_IID:`, rebase check trước push, branch prefix `fix/` khi REOPENED |
| `claude-config/skills/handle-review-changes/SKILL.md` | Thêm classify step, rebase check, re-request review, iteration guard |

---

## Thứ tự implement đề xuất

**Nhóm 1 — Nền tảng (không phụ thuộc nhau, làm trước)**
1. DB migration + `types.ts` (thêm phases/statuses mới)
2. `StateManager` methods mới
3. `AgentRunner` detect `error_max_turns`

**Nhóm 2 — Core flow**
4. `phase2-plan.ts` — planning logic (dependency graph + topological sort)
5. Sửa `phase1-init.ts` — lưu docs MR IID
6. Sửa `dispatch` — trigger từ docs MR approved, bỏ "approve" comment
7. Sửa `startImplementationLoop` — dùng planned order, xử lý interrupted, inject pending comments, parse MR_IID

**Nhóm 3 — Task lifecycle**
8. Sửa `MR_MERGED` handler — close issue liên kết
9. Sửa `ISSUE_COMMENT` handler — classify intent (bug/enhancement/question)

**Nhóm 4 — Change request flow**
10. Sửa `implement-issue` skill — Step 8 tạo MR, rebase check, fix/ prefix
11. Sửa `handle-review-changes` skill — classify, rebase, re-request review, cycle guard
12. Sửa `phase3-review.ts` — review cycle tracking
13. Fix `mr.ts` — require bot username
