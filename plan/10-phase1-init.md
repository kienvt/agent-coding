# T10 — Phase 1: Init

> **Phụ thuộc:** T08, T09
> **Output:** `src/orchestrator/phase1-init.ts`

---

## Mục tiêu

Từ requirement file vừa được push lên GitLab, agent tự động:
1. Phân tích requirement
2. Sinh tài liệu kỹ thuật (Architecture, DB Schema, API Docs, Test Cases, Plan)
3. Sinh HTML UI Mockup
4. Tạo issues trên GitLab qua `glab`
5. Chờ user approve

---

## Các bước

### Bước 1: Trigger (từ orchestrator)

Khi nhận `REQUIREMENT_PUSHED` event:
- Check state hiện tại = `IDLE` (skip nếu đang ở phase khác)
- `stateManager.transitionPhase(projectId, 'ANALYZING')`
- Invoke `phase1Init.run(event)`

### Bước 2: `phase1Init.run(event)` coordinator (`src/orchestrator/phase1-init.ts`)

Flow:
```
1. Resolve repo từ projectId → lấy local_path
2. stateManager.transitionPhase → 'ANALYZING'
3. agentRunner.run(prompt=PHASE1_PROMPT, cwd=repo.local_path)
4. stateManager.transitionPhase → 'AWAITING_REVIEW'
```

### Bước 3: Prompt cho agent (PHASE1_PROMPT)

Prompt truyền vào `agentRunner.run()` sẽ hướng dẫn agent thực hiện **toàn bộ Phase 1 trong 1 run**:

```
You are starting Phase 1 (Init) for project: {repositoryName}
Requirement file location: {repo.local_path}/{filePath}

Your tasks (do them in order):

1. READ the requirement file
2. ANALYZE scope, features, modules, tech decisions
3. CREATE branch 'docs/init-plan' from main
4. GENERATE and commit these documents to docs/:
   - architecture.md (with Mermaid diagrams)
   - database-schema.md (with ERD + SQL)
   - api-documentation.md (endpoints + schemas)
   - test-cases.md (unit, integration, E2E)
   - implementation-plan.md (phases + dependencies)
5. GENERATE HTML mockup to docs/mockup/:
   - One HTML file per UI screen (self-contained, no CDN)
   - Shared style.css and mock-data.js in assets/
   - index.html as navigation hub
   - README.md with instructions
6. USE /create-issues skill to create GitLab issues
   - Each issue: clear title, description, acceptance criteria, priority labels
   - Issues ordered by dependency (setup before features)
7. PUSH all commits to remote branch 'docs/init-plan'
8. POST summary comment on GitLab with list of created issues
   (glab issue note {firstIssueIid} --message "...")

GitLab project ID: {gitlab_project_id}
Use glab for all GitLab operations.
```

### Bước 4: Sau khi agent xong

Agent sẽ đã:
- Committed docs + mockup lên branch `docs/init-plan`
- Tạo issues trên GitLab với glab
- Posted summary comment

Orchestrator:
- Parse agent output để lấy danh sách issue IIDs (agent sẽ list chúng trong output)
- `stateManager.setIssueList(projectId, iids)`
- `stateManager.transitionPhase → 'AWAITING_REVIEW'`

### Bước 5: Xử lý feedback trong `AWAITING_REVIEW` phase

Khi nhận `ISSUE_COMMENT` event (phase = `AWAITING_REVIEW`):
- Nếu body chứa "approve" (case-insensitive) → start Phase 2
- Nếu body là feedback khác → invoke agent:
  ```
  You received feedback on the plan: "{comment}"
  Update the relevant documents and/or issues to address this feedback.
  Post a reply comment when done.
  ```

---

## Document structure expected

```
docs/
├── README.md                    # Index tất cả tài liệu
├── architecture.md
├── database-schema.md
├── api-documentation.md
├── test-cases.md
├── implementation-plan.md
└── mockup/
    ├── index.html               # Navigation hub
    ├── README.md
    ├── assets/
    │   ├── style.css
    │   └── mock-data.js
    └── screens/
        ├── dashboard.html
        ├── login.html
        └── *.html
```

---

## Acceptance Criteria

- [ ] State transition đúng: `IDLE` → `ANALYZING` → `AWAITING_REVIEW`
- [ ] Agent tạo đủ 5 docs trong `docs/` directory
- [ ] HTML mockup có ít nhất 4 screens, hoạt động offline
- [ ] Issues được tạo trên GitLab với `glab issue create`
- [ ] Summary comment được post sau khi xong
- [ ] Khi user comment "approve" → Phase 2 bắt đầu
- [ ] Feedback khác → agent update docs/issues và reply
