import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { IssueCommentEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
import { createLogger } from '../utils/logger.js'
import { runPhase3 } from './phase3-review.js'

const log = createLogger('phase2-implement')

/** Fetch labels for an issue from GitLab API and return the repo:<name> value, or null */
async function fetchIssueRepoLabel(
  projectId: number,
  issueIid: number,
  gitlabUrl: string,
  token: string,
): Promise<string | null> {
  try {
    const url = `${gitlabUrl}/api/v4/projects/${projectId}/issues/${issueIid}`
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } })
    if (!res.ok) return null
    const issue = (await res.json()) as { labels?: string[] }
    const repoLabel = issue.labels?.find((l) => l.startsWith('repo:'))
    return repoLabel ? repoLabel.slice(5) : null
  } catch {
    return null
  }
}

export async function startImplementationLoop(projectSlug: string): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === projectSlug)
  if (!projectGroup) {
    log.warn({ projectSlug }, 'No project group config found')
    return
  }

  const codeRepos = projectGroup.repositories.filter((r) => r.role === 'code')
  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  if (!docsRepo) {
    log.warn({ projectSlug }, 'Docs repo not found — cannot iterate issues')
    return
  }

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'

  while (true) {
    const nextIid = await stateManager.getNextPendingIssue(projectSlug, docsRepo.name)

    if (nextIid === null) {
      const allDone = await stateManager.areAllIssuesDone(projectSlug, docsRepo.name)
      if (allDone) {
        log.info({ projectSlug }, 'All issues done — transitioning to ALL_ISSUES_DONE')
        await stateManager.transitionGroupPhase(projectSlug, 'ALL_ISSUES_DONE')
        await runPhase3(projectSlug)
      }
      break
    }

    // Determine target repo via issue label repo:<name>
    // Fetch issue labels from GitLab API to find the repo: label
    const repoLabelName = await fetchIssueRepoLabel(
      docsRepo.gitlab_project_id,
      nextIid,
      config.gitlab.url,
      config.gitlab.token,
    )
    const targetRepo =
      (repoLabelName ? codeRepos.find((r) => r.name === repoLabelName) : null) ??
      codeRepos[0]

    if (!targetRepo) {
      log.warn({ projectSlug, iid: nextIid }, 'No code repos configured — skipping issue')
      await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'DONE')
      continue
    }

    const repoAbsPath = path.resolve(workspacePath, targetRepo.local_path)
    const docsRepoAbsPath = path.resolve(workspacePath, docsRepo.local_path)
    log.info({ projectSlug, iid: nextIid, repo: targetRepo.name }, 'Implementing issue')
    await stateManager.appendIssueToRepo(projectSlug, targetRepo.name, targetRepo.gitlab_project_id, nextIid)
    await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'IN_PROGRESS')

    // Sibling repos the agent can read for shared types, APIs, etc.
    const siblingRepos = codeRepos
      .filter((r) => r.name !== targetRepo.name)
      .map((r) => `${r.name}: ${path.resolve(workspacePath, r.local_path)}`)

    const prompt = invokeSkill('implement-issue', {
      issueIid: nextIid,
      issueProjectId: docsRepo.gitlab_project_id,
      repoName: targetRepo.name,
      projectSlug,
      docsRepoPath: docsRepoAbsPath,
      siblingRepos: siblingRepos.length > 0 ? siblingRepos.join(', ') : null,
    })

    const systemPrompt = [
      `Docs repository (architecture docs, issues): ${docsRepoAbsPath}`,
      siblingRepos.length > 0
        ? `Sibling repositories (read for shared types/APIs, do NOT commit to them):\n${siblingRepos.map((r) => `  - ${r}`).join('\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const result = await agentRunner.run({
        prompt,
        cwd: repoAbsPath,
        projectSlug,
        systemPrompt,
        onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
      })


      await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'DONE')
      log.info({ projectSlug, iid: nextIid }, 'Issue implementation done')
    } catch (err) {
      log.error({ projectSlug, iid: nextIid, err }, 'Issue implementation failed')
      // Keep as IN_PROGRESS so it can be retried on next feedback
      break
    }
  }
}

export async function handleIssueCommentDuringImplementation(
  event: IssueCommentEvent,
): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === event.projectSlug)
  if (!projectGroup) return

  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  if (!docsRepo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const docsRepoAbsPath = path.resolve(workspacePath, docsRepo.local_path)

  const prompt = invokeSkill('handle-plan-feedback', {
    authorUsername: event.authorUsername,
    issueIid: event.issueIid,
    feedbackBody: event.body,
  })

  await agentRunner.run({
    prompt,
    cwd: docsRepoAbsPath,
    projectSlug: event.projectSlug,
  })
}
