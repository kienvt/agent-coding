# Plan 17: Command-Driven Agent Architecture

**Ngày tạo**: 2026-03-13
**Vấn đề**: Phase logic hardcoded trong TypeScript source code — khó maintain, không thể update per-project
**Giải pháp**: Chuyển toàn bộ workflow instructions sang skill files, TypeScript chỉ pass context

---

## Vấn đề hiện tại

### Trước (hiện tại)

TypeScript build prompt dài trong source code:

```typescript
// phase1-init.ts — 40 dòng hardcoded instructions
function buildPhase1Prompt(repo, event, workspacePath): string {
  return `You are starting Phase 1 (Init) for project: ${repo.name}
  ...
  1. READ the requirement file at: ${reqFilePath}
  2. ANALYZE scope, features, modules...
  3. CREATE branch 'docs/init-plan'...
  4. GENERATE and commit these documents...
  5. GENERATE HTML UI Mockup...
  6. USE /create-issues skill...
  7. PUSH all commits...
  8. POST summary comment...`
}

// phase2-implement.ts — 30 dòng hardcoded
function buildImplementPrompt(iid, repo, repoAbsPath): string {
  return `Implement GitLab issue #${iid}...
  STEP 1 — FETCH ISSUE DETAILS: glab issue view...
  STEP 2 — SETUP BRANCH: git fetch origin...
  ...`
}
```

**Hậu quả:**
- Thay đổi workflow = thay đổi TypeScript = rebuild + redeploy
- Không thể customize per-project (tất cả dự án dùng cùng workflow)
- Logic phân tán qua 4 file TypeScript (phase1-4.ts)
- Dự án mới phát triển dần: bắt đầu với `docs/` format nhưng muốn dùng `spec-kit` format → phải sửa source code

### Sau (mục tiêu)

TypeScript chỉ pass context variables, skill file chứa logic:

```typescript
// phase1-init.ts — sau refactor: 5 dòng thực sự
const prompt = buildSkillInvocation('init-plan', {
  requirementFile: reqFilePath,
  repoName: repo.name,
  projectId: repo.gitlab_project_id,
})
```

```markdown
<!-- claude-config/skills/init-plan.md — logic ở đây, không trong TypeScript -->
# /init-plan — Phase 1: Analyze requirements and create project plan

Context variables:
- requirementFile: path to the requirement file
- repoName: project name
- projectId: GitLab project ID

## Steps
1. READ requirementFile
2. ANALYZE scope...
...
```

---

## Kiến trúc mới

### Nguyên tắc

```
TypeScript orchestrator  →  chỉ quản lý STATE MACHINE + pass CONTEXT
Skill files (.md)        →  chứa WORKFLOW LOGIC (steps, instructions)
CLAUDE.md               →  project conventions (branch naming, commit format, etc.)
```

### Luồng thực thi

```
Webhook event received
      ↓
orchestrator/index.ts   → dispatch(event)
      ↓
phase1-init.ts          → buildSkillInvocation('init-plan', { context })
      ↓
agentRunner.run()       → query({ prompt: "/init-plan\n\nContext:\n- ..." })
      ↓
Claude reads            → claude-config/skills/init-plan.md
      ↓
Agent executes steps    → theo instructions trong skill file
```

---

## Skill files cần tạo

### Hiện có (đã đúng pattern)
```
claude-config/skills/
├── commit.md              ✅ context: message, files
├── create-issues.md       ✅ context: plan file path, project info
├── create-mr.md           ✅ context: issue IIDs, project info
└── review-comments.md     ✅ context: MR IID
```

### Cần tạo mới (chuyển từ TypeScript)

```
claude-config/skills/
├── init-plan.md           🆕 Phase 1: analyze req → docs → issues → notify
├── implement-issue.md     🆕 Phase 2: fetch issue → branch → code → test → commit → push
├── handle-plan-feedback.md 🆕 Phase 1 feedback: update docs → reply comment
├── handle-review-changes.md 🆕 Phase 3: address MR comments → push → notify
└── phase-done.md          🆕 Phase 4: close issues → cleanup branches → summary
```

---

## Chi tiết từng skill mới

### `init-plan.md` (thay thế buildPhase1Prompt)

