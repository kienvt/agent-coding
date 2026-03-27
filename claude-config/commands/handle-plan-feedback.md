---
name: handle-plan-feedback
description: Address feedback on the project plan from a GitLab issue comment
argument-hint: authorUsername=<username> issueIid=<iid> feedbackBody=<text>
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Execute the **handle-plan-feedback** skill workflow. Context:

$ARGUMENTS

Follow all steps in `.claude/skills/handle-plan-feedback/SKILL.md` precisely.
