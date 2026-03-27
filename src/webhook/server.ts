import { Hono } from 'hono'
import { getConfig } from '../config/index.js'
import { eventQueue } from '../queue/event-queue.js'
import { stateManager } from '../state/manager.js'
import { handlePushEvent } from './handlers/push.js'
import { handleNoteEvent } from './handlers/note.js'
import { handleMREvent } from './handlers/mr.js'
import { createLogger } from '../utils/logger.js'
import { registerProjectRoutes } from '../web/api/projects.js'
import { registerLogRoutes } from '../web/api/logs.js'
import { registerQueueRoutes } from '../web/api/queue.js'
import { registerConfigRoutes } from '../web/api/config.js'
import { registerStaticRoutes } from '../web/static.js'

const log = createLogger('webhook')

export const app = new Hono()

// API routes (must be before static, so /api/* takes priority)
registerProjectRoutes(app)
registerLogRoutes(app)
registerQueueRoutes(app)
registerConfigRoutes(app)

// Static files (serves src/web/public/* for the dashboard UI)
registerStaticRoutes(app)

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/status', async (c) => {
  try {
    const config = getConfig()
    const queueLength = await eventQueue.queueLength()

    const states = await Promise.all(
      config.projects.map((group) => stateManager.getGroupState(group.id)),
    )

    return c.json({
      queue_length: queueLength,
      projects: states
        .filter(Boolean)
        .map((s) => ({ projectSlug: s!.projectSlug, phase: s!.phase })),
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
  let body: { phase: string; project_slug: string; filePath?: string }
  try {
    body = (await c.req.json()) as { phase: string; project_slug: string; filePath?: string }
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { phase, project_slug } = body
  if (!phase || !project_slug) {
    return c.json({ error: 'phase and project_slug are required' }, 400)
  }

  const validPhases = ['init', 'implement', 'review', 'done'] as const
  if (!validPhases.includes(phase as (typeof validPhases)[number])) {
    return c.json({ error: `phase must be one of: ${validPhases.join(', ')}` }, 400)
  }

  const eventId = await eventQueue.enqueue({
    type: 'TRIGGER_PHASE',
    projectSlug: project_slug,
    phase: phase as 'init' | 'implement' | 'review' | 'done',
    filePath: body.filePath,
  })

  log.info({ phase, projectSlug: project_slug, eventId }, 'Manual trigger enqueued')
  return c.json({ ok: true, eventId })
})
