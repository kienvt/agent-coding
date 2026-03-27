import type { Hono } from 'hono'
import { getConfig, updateConfig, updateSecrets, invalidateConfigCache, loadConfig } from '../../config/index.js'
import type { Config } from '../../config/index.js'
import { ensureAllReposCloned } from '../../utils/repo-setup.js'

function isConfigured(value: string): boolean {
  return value !== '' && !value.startsWith('${')
}

function redactConfig(config: Config): unknown {
  return {
    ...config,
    gitlab: {
      ...config.gitlab,
      token: '***',
      webhook_secret: '***',
    },
    secrets_configured: {
      token: isConfigured(config.gitlab.token),
      webhook_secret: isConfigured(config.gitlab.webhook_secret),
    },
  }
}

export function registerConfigRoutes(app: Hono): void {
  // GET /api/config — full config with secrets redacted + secrets_configured flags
  app.get('/api/config', (c) => {
    const config = getConfig()
    return c.json(redactConfig(config))
  })

  // PUT /api/config — update non-sensitive config fields (gitlab.url, agent, workflow, projects)
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

    const cfg = getConfig()
    const allRepos = cfg.projects.flatMap((g) => g.repositories)
    void ensureAllReposCloned(allRepos, cfg.gitlab.url, cfg.gitlab.token)

    return c.json({ ok: true, config: redactConfig(getConfig()) })
  })

  // PUT /api/config/secrets — update gitlab token and/or webhook_secret
  app.put('/api/config/secrets', async (c) => {
    let body: { token?: string; webhook_secret?: string }
    try {
      body = (await c.req.json()) as { token?: string; webhook_secret?: string }
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    try {
      updateSecrets(body.token, body.webhook_secret)
      // Reload config to validate new secrets
      await loadConfig()
    } catch (err) {
      invalidateConfigCache()
      // Try to restore a valid state on next request
      return c.json({ error: (err as Error).message }, 400)
    }

    return c.json({ ok: true })
  })
}
