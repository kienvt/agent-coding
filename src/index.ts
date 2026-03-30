import { serve } from '@hono/node-server'
import { execSync } from 'node:child_process'
import { loadConfig } from './config/index.js'
import { getRedis } from './queue/redis.js'
import { app } from './webhook/server.js'
import { startOrchestrator } from './orchestrator/index.js'
import { createLogger } from './utils/logger.js'
import { ensureAllReposCloned } from './utils/repo-setup.js'

// Unset CLAUDECODE so the agent subprocess (claude CLI) can be spawned freely.
// This process is an orchestrator, not a Claude Code session — the env var
// is inherited when running from a Claude Code terminal and must be cleared.
delete process.env['CLAUDECODE']

// Expand ~ in WORKSPACE_PATH once at startup so all modules get the absolute path.
if (process.env['WORKSPACE_PATH']?.startsWith('~')) {
  process.env['WORKSPACE_PATH'] = process.env['WORKSPACE_PATH'].replace(/^~/, process.env['HOME'] ?? '')
}

const log = createLogger('main')

async function setupGlab(): Promise<void> {
  const token = process.env['GITLAB_TOKEN']
  const url = process.env['GITLAB_URL']

  if (!token || !url) {
    log.warn('GITLAB_TOKEN or GITLAB_URL not set — skipping glab auth setup')
    return
  }

  // glab expects hostname only, not full URL (e.g. "git.bssd.vn" not "https://git.bssd.vn")
  const hostname = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  try {
    execSync(
      `echo "${token}" | glab auth login --hostname "${hostname}" --stdin --git-protocol https`,
      { stdio: 'pipe' },
    )
    // Check only the specific hostname to avoid failures from stale entries (e.g. gitlab.com)
    const status = execSync(`glab auth status --hostname "${hostname}" 2>&1 || true`, { stdio: 'pipe' }).toString()
    log.info({ status: status.trim() }, 'glab authenticated')
  } catch (err) {
    log.warn({ err }, 'glab auth setup failed — agent may not be able to use GitLab CLI')
  }
}

async function main(): Promise<void> {
  log.info('Starting AI Agent Orchestrator')

  // 1. Start HTTP server first so health checks work immediately
  const port = parseInt(process.env['PORT'] ?? '3000', 10)
  serve({ fetch: app.fetch, port })
  log.info({ port }, 'Webhook server started')

  // 2. Load configuration
  await loadConfig()
  log.info('Configuration loaded')

  // 3. Connect Redis
  const redis = getRedis()
  await redis.ping()
  log.info('Redis connected')

  // 4. Setup glab authentication
  await setupGlab()

  // 5. Clone any repos in config that don't exist locally yet
  const cfg = await loadConfig()
  const allRepos = cfg.projects.flatMap((g) => g.repositories)
  if (allRepos.length > 0) {
    void ensureAllReposCloned(allRepos, cfg.gitlab.url, cfg.gitlab.token)
  }

  // 6. Start orchestrator consumer loop
  startOrchestrator().catch((err) => {
    log.fatal({ err }, 'Orchestrator crashed')
    process.exit(1)
  })

  log.info('AI Agent Orchestrator is running')

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM — shutting down')
    process.exit(0)
  })
  process.on('SIGINT', () => {
    log.info('Received SIGINT — shutting down')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
