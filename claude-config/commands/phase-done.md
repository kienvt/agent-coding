# /phase-done — Phase 4: Merge MR, close issues, and finalize project

Merge the approved MR, close all implementation issues, clean up branches, and post a final summary.

## Context (provided in prompt)

- `mrIid` — Merge Request IID to merge
- `issueIids` — comma-separated list of issue IIDs to close
- `projectId` — GitLab project ID

## Steps

### Step 1 — Merge the MR

```bash
glab mr merge {mrIid} --squash=false --delete-source-branch
```

If merge fails due to conflicts:
```bash
glab mr view {mrIid} --output json  # get source_branch
git fetch origin
git checkout {sourceBranch}
git merge origin/main
# resolve conflicts, then:
git add -A
git commit -m "chore: resolve merge conflicts before merge"
git push origin {sourceBranch}
glab mr merge {mrIid} --squash=false --delete-source-branch
```

### Step 2 — Verify merge

```bash
glab mr view {mrIid} --output json
```

Confirm `state === "merged"` before proceeding.

### Step 3 — Close all issues

For each issue IID in the provided list:
```bash
glab issue close {iid}
glab issue note {iid} --message "✅ Closed — implemented and merged in MR !{mrIid}"
```

### Step 4 — Clean up local branches

```bash
git fetch --prune
git checkout main
git pull origin main
```

Delete any remaining local feature branches:
```bash
git branch | grep 'feature/issue-' | xargs git branch -d 2>/dev/null || true
```

### Step 5 — Post final summary

```bash
glab mr note {mrIid} --message "## 🎉 Project Complete!

**Merged:** $(date -u +%Y-%m-%dT%H:%M:%SZ)

### Implemented Issues
{for each issue: - ✅ #{iid}}

### What was built
{2-3 sentence summary of what was implemented}

---
*Completed by AI Agent Orchestrator*"
```

## Output

Must output on its own line (used by orchestrator to detect completion):
```
PHASE_COMPLETE: done
```
