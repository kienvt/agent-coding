import path from 'node:path'
import { execSync } from 'node:child_process'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { IssueCommentEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
import { getWorkspacePath } from '../utils/repo-setup.js'
import { createWorktree, removeWorktree } from '../utils/worktree.js'
import { createLogger } from '../utils/logger.js'
import { runPhase3 } from './phase3-review.js'

const log = createLogger('phase2-implement')

function parseMrIid(output: string): number | null {
  const match = output.match(/MR_IID:\s*(\d+)/i)
  return match ? parseInt(match[1], 10) : null
}

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

  const workspacePath = getWorkspacePath()

  while (true) {
    // Use planned order (priority-sorted) instead of sequential pending
    const nextIid = await stateManager.getNextPlannedIssue(projectSlug, docsRepo.name)

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

    const docsRepoAbsPath = path.resolve(workspacePath, docsRepo.local_path)

    await stateManager.appendIssueToRepo(projectSlug, targetRepo.name, targetRepo.gitlab_project_id, nextIid)

    // Check for existing checkpoint (INTERRUPTED resume)
    const existingCheckpoint = stateManager.getCheckpoint(projectSlug, targetRepo.name, nextIid)
    const isResume = existingCheckpoint != null

    // Create or reuse worktree
    const branch = existingCheckpoint?.branch ?? `feature/issue-${nextIid}-${targetRepo.name}`
    let worktreePath: string
    try {
      worktreePath = existingCheckpoint?.worktreePath
        ?? createWorktree(targetRepo.name, nextIid, branch, workspacePath)
    } catch (err) {
      log.error({ projectSlug, iid: nextIid, err }, 'Failed to create worktree — falling back to repo path')
      worktreePath = path.resolve(workspacePath, targetRepo.local_path)
    }

    log.info({ projectSlug, iid: nextIid, repo: targetRepo.name, worktreePath, isResume }, 'Implementing issue')
    await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'IN_PROGRESS')

    // Sibling repos the agent can read for shared types, APIs, etc.
    const siblingRepos = codeRepos
      .filter((r) => r.name !== targetRepo.name)
      .map((r) => `${r.name}: ${path.resolve(workspacePath, r.local_path)}`)

    const resumeNote = isResume
      ? `Previously interrupted on branch: ${branch}\nResume from where you left off. Run: git log --oneline -10 to see what was done.`
      : null

    const systemPrompt = [
      `Working directory (write target): ${worktreePath}`,
      `Docs repository (architecture docs, issues): ${docsRepoAbsPath}`,
      siblingRepos.length > 0
        ? `Read-only references (DO NOT commit to these):\n${siblingRepos.map((r) => `  - ${r}`).join('\n')}`
        : null,
      resumeNote,
    ]
      .filter(Boolean)
      .join('\n')

    const prompt = invokeSkill('implement-issue', {
      issueIid: nextIid,
      issueProjectId: docsRepo.gitlab_project_id,
      repoName: targetRepo.name,
      projectSlug,
      docsRepoPath: docsRepoAbsPath,
      siblingRepos: siblingRepos.length > 0 ? siblingRepos.join(', ') : null,
    })

    try {
      const result = await agentRunner.run({
        prompt,
        cwd: worktreePath,
        projectSlug,
        systemPrompt,
        onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
      })

      if (result.interrupted) {
        // Save checkpoint for later resume
        let currentBranch = branch
        try {
          currentBranch = execSync('git branch --show-current', { cwd: worktreePath, stdio: 'pipe' })
            .toString().trim() || branch
        } catch { /* use default branch */ }

        await stateManager.saveCheckpoint(projectSlug, targetRepo.name, nextIid, {
          branch: currentBranch,
          worktreePath,
          interruptedAt: new Date().toISOString(),
        })
        await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'INTERRUPTED')
        log.warn({ projectSlug, iid: nextIid, branch: currentBranch }, 'Issue interrupted — checkpoint saved')
        break
      }

      // Parse MR IID from agent output
      const mrIid = parseMrIid(result.output)
      if (mrIid) {
        await stateManager.setIssueMr(projectSlug, targetRepo.name, nextIid, mrIid)
        await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'MR_OPEN')
        log.info({ projectSlug, iid: nextIid, mrIid }, 'MR created — issue awaiting merge')
      } else {
        // No MR output — mark done directly (fallback)
        await stateManager.updateIssueStatus(projectSlug, docsRepo.name, nextIid, 'DONE')
        log.info({ projectSlug, iid: nextIid }, 'Issue implementation done (no MR detected)')
      }
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

  const workspacePath = getWorkspacePath()
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
