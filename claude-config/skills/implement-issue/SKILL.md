---
name: implement-issue
description: Full Phase 2 workflow — fetch issue, create branch, implement code, write tests, commit, push, update issue
user-invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

You are running in the **code repository** for the target repo.
The GitLab issue lives in the **docs repository**. Use `issueProjectId` for all `glab issue` operations.

## Context variables

Available from `$ARGUMENTS`:
- `issueIid` — GitLab issue IID number
- `issueProjectId` — GitLab project ID of the **docs repository** (where the issue was created)
- `repoName` — name of the current **code repository** you are implementing in
- `projectSlug` — project group identifier (for reference only)

## Step 1 — Fetch issue details

Issues live in the docs repository. Use the project ID explicitly:

```bash
ISSUE_JSON=$(glab api "projects/$ISSUE_PROJECT_ID/issues/$ISSUE_IID")
echo "$ISSUE_JSON"
```

Where `$ISSUE_PROJECT_ID` = value of `issueProjectId` from context, `$ISSUE_IID` = value of `issueIid`.

Extract: title, description, acceptance criteria, labels, dependencies.

## Step 2 — Create feature branch

```bash
git fetch origin
ISSUE_TITLE="<title from issue>"
SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-40)
BRANCH="feature/issue-$ISSUE_IID-$SLUG"
git checkout -b "$BRANCH" origin/main
```

Update issue status in docs repo:
```bash
glab api "projects/$ISSUE_PROJECT_ID/issues/$ISSUE_IID" \
  --method PUT \
  --field "labels=phase:implement,repo:$REPO_NAME,status:in-progress"
```

## Step 3 — Read architecture context

Before writing any code, read the architecture documents from the docs repository:
- Look for `docs/` in the parent workspace directory (sibling of current repo)
- Or check issue description for links to docs

Read these files if available:
- `docs/architecture.md` — system design overview
- `docs/api-documentation.md` — API contracts
- Explore existing `src/` in the current code repo to understand patterns, naming conventions, and project structure

## Step 4 — Implement

Write all required code files:
- Follow existing code patterns, naming conventions, and file structure in the current repo
- Fulfill every acceptance criterion listed in the issue
- Handle errors gracefully with appropriate HTTP status codes or thrown errors
- Use the project's existing utilities (logger, error classes, etc.)

## Step 5 — Write tests

Write tests alongside implementation:
- Unit tests for business logic functions
- Integration tests for API endpoints (if applicable)
- Place tests in the directory structure mirroring `src/` (e.g., `src/foo/bar.ts` → `tests/foo/bar.test.ts`)

## Step 6 — Commit and push

Use the `/commit` command:
```
Message: "feat: implement #$ISSUE_IID - $ISSUE_TITLE"
```

```bash
git push -u origin "$BRANCH"
```

## Step 7 — Update issue in docs repo

```bash
# Update labels to mark done
glab api "projects/$ISSUE_PROJECT_ID/issues/$ISSUE_IID" \
  --method PUT \
  --field "labels=phase:implement,repo:$REPO_NAME,status:done"

# Post completion note
glab api "projects/$ISSUE_PROJECT_ID/issues/$ISSUE_IID/notes" \
  --method POST \
  --field "body=✅ Implementation complete on branch \`$BRANCH\` in repo \`$REPO_NAME\`.

All acceptance criteria met. Ready for review."
```
