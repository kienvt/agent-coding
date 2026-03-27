---
name: create-issues
description: Read implementation plan and create GitLab issues with repo routing labels
argument-hint: planFile=<path> projectId=<id>
allowed-tools: Read, Bash
---

Read the implementation plan and create GitLab issues. Context: $ARGUMENTS

## Steps

1. Read the implementation plan file (path from context or default `docs/implementation-plan.md`)
2. Parse all tasks — each becomes one issue
3. For each task, create an issue with a `repo:` label for Phase 2 routing:

```bash
glab issue create \
  --title "$TASK_TITLE" \
  --description "$DESCRIPTION" \
  --label "phase:implement,priority:$PRIORITY,repo:$TARGET_REPO" \
  --assignee "@me"
```

4. Collect the IID from each create output
5. Output:

```
ISSUE_IIDS: 1,2,3,4,5
```

## Issue description template

```markdown
## Description
$TASK_DESCRIPTION

## Acceptance Criteria
- [ ] $CRITERIA

## Technical Notes
$NOTES

## Dependencies
- Depends on: #IID (if applicable)
```

## Priority mapping

- Project setup: `priority:critical`
- Core features: `priority:high`
- Secondary features: `priority:medium`
- Nice-to-have: `priority:low`

## Rules

- Order by dependency (foundation before features)
- Each issue should be implementable in 1-2 hours
- The `repo:` label is **required** — it routes the issue to the correct code repo in Phase 2
