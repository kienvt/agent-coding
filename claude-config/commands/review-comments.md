---
name: review-comments
description: Fetch MR review comments, fix all issues, push and notify reviewer
argument-hint: mrIid=<iid> sourceBranch=<branch>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Address all open MR review comments. Context: $ARGUMENTS

## Steps

1. Fetch all MR notes:
```bash
glab mr note list $MR_IID --output json
```

2. **Filter** — skip:
   - Comments from bot username (`$GITLAB_BOT_USERNAME`)
   - System notes (automated messages)
   - Already resolved threads

3. Group comments by file/context

4. For each unresolved comment:
   - Analyze what change is requested
   - Implement the fix in the relevant file

5. Use the `/commit` command:
```
Message: "fix: address review comments on !$MR_IID"
```

6. Push:
```bash
git push origin "$SOURCE_BRANCH"
```

7. Reply to all addressed comments:
```bash
glab mr note $MR_IID --message "## Review Comments Addressed

All requested changes have been implemented:
[for each comment: - ✅ what was done]

Changes pushed to $SOURCE_BRANCH."
```

8. Re-request review if needed:
```bash
glab mr update $MR_IID --reviewer "$REVIEWER_USERNAME"
```

## Rules

- Fix ALL comments in one pass before committing
- Be specific about what was changed in each reply
- Do not delete or reduce existing test coverage
