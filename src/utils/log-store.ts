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
  projectId: number
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
    INSERT INTO agent_logs (project_id, occurred_at, level, module, msg)
    VALUES (@projectId, @ts, @level, @module, @msg)
  `),
  cap: db.prepare(`
    DELETE FROM agent_logs
    WHERE project_id = @projectId
      AND id NOT IN (
        SELECT id FROM agent_logs
        WHERE project_id = @projectId
        ORDER BY occurred_at DESC
        LIMIT @limit
      )
  `),
  tail: db.prepare<[number, number], LogRow>(`
    SELECT occurred_at, level, module, msg FROM agent_logs
    WHERE project_id = ?
    ORDER BY occurred_at DESC
    LIMIT ?
  `),
  since: db.prepare<[number, number], LogRow>(`
    SELECT occurred_at, level, module, msg FROM agent_logs
    WHERE project_id = ? AND occurred_at > ?
    ORDER BY occurred_at ASC
  `),
  clear: db.prepare('DELETE FROM agent_logs WHERE project_id = ?'),
}

function rowToEntry(row: LogRow, projectId: number): LogEntry {
  return {
    ts: row.occurred_at,
    level: row.level as LogLevel,
    module: row.module,
    msg: row.msg,
    projectId,
  }
}

export const logStore = {
  async append(projectId: number, entry: Omit<LogEntry, 'ts' | 'projectId'>): Promise<void> {
    const full: LogEntry = { ...entry, ts: Date.now(), projectId }

    // Persist to SQLite
    stmts.insert.run({
      projectId,
      ts: full.ts,
      level: full.level,
      module: full.module,
      msg: full.msg.slice(0, 2000),
    })

    // Cap per-project entries (keep newest)
    stmts.cap.run({ projectId, limit: LOG_MAX_ENTRIES })

    // Publish for SSE streaming (Redis pub/sub — ephemeral, best-effort)
    const redis = getRedis()
    await redis.publish(LOG_PUBSUB_CHANNEL, JSON.stringify({ projectId, entry: full }))
  },

  tail(projectId: number, limit = 200): Promise<LogEntry[]> {
    // tail returns DESC, reverse to get chronological order
    const rows = stmts.tail.all(projectId, limit).reverse()
    return Promise.resolve(rows.map((r) => rowToEntry(r, projectId)))
  },

  since(projectId: number, since: number): Promise<LogEntry[]> {
    const rows = stmts.since.all(projectId, since)
    return Promise.resolve(rows.map((r) => rowToEntry(r, projectId)))
  },

  clear(projectId: number): Promise<void> {
    stmts.clear.run(projectId)
    return Promise.resolve()
  },
}
