# T12 — Phase 3: Review

> **Phụ thuộc:** T08, T09
> **Output:** `src/orchestrator/phase3-review.ts`

---

## Mục tiêu

Tạo Merge Request khi tất cả issues đã implement xong. Xử lý review comments từ user cho đến khi MR được approve.

---

## Các bước

### Bước 1: Trigger Phase 3

Từ orchestrator khi state = `ALL_ISSUES_DONE`:
```
stateManager.transitionPhase → 'MR_CREATED'
phase3Review.createMR(projectId, repo)
```

### Bước 2: `createMR(projectId, repo)`

Invoke agent với prompt dùng `/create-mr` skill:

```
All issues have been implemented. Now create a Merge Request.

STEP 1 - GET ISSUE LIST:
  Run: glab issue list --label "phase:implement,status:done" --output json
  Extract: IIDs and titles

STEP 2 - USE /create-mr skill:
  Source branch: the feature branches (or a consolidated branch if needed)
  Target branch: main
  Include "Closes #N" for each issue

  Note: If there are multiple feature branches, first:
  - Create branch 'feature/sprint-{timestamp}' from main
  - Merge each feature branch into it locally
  - Push this consolidated branch
  - Create MR from this branch

STEP 3 - SAVE MR INFO:
  After creating MR, output the MR IID on a line like:
  "MR_IID: {number}"

STEP 4 - NOTIFY USER:
  glab mr note {mrIid} --message "🤖 All N issues implemented. MR ready for review. ..."

GitLab project ID: {gitlab_project_id}
Working directory: {repo.local_path}
```

Sau khi agent xong:
- Parse MR IID từ agent output (tìm pattern `MR_IID: (\d+)`)
- `stateManager.setMR(projectId, mrIid)`
- `stateManager.transitionPhase → 'AWAITING_MR_REVIEW'`

### Bước 3: Xử lý `MR_REVIEW` event với `changes_requested`

Invoke agent với `/review-comments` skill:

```
The user requested changes on MR !{mrIid}.

USE /review-comments skill:
  MR IID: {mrIid}
  Source branch: {sourceBranch}

After addressing all comments:
  - Use /commit skill: "fix: address review comments on !{mrIid}"
  - git push origin {sourceBranch}
  - Re-request review via glab mr update

GitLab project ID: {gitlab_project_id}
Working directory: {repo.local_path}
```

### Bước 4: Xử lý `MR_REVIEW` event với `approved`

- `stateManager.transitionPhase → 'MR_APPROVED'`
- Trigger Phase 4 (merge)

---

## Notes về branch strategy

Nếu có nhiều feature branches (1 per issue), agent cần consolidate chúng:
```bash
git checkout -b feature/sprint-{date} main
git merge feature/issue-1-* --no-edit
git merge feature/issue-2-* --no-edit
# ... etc
git push -u origin feature/sprint-{date}
```
Nếu có conflicts, agent tự resolve.

---

## Acceptance Criteria

- [ ] State transition: `ALL_ISSUES_DONE` → `MR_CREATED` → `AWAITING_MR_REVIEW`
- [ ] MR được tạo với `Closes #N` cho tất cả issues
- [ ] MR IID được parse và lưu vào state
- [ ] Notification comment được post sau khi MR tạo xong
- [ ] Review comments từ user → agent fix + push + reply
- [ ] User "approve" → trigger Phase 4 (không merge ngay, để Phase 4 xử lý)
- [ ] Multiple feature branches → được merge vào 1 consolidated branch
