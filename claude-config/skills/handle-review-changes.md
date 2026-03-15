# /handle-review-changes — Address MR review comments

Fetch all open review comments on the MR, address each one, then push and notify the reviewer.

## Context (provided in prompt)

- `mrIid` — Merge Request IID

## Steps

### Step 1 — Fetch review comments

Use `/review-comments` skill with the MR IID to fetch and parse all unresolved comments.

### Step 2 — Determine the source branch

```bash
glab mr view {mrIid} --output json
```

Extract `source_branch` to know which branch to push fixes to.

### Step 3 — Check out the branch

```bash
git fetch origin
git checkout {sourceBranch}
```

### Step 4 — Address each unresolved comment

For each comment, apply the appropriate action:

- **Bug report / broken code** → locate the file and line, fix the issue
- **Style / naming / formatting** → apply the requested change
- **Logic improvement** → refactor as suggested (use judgment if unclear)
- **Question needing code change** → make the change, note it in reply
- **Question not requiring code change** → reply with explanation only (no commit needed for this alone)

### Step 5 — Commit and push

Use `/commit` skill:
```
Message: "fix: address review comments on !{mrIid}"
```

```bash
git push origin {sourceBranch}
```

### Step 6 — Notify reviewer

```bash
glab mr note {mrIid} --message "All review comments have been addressed.

{brief summary of changes — 2-4 bullet points}

Ready for re-review. ✅"
```