```markdown
# /init-plan — Phase 1: Initialize project from requirements

Analyze requirement file and set up project documentation, issues, and initial structure.

## Context (provided in prompt)
- requirementFile: absolute path to requirement file
- repoName: project name
- projectId: GitLab project ID

## Steps

### Step 1 — Read & Analyze
Read the requirement file at `requirementFile`.
Identify: core features, data entities, user roles, integration points, tech constraints.

### Step 2 — Create planning branch
git fetch origin
git checkout -b docs/init-plan origin/main

### Step 3 — Generate documentation
Create these files in docs/:
- docs/architecture.md — system overview + Mermaid component diagram
- docs/database-schema.md — ERD + table definitions
- docs/api-documentation.md — all endpoints with request/response schemas
- docs/test-cases.md — unit, integration, E2E scenarios
- docs/implementation-plan.md — phased task list ordered by dependency
- docs/README.md — index with links to all docs

### Step 4 — Generate UI mockup
Create self-contained HTML mockups in docs/mockup/:
- docs/mockup/index.html — navigation hub
- docs/mockup/assets/style.css — shared design tokens
- docs/mockup/assets/mock-data.js — realistic placeholder data
- docs/mockup/screens/{screen-name}.html — one file per major UI screen (min 4)

Rules: no CDN, responsive, realistic fake data, inline navigation between screens.

### Step 5 — Create issues
Use /create-issues skill:
- Source: docs/implementation-plan.md
- Output: ISSUE_IIDS: {comma-separated list}

### Step 6 — Push & notify
git push -u origin docs/init-plan
glab issue note {firstIssueIid} --message "## 🤖 Phase 1 Complete\n\nDocuments and issues created. Comment 'approve' to start implementation."

## Output
Must output on a separate line:
ISSUE_IIDS: {number},{number},...
```

### `implement-issue.md` (thay thế buildImplementPrompt)

```markdown
# /implement-issue — Phase 2: Implement a single GitLab issue

## Context (provided in prompt)
- issueIid: GitLab issue IID number
- projectId: GitLab project ID

## Steps

### Step 1 — Fetch issue details
glab issue view {issueIid} --output json
Extract: title, description, acceptance criteria, labels.

### Step 2 — Create feature branch
git fetch origin
SLUG=$(glab issue view {issueIid} | head -1 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-40)
git checkout -b feature/issue-{issueIid}-$SLUG origin/main
glab issue update {issueIid} --label "status:in-progress"

### Step 3 — Read architecture context
Read docs/architecture.md and docs/api-documentation.md.
Explore existing codebase structure to understand patterns.

### Step 4 — Implement
Write all required code following existing patterns.
Meet every acceptance criterion from the issue description.

### Step 5 — Write tests
Write unit tests for new functions in the test directory matching src/ structure.

### Step 6 — Commit & push
Use /commit skill: "feat: implement #{issueIid} - {issue title}"
git push -u origin {branch-name}

### Step 7 — Close issue
glab issue update {issueIid} --label "status:done"
glab issue note {issueIid} --message "✅ Implementation complete on branch feature/issue-{issueIid}-*."
```

### `handle-plan-feedback.md` (thay thế inline prompt trong handlePlanFeedback)

```markdown
# /handle-plan-feedback — Address feedback on the project plan

## Context (provided in prompt)
- authorUsername: GitLab username who commented
- issueIid: issue IID where feedback was posted
- feedbackBody: the comment text

## Steps

1. Read current docs/ to understand existing plan
2. Parse feedback intent:
   - Scope change → update docs/implementation-plan.md + affected docs
   - Design question → update docs/architecture.md or docs/api-documentation.md
   - Correction → fix the specific document
3. Make the necessary changes
4. Use /commit skill: "docs: address feedback from @{authorUsername}"
5. Push the changes
6. Reply on the issue:
   glab issue note {issueIid} --message "✅ Feedback addressed: {brief summary}"
```

### `handle-review-changes.md` (thay thế inline prompt trong handleMRReviewEvent)

```markdown
# /handle-review-changes — Address MR review comments

## Context (provided in prompt)
- mrIid: Merge Request IID

## Steps

1. Use /review-comments skill with mrIid to fetch and parse all open comments
2. For each unresolved comment:
   - Bug/issue → fix in the source branch
   - Style/formatting → apply the change
   - Question → reply inline with explanation (no code change needed)
3. After addressing all comments:
   - Use /commit skill: "fix: address review comments on !{mrIid}"
   - git push origin {sourceBranch}
4. Notify reviewer:
   glab mr note {mrIid} --message "All review comments addressed. Ready for re-review."
```

### `phase-done.md` (Phase 4 cleanup)

