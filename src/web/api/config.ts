import type { Hono } from 'hono'
import { getConfig, updateConfig } from '../../config/index.js'
import type { Config } from '../../config/index.js'
import { ensureAllReposCloned } from '../../utils/repo-setup.js'

function redactConfig(config: Config): unknown {
  return {
    ...config,
    gitlab: {
      ...config.gitlab,
      token: '***',
      webhook_secret: '***',
    },
  }
}

export function registerConfigRoutes(app: Hono): void {
  // GET /api/config — full config with secrets redacted
  app.get('/api/config', (c) => {
    const config = getConfig()
    return c.json(redactConfig(config))
  })

  // PUT /api/config — update non-sensitive config fields
  app.put('/api/config', async (c) => {
    let body: Partial<Config>
    try {
      body = (await c.req.json()) as Partial<Config>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    try {
      updateConfig(body)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    // Auto-clone any new repos that don't exist locally yet (fire and forget)
    const cfg = getConfig()
    void ensureAllReposCloned(cfg.repositories, cfg.gitlab.url, cfg.gitlab.token)

    return c.json({ ok: true, config: redactConfig(getConfig()) })
  })
}
