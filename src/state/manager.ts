import { db } from '../db/index.js'
import type { ProjectPhase, IssueStatus, ProjectState } from './types.js'
import { createLogger } from '../utils/logger.js'
import { logStore } from '../utils/log-store.js'

const log = createLogger('state-manager')

type StateRow = {
  project_id: number
  repo_name: string
  phase: string
  req_file: string | null
  issue_iids: string
  issue_statuses: string
  current_issue: number | null
  mr_iid: number | null
  error: string | null
  started_at: number
  updated_at: number
}

function rowToState(row: StateRow): ProjectState {
  return {
    projectId: row.project_id,
    repositoryName: row.repo_name,
    phase: row.phase as ProjectPhase,
    requirementFile: row.req_file ?? undefined,
    currentIssueIid: row.current_issue ?? undefined,
    mrIid: row.mr_iid ?? undefined,
    issueIids: JSON.parse(row.issue_iids) as number[],
    issueStatuses: JSON.parse(row.issue_statuses) as Record<number, IssueStatus>,
    startedAt: new Date(row.started_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    error: row.error ?? undefined,
  }
}

const stmts = {
  getById: db.prepare<[number], StateRow>('SELECT * FROM project_state WHERE project_id = ?'),
  getAll: db.prepare<[], StateRow>('SELECT * FROM project_state ORDER BY updated_at DESC'),
  insert: db.prepare(`
    INSERT INTO project_state (project_id, repo_name, phase, req_file, started_at, updated_at)
    VALUES (@projectId, @repoName, 'IDLE', @reqFile, @now, @now)
  `),
  updatePhase: db.prepare(`
    UPDATE project_state SET phase = @phase, error = NULL, updated_at = @now
    WHERE project_id = @projectId
  `),
  insertHistory: db.prepare(`
    INSERT INTO phase_history (project_id, from_phase, to_phase, occurred_at)
    VALUES (@projectId, @fromPhase, @toPhase, @now)
  `),
  updateIssues: db.prepare(`
    UPDATE project_state SET issue_iids = @iids, issue_statuses = @statuses, updated_at = @now
    WHERE project_id = @projectId
  `),
  updateIssueStatuses: db.prepare(`
    UPDATE project_state SET issue_statuses = @statuses, current_issue = @currentIssue, updated_at = @now
    WHERE project_id = @projectId
  `),
  updateMR: db.prepare(`
    UPDATE project_state SET mr_iid = @mrIid, updated_at = @now
    WHERE project_id = @projectId
  `),
  setError: db.prepare(`
    UPDATE project_state SET phase = 'ERROR', error = @error, updated_at = @now
    WHERE project_id = @projectId
  `),
  delete: db.prepare('DELETE FROM project_state WHERE project_id = ?'),
  deleteHistory: db.prepare('DELETE FROM phase_history WHERE project_id = ?'),
}

export class StateManager {
  initProjectState(
    projectId: number,
    repositoryName: string,
    requirementFile?: string,
  ): Promise<ProjectState> {
    const existing = stmts.getById.get(projectId)
    if (existing) {
      log.info({ projectId }, 'State already exists, skipping init')
      return Promise.resolve(rowToState(existing))
    }

    stmts.insert.run({ projectId, repoName: repositoryName, reqFile: requirementFile ?? null, now: Date.now() })
    log.info({ projectId, repositoryName }, 'Project state initialized')
    return Promise.resolve(rowToState(stmts.getById.get(projectId)!))
  }

  getProjectState(projectId: number): Promise<ProjectState | null> {
    const row = stmts.getById.get(projectId)
    return Promise.resolve(row ? rowToState(row) : null)
  }

  getAllProjectStates(): Promise<ProjectState[]> {
    return Promise.resolve(stmts.getAll.all().map(rowToState))
  }

  async transitionPhase(projectId: number, newPhase: ProjectPhase): Promise<void> {
    const row = stmts.getById.get(projectId)
    if (!row) {
      log.warn({ projectId }, 'Cannot transition phase: state not found')
      return
    }

    const fromPhase = row.phase
    const now = Date.now()
    stmts.updatePhase.run({ phase: newPhase, now, projectId })
    stmts.insertHistory.run({ projectId, fromPhase, toPhase: newPhase, now })

    log.info({ projectId, from: fromPhase, to: newPhase }, 'Phase transition')

    await logStore.append(projectId, {
      level: 'info',
      module: 'state-manager',
      msg: `Phase transition: ${fromPhase} → ${newPhase}`,
    }).catch(() => {/* non-critical */})
  }

  setIssueList(projectId: number, iids: number[]): Promise<void> {
    const statuses: Record<number, IssueStatus> = {}
    for (const iid of iids) statuses[iid] = 'OPEN'
    stmts.updateIssues.run({
      iids: JSON.stringify(iids),
      statuses: JSON.stringify(statuses),
      now: Date.now(),
      projectId,
    })
    log.info({ projectId, count: iids.length }, 'Issue list set')
    return Promise.resolve()
  }

  updateIssueStatus(projectId: number, iid: number, status: IssueStatus): Promise<void> {
    const row = stmts.getById.get(projectId)
    if (!row) return Promise.resolve()

    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    statuses[iid] = status
    const currentIssue = status === 'IN_PROGRESS' ? iid : (row.current_issue ?? null)
    stmts.updateIssueStatuses.run({
      statuses: JSON.stringify(statuses),
      currentIssue,
      now: Date.now(),
      projectId,
    })
    log.info({ projectId, iid, status }, 'Issue status updated')
    return Promise.resolve()
  }

  getNextPendingIssue(projectId: number): Promise<number | null> {
    const row = stmts.getById.get(projectId)
    if (!row) return Promise.resolve(null)

    const iids = JSON.parse(row.issue_iids) as number[]
    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    const next = iids.find((iid) => statuses[iid] === 'OPEN') ?? null
    return Promise.resolve(next)
  }

  areAllIssuesDone(projectId: number): Promise<boolean> {
    const row = stmts.getById.get(projectId)
    if (!row) return Promise.resolve(false)

    const iids = JSON.parse(row.issue_iids) as number[]
    if (iids.length === 0) return Promise.resolve(false)

    const statuses = JSON.parse(row.issue_statuses) as Record<number, IssueStatus>
    return Promise.resolve(iids.every((iid) => statuses[iid] === 'DONE' || statuses[iid] === 'CLOSED'))
  }

  setMR(projectId: number, mrIid: number): Promise<void> {
    stmts.updateMR.run({ mrIid, now: Date.now(), projectId })
    log.info({ projectId, mrIid }, 'MR IID saved')
    return Promise.resolve()
  }

  async setError(projectId: number, message: string): Promise<void> {
    stmts.setError.run({ error: message, now: Date.now(), projectId })
    log.error({ projectId, message }, 'Project state set to ERROR')
    await logStore.append(projectId, {
      level: 'error',
      module: 'state-manager',
      msg: `Error: ${message}`,
    }).catch(() => {/* non-critical */})
  }

  resetProjectState(projectId: number): Promise<void> {
    stmts.delete.run(projectId)
    stmts.deleteHistory.run(projectId)
    log.info({ projectId }, 'Project state reset')
    return Promise.resolve()
  }
}

export const stateManager = new StateManager()
