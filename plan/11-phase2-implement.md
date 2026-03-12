# T11 — Phase 2: Implement

> **Phụ thuộc:** T08, T09
> **Output:** `src/orchestrator/phase2-implement.ts`

---

## Mục tiêu

Implement từng issue theo thứ tự dependency. Với mỗi issue: tạo branch, AI code, test, commit, push, update status. Xử lý user feedback nếu có.

---

## Các bước

### Bước 1: Trigger Phase 2

Từ orchestrator khi phát hiện "approve" comment:
```
stateManager.transitionPhase → 'IMPLEMENTING'
phase2Implement.startImplementationLoop(projectId)
```

### Bước 2: Implementation loop (`src/orchestrator/phase2-implement.ts`)

```
loop:
  nextIssue = stateManager.getNextPendingIssue(projectId)
  if no more issues:
    stateManager.transitionPhase → 'ALL_ISSUES_DONE'
    trigger Phase 3
    break

  stateManager.updateIssueStatus(projectId, iid, 'IN_PROGRESS')
  await implementIssue(iid, repo)
  stateManager.updateIssueStatus(projectId, iid, 'DONE')
```

### Bước 3: `implementIssue(iid, repo)`

Invoke agent với prompt:

```
Implement GitLab issue #{iid}.

STEP 1 - FETCH ISSUE DETAILS:
  glab issue view {iid} --output json

STEP 2 - SETUP BRANCH:
  git fetch origin
  git checkout -b feature/issue-{iid}-{slug} origin/main

STEP 3 - UPDATE ISSUE STATUS:
  glab issue update {iid} --label "status:in-progress"

STEP 4 - READ CONTEXT:
  - Read docs/architecture.md and docs/api-documentation.md for reference
  - Explore existing codebase structure

STEP 5 - IMPLEMENT:
  - Write all required code files
  - Follow existing patterns and conventions
  - Handle errors properly

STEP 6 - WRITE TESTS:
  - Unit tests for new functions
  - Place in correct test directory

STEP 7 - USE /commit skill:
  Message format: "feat: implement #{iid} - {issue title}"

STEP 8 - PUSH:
  git push -u origin feature/issue-{iid}-{slug}

STEP 9 - UPDATE ISSUE:
  glab issue update {iid} --label "status:done"
  glab issue note {iid} --message "Implementation complete. Branch: feature/issue-{iid}-{slug}. ..."

GitLab project ID: {gitlab_project_id}
Working directory: {repo.local_path}
```

### Bước 4: Xử lý user feedback trong Phase 2

Khi nhận `ISSUE_COMMENT` event (phase = `IMPLEMENTING`):
- Check issue đang ở status `IN_PROGRESS` hoặc `DONE`
- Invoke agent:
  ```
  User @{author} commented on issue #{iid}: "{body}"

  Classify the comment:
  - "approve" / "lgtm" → reply "Acknowledged!" and skip
  - Bug report → fix the bug on branch feature/issue-{iid}-*
  - Change request → implement the change
  - Question → answer it with glab issue note

  Use /commit skill after making changes. Then push.
  ```

---

## Notes về implementation order

Issues được implement theo thứ tự `issueIids` trong state (đã được sort theo dependency trong Phase 1). Orchestrator không cần biết về dependency logic — chỉ cần follow thứ tự.

---

## Acceptance Criteria

- [ ] Issues được implement theo đúng thứ tự `issueIids`
- [ ] Mỗi issue có feature branch riêng: `feature/issue-{iid}-{slug}`
- [ ] Issue status được update: `status:in-progress` → `status:done`
- [ ] Progress comment được post lên GitLab issue sau khi xong
- [ ] Sau khi hết issues → tự động trigger Phase 3
- [ ] User feedback (bug/change) → agent fix và push lên đúng branch
- [ ] User "approve" comment → agent acknowledge và tiếp tục issue tiếp theo
