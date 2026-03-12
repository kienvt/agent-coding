# /create-issues — Create GitLab Issues from Implementation Plan

Read the implementation plan document and create GitLab issues for each task.

## Steps

1. Read the implementation plan file (path provided in prompt)
2. Parse the list of features/tasks — identify each as a separate issue
3. For each task, create an issue:

```bash
glab issue create \
  --title "{task title}" \
  --description "{description with acceptance criteria and technical notes}" \
  --label "phase:implement,priority:high" \
  --assignee "@me"
```

4. Collect the IID from each `glab issue create` output
5. Output the list of created IIDs in this format:

```
ISSUE_IIDS: 1,2,3,4,5
```

## Issue Description Template

```markdown
## Description
{task description}

## Acceptance Criteria
- [ ] {criteria 1}
- [ ] {criteria 2}

## Technical Notes
{implementation hints, references to architecture/api docs}

## Dependencies
- Depends on: #{iid} (if applicable)
```

## Input

The prompt should provide:
- Path to the implementation plan file
- GitLab project context (project ID, repo name)

## Priority Labels

- First issue (project setup): `priority:critical`
- Core features: `priority:high`
- Secondary features: `priority:medium`
- Nice-to-have: `priority:low`

## Important

- Order issues by dependency (foundation before features)
- Issues should be granular enough to implement in 1-2 hours
- Each issue must have clear acceptance criteria
