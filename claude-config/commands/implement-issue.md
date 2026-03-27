# /implement-issue — Phase 2: Implement a single GitLab issue

Fetch issue details, create a feature branch, implement the code, write tests, commit, push, and update the issue status.

You are running in the **code repository** (`repoName`).
The GitLab issue lives in the **docs repository** (`issueProjectId`). Use the `--repo-id` flag or change to the docs repo context for all `glab issue` operations.

## Context (provided in prompt)

- `issueIid` — GitLab issue IID number
- `issueProjectId` — GitLab project ID of the **docs repository** (where the issue was created)
- `repoName` — name of the current **code repository** you are implementing in
- `projectSlug` — project group identifier (for reference only)

## Steps

### Step 1 — Fetch issue details

Issues live in the docs repository. Use the project ID explicitly:

```bash
ISSUE_JSON=$(glab api "projects/{issueProjectId}/issues/{issueIid}")
echo "$ISSUE_JSON"
```

Extract: title, description, acceptance criteria, labels, dependencies.

### Step 2 — Create feature branch

```bash
git fetch origin
SLUG=$(echo "{issue title}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-40)
git checkout -b feature/issue-{issueIid}-$SLUG origin/main
```

Update issue status in docs repo:
```bash
glab api "projects/{issueProjectId}/issues/{issueIid}" \
  --method PUT \
  --field "labels=phase:implement,repo:{repoName},status:in-progress"
```

### Step 3 — Read architecture context

Before writing any code, read the architecture documents from the docs repository:
- The docs repo's path can be found via `git remote -v` on a sibling directory, or the docs are often linked in the issue description
- Alternatively, look for `docs/` in the parent workspace directory

Read these files if available in the issue description or via workspace path:
- `docs/architecture.md` — system design overview
- `docs/api-documentation.md` — API contracts
- Explore existing `src/` in the current code repo to understand patterns, naming conventions, and project structure

### Step 4 — Implement

Write all required code files:
- Follow existing code patterns, naming conventions, and file structure in `{repoName}`
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

### Step 7 — Update issue in docs repo

```bash
# Update labels to mark done
glab api "projects/{issueProjectId}/issues/{issueIid}" \
  --method PUT \
  --field "labels=phase:implement,repo:{repoName},status:done"

# Post completion note
glab api "projects/{issueProjectId}/issues/{issueIid}/notes" \
  --method POST \
  --field "body=✅ Implementation complete on branch \`feature/issue-{issueIid}-{slug}\` in repo \`{repoName}\`.

All acceptance criteria met. Ready for review."
```
