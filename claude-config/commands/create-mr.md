# /create-mr — Create a Merge Request

Consolidate feature branches and create a Merge Request targeting main.

## Steps

1. Get the list of completed issues from the **docs repo** (where issues live):
```bash
# issueProjectId is provided in context — use it to fetch issue details from the docs repo
for IID in {issueIids split by comma}; do
  glab api "projects/{issueProjectId}/issues/$IID" | jq '{iid: .iid, title: .title}'
done
```
Extract IIDs and titles. Use `{issueProjectId}` (not the current code repo's project ID) for all issue API calls.

2. **Consolidate branches** (if multiple feature branches):
```bash
git fetch origin
git checkout -b feature/sprint-$(date +%Y%m%d) origin/main
# For each issue branch:
git merge feature/issue-{iid}-{slug} --no-edit
# If conflict: resolve, then git add -A && git commit
git push -u origin feature/sprint-$(date +%Y%m%d)
```

3. Build the MR description:
```markdown
## 🔀 Implementation Complete

### Summary
{brief summary of all changes}

### Related Issues
{for each issue:}
- Closes #{iid} — {title}

### Changes
{bullet list of major changes}

### Testing
- [ ] Unit tests pass
- [ ] Manual testing completed

### Documentation
- [ ] Architecture doc updated
- [ ] README updated
```

4. Create the MR:
```bash
glab mr create \
  --source-branch "feature/sprint-{date}" \
  --target-branch "main" \
  --title "feat: complete implementation - {project name}" \
  --description "{description}" \
  --label "phase:review"
```

5. **Output the MR IID** on its own line:
```
MR_IID: {number}
```

## Input

The prompt should provide:
- `issueIids` — comma-separated list of issue IIDs to include
- `issueProjectId` — GitLab project ID of the **docs repo** where issues are tracked
- `projectId` — GitLab project ID of the **current code repo** (for MR creation)
- `repoName` — name of the current code repo

## Important

- Always output `MR_IID: {number}` so the orchestrator can capture it
- Use `Closes #N` for each issue to auto-close on merge
- If only one feature branch exists, use it directly (skip consolidation)
