import { getRedis } from '../queue/redis.js'
import type { ProjectPhase, IssueStatus, ProjectState } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('state-manager')

const STATE_KEY_PREFIX = 'state:project:'
const STATE_TTL_SECONDS = 7 * 24 * 3600 // 7 days

function stateKey(projectId: number): string {
  return `${STATE_KEY_PREFIX}${projectId}`
}

export class StateManager {
  async initProjectState(
    projectId: number,
    repositoryName: string,
    requirementFile?: string,
  ): Promise<ProjectState> {
    const existing = await this.getProjectState(projectId)
    if (existing) {
      log.info({ projectId }, 'State already exists, skipping init')
      return existing
    }

    const state: ProjectState = {
      projectId,
      repositoryName,
      phase: 'IDLE',
      requirementFile,
      issueIids: [],
      issueStatuses: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await this.save(state)
    log.info({ projectId, repositoryName }, 'Project state initialized')
    return state
  }

  async getProjectState(projectId: number): Promise<ProjectState | null> {
    const redis = getRedis()
    const data = await redis.get(stateKey(projectId))
    if (!data) return null
    return JSON.parse(data) as ProjectState
  }

  async transitionPhase(projectId: number, newPhase: ProjectPhase): Promise<void> {
    const state = await this.getProjectState(projectId)
    if (!state) {
      log.warn({ projectId }, 'Cannot transition phase: state not found')
      return
    }

    const fromPhase = state.phase
    state.phase = newPhase
    state.updatedAt = new Date().toISOString()
    await this.save(state)

    log.info({ projectId, from: fromPhase, to: newPhase }, 'Phase transition')
  }

  async setIssueList(projectId: number, iids: number[]): Promise<void> {
    const state = await this.getProjectState(projectId)
    if (!state) return

    state.issueIids = iids
    state.issueStatuses = {}
    for (const iid of iids) {
      state.issueStatuses[iid] = 'OPEN'
    }
    state.updatedAt = new Date().toISOString()
    await this.save(state)
    log.info({ projectId, count: iids.length }, 'Issue list set')
  }

  async updateIssueStatus(
    projectId: number,
    iid: number,
    status: IssueStatus,
  ): Promise<void> {
    const state = await this.getProjectState(projectId)
    if (!state) return

    state.issueStatuses[iid] = status
    if (status === 'IN_PROGRESS') {
      state.currentIssueIid = iid
    }
    state.updatedAt = new Date().toISOString()
    await this.save(state)
    log.info({ projectId, iid, status }, 'Issue status updated')
  }

  async getNextPendingIssue(projectId: number): Promise<number | null> {
    const state = await this.getProjectState(projectId)
    if (!state) return null

    for (const iid of state.issueIids) {
      const status = state.issueStatuses[iid]
      if (status === 'OPEN') return iid
    }
    return null
  }

  async areAllIssuesDone(projectId: number): Promise<boolean> {
    const state = await this.getProjectState(projectId)
    if (!state || state.issueIids.length === 0) return false

    return state.issueIids.every((iid) => {
      const status = state.issueStatuses[iid]
      return status === 'DONE' || status === 'CLOSED'
    })
  }

  async setMR(projectId: number, mrIid: number): Promise<void> {
    const state = await this.getProjectState(projectId)
    if (!state) return

    state.mrIid = mrIid
    state.updatedAt = new Date().toISOString()
    await this.save(state)
    log.info({ projectId, mrIid }, 'MR IID saved')
  }

  async setError(projectId: number, message: string): Promise<void> {
    const state = await this.getProjectState(projectId)
    if (!state) return

    state.phase = 'ERROR'
    state.error = message
    state.updatedAt = new Date().toISOString()
    await this.save(state)
    log.error({ projectId, message }, 'Project state set to ERROR')
  }

  private async save(state: ProjectState): Promise<void> {
    const redis = getRedis()
    await redis.set(
      stateKey(state.projectId),
      JSON.stringify(state),
      'EX',
      STATE_TTL_SECONDS,
    )
  }
}

export const stateManager = new StateManager()
