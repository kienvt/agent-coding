import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
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

export async function runPhase3(projectSlug: string): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === projectSlug)
  if (!projectGroup) {
    log.warn({ projectSlug }, 'No project group config found')
    return
  }

  await stateManager.transitionGroupPhase(projectSlug, 'MR_CREATED')

  const codeRepos = projectGroup.repositories.filter((r) => r.role === 'code')
  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'

  // Create an MR per code repo
  for (const repo of codeRepos) {
    const repoAbsPath = path.resolve(workspacePath, repo.local_path)

    let repoState = await stateManager.getRepoState(projectSlug, repo.name)
    if (!repoState) {
      await stateManager.initRepoState(projectSlug, repo.name, repo.gitlab_project_id)
      repoState = await stateManager.getRepoState(projectSlug, repo.name)
    }

    const iids = repoState?.issueIids ?? []

    const prompt = invokeSkill('create-mr', {
      issueIids: iids.join(','),
      projectId: repo.gitlab_project_id,
      issueProjectId: docsRepo?.gitlab_project_id ?? repo.gitlab_project_id,
      repoName: repo.name,
    })

    log.info({ projectSlug, repo: repo.name }, 'Creating MR for code repo')

    const result = await agentRunner.run({
      prompt,
      cwd: repoAbsPath,
      projectSlug,
      onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
    })

    const mrIid = parseMrIid(result.output)
    if (mrIid) {
      await stateManager.setMR(projectSlug, repo.name, mrIid)
      log.info({ projectSlug, repo: repo.name, mrIid }, 'MR IID saved')
    } else {
      log.warn({ projectSlug, repo: repo.name }, 'Could not parse MR IID from agent output')
    }
  }

  await stateManager.transitionGroupPhase(projectSlug, 'AWAITING_MR_REVIEW')
}

export async function handleMRReviewEvent(event: MRReviewEvent): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === event.projectSlug)
  if (!projectGroup) return

  const groupState = await stateManager.getGroupState(event.projectSlug)
  if (!groupState) return

  // Find the repo that owns this MR
  const repoStates = await stateManager.getAllRepoStates(event.projectSlug)
  const ownerRepo = repoStates.find((rs) => rs.mrIid === event.mrIid)

  if (event.action === 'approved') {
    if (!ownerRepo) {
      log.warn({ projectSlug: event.projectSlug, mrIid: event.mrIid }, 'Approved MR not matched to any repo')
      return
    }

    log.info({ projectSlug: event.projectSlug, mrIid: event.mrIid, repo: ownerRepo.repoName }, 'MR approved')
    await stateManager.transitionRepoPhase(event.projectSlug, ownerRepo.repoName, 'MR_APPROVED')

    const codeRepoNames = projectGroup.repositories
      .filter((r) => r.role === 'code')
      .map((r) => r.name)
    const allApproved = await stateManager.areAllCodeRepoMRsApproved(event.projectSlug, codeRepoNames)
    if (allApproved) {
      log.info({ projectSlug: event.projectSlug }, 'All code repo MRs approved — triggering Phase 4')
      await stateManager.transitionGroupPhase(event.projectSlug, 'MR_APPROVED')
      await runPhase4(event.projectSlug)
    }
    return
  }

  if (event.action === 'changes_requested' || event.action === 'commented') {
    if (!ownerRepo) return

    const repoConfig = projectGroup.repositories.find((r) => r.name === ownerRepo.repoName)
    if (!repoConfig) return

    const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
    const repoAbsPath = path.resolve(workspacePath, repoConfig.local_path)

    const prompt = invokeSkill('handle-review-changes', {
      mrIid: event.mrIid,
    })

    await agentRunner.run({
      prompt,
      cwd: repoAbsPath,
      projectSlug: event.projectSlug,
    })
  }
}
