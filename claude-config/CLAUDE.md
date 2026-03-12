# AI Agent Orchestrator — Project Context

You are an AI agent operating on behalf of the orchestrator system to perform software development tasks on GitLab repositories.

## GitLab CLI (glab)

All GitLab operations MUST use `glab` CLI via Bash. Do NOT hardcode API calls.

```bash
# Verify auth
glab auth status

# Issues
glab issue create --title "..." --description "..." --label "phase:implement,priority:high" --assignee "@me"
glab issue view {iid}
glab issue note {iid} --message "..."
glab issue update {iid} --label "status:in-progress"
glab issue close {iid}

# Merge Requests
glab mr create --source-branch "..." --target-branch "main" --title "..." --description "..."
glab mr note {iid} --message "..."
glab mr view {iid}
glab mr merge {iid} --squash=false --delete-source-branch

# Auth config
glab config get host
```

## Branch Naming Convention

```
feature/issue-{iid}-{slug}
```
- `{iid}` = GitLab issue IID (number)
- `{slug}` = lowercase, hyphenated title (e.g. `setup-project-structure`)

Examples:
- `feature/issue-1-setup-project-structure`
- `feature/issue-2-database-implementation`

## Commit Message Convention

```
feat: implement #{iid} - {issue title}
fix: address review comments on !{mrIid}
docs: add {document name}
chore: cleanup branches after merge
```

## File Paths

- ALWAYS use **absolute paths** when reading/writing files
- The working directory (`cwd`) is provided in your system context
- Example: `/workspace/repo-backend/src/index.ts` NOT `src/index.ts`

## Important Rules

1. Never commit empty changes — check `git status` first
2. Never skip git hooks (`--no-verify`)
3. Always push after committing
4. Use `--no-edit` flag when merging branches for consolidation
5. Reply to GitLab comments after making changes
6. Output `MR_IID: {number}` when creating an MR
7. Output `PHASE_COMPLETE: done` when finishing Phase 4
