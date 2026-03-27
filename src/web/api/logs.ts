import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getRedis } from '../../queue/redis.js'
import { logStore, LOG_PUBSUB_CHANNEL } from '../../utils/log-store.js'

export function registerLogRoutes(app: Hono): void {
  // GET /api/projects/:slug/logs — last N entries
  app.get('/api/projects/:slug/logs', async (c) => {
    const slug = c.req.param('slug')
    const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 1000)
    const since = parseInt(c.req.query('since') ?? '0', 10)

    const entries = since > 0
      ? await logStore.since(slug, since)
      : await logStore.tail(slug, limit)

    return c.json(entries)
  })

  // GET /api/projects/:slug/logs/stream — SSE live stream
  app.get('/api/projects/:slug/logs/stream', async (c) => {
    const slug = c.req.param('slug')
    const repoFilter = c.req.query('repo') ?? null

    return streamSSE(c, async (stream) => {
      // 1. Backfill last 50 entries
      const history = await logStore.tail(slug, 50)
      for (const entry of history) {
        await stream.writeSSE({ data: JSON.stringify(entry) })
      }

      // 2. Subscribe to new entries via pub/sub
      const sub = getRedis().duplicate()
      await sub.subscribe(LOG_PUBSUB_CHANNEL)

      sub.on('message', async (_ch: string, msg: string) => {
        try {
          const { projectSlug, entry } = JSON.parse(msg) as { projectSlug: string; entry: Record<string, unknown> }
          if (projectSlug !== slug) return

          // Filter by repo if requested
          if (repoFilter && entry['module'] && !String(entry['module']).includes(repoFilter)) return

          await stream.writeSSE({ data: JSON.stringify(entry) })
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

  // DELETE /api/projects/:slug/logs — clear log history
  app.delete('/api/projects/:slug/logs', async (c) => {
    const slug = c.req.param('slug')
    await logStore.clear(slug)
    return c.json({ ok: true })
  })
}
