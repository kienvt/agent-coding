---
name: phase-done
description: Phase 4 — Merge MR, close all issues, clean up branches, post final summary
argument-hint: mrIid=<iid> issueIids=<iid1,iid2,...> projectId=<id>
disable-model-invocation: true
allowed-tools: Read, Bash
---

Execute the **phase-done** skill workflow. Context:

$ARGUMENTS

Follow all steps in `.claude/skills/phase-done/SKILL.md` precisely.
