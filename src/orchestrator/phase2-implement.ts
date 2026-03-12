import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { RepositoryConfig } from '../config/index.js'
import type { IssueCommentEvent } from '../queue/types.js'
import { createLogger } from '../utils/logger.js'
import { runPhase3 } from './phase3-review.js'

const log = createLogger('phase2-implement')

function buildImplementPrompt(
  iid: number,
  repo: RepositoryConfig,
  repoAbsPath: string,
): string {
  return `Implement GitLab issue #${iid} for project ${repo.name}.
GitLab project ID: ${repo.gitlab_project_id}
Working directory: ${repoAbsPath}

STEP 1 — FETCH ISSUE DETAILS:
  glab issue view ${iid} --output json

STEP 2 — SETUP BRANCH:
  git fetch origin
  git checkout -b feature/issue-${iid}-$(glab issue view ${iid} | head -1 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-40) origin/main
  (Use the issue title to form the branch slug)

STEP 3 — UPDATE ISSUE STATUS:
  glab issue update ${iid} --label "status:in-progress"

STEP 4 — READ CONTEXT:
  Read docs/architecture.md and docs/api-documentation.md for architecture guidance.
  Explore existing codebase structure.

STEP 5 — IMPLEMENT:
  Write all required code files following existing patterns.
  Handle errors properly. Follow the acceptance criteria from the issue.

STEP 6 — WRITE TESTS:
  Write unit tests for new functions in the correct test directory.

STEP 7 — USE /commit skill:
  Message: "feat: implement #${iid} - {issue title}"

STEP 8 — PUSH:
  git push -u origin {branch-name}

STEP 9 — UPDATE ISSUE:
  glab issue update ${iid} --label "status:done"
  glab issue note ${iid} --message "✅ Implementation complete on branch feature/issue-${iid}-*. All acceptance criteria met."

Always use absolute file paths starting with ${repoAbsPath}.`
}

export async function startImplementationLoop(projectId: number): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === projectId)
  if (!repo) {
    log.warn({ projectId }, 'No repo config found')
    return
  }

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  while (true) {
    const nextIid = await stateManager.getNextPendingIssue(projectId)

    if (nextIid === null) {
      log.info({ projectId }, 'All issues done — transitioning to ALL_ISSUES_DONE')
      await stateManager.transitionPhase(projectId, 'ALL_ISSUES_DONE')
      await runPhase3(projectId)
      break
    }

    log.info({ projectId, iid: nextIid }, 'Implementing issue')
    await stateManager.updateIssueStatus(projectId, nextIid, 'IN_PROGRESS')

    const prompt = buildImplementPrompt(nextIid, repo, repoAbsPath)

    try {
      await agentRunner.run({
        prompt,
        cwd: repoAbsPath,
        onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
      })
      await stateManager.updateIssueStatus(projectId, nextIid, 'DONE')
      log.info({ projectId, iid: nextIid }, 'Issue implementation done')
    } catch (err) {
      log.error({ projectId, iid: nextIid, err }, 'Issue implementation failed')
      // Keep as IN_PROGRESS so it can be retried on next feedback
      break
    }
  }
}

export async function handleIssueCommentDuringImplementation(
  event: IssueCommentEvent,
): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const bodyLower = event.body.toLowerCase().trim()
  if (bodyLower.includes('approve') || bodyLower.includes('lgtm')) {
    await agentRunner.run({
      prompt: `User @${event.authorUsername} approved issue #${event.issueIid}. Reply with acknowledgment:
glab issue note ${event.issueIid} --message "👍 Acknowledged, thank you!"`,
      cwd: repoAbsPath,
    })
    return
  }

  const prompt = `User @${event.authorUsername} commented on issue #${event.issueIid}:
"${event.body}"

GitLab project ID: ${repo.gitlab_project_id}
Working directory: ${repoAbsPath}

Classify and handle the comment:
- Bug report → fix the bug on branch feature/issue-${event.issueIid}-*, then push
- Change request → implement the change, then push
- Question → answer with: glab issue note ${event.issueIid} --message "{answer}"

If you make code changes, use /commit skill then git push.
After handling, post a reply comment on the issue.`

  await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
  })
}
