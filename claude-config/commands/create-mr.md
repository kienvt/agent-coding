---
name: create-mr
description: Consolidate feature branches and create a Merge Request targeting main
argument-hint: issueIids=<iid1,iid2> issueProjectId=<id> projectId=<id> repoName=<name>
allowed-tools: Read, Bash
---

Consolidate feature branches and create an MR. Context: $ARGUMENTS

## Steps

1. Fetch issue details from the docs repo (use `issueProjectId` from context):
```bash
for IID in $ISSUE_IID_LIST; do
  glab api "projects/$ISSUE_PROJECT_ID/issues/$IID" | jq '{iid: .iid, title: .title}'
done
```

2. **Consolidate branches** (if multiple feature branches):
```bash
git fetch origin
SPRINT_BRANCH="feature/sprint-$(date +%Y%m%d)"
git checkout -b "$SPRINT_BRANCH" origin/main
# For each issue branch:
git merge "feature/issue-$IID-$SLUG" --no-edit
git push -u origin "$SPRINT_BRANCH"
```

3. Create the MR:
```bash
glab mr create \
  --source-branch "$SPRINT_BRANCH" \
  --target-branch "main" \
  --title "feat: complete implementation - $REPO_NAME" \
  --description "$DESCRIPTION" \
  --label "phase:review"
```

MR description must include `Closes #IID` for each issue to auto-close on merge.

4. **Output on its own line**:
```
MR_IID: {number}
```

## Rules

- Always output `MR_IID: {number}` so the orchestrator can capture it
- If only one feature branch, use it directly (skip consolidation)
- Use `$ISSUE_PROJECT_ID` (docs repo) for issue API calls, not the current code repo ID
