import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { Config, RepositoryConfig } from '../config/index.js'
import type { RequirementPushedEvent, IssueCommentEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('phase1-init')

function parseIssueIids(output: string): number[] {
  const match = output.match(/ISSUE_IIDS:\s*([\d,\s]+)/i)
  if (!match) return []
  return match[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n))
}

export async function handleRequirementPushed(
  event: RequirementPushedEvent,
): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) {
    log.warn({ projectId: event.projectId }, 'No repo config found for project')
    return
  }

  const state = await stateManager.getProjectState(event.projectId)
  if (state && state.phase !== 'IDLE') {
    log.info({ projectId: event.projectId, phase: state.phase }, 'Skipping — not in IDLE phase')
    return
  }

  await stateManager.initProjectState(event.projectId, repo.name, event.filePath)
  await stateManager.transitionPhase(event.projectId, 'ANALYZING')

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)
  const reqFilePath = path.join(repoAbsPath, event.filePath)

  const prompt = invokeSkill('init-plan', {
    requirementFile: reqFilePath,
    repoName: repo.name,
    projectId: repo.gitlab_project_id,
  })

  log.info({ projectId: event.projectId, repoPath: repoAbsPath }, 'Starting Phase 1 agent run')

  const result = await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    projectId: event.projectId,
    onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
  })

  const iids = parseIssueIids(result.output)
  if (iids.length > 0) {
    await stateManager.setIssueList(event.projectId, iids)
    log.info({ projectId: event.projectId, iids }, 'Issue list set')
  } else {
    log.warn({ projectId: event.projectId }, 'No issue IIDs found in agent output')
  }

  await stateManager.transitionPhase(event.projectId, 'AWAITING_REVIEW')
}

export async function handlePlanFeedback(
  event: IssueCommentEvent,
  config: Config,
): Promise<void> {
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const prompt = invokeSkill('handle-plan-feedback', {
    authorUsername: event.authorUsername,
    issueIid: event.issueIid,
    feedbackBody: event.body,
  })

  await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    projectId: event.projectId,
  })
}
