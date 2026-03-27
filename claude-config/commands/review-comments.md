# /review-comments — Address MR Review Comments

Fetch MR review comments, fix the code, and reply to each comment.

## Steps

1. Fetch all MR notes:
```bash
glab mr note list {mrIid} --output json
```

2. **Filter** — skip:
   - Comments from bot username (check `GITLAB_BOT_USERNAME`)
   - System notes (automated messages)
   - Already resolved threads

3. **Group** comments by file/context

4. For each unresolved comment:
   - Analyze what change is requested
   - Implement the fix in the relevant file
   - Note what was changed

5. After fixing all comments, use `/commit` skill:
```
Use /commit skill: "fix: address review comments on !{mrIid}"
```

6. Push changes:
```bash
git push origin {sourceBranch}
```

7. Reply to all addressed comments:
```bash
glab mr note {mrIid} --message "## Review Comments Addressed

All requested changes have been implemented:
{for each comment:}
- ✅ {comment summary}: {what was done}

Changes pushed to {sourceBranch}."
```

8. Re-request review if needed:
```bash
glab mr update {mrIid} --reviewer "{reviewer username}"
```

## Input

The prompt should provide:
- MR IID
- Source branch name
- Working directory / repo context

## Important

- Fix ALL comments in one pass before committing
- Be specific in the reply about what was changed
- If a comment is unclear, ask for clarification via a reply note
- Do not delete or modify existing test coverage
