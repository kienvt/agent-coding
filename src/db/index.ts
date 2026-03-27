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

// Migrate old project_state table to new schema if needed
const oldTableExists = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='project_state'`
).get()
const newTableExists = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='project_group_state'`
).get()

if (oldTableExists && !newTableExists) {
  log.info('Migrating project_state → project_group_state + repo_state')
  // Create new tables first, then migrate data, then drop old
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_group_state (
      project_slug   TEXT    PRIMARY KEY,
      phase          TEXT    NOT NULL DEFAULT 'IDLE',
      req_file       TEXT,
      error          TEXT,
      started_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repo_state (
      project_slug   TEXT    NOT NULL,
      repo_name      TEXT    NOT NULL,
      gitlab_proj_id INTEGER NOT NULL DEFAULT 0,
      phase          TEXT    NOT NULL DEFAULT 'IDLE',
      issue_iids     TEXT    NOT NULL DEFAULT '[]',
      issue_statuses TEXT    NOT NULL DEFAULT '{}',
      current_issue  INTEGER,
      mr_iid         INTEGER,
      error          TEXT,
      started_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (project_slug, repo_name)
    );
  `)

  // Migrate rows: use project_id as slug (best effort — config may not be loaded yet)
  const oldRows = db.prepare('SELECT * FROM project_state').all() as Array<Record<string, unknown>>
  for (const row of oldRows) {
    const slug = String(row['project_id'])
    const now = Date.now()
    db.prepare(`
      INSERT OR IGNORE INTO project_group_state (project_slug, phase, req_file, error, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(slug, row['phase'], row['req_file'], row['error'], row['started_at'] ?? now, row['updated_at'] ?? now)

    db.prepare(`
      INSERT OR IGNORE INTO repo_state
        (project_slug, repo_name, gitlab_proj_id, phase, issue_iids, issue_statuses, current_issue, mr_iid, error, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug,
      row['repo_name'] ?? 'unknown',
      row['project_id'],
      row['phase'],
      row['issue_iids'] ?? '[]',
      row['issue_statuses'] ?? '{}',
      row['current_issue'],
      row['mr_iid'],
      row['error'],
      row['started_at'] ?? now,
      row['updated_at'] ?? now,
    )
  }

  db.exec(`DROP TABLE IF EXISTS project_state`)
  db.exec(`DROP TABLE IF EXISTS phase_history`)
  db.exec(`DROP TABLE IF EXISTS agent_logs`) // recreated below with correct project_slug column
  log.info(`Migrated ${oldRows.length} project(s) to new schema`)
}

// Migrate agent_logs: rename project_id → project_slug if needed
const logsHasOldColumn = db.prepare(
  `SELECT COUNT(*) as cnt FROM pragma_table_info('agent_logs') WHERE name='project_id'`
).get() as { cnt: number } | undefined
if (logsHasOldColumn?.cnt) {
  log.info('Migrating agent_logs: project_id → project_slug')
  db.exec(`DROP TABLE IF EXISTS agent_logs`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS project_group_state (
    project_slug   TEXT    PRIMARY KEY,
    phase          TEXT    NOT NULL DEFAULT 'IDLE',
    req_file       TEXT,
    error          TEXT,
    started_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repo_state (
    project_slug   TEXT    NOT NULL,
    repo_name      TEXT    NOT NULL,
    gitlab_proj_id INTEGER NOT NULL DEFAULT 0,
    phase          TEXT    NOT NULL DEFAULT 'IDLE',
    issue_iids     TEXT    NOT NULL DEFAULT '[]',
    issue_statuses TEXT    NOT NULL DEFAULT '{}',
    current_issue  INTEGER,
    mr_iid         INTEGER,
    error          TEXT,
    started_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (project_slug, repo_name)
  );

  CREATE TABLE IF NOT EXISTS agent_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_slug   TEXT    NOT NULL,
    occurred_at    INTEGER NOT NULL,
    level          TEXT    NOT NULL,
    module         TEXT    NOT NULL,
    msg            TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_slug_ts
    ON agent_logs(project_slug, occurred_at);
`)

log.info({ path: DB_PATH }, 'SQLite database ready')
