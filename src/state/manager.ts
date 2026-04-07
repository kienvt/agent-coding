import { db } from '../db/index.js'
import type { ProjectPhase, IssueStatus, ProjectGroupState, RepoState, CheckpointData } from './types.js'
import { createLogger } from '../utils/logger.js'
import { logStore } from '../utils/log-store.js'

const log = createLogger('state-manager')

type GroupRow = {
  project_slug: string
  phase: string
  req_file: string | null
  docs_mr_iid: number | null
  error: string | null
  started_at: number
  updated_at: number
}

type RepoRow = {
  project_slug: string
  repo_name: string
  gitlab_proj_id: number
  phase: string
  issue_iids: string
  issue_statuses: string
  planned_order: string
  issue_to_mr: string
  checkpoints: string
  current_issue: number | null
  mr_iid: number | null
  error: string | null
  started_at: number
  updated_at: number
}

function rowToGroupState(row: GroupRow): ProjectGroupState {
  return {
    projectSlug: row.project_slug,
    phase: row.phase as ProjectPhase,
    requirementFile: row.req_file ?? undefined,
    docsMrIid: row.docs_mr_iid ?? undefined,
    startedAt: new Date(row.started_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    error: row.error ?? undefined,
  }
}

function rowToRepoState(row: RepoRow): RepoState {
  return {
    projectSlug: row.project_slug,
    repoName: row.repo_name,
    gitlabProjectId: row.gitlab_proj_id,
    phase: row.phase as ProjectPhase,
    issueIids: JSON.parse(row.issue_iids) as number[],
    issueStatuses: JSON.parse(row.issue_statuses) as Record<number, IssueStatus>,
    plannedOrder: JSON.parse(row.planned_order ?? '[]') as number[],
    issueToMr: JSON.parse(row.issue_to_mr ?? '{}') as Record<string, number>,
    checkpoints: JSON.parse(row.checkpoints ?? '{}') as Record<string, CheckpointData>,
    currentIssueIid: row.current_issue ?? undefined,
    mrIid: row.mr_iid ?? undefined,
    error: row.error ?? undefined,
  }
}

const groupStmts = {
  get: db.prepare<[string], GroupRow>('SELECT * FROM project_group_state WHERE project_slug = ?'),
  getAll: db.prepare<[], GroupRow>('SELECT * FROM project_group_state ORDER BY updated_at DESC'),
  insert: db.prepare(`
    INSERT INTO project_group_state (project_slug, phase, req_file, started_at, updated_at)
    VALUES (@slug, 'IDLE', @reqFile, @now, @now)
  `),
  updatePhase: db.prepare(`
    UPDATE project_group_state SET phase = @phase, error = NULL, updated_at = @now
    WHERE project_slug = @slug
  `),
  setError: db.prepare(`
    UPDATE project_group_state SET phase = 'ERROR', error = @error, updated_at = @now
    WHERE project_slug = @slug
  `),
  setDocsMrIid: db.prepare(`
    UPDATE project_group_state SET docs_mr_iid = @mrIid, updated_at = @now
    WHERE project_slug = @slug
  `),
  delete: db.prepare('DELETE FROM project_group_state WHERE project_slug = ?'),
}

const repoStmts = {
  get: db.prepare<[string, string], RepoRow>(
    'SELECT * FROM repo_state WHERE project_slug = ? AND repo_name = ?'
  ),
  getAll: db.prepare<[string], RepoRow>(
    'SELECT * FROM repo_state WHERE project_slug = ? ORDER BY repo_name ASC'
  ),
  insert: db.prepare(`
    INSERT INTO repo_state (project_slug, repo_name, gitlab_proj_id, phase, started_at, updated_at)
    VALUES (@slug, @repoName, @gitlabProjectId, 'IDLE', @now, @now)
  `),
  updatePhase: db.prepare(`
    UPDATE repo_state SET phase = @phase, error = NULL, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updateIssues: db.prepare(`
    UPDATE repo_state SET issue_iids = @iids, issue_statuses = @statuses, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updateIssueStatuses: db.prepare(`
    UPDATE repo_state SET issue_statuses = @statuses, current_issue = @currentIssue, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updateMR: db.prepare(`
    UPDATE repo_state SET mr_iid = @mrIid, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  setError: db.prepare(`
    UPDATE repo_state SET phase = 'ERROR', error = @error, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updatePlannedOrder: db.prepare(`
    UPDATE repo_state SET planned_order = @plannedOrder, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updateIssueToMr: db.prepare(`
    UPDATE repo_state SET issue_to_mr = @issueToMr, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  updateCheckpoints: db.prepare(`
    UPDATE repo_state SET checkpoints = @checkpoints, updated_at = @now
    WHERE project_slug = @slug AND repo_name = @repoName
  `),
  deleteAll: db.prepare('DELETE FROM repo_state WHERE project_slug = ?'),
}

export class StateManager {
  // ── Group-level ───────────────────────────────────────────────────

  initGroupState(slug: string, requirementFile?: string): Promise<ProjectGroupState> {
    const existing = groupStmts.get.get(slug)
    if (existing) {
      log.info({ slug }, 'Group state already exists, skipping init')
      return Promise.resolve(rowToGroupState(existing))
    }

    groupStmts.insert.run({ slug, reqFile: requirementFile ?? null, now: Date.now() })
    log.info({ slug }, 'Group state initialized')
    return Promise.resolve(rowToGroupState(groupStmts.get.get(slug)!))
  }

  getGroupState(slug: string): Promise<ProjectGroupState | null> {
    const row = groupStmts.get.get(slug)
    return Promise.resolve(row ? rowToGroupState(row) : null)
  }

  getAllGroupStates(): Promise<ProjectGroupState[]> {
    return Promise.resolve(groupStmts.getAll.all().map(rowToGroupState))
  }

  async transitionGroupPhase(slug: string, newPhase: ProjectPhase): Promise<void> {
    const row = groupStmts.get.get(slug)
    if (!row) { log.warn({ slug }, 'Cannot transition group phase: state not found'); return }

    const fromPhase = row.phase
    groupStmts.updatePhase.run({ phase: newPhase, now: Date.now(), slug })
    log.info({ slug, from: fromPhase, to: newPhase }, 'Group phase transition')

    await logStore.append(slug, {
      level: 'info',
      module: 'state-manager',
      msg: `Group phase: ${fromPhase} → ${newPhase}`,
    }).catch(() => {/* non-critical */})
  }

  async setGroupError(slug: string, message: string): Promise<void> {
    groupStmts.setError.run({ error: message, now: Date.now(), slug })
    log.error({ slug, message }, 'Group state set to ERROR')
    await logStore.append(slug, {
      level: 'error',
      module: 'state-manager',
      msg: `Error: ${message}`,
    }).catch(() => {/* non-critical */})
  }

  resetGroupState(slug: string): Promise<void> {
    groupStmts.delete.run(slug)
    repoStmts.deleteAll.run(slug)
    log.info({ slug }, 'Group state reset')
    return Promise.resolve()
  }

  // ── Repo-level ────────────────────────────────────────────────────

  initRepoState(slug: string, repoName: string, gitlabProjectId: number): Promise<RepoState> {
    const existing = repoStmts.get.get(slug, repoName)
    if (existing) {
      return Promise.resolve(rowToRepoState(existing))
    }

    repoStmts.insert.run({ slug, repoName, gitlabProjectId, now: Date.now() })
    log.info({ slug, repoName }, 'Repo state initialized')
    return Promise.resolve(rowToRepoState(repoStmts.get.get(slug, repoName)!))
  }

  getRepoState(slug: string, repoName: string): Promise<RepoState | null> {
    const row = repoStmts.get.get(slug, repoName)
    return Promise.resolve(row ? rowToRepoState(row) : null)
  }

  getAllRepoStates(slug: string): Promise<RepoState[]> {
    return Promise.resolve(repoStmts.getAll.all(slug).map(rowToRepoState))
  }

  async transitionRepoPhase(slug: string, repoName: string, newPhase: ProjectPhase): Promise<void> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) { log.warn({ slug, repoName }, 'Cannot transition repo phase: state not found'); return }

    const fromPhase = row.phase
    repoStmts.updatePhase.run({ phase: newPhase, now: Date.now(), slug, repoName })
    log.info({ slug, repoName, from: fromPhase, to: newPhase }, 'Repo phase transition')

    await logStore.append(slug, {
      level: 'info',
      module: 'state-manager',
      msg: `[${repoName}] Phase: ${fromPhase} → ${newPhase}`,
    }).catch(() => {/* non-critical */})
  }

  setIssueList(slug: string, repoName: string, iids: number[]): Promise<void> {
    const statuses: Record<number, IssueStatus> = {}
    for (const iid of iids) statuses[iid] = 'OPEN'
    repoStmts.updateIssues.run({
      iids: JSON.stringify(iids),
      statuses: JSON.stringify(statuses),
      now: Date.now(),
      slug,
      repoName,
    })
    log.info({ slug, repoName, count: iids.length }, 'Issue list set')
    return Promise.resolve()
  }

  updateIssueStatus(slug: string, repoName: string, iid: number, status: IssueStatus): Promise<void> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve()

    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    statuses[iid] = status
    const currentIssue = status === 'IN_PROGRESS' ? iid : (row.current_issue ?? null)
    repoStmts.updateIssueStatuses.run({
      statuses: JSON.stringify(statuses),
      currentIssue,
      now: Date.now(),
      slug,
      repoName,
    })
    log.info({ slug, repoName, iid, status }, 'Issue status updated')
    return Promise.resolve()
  }

  getNextPendingIssue(slug: string, repoName: string): Promise<number | null> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve(null)

    const iids = JSON.parse(row.issue_iids) as number[]
    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    const next = iids.find((iid) => statuses[iid] === 'OPEN') ?? null
    return Promise.resolve(next)
  }

  areAllIssuesDone(slug: string, repoName: string): Promise<boolean> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve(false)

    const iids = JSON.parse(row.issue_iids) as number[]
    if (iids.length === 0) return Promise.resolve(false)

    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    return Promise.resolve(iids.every((iid) => statuses[iid] === 'DONE' || statuses[iid] === 'CLOSED'))
  }

  async appendIssueToRepo(slug: string, repoName: string, gitlabProjectId: number, iid: number): Promise<void> {
    let row = repoStmts.get.get(slug, repoName)
    if (!row) {
      await this.initRepoState(slug, repoName, gitlabProjectId)
      row = repoStmts.get.get(slug, repoName)!
    }

    const iids = JSON.parse(row.issue_iids) as number[]
    if (iids.includes(iid)) return

    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    iids.push(iid)
    statuses[iid] = 'OPEN'
    repoStmts.updateIssues.run({
      iids: JSON.stringify(iids),
      statuses: JSON.stringify(statuses),
      now: Date.now(),
      slug,
      repoName,
    })
    log.info({ slug, repoName, iid }, 'Issue appended to repo')
  }

  async areAllCodeRepoMRsApproved(slug: string, codeRepoNames: string[]): Promise<boolean> {
    if (codeRepoNames.length === 0) return false
    for (const repoName of codeRepoNames) {
      const row = repoStmts.get.get(slug, repoName)
      if (!row || row.phase !== 'MR_APPROVED') return false
    }
    return true
  }

  setMR(slug: string, repoName: string, mrIid: number): Promise<void> {
    repoStmts.updateMR.run({ mrIid, now: Date.now(), slug, repoName })
    log.info({ slug, repoName, mrIid }, 'MR IID saved')
    return Promise.resolve()
  }

  async setRepoError(slug: string, repoName: string, message: string): Promise<void> {
    repoStmts.setError.run({ error: message, now: Date.now(), slug, repoName })
    log.error({ slug, repoName, message }, 'Repo state set to ERROR')
    await logStore.append(slug, {
      level: 'error',
      module: 'state-manager',
      msg: `[${repoName}] Error: ${message}`,
    }).catch(() => {/* non-critical */})
  }

  // ── New v2 methods ────────────────────────────────────────────────

  setDocsMrIid(slug: string, mrIid: number): Promise<void> {
    groupStmts.setDocsMrIid.run({ mrIid, now: Date.now(), slug })
    log.info({ slug, mrIid }, 'Docs MR IID saved')
    return Promise.resolve()
  }

  setPlannedOrder(slug: string, repoName: string, iids: number[]): Promise<void> {
    repoStmts.updatePlannedOrder.run({ plannedOrder: JSON.stringify(iids), now: Date.now(), slug, repoName })
    log.info({ slug, repoName, count: iids.length }, 'Planned order set')
    return Promise.resolve()
  }

  getNextPlannedIssue(slug: string, repoName: string): Promise<number | null> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve(null)

    const plannedOrder = JSON.parse(row.planned_order ?? '[]') as number[]
    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    const skip = new Set<IssueStatus>(['DONE', 'CLOSED', 'MR_OPEN'])

    // Prefer INTERRUPTED first, then OPEN/REOPENED
    const interrupted = plannedOrder.find((iid) => statuses[iid] === 'INTERRUPTED')
    if (interrupted != null) return Promise.resolve(interrupted)
    const next = plannedOrder.find((iid) => !skip.has(statuses[iid])) ?? null
    return Promise.resolve(next)
  }

  setIssueMr(slug: string, repoName: string, iid: number, mrIid: number): Promise<void> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve()

    const issueToMr = JSON.parse(row.issue_to_mr ?? '{}') as Record<string, number>
    issueToMr[String(iid)] = mrIid
    repoStmts.updateIssueToMr.run({ issueToMr: JSON.stringify(issueToMr), now: Date.now(), slug, repoName })
    log.info({ slug, repoName, iid, mrIid }, 'Issue→MR mapping saved')
    return Promise.resolve()
  }

  prependToPlannedOrder(slug: string, repoName: string, iid: number): Promise<void> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve()

    const plannedOrder = JSON.parse(row.planned_order ?? '[]') as number[]
    const filtered = plannedOrder.filter((i) => i !== iid)
    filtered.unshift(iid)
    repoStmts.updatePlannedOrder.run({ plannedOrder: JSON.stringify(filtered), now: Date.now(), slug, repoName })
    log.info({ slug, repoName, iid }, 'Issue prepended to planned order')
    return Promise.resolve()
  }

  getIssueOwnerRepo(slug: string, iid: number): Promise<string | null> {
    const rows = repoStmts.getAll.all(slug)
    for (const row of rows) {
      const issueToMr = JSON.parse(row.issue_to_mr ?? '{}') as Record<string, number>
      if (String(iid) in issueToMr) return Promise.resolve(row.repo_name)
      // Also check if issue is tracked in this repo's issue list
      const iids = JSON.parse(row.issue_iids) as number[]
      if (iids.includes(iid)) return Promise.resolve(row.repo_name)
    }
    return Promise.resolve(null)
  }

  getIssueStatusInRepo(slug: string, repoName: string, iid: number): IssueStatus | null {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return null
    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    return statuses[iid] ?? null
  }

  saveCheckpoint(slug: string, repoName: string, iid: number, data: CheckpointData): Promise<void> {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return Promise.resolve()

    const checkpoints = JSON.parse(row.checkpoints ?? '{}') as Record<string, CheckpointData>
    checkpoints[String(iid)] = data
    repoStmts.updateCheckpoints.run({ checkpoints: JSON.stringify(checkpoints), now: Date.now(), slug, repoName })
    log.info({ slug, repoName, iid }, 'Checkpoint saved')
    return Promise.resolve()
  }

  getCheckpoint(slug: string, repoName: string, iid: number): CheckpointData | null {
    const row = repoStmts.get.get(slug, repoName)
    if (!row) return null
    const checkpoints = JSON.parse(row.checkpoints ?? '{}') as Record<string, CheckpointData>
    return checkpoints[String(iid)] ?? null
  }
}

export const stateManager = new StateManager()
