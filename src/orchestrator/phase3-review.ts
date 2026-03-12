import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { RepositoryConfig } from '../config/index.js'
import type { MRReviewEvent } from '../queue/types.js'
import { createLogger } from '../utils/logger.js'
import { runPhase4 } from './phase4-done.js'

const log = createLogger('phase3-review')

function parseMrIid(output: string): number | null {
  const match = output.match(/MR_IID:\s*(\d+)/i)
  if (!match) return null
  return parseInt(match[1], 10)
}

export async function runPhase3(projectId: number): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === projectId)
  if (!repo) {
    log.warn({ projectId }, 'No repo config found')
    return
  }

  await stateManager.transitionPhase(projectId, 'MR_CREATED')

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const state = await stateManager.getProjectState(projectId)
  const iids = state?.issueIids ?? []

  const prompt = `All issues have been implemented for project ${repo.name}.
GitLab project ID: ${repo.gitlab_project_id}
Working directory: ${repoAbsPath}
Implemented issues: ${iids.join(', ')}

USE /create-mr skill to create the Merge Request.

STEP 1 — GET ISSUE LIST:
  glab issue list --label "phase:implement,status:done" --output json
  Extract: IIDs and titles

STEP 2 — USE /create-mr skill:
  Source branch: feature branches (consolidate if multiple)
  Target branch: main
  Include "Closes #N" for each issue

  If multiple feature branches exist:
    git fetch origin
    git checkout -b feature/sprint-$(date +%Y%m%d) main
    git merge feature/issue-* --no-edit (for each branch)
    git push -u origin feature/sprint-$(date +%Y%m%d)

STEP 3 — OUTPUT MR IID on its own line:
  MR_IID: {number}

STEP 4 — NOTIFY USER:
  glab mr note {mrIid} --message "🤖 All ${iids.length} issues implemented. MR ready for review!"

Always use absolute paths starting with ${repoAbsPath}.`

  log.info({ projectId }, 'Starting Phase 3 — creating MR')

  const result = await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
  })

  const mrIid = parseMrIid(result.output)
  if (mrIid) {
    await stateManager.setMR(projectId, mrIid)
    log.info({ projectId, mrIid }, 'MR IID saved')
  } else {
    log.warn({ projectId }, 'Could not parse MR IID from agent output')
  }

  await stateManager.transitionPhase(projectId, 'AWAITING_MR_REVIEW')
}

export async function handleMRReviewEvent(event: MRReviewEvent): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const state = await stateManager.getProjectState(event.projectId)
  if (!state) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  if (event.action === 'approved') {
    log.info({ projectId: event.projectId, mrIid: event.mrIid }, 'MR approved — triggering Phase 4')
    await stateManager.transitionPhase(event.projectId, 'MR_APPROVED')
    await runPhase4(event.projectId)
    return
  }

  if (event.action === 'changes_requested' || event.action === 'commented') {
    const prompt = `The user requested changes on MR !${event.mrIid} for project ${repo.name}.
GitLab project ID: ${repo.gitlab_project_id}
Working directory: ${repoAbsPath}

USE /review-comments skill:
  MR IID: ${event.mrIid}

After addressing all review comments:
  - Use /commit skill: "fix: address review comments on !${event.mrIid}"
  - git push origin {sourceBranch}
  - Update MR: glab mr note ${event.mrIid} --message "All review comments addressed. Ready for re-review."

Always use absolute paths starting with ${repoAbsPath}.`

    await agentRunner.run({
      prompt,
      cwd: repoAbsPath,
    })
  }
}
