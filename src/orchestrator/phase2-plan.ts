import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import { startImplementationLoop } from './phase2-implement.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('phase2-plan')

const PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function getPriority(labels: string[]): number {
  for (const label of labels) {
    const w = PRIORITY_WEIGHTS[label.toLowerCase()]
    if (w != null) return w
  }
  return 0
}

interface GitLabIssue {
  iid: number
  labels: string[]
}

async function fetchAllIssues(projectId: number, gitlabUrl: string, token: string): Promise<GitLabIssue[]> {
  const url = `${gitlabUrl}/api/v4/projects/${projectId}/issues?state=opened&per_page=100`
  const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token } })
  if (!res.ok) throw new Error(`GitLab issues API error: ${res.status}`)
  return res.json() as Promise<GitLabIssue[]>
}

export async function startPlanningPhase(projectSlug: string): Promise<void> {
  const config = getConfig()
  const projectGroup = config.projects.find((g) => g.id === projectSlug)
  if (!projectGroup) {
    log.warn({ projectSlug }, 'No project group config found')
    return
  }

  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  if (!docsRepo) {
    log.warn({ projectSlug }, 'Docs repo not found — skipping planning phase')
    await stateManager.transitionGroupPhase(projectSlug, 'IMPLEMENTING')
    startImplementationLoop(projectSlug).catch((err) =>
      log.error({ err, projectSlug }, 'Implementation loop error'),
    )
    return
  }

  const codeRepos = projectGroup.repositories.filter((r) => r.role === 'code')

  log.info({ projectSlug }, 'Starting planning phase — fetching and sorting issues')

  let issues: GitLabIssue[]
  try {
    issues = await fetchAllIssues(docsRepo.gitlab_project_id, config.gitlab.url, config.gitlab.token)
  } catch (err) {
    log.error({ projectSlug, err }, 'Failed to fetch issues — falling back to existing order')
    await stateManager.transitionGroupPhase(projectSlug, 'IMPLEMENTING')
    startImplementationLoop(projectSlug).catch((e) =>
      log.error({ e, projectSlug }, 'Implementation loop error'),
    )
    return
  }

  // Sort all issues by priority (descending)
  const sorted = [...issues].sort((a, b) => getPriority(b.labels) - getPriority(a.labels))
  log.info({ projectSlug, count: sorted.length }, 'Issues sorted by priority')

  // Set planned order per code repo (filter by repo:<name> label)
  for (const codeRepo of codeRepos) {
    const repoIssues = sorted
      .filter((i) => i.labels.some((l) => l === `repo:${codeRepo.name}`))
      .map((i) => i.iid)

    if (repoIssues.length > 0) {
      await stateManager.setPlannedOrder(projectSlug, codeRepo.name, repoIssues)
      log.info({ projectSlug, repo: codeRepo.name, order: repoIssues }, 'Planned order set')
    }
  }

  // Also set planned order on docs repo (for issues not assigned to specific code repos)
  const unassignedIssues = sorted
    .filter((i) => !i.labels.some((l) => l.startsWith('repo:')))
    .map((i) => i.iid)
  if (unassignedIssues.length > 0) {
    await stateManager.setPlannedOrder(projectSlug, docsRepo.name, unassignedIssues)
  }

  await stateManager.transitionGroupPhase(projectSlug, 'IMPLEMENTING')
  startImplementationLoop(projectSlug).catch((err) =>
    log.error({ err, projectSlug }, 'Implementation loop error'),
  )
}
