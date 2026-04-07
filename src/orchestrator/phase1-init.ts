import path from 'node:path'
import { execSync } from 'node:child_process'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { Config } from '../config/index.js'
import type { RequirementPushedEvent, IssueCommentEvent } from '../queue/types.js'
import { invokeSkill } from '../utils/skill.js'
import { getWorkspacePath } from '../utils/repo-setup.js'
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

function parseMrIid(output: string): number | null {
  const match = output.match(/MR_IID:\s*(\d+)/i)
  return match ? parseInt(match[1], 10) : null
}

export async function handleRequirementPushed(
  event: RequirementPushedEvent,
): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === event.projectSlug)
  if (!projectGroup) {
    log.warn({ projectSlug: event.projectSlug }, 'No project group config found')
    return
  }

  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  if (!docsRepo) {
    log.warn({ projectSlug: event.projectSlug, docsRepo: projectGroup.docs_repo }, 'Docs repo not found in config')
    return
  }

  const codeRepos = projectGroup.repositories.filter((r) => r.role === 'code')
  const groupState = await stateManager.getGroupState(event.projectSlug)

  // Allow re-plan only from IDLE or AWAITING_REVIEW (before implementation starts)
  const replanablePhases = ['IDLE', 'AWAITING_REVIEW']
  if (groupState && !replanablePhases.includes(groupState.phase)) {
    log.info(
      { projectSlug: event.projectSlug, phase: groupState.phase },
      'Skipping — implementation already started, cannot re-plan',
    )
    return
  }

  if (groupState?.phase === 'AWAITING_REVIEW') {
    log.info({ projectSlug: event.projectSlug }, 'Requirements updated — re-planning from AWAITING_REVIEW')
    await stateManager.resetGroupState(event.projectSlug)
  }

  await stateManager.initGroupState(event.projectSlug, event.filePath)
  await stateManager.transitionGroupPhase(event.projectSlug, 'ANALYZING')

  const workspacePath = getWorkspacePath()
  const docsRepoAbsPath = path.resolve(workspacePath, docsRepo.local_path)

  // Pull latest changes so the requirement file is available locally
  try {
    execSync('git pull --ff-only', { cwd: docsRepoAbsPath, stdio: 'pipe' })
    log.info({ docsRepoAbsPath }, 'git pull completed')
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'git pull failed — continuing with local state')
  }

  const reqFilePath = path.join(docsRepoAbsPath, event.filePath)

  const prompt = invokeSkill('init-plan', {
    requirementFile: reqFilePath,
    repoName: docsRepo.name,
    projectId: docsRepo.gitlab_project_id,
    codeRepos: codeRepos.map((r) => `${r.name} (ID: ${r.gitlab_project_id})`).join(', '),
  })

  log.info({ projectSlug: event.projectSlug, docsRepoPath: docsRepoAbsPath }, 'Starting Phase 1 agent run')

  const result = await agentRunner.run({
    prompt,
    cwd: docsRepoAbsPath,
    projectSlug: event.projectSlug,
    onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
  })

  // ── Save docs MR IID if agent output contains one ────────────────────────
  const docsMrIid = parseMrIid(result.output)
  if (docsMrIid) {
    await stateManager.setDocsMrIid(event.projectSlug, docsMrIid)
    log.info({ projectSlug: event.projectSlug, docsMrIid }, 'Docs MR IID saved')
  }

  // ── Post-run verification ─────────────────────────────────────────────────
  // 1. Ensure the docs branch is pushed to remote (agent push may have failed)
  try {
    const branchOut = execSync('git branch --show-current', { cwd: docsRepoAbsPath, stdio: 'pipe' }).toString().trim()
    if (branchOut && branchOut !== 'main') {
      execSync(`git push -u origin ${branchOut}`, { cwd: docsRepoAbsPath, stdio: 'pipe' })
      log.info({ branch: branchOut }, 'Verified: branch pushed to remote')
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Branch push verification failed — branch may already be up to date')
  }

  // 2. Verify issues were created — fall back to querying GitLab directly
  let iids = parseIssueIids(result.output)
  if (iids.length === 0) {
    log.warn({ projectSlug: event.projectSlug }, 'No ISSUE_IIDS in agent output — querying GitLab for open issues')
    try {
      const token = getConfig().gitlab.token
      const apiUrl = `${getConfig().gitlab.url}/api/v4/projects/${docsRepo.gitlab_project_id}/issues?state=opened&per_page=100&labels=phase%3Aimplement`
      const out = execSync(`curl -sf -H "PRIVATE-TOKEN: ${token}" "${apiUrl}"`, { stdio: 'pipe' }).toString()
      const issues = JSON.parse(out) as Array<{ iid: number }>
      iids = issues.map((i) => i.iid)
      log.info({ iids }, 'Recovered issue IIDs from GitLab API')
    } catch {
      log.warn('Could not recover issue IIDs from GitLab — proceeding without them')
    }
  }

  if (iids.length > 0) {
    await stateManager.setIssueList(event.projectSlug, docsRepo.name, iids)
    log.info({ projectSlug: event.projectSlug, iids }, 'Issue list set')
  }

  await stateManager.transitionGroupPhase(event.projectSlug, 'AWAITING_REVIEW')
}

export async function handlePlanFeedback(
  event: IssueCommentEvent,
  config: Config,
): Promise<void> {
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

  await stateManager.transitionGroupPhase(event.projectSlug, 'AWAITING_REVIEW')
  log.info({ projectSlug: event.projectSlug }, 'Plan feedback handled — back to AWAITING_REVIEW')
}
