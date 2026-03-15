import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { RepositoryConfig } from '../config/index.js'
import type { IssueCommentEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
import { createLogger } from '../utils/logger.js'
import { runPhase3 } from './phase3-review.js'

const log = createLogger('phase2-implement')

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

    const prompt = invokeSkill('implement-issue', {
      issueIid: nextIid,
      projectId: repo.gitlab_project_id,
    })

    try {
      await agentRunner.run({
        prompt,
        cwd: repoAbsPath,
        projectId,
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
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const bodyLower = event.body.toLowerCase().trim()
  if (bodyLower.includes('approve') || bodyLower.includes('lgtm')) {
    await agentRunner.run({
      prompt: invokeSkill('handle-plan-feedback', {
        authorUsername: event.authorUsername,
        issueIid: event.issueIid,
        feedbackBody: event.body,
      }),
      cwd: repoAbsPath,
      projectId: event.projectId,
    })
    return
  }

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
