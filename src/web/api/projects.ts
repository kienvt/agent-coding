import type { Hono } from 'hono'
import { getConfig } from '../../config/index.js'
import { stateManager } from '../../state/manager.js'
import { eventQueue } from '../../queue/event-queue.js'
import { logStore } from '../../utils/log-store.js'
import type { ProjectPhase } from '../../state/types.js'

const VALID_TRIGGER_PHASES = ['init', 'implement', 'review', 'done'] as const
type TriggerPhase = (typeof VALID_TRIGGER_PHASES)[number]

export function registerProjectRoutes(app: Hono): void {
  // GET /api/projects — list all repos with live state
  app.get('/api/projects', async (c) => {
    const config = getConfig()
    const projects = await Promise.all(
      config.repositories.map(async (repo) => {
        const state = await stateManager.getProjectState(repo.gitlab_project_id)
        const issueStats = state
          ? {
              total: state.issueIids.length,
              done: Object.values(state.issueStatuses).filter((s) => s === 'DONE' || s === 'CLOSED').length,
              inProgress: Object.values(state.issueStatuses).filter((s) => s === 'IN_PROGRESS').length,
              pending: Object.values(state.issueStatuses).filter((s) => s === 'OPEN').length,
            }
          : { total: 0, done: 0, inProgress: 0, pending: 0 }

        return {
          id: repo.gitlab_project_id,
          name: repo.name,
          local_path: repo.local_path,
          type: repo.type,
          tags: repo.tags,
          phase: (state?.phase ?? 'IDLE') as ProjectPhase,
          issues: issueStats,
          mrIid: state?.mrIid ?? null,
          currentIssueIid: state?.currentIssueIid ?? null,
          lastActivity: state?.updatedAt ?? null,
          startedAt: state?.startedAt ?? null,
          hasError: state?.phase === 'ERROR',
          error: state?.error ?? null,
        }
      }),
    )
    return c.json(projects)
  })

  // GET /api/projects/:id — single project detail
  app.get('/api/projects/:id', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    const config = getConfig()
    const repo = config.repositories.find((r) => r.gitlab_project_id === projectId)
    if (!repo) return c.json({ error: 'Project not found' }, 404)

    const state = await stateManager.getProjectState(projectId)
    return c.json({
      id: repo.gitlab_project_id,
      name: repo.name,
      local_path: repo.local_path,
      type: repo.type,
      tags: repo.tags,
      state,
    })
  })

  // POST /api/projects/:id/trigger — enqueue TRIGGER_PHASE
  app.post('/api/projects/:id/trigger', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    let body: { phase: string }
    try {
      body = (await c.req.json()) as { phase: string }
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    if (!VALID_TRIGGER_PHASES.includes(body.phase as TriggerPhase)) {
      return c.json({ error: `phase must be one of: ${VALID_TRIGGER_PHASES.join(', ')}` }, 400)
    }

    const eventId = await eventQueue.enqueue({
      type: 'TRIGGER_PHASE',
      projectId,
      phase: body.phase as TriggerPhase,
    })

    return c.json({ ok: true, eventId })
  })

  // DELETE /api/projects/:id/state — reset state to IDLE
  app.delete('/api/projects/:id/state', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    const config = getConfig()
    const repo = config.repositories.find((r) => r.gitlab_project_id === projectId)
    if (!repo) return c.json({ error: 'Project not found' }, 404)

    await stateManager.initProjectState(projectId, repo.name)
    await stateManager.transitionPhase(projectId, 'IDLE')
    await logStore.clear(projectId)

    return c.json({ ok: true })
  })
}
