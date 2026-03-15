import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getRedis } from '../../queue/redis.js'
import { logStore, LOG_PUBSUB_CHANNEL } from '../../utils/log-store.js'

export function registerLogRoutes(app: Hono): void {
  // GET /api/projects/:id/logs — last N entries
  app.get('/api/projects/:id/logs', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 1000)
    const since = parseInt(c.req.query('since') ?? '0', 10)

    const entries = since > 0
      ? await logStore.since(projectId, since)
      : await logStore.tail(projectId, limit)

    return c.json(entries)
  })

  // GET /api/projects/:id/logs/stream — SSE live stream
  app.get('/api/projects/:id/logs/stream', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    return streamSSE(c, async (stream) => {
      // 1. Backfill last 50 entries
      const history = await logStore.tail(projectId, 50)
      for (const entry of history) {
        await stream.writeSSE({ data: JSON.stringify(entry) })
      }

      // 2. Subscribe to new entries via pub/sub
      const sub = getRedis().duplicate()
      await sub.subscribe(LOG_PUBSUB_CHANNEL)

      sub.on('message', async (_ch: string, msg: string) => {
        try {
          const { projectId: pid, entry } = JSON.parse(msg) as { projectId: number; entry: unknown }
          if (pid === projectId) {
            await stream.writeSSE({ data: JSON.stringify(entry) })
          }
        } catch {
          // ignore malformed pub/sub messages
        }
      })

      // 3. Keepalive ping every 15s
      const interval = setInterval(async () => {
        await stream.writeSSE({ event: 'ping', data: '' })
      }, 15_000)

      // 4. Cleanup on disconnect
      stream.onAbort(() => {
        clearInterval(interval)
        sub.disconnect()
      })

      // Keep stream open
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
      })
    })
  })

  // DELETE /api/projects/:id/logs — clear log history
  app.delete('/api/projects/:id/logs', async (c) => {
    const projectId = parseInt(c.req.param('id'), 10)
    if (isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400)

    await logStore.clear(projectId)
    return c.json({ ok: true })
  })
}
