import DatabaseConstructor, { type Database } from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createLogger } from '../utils/logger.js'

const log = createLogger('db')

const DATA_DIR = process.env['DATA_DIR'] ?? join(process.cwd(), 'data')
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = join(DATA_DIR, 'orchestrator.db')
export const db: Database = new DatabaseConstructor(DB_PATH)

// WAL mode: faster writes, better concurrent reads
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS project_state (
    project_id      INTEGER PRIMARY KEY,
    repo_name       TEXT    NOT NULL,
    phase           TEXT    NOT NULL DEFAULT 'IDLE',
    req_file        TEXT,
    issue_iids      TEXT    NOT NULL DEFAULT '[]',
    issue_statuses  TEXT    NOT NULL DEFAULT '{}',
    current_issue   INTEGER,
    mr_iid          INTEGER,
    error           TEXT,
    started_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS phase_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL,
    from_phase   TEXT,
    to_phase     TEXT    NOT NULL,
    occurred_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL,
    occurred_at  INTEGER NOT NULL,
    level        TEXT    NOT NULL,
    module       TEXT    NOT NULL,
    msg          TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_project_ts
    ON agent_logs(project_id, occurred_at);
`)

log.info({ path: DB_PATH }, 'SQLite database ready')
