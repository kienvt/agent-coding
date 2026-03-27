---
name: handle-review-changes
description: Address all open MR review comments — fetch, fix, commit, push, notify reviewer
user-invocable: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

## Context variables

Available from `$ARGUMENTS`:
- `mrIid` — Merge Request IID

## Step 1 — Fetch review comments

Use the `/review-comments` command with the MR IID to fetch and parse all unresolved comments.

## Step 2 — Determine the source branch

```bash
MR_JSON=$(glab mr view $MR_IID --output json)
SOURCE_BRANCH=$(echo "$MR_JSON" | jq -r '.source_branch')
```

Extract `source_branch` to know which branch to push fixes to.

## Step 3 — Check out the branch

```bash
git fetch origin
git checkout "$SOURCE_BRANCH"
```

## Step 4 — Address each unresolved comment

For each comment, apply the appropriate action:

- **Bug report / broken code** → locate the file and line, fix the issue
- **Style / naming / formatting** → apply the requested change
- **Logic improvement** → refactor as suggested (use judgment if unclear)
- **Question needing code change** → make the change, note it in reply
- **Question not requiring code change** → reply with explanation only (no commit needed for this alone)

## Step 5 — Commit and push

Use the `/commit` command:
```
Message: "fix: address review comments on !$MR_IID"
```

```bash
git push origin "$SOURCE_BRANCH"
```

## Step 6 — Notify reviewer

```bash
glab mr note $MR_IID --message "All review comments have been addressed.

[brief summary of changes — 2-4 bullet points]

Ready for re-review. ✅"
```
