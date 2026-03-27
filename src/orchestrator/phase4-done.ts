import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import { invokeSkill } from '../utils/skill.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('phase4-done')

export async function runPhase4(projectSlug: string): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === projectSlug)
  if (!projectGroup) {
    log.warn({ projectSlug }, 'No project group config found')
    return
  }

  const groupState = await stateManager.getGroupState(projectSlug)
  if (!groupState) {
    log.warn({ projectSlug }, 'No group state found')
    return
  }

  await stateManager.transitionGroupPhase(projectSlug, 'MERGING')

  const codeRepos = projectGroup.repositories.filter((r) => r.role === 'code')
  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  let allComplete = true

  for (const repo of codeRepos) {
    const repoState = await stateManager.getRepoState(projectSlug, repo.name)
    const repoAbsPath = path.resolve(workspacePath, repo.local_path)

    const prompt = invokeSkill('phase-done', {
      mrIid: repoState?.mrIid ?? null,
      issueIids: (repoState?.issueIids ?? []).join(','),
      projectId: repo.gitlab_project_id,
      repoName: repo.name,
    })

    log.info({ projectSlug, repo: repo.name, mrIid: repoState?.mrIid }, 'Starting Phase 4 — merge and cleanup')

    const result = await agentRunner.run({
      prompt,
      cwd: repoAbsPath,
      projectSlug,
      onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
    })

    if (result.output.includes('PHASE_COMPLETE: done')) {
      await stateManager.transitionRepoPhase(projectSlug, repo.name, 'COMPLETE')
      log.info({ projectSlug, repo: repo.name }, 'Repo phase complete')
    } else {
      log.warn({ projectSlug, repo: repo.name }, 'PHASE_COMPLETE not found in agent output')
      allComplete = false
    }
  }

  if (allComplete) {
    await stateManager.transitionGroupPhase(projectSlug, 'COMPLETE')
    log.info({ projectSlug }, 'Project complete!')
  } else {
    log.warn({ projectSlug }, 'Some repos did not complete — group phase not set to COMPLETE')
  }
}
