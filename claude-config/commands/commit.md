---
name: commit
description: Stage all changes and create a properly formatted git commit
argument-hint: "[feat|fix|docs|chore]: <message> [#iid]"
allowed-tools: Bash
---

Stage and commit all changes.

## Steps

1. Run `git status` — if no changes, output "Nothing to commit" and stop
2. Run `git add -A` to stage all changes
3. Format the commit message:
   - Issue implementation: `feat: implement #$IID - $ISSUE_TITLE`
   - Bug fix: `fix: $DESCRIPTION`
   - Docs: `docs: $DESCRIPTION`
   - Chore: `chore: $DESCRIPTION`
4. Run: `git commit -m "$MESSAGE"`
5. Output the commit SHA

Message hint from `$ARGUMENTS`: $ARGUMENTS
