---
name: handle-review-changes
description: Address all open review comments on an MR
argument-hint: mrIid=<iid>
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Execute the **handle-review-changes** skill workflow. Context:

$ARGUMENTS

Follow all steps in `.claude/skills/handle-review-changes/SKILL.md` precisely.
