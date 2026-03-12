# /create-mr — Create a Merge Request

Consolidate feature branches and create a Merge Request targeting main.

## Steps

1. Get the list of completed issues:
```bash
glab issue list --label "phase:implement,status:done" --output json
```
Extract IIDs and titles.

2. **Consolidate branches** (if multiple feature branches):
```bash
git fetch origin
git checkout -b feature/sprint-$(date +%Y%m%d) main
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
- List of issue IIDs
- Project/repo context
- Working directory

## Important

- Always output `MR_IID: {number}` so the orchestrator can capture it
- Use `Closes #N` for each issue to auto-close on merge
- If only one feature branch exists, use it directly (skip consolidation)
