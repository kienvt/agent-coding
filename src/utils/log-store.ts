import { db } from '../db/index.js'
import { getRedis } from '../queue/redis.js'

export const LOG_PUBSUB_CHANNEL = 'logs:pubsub'
const LOG_MAX_ENTRIES = 10_000

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'agent'

export interface LogEntry {
  ts: number
  level: LogLevel
  module: string
  msg: string
  projectSlug: string
  data?: Record<string, unknown>
}

type LogRow = {
  occurred_at: number
  level: string
  module: string
  msg: string
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO agent_logs (project_slug, occurred_at, level, module, msg)
    VALUES (@projectSlug, @ts, @level, @module, @msg)
  `),
  cap: db.prepare(`
    DELETE FROM agent_logs
    WHERE project_slug = @projectSlug
      AND id NOT IN (
        SELECT id FROM agent_logs
        WHERE project_slug = @projectSlug
        ORDER BY occurred_at DESC
        LIMIT @limit
      )
  `),
  tail: db.prepare<[string, number], LogRow>(`
    SELECT occurred_at, level, module, msg FROM agent_logs
    WHERE project_slug = ?
    ORDER BY occurred_at DESC
    LIMIT ?
  `),
  since: db.prepare<[string, number], LogRow>(`
    SELECT occurred_at, level, module, msg FROM agent_logs
    WHERE project_slug = ? AND occurred_at > ?
    ORDER BY occurred_at ASC
  `),
  clear: db.prepare('DELETE FROM agent_logs WHERE project_slug = ?'),
}

function rowToEntry(row: LogRow, projectSlug: string): LogEntry {
  return {
    ts: row.occurred_at,
    level: row.level as LogLevel,
    module: row.module,
    msg: row.msg,
    projectSlug,
  }
}

export const logStore = {
  async append(projectSlug: string, entry: Omit<LogEntry, 'ts' | 'projectSlug'>): Promise<void> {
    const full: LogEntry = { ...entry, ts: Date.now(), projectSlug }

    // Persist to SQLite
    stmts.insert.run({
      projectSlug,
      ts: full.ts,
      level: full.level,
      module: full.module,
      msg: full.msg.slice(0, 2000),
    })

    // Cap per-project entries (keep newest)
    stmts.cap.run({ projectSlug, limit: LOG_MAX_ENTRIES })

    // Publish for SSE streaming (Redis pub/sub — ephemeral, best-effort)
    const redis = getRedis()
    await redis.publish(LOG_PUBSUB_CHANNEL, JSON.stringify({ projectSlug, entry: full }))
  },

  tail(projectSlug: string, limit = 200): Promise<LogEntry[]> {
    // tail returns DESC, reverse to get chronological order
    const rows = stmts.tail.all(projectSlug, limit).reverse()
    return Promise.resolve(rows.map((r) => rowToEntry(r, projectSlug)))
  },

  since(projectSlug: string, since: number): Promise<LogEntry[]> {
    const rows = stmts.since.all(projectSlug, since)
    return Promise.resolve(rows.map((r) => rowToEntry(r, projectSlug)))
  },

  clear(projectSlug: string): Promise<void> {
    stmts.clear.run(projectSlug)
    return Promise.resolve()
  },
}
