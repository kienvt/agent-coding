# /implement-issue — Phase 2: Implement a single GitLab issue

Fetch issue details, create a feature branch, implement the code, write tests, commit, push, and update the issue status.

## Context (provided in prompt)

- `issueIid` — GitLab issue IID number
- `projectId` — GitLab project ID

## Steps

### Step 1 — Fetch issue details

```bash
glab issue view {issueIid} --output json
```

Extract: title, description, acceptance criteria, labels, dependencies.

### Step 2 — Create feature branch

```bash
git fetch origin
SLUG=$(glab issue view {issueIid} | head -1 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-40)
git checkout -b feature/issue-{issueIid}-$SLUG origin/main
glab issue update {issueIid} --label "status:in-progress"
```

### Step 3 — Read architecture context

Before writing any code:
- Read `docs/architecture.md` to understand the system design
- Read `docs/api-documentation.md` for API contracts
- Explore existing `src/` directory to understand patterns, naming conventions, and project structure

### Step 4 — Implement

Write all required code files:
- Follow existing code patterns, naming conventions, and file structure
- Fulfill every acceptance criterion listed in the issue
- Handle errors gracefully with appropriate HTTP status codes or thrown errors
- Use the project's existing utilities (logger, error classes, etc.)

### Step 5 — Write tests

Write tests alongside implementation:
- Unit tests for business logic functions
- Integration tests for API endpoints (if applicable)
- Place tests in the directory structure mirroring `src/` (e.g., `src/foo/bar.ts` → `tests/foo/bar.test.ts`)

### Step 6 — Commit and push

Use `/commit` skill:
```
Message: "feat: implement #{issueIid} - {issue title}"
```

```bash
git push -u origin feature/issue-{issueIid}-{slug}
```

### Step 7 — Update issue

```bash
glab issue update {issueIid} --label "status:done"
glab issue note {issueIid} --message "✅ Implementation complete on branch \`feature/issue-{issueIid}-{slug}\`.

All acceptance criteria met. Ready for review."
```
