---
name: handle-plan-feedback
description: Address feedback on the project plan — update docs, commit, reply on issue
user-invocable: false
---

## Context variables

Available from `$ARGUMENTS`:

- `authorUsername` — GitLab username who left the comment
- `issueIid` — issue IID where feedback was posted
- `feedbackBody` — the full text of the comment

## Step 1 — Read current planning state

Read the relevant files in `docs/` to understand the current plan:

- `docs/implementation-plan.md`
- `docs/architecture.md` (if feedback touches architecture)
- `docs/api-documentation.md` (if feedback touches API design)

## Step 2 — Classify the feedback

Determine the type of feedback:

- **Scope change** — adding or removing features → update `docs/implementation-plan.md` and affected docs
- **Architecture feedback** — design concerns → update `docs/architecture.md`
- **API design feedback** — endpoint changes, naming → update `docs/api-documentation.md`
- **Clarification / question** — no document change needed, just reply
- **Correction** — factual error → fix the specific document

## Step 3 — Apply changes

Make the necessary updates to the affected documents.

If the feedback results in new or removed tasks, update `docs/implementation-plan.md` accordingly.

## Step 4 — Commit and push

Use the `/commit` command:

```
Message: "docs: address plan feedback from @{authorUsername}"
```

```bash
git push origin docs/init-plan
```

## Step 5 — Ensure Merge Request exists

Check if an open MR already exists for this branch:

```bash
glab mr list --source-branch docs/init-plan --state opened
```

- If **no MR exists** → create one:

```bash
glab mr create \
  --source-branch "docs/init-plan" \
  --target-branch "main" \
  --title "docs: update planning documents based on feedback" \
  --description "Updated planning documents addressing feedback from @{authorUsername}." \
  --assignee "@me"
```

- If **MR already exists** → no action needed (new commit is already reflected in the MR).

## Step 6 — Reply on the issue

Use the `issueIid` value from the arguments above:

```bash
glab issue note {issueIid} --message "✅ Feedback addressed: [brief 1-2 sentence summary of changes made]

@{authorUsername} — please review the updated documents and comment **'approve'** when ready."
```

If no document changes were needed (pure clarification), skip Steps 4–5 and reply directly.
