import { Hono } from 'hono'
import { getConfig } from '../config/index.js'
import { eventQueue } from '../queue/event-queue.js'
import { stateManager } from '../state/manager.js'
import { handlePushEvent } from './handlers/push.js'
import { handleNoteEvent } from './handlers/note.js'
import { handleMREvent } from './handlers/mr.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('webhook')

export const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/status', async (c) => {
  try {
    const config = getConfig()
    const queueLength = await eventQueue.queueLength()

    const states = await Promise.all(
      config.repositories.map((repo) =>
        stateManager.getProjectState(repo.gitlab_project_id),
      ),
    )

    return c.json({
      queue_length: queueLength,
      projects: states
        .filter(Boolean)
        .map((s) => ({ projectId: s!.projectId, name: s!.repositoryName, phase: s!.phase })),
    })
  } catch {
    return c.json({ queue_length: 0, projects: [] })
  }
})

app.post('/webhook', async (c) => {
  let config
  try {
    config = getConfig()
  } catch {
    return c.json({ error: 'Service not ready' }, 503)
  }
  const token = c.req.header('X-Gitlab-Token')

  if (token !== config.gitlab.webhook_secret) {
    log.warn({ token: token?.slice(0, 4) }, 'Webhook token mismatch')
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const objectKind = payload['object_kind'] as string
  log.info({ objectKind }, 'Webhook received')

  try {
    switch (objectKind) {
      case 'push':
        await handlePushEvent(payload as unknown as Parameters<typeof handlePushEvent>[0])
        break
      case 'note':
        await handleNoteEvent(payload as unknown as Parameters<typeof handleNoteEvent>[0])
        break
      case 'merge_request':
        await handleMREvent(payload as unknown as Parameters<typeof handleMREvent>[0])
        break
      default:
        log.debug({ objectKind }, 'Unhandled webhook event type')
    }
  } catch (err) {
    log.error({ err, objectKind }, 'Error processing webhook')
    return c.json({ error: 'Internal error' }, 500)
  }

  return c.json({ ok: true })
})

app.post('/trigger', async (c) => {
  let body: { phase: string; project_id: number }
  try {
    body = (await c.req.json()) as { phase: string; project_id: number }
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { phase, project_id } = body
  if (!phase || !project_id) {
    return c.json({ error: 'phase and project_id are required' }, 400)
  }

  const validPhases = ['init', 'implement', 'review', 'done'] as const
  if (!validPhases.includes(phase as (typeof validPhases)[number])) {
    return c.json({ error: `phase must be one of: ${validPhases.join(', ')}` }, 400)
  }

  const eventId = await eventQueue.enqueue({
    type: 'TRIGGER_PHASE',
    projectId: project_id,
    phase: phase as 'init' | 'implement' | 'review' | 'done',
  })

  log.info({ phase, projectId: project_id, eventId }, 'Manual trigger enqueued')
  return c.json({ ok: true, eventId })
})