```markdown
# /phase-done — Phase 4: Post-merge cleanup and summary

## Context (provided in prompt)
- projectId: GitLab project ID
- issueIids: comma-separated list of closed issue IIDs

## Steps

1. Verify all issues are closed:
   glab issue list --label "status:done" --output json

2. Close any remaining open issues from the sprint:
   for each open issue: glab issue close {iid}

3. Delete merged feature branches:
   git fetch --prune
   git branch -r | grep 'feature/issue-' | sed 's/origin\///' | xargs -I{} git push origin --delete {}

4. Post final summary on the MR or first issue:
   glab issue note {firstIssueIid} --message "## ✅ Project Complete\n\n{summary of what was built}"

## Output
Must output on a separate line:
PHASE_COMPLETE: done
```

---

## Refactor TypeScript code

Sau khi tạo skill files, các phase files trở thành **thin context builders**:

### Helper function (thêm vào `agent/runner.ts` hoặc tạo `utils/skill.ts`)

```typescript
// Cách invoke skill với context variables
export function invokeSkill(skillName: string, context: Record<string, string | number>): string {
  const lines = Object.entries(context).map(([k, v]) => `- ${k}: ${v}`)
  return `/${skillName}\n\n${lines.join('\n')}`
}
```

### phase1-init.ts sau refactor

```typescript
// TRƯỚC: 40 dòng buildPhase1Prompt()
// SAU:
const prompt = invokeSkill('init-plan', {
  requirementFile: reqFilePath,
  repoName: repo.name,
  projectId: repo.gitlab_project_id,
})

// handlePlanFeedback — TRƯỚC: 15 dòng inline prompt
// SAU:
const prompt = invokeSkill('handle-plan-feedback', {
  authorUsername: event.authorUsername,
  issueIid: event.issueIid,
  feedbackBody: event.body,
})
```

### phase2-implement.ts sau refactor

```typescript
// TRƯỚC: 30 dòng buildImplementPrompt()
// SAU:
const prompt = invokeSkill('implement-issue', {
  issueIid: iid,
  projectId: repo.gitlab_project_id,
})
```

### phase3-review.ts sau refactor

```typescript
// TRƯỚC: 25 dòng inline prompt trong runPhase3()
// SAU:
const prompt = invokeSkill('create-mr', {   // dùng skill đã có!
  issueIids: iids.join(','),
  projectId: repo.gitlab_project_id,
  repoName: repo.name,
})

// handleMRReviewEvent — TRƯỚC: 15 dòng inline prompt
// SAU:
const prompt = invokeSkill('handle-review-changes', {
  mrIid: event.mrIid,
})
```

---

## Lợi ích của kiến trúc mới

| | Trước | Sau |
|--|-------|-----|
| Thay đổi workflow | Sửa TypeScript → rebuild → redeploy | Sửa .md file → không cần rebuild |
| Customize per-project | Không thể | Copy skills vào project repo + override |
| Độ dài phase files | 100-140 dòng mỗi file | 30-40 dòng mỗi file (chỉ state machine) |
| Logic visibility | Ẩn trong TS string literals | Explicit trong markdown files |
| Agent context | Agent đọc inline prompt | Agent đọc structured skill file |
| Testing workflow | Cần run TypeScript | Có thể test skill file độc lập |

---

## Thứ tự thực hiện

### Bước 1: Tạo skill files (không phá vỡ code hiện tại)
```
Tạo claude-config/skills/init-plan.md
Tạo claude-config/skills/implement-issue.md
Tạo claude-config/skills/handle-plan-feedback.md
Tạo claude-config/skills/handle-review-changes.md
Tạo claude-config/skills/phase-done.md
```

### Bước 2: Thêm helper function
```
Tạo src/utils/skill.ts với invokeSkill() function
```

### Bước 3: Refactor phase files
```
Refactor src/orchestrator/phase1-init.ts     — xóa buildPhase1Prompt()
Refactor src/orchestrator/phase2-implement.ts — xóa buildImplementPrompt()
Refactor src/orchestrator/phase3-review.ts    — xóa inline prompts
Refactor src/orchestrator/phase4-done.ts      — kiểm tra, refactor nếu cần
```

### Bước 4: Cập nhật create-mr.md
Skill này đã tồn tại nhưng context section cần sync với invokeSkill() format mới.

### Bước 5: Test
Test từng phase bằng cách trigger thủ công qua TRIGGER_PHASE event.

---

## Per-project customization (bonus)

Với kiến trúc mới, từng repo có thể override skill bằng cách có file `.claude/skills/` riêng:

```
project-repo/
└── .claude/
    └── skills/
        └── init-plan.md   ← override orchestrator's init-plan với custom steps
```

Agent sẽ ưu tiên `.claude/skills/` trong working directory trước khi dùng global skills.
Điều này cho phép mỗi project có workflow khác nhau mà không cần thay đổi orchestrator.
