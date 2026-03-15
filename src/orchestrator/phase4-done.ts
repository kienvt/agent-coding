import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import { invokeSkill } from '../utils/skill.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('phase4-done')

export async function runPhase4(projectId: number): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === projectId)
  if (!repo) {
    log.warn({ projectId }, 'No repo config found')
    return
  }

  const state = await stateManager.getProjectState(projectId)
  if (!state) {
    log.warn({ projectId }, 'No state found')
    return
  }

  await stateManager.transitionPhase(projectId, 'MERGING')

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const prompt = invokeSkill('phase-done', {
    mrIid: state.mrIid ?? null,
    issueIids: state.issueIids.join(','),
    projectId: repo.gitlab_project_id,
  })

  log.info({ projectId, mrIid: state.mrIid }, 'Starting Phase 4 — merge and cleanup')

  const result = await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    projectId,
    onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
  })

  if (result.output.includes('PHASE_COMPLETE: done')) {
    await stateManager.transitionPhase(projectId, 'COMPLETE')
    log.info({ projectId }, 'Project complete!')
  } else {
    log.warn({ projectId }, 'PHASE_COMPLETE not found in agent output')
  }
}
