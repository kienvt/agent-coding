---
name: phase-done
description: Phase 4 final workflow — merge MR, close all issues, clean up branches, post summary
user-invocable: false
---

## Context variables

Available from `$ARGUMENTS`:

- `mrIid` — Merge Request IID to merge
- `issueIids` — comma-separated list of issue IIDs to close
- `projectId` — GitLab project ID

## Step 1 — Merge the MR

```bash
glab mr merge $MR_IID --squash=false --delete-source-branch
```

If merge fails due to conflicts:

```bash
SOURCE_BRANCH=$(glab mr view $MR_IID --output json | jq -r '.source_branch')
git fetch origin
git checkout "$SOURCE_BRANCH"
git merge origin/main
# resolve conflicts, then:
git add -A
git commit -m "chore: resolve merge conflicts before merge"
git push origin "$SOURCE_BRANCH"
glab mr merge $MR_IID --squash=false --delete-source-branch
```

## Step 2 — Verify merge

```bash
glab mr view $MR_IID --output json
```

Confirm `state === "merged"` before proceeding.

## Step 3 — Close all issues

For each issue IID in the provided list:

```bash
for IID in $(echo "$ISSUE_IIDS" | tr ',' ' '); do
  glab issue close $IID
  glab issue note $IID --message "✅ Closed — implemented and merged in MR !$MR_IID"
done
```

## Step 4 — Clean up local branches

```bash
git fetch --prune
git checkout main
git pull origin main
git branch | grep 'feature/issue-' | xargs git branch -d 2>/dev/null || true
```

## Step 5 — Post final summary

```bash
glab mr note $MR_IID --message "## 🎉 Project Complete!

**Merged:** $(date -u +%Y-%m-%dT%H:%M:%SZ)

### Implemented Issues
[list each closed issue: - ✅ #IID]

### What was built
[2-3 sentence summary of what was implemented]

---
*Completed by AI Agent Orchestrator*"
```

## Output

Must output on its own line (used by orchestrator to detect completion):

```
PHASE_COMPLETE: done
```
