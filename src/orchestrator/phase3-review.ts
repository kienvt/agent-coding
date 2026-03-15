import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { RepositoryConfig } from '../config/index.js'
import type { MRReviewEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
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
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === projectId)
  if (!repo) {
    log.warn({ projectId }, 'No repo config found')
    return
  }

  await stateManager.transitionPhase(projectId, 'MR_CREATED')

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const state = await stateManager.getProjectState(projectId)
  const iids = state?.issueIids ?? []

  const prompt = invokeSkill('create-mr', {
    issueIids: iids.join(','),
    projectId: repo.gitlab_project_id,
    repoName: repo.name,
  })

  log.info({ projectId }, 'Starting Phase 3 — creating MR')

  const result = await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    projectId,
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
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const state = await stateManager.getProjectState(event.projectId)
  if (!state) return

  if (event.action === 'approved') {
    log.info({ projectId: event.projectId, mrIid: event.mrIid }, 'MR approved — triggering Phase 4')
    await stateManager.transitionPhase(event.projectId, 'MR_APPROVED')
    await runPhase4(event.projectId)
    return
  }

  if (event.action === 'changes_requested' || event.action === 'commented') {
    const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
    const repoAbsPath = path.resolve(workspacePath, repo.local_path)

    const prompt = invokeSkill('handle-review-changes', {
      mrIid: event.mrIid,
    })

    await agentRunner.run({
      prompt,
      cwd: repoAbsPath,
      projectId: event.projectId,
    })
  }
}
