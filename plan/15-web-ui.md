# Task 15: Web UI — Management Dashboard

## Overview

Build a web management dashboard that lets operators:
1. View all configured projects and their current AI agent phase
2. Monitor real-time agent logs per project/repo
3. Add, edit, and delete project/repo configuration (reads/writes `config.yaml`)
4. Inspect and manage the Redis event queue
5. Adjust orchestrator settings (GitLab, agent model, workflow options)
6. Manually trigger phases

The UI is served by the existing Hono server (port 3000). It uses **Server-Sent Events (SSE)** for live log streaming and a simple REST API for all data operations. The frontend is **plain HTML/CSS/JS** — no frontend framework needed — extending the mockup at `plan/ui-mockup.html`.

---

## Architecture

```
Browser ─── REST ──────────── GET/POST/PUT/DELETE /api/*   (new Hono routes)
        ─── SSE  ──────────── GET /api/projects/:id/logs/stream
        ─── Static ─────────── GET /*   (serves src/web/)

Hono server
  ├── webhook/server.ts          (existing: /health, /status, /webhook, /trigger)
  ├── web/api/projects.ts        (new: project CRUD + state)
  ├── web/api/logs.ts            (new: log history + SSE stream)
  ├── web/api/queue.ts           (new: queue inspection + delete)
  ├── web/api/config.ts          (new: global config read/write)
  └── web/static.ts              (new: serve src/web/public/)

Redis (new keys)
  logs:project:{id}              ZSET  score=timestamp  member=JSON log entry
  logs:project:{id}:channel      PubSub channel for SSE fan-out

src/web/
  public/
    index.html                   (main app shell — adapted from mockup)
    app.js                       (SPA navigation + API calls)
    style.css                    (extracted from mockup)
  api/
    projects.ts
    logs.ts
    queue.ts
    config.ts
  static.ts
```

---

## Phase 1 — Log Storage (prerequisite)

Currently, agent logs go only to pino (stdout/file). We need to store per-project logs in Redis so the UI can display them.

### `src/utils/log-store.ts`

```typescript
// Store a log entry for a project
logStore.append(projectId: number, entry: LogEntry): Promise<void>
// Get recent N entries (newest last)
logStore.tail(projectId: number, limit?: number): Promise<LogEntry[]>
// Get entries since a timestamp
logStore.since(projectId: number, since: number): Promise<LogEntry[]>
// Clear logs for a project
logStore.clear(projectId: number): Promise<void>
// Publish to SSE channel
logStore.publish(projectId: number, entry: LogEntry): Promise<void>
```

**Redis keys:**
- `logs:project:{id}` — ZSET, score = `Date.now()` (ms), member = JSON string of `LogEntry`
- TTL: 7 days, capped at 10,000 entries per project (`ZREMRANGEBYRANK` on each append)
- `logs:pubsub` — single Redis pub/sub channel; message = `{ projectId, entry }`

**LogEntry schema:**
```typescript
interface LogEntry {
  ts: number          // Unix ms
  level: 'info' | 'warn' | 'error' | 'debug' | 'agent'
  module: string      // 'agent-runner', 'phase1', etc.
  msg: string
  projectId: number
  data?: Record<string, unknown>
}
```

### Integration points

1. **`AgentRunner.run()`** — call `logStore.append()` for every `onProgress` text chunk (level=`'agent'`)
2. **`StateManager.transitionPhase()`** — log each phase transition (level=`'info'`, module=`'state'`)
3. **Orchestrator error handler** — log errors (level=`'error'`)
4. **Pino transport** — add a custom pino transport that mirrors structured logs to `logStore` (optional, for completeness)

---

## Phase 2 — REST API

### Register routes in `src/webhook/server.ts`

```typescript
import { registerProjectRoutes } from '../web/api/projects.js'
import { registerLogRoutes }     from '../web/api/logs.js'
import { registerQueueRoutes }   from '../web/api/queue.js'
import { registerConfigRoutes }  from '../web/api/config.js'

registerProjectRoutes(app)
registerLogRoutes(app)
registerQueueRoutes(app)
registerConfigRoutes(app)
```

---

### `src/web/api/projects.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/projects` | List all repos from config + live state from Redis |
| `GET`  | `/api/projects/:id` | Single project detail + state + issue list |
| `POST` | `/api/projects` | Add a new repo to config.yaml, reload config |
| `PUT`  | `/api/projects/:id` | Update repo config in config.yaml, reload config |
| `DELETE` | `/api/projects/:id` | Remove repo from config.yaml |
| `POST` | `/api/projects/:id/trigger` | Enqueue TRIGGER_PHASE event |
| `DELETE` | `/api/projects/:id/state` | Reset project state to IDLE (for rerun) |

**GET /api/projects response:**
```json
[
  {
    "id": 42,
    "name": "backend-api",
    "local_path": "/workspace/backend-api",
    "type": "backend",
    "tags": ["node", "postgres"],
    "phase": "IMPLEMENTING",
    "issues": { "total": 5, "done": 3, "inProgress": 1, "pending": 1 },
    "mrIid": null,
    "lastActivity": 1710000000000,
    "hasError": false
  }
]
```

---

### `src/web/api/logs.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/projects/:id/logs` | Last 200 log entries (query: `?limit=200&since=<ts>`) |
| `GET`  | `/api/projects/:id/logs/stream` | SSE stream of live log entries |
| `DELETE` | `/api/projects/:id/logs` | Clear log history |

**SSE stream format** (`text/event-stream`):
```
data: {"ts":1710000000000,"level":"agent","msg":"Reading requirements...","module":"phase1"}

data: {"ts":1710000001000,"level":"info","msg":"Phase transition: ANALYZING","module":"state"}
```

**SSE implementation:**
```typescript
app.get('/api/projects/:id/logs/stream', async (c) => {
  const projectId = parseInt(c.req.param('id'))
  return streamSSE(c, async (stream) => {
    // 1. Send last 50 entries as backfill
    const history = await logStore.tail(projectId, 50)
    for (const entry of history) {
      await stream.writeSSE({ data: JSON.stringify(entry) })
    }
    // 2. Subscribe to pub/sub for new entries
    const sub = getRedis().duplicate()
    await sub.subscribe('logs:pubsub')
    sub.on('message', async (_ch, msg) => {
      const { projectId: pid, entry } = JSON.parse(msg)
      if (pid === projectId) {
        await stream.writeSSE({ data: JSON.stringify(entry) })
      }
    })
    // 3. Keep alive ping every 15s
    const interval = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }), 15000)
    // 4. Cleanup on disconnect
    stream.onAbort(() => { clearInterval(interval); sub.disconnect() })
  })
})
```

---

### `src/web/api/queue.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/queue` | Queue length + up to 20 pending event IDs + dead-letter entries |
| `DELETE` | `/api/queue/dead-letter` | Clear dead-letter queue |

---

### `src/web/api/config.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/config` | Full config object (token/secret redacted to `***`) |
| `PUT`  | `/api/config` | Update non-sensitive config fields, write config.yaml, reload |

**Security note:** `PUT /api/config` must NOT accept `gitlab.token` or `gitlab.webhook_secret` (those come from env vars only). Validate with Zod before writing.

**Config write helper** in `src/config/index.ts`:
```typescript
export async function updateConfig(partial: Partial<Config>): Promise<void>
// Merges partial into current config (excluding sensitive fields),
// writes back to config.yaml via js-yaml.dump(), calls loadConfig() to reload singleton
```

---

## Phase 3 — Frontend

### File structure

```
src/web/public/
  index.html      Single HTML shell (nav + router outlet)
  style.css       Dark theme CSS (extracted from mockup)
  app.js          SPA router + page renderers + API client
  pages/
    dashboard.js      Project cards grid
    project.js        Project detail + phase timeline
    logs.js           Live log terminal (SSE consumer)
    queue.js          Queue inspector
    project-form.js   Add/Edit project form
    settings.js       Config forms
```

### Serving static files

Add to `src/web/static.ts`:
```typescript
import { serveStatic } from '@hono/node-server/serve-static'

export function registerStaticRoutes(app: Hono): void {
  app.use('/*', serveStatic({ root: './dist/web/public' }))
}
```

Or for development, use the `src/web/public/` dir directly and copy to `dist/web/public/` via tsup config.

### SPA router (app.js)

Pure hash-based routing (`#dashboard`, `#project/42`, `#logs/42`, `#queue`, `#add-project`, `#settings`). No bundler needed — ES modules loaded via `<script type="module">`.

### API client (app.js)

```javascript
const api = {
  getProjects:     ()        => fetch('/api/projects').then(r => r.json()),
  getProject:      (id)      => fetch(`/api/projects/${id}`).then(r => r.json()),
  createProject:   (body)    => fetch('/api/projects', { method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'application/json'} }).then(r => r.json()),
  updateProject:   (id,body) => fetch(`/api/projects/${id}`, { method:'PUT', ... }).then(r => r.json()),
  deleteProject:   (id)      => fetch(`/api/projects/${id}`, { method:'DELETE' }).then(r => r.json()),
  triggerPhase:    (id,phase)=> fetch(`/api/projects/${id}/trigger`, { method:'POST', body:JSON.stringify({phase}) }).then(r => r.json()),
  getLogs:         (id,opts) => fetch(`/api/projects/${id}/logs?${new URLSearchParams(opts)}`).then(r => r.json()),
  streamLogs:      (id)      => new EventSource(`/api/projects/${id}/logs/stream`),
  getQueue:        ()        => fetch('/api/queue').then(r => r.json()),
  clearDeadLetter: ()        => fetch('/api/queue/dead-letter', { method:'DELETE' }).then(r => r.json()),
  getConfig:       ()        => fetch('/api/config').then(r => r.json()),
  updateConfig:    (body)    => fetch('/api/config', { method:'PUT', ... }).then(r => r.json()),
}
```

### Live Logs page

```javascript
// logs.js
let sse = null

function mountLogsPage(projectId) {
  if (sse) { sse.close(); sse = null }
  renderTerminal()
  sse = api.streamLogs(projectId)
  sse.onmessage = (e) => {
    const entry = JSON.parse(e.data)
    appendLogLine(entry)
    if (autoScroll) scrollToBottom()
  }
}
```

Log line formatting — color by level:
- `agent` → cyan (`var(--cyan)`)
- `info`  → blue accent (`var(--accent)`)
- `warn`  → yellow (`var(--yellow)`)
- `error` → red (`var(--red)`)
- `debug` → muted (`var(--text3)`)

---

## Phase 4 — Build Integration

### tsup.config.ts additions

Copy `src/web/public/` to `dist/web/public/` as static assets (tsup doesn't handle this — use a simple copy step):

```typescript
// tsup.config.ts
{
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  // Add onSuccess hook to copy static assets
  onSuccess: 'cp -r src/web/public dist/web/public',
}
```

### package.json scripts

```json
"build": "tsup && cp -r src/web/public dist/web/",
"dev:ui": "tsx watch src/index.ts"
```

---

## New Files Summary

```
src/utils/log-store.ts          Log storage + pub/sub helper
src/web/api/projects.ts         Project CRUD routes
src/web/api/logs.ts             Log history + SSE stream
src/web/api/queue.ts            Queue inspection routes
src/web/api/config.ts           Config read/write routes
src/web/static.ts               Static file serving
src/web/public/index.html       App shell
src/web/public/style.css        Dark theme (from mockup)
src/web/public/app.js           SPA router + API client
src/web/public/pages/dashboard.js
src/web/public/pages/project.js
src/web/public/pages/logs.js
src/web/public/pages/queue.js
src/web/public/pages/project-form.js
src/web/public/pages/settings.js
```

**Modified files:**
```
src/webhook/server.ts           Register new API + static routes
src/config/index.ts             Add updateConfig() write-back helper
src/agent/runner.ts             Call logStore.append() on agent progress
src/state/manager.ts            Call logStore.append() on phase transitions
tsup.config.ts                  Add static asset copy step
```

---

## Verification Checklist

1. `GET /api/projects` returns project list with live phase state
2. `POST /api/projects` adds to config.yaml and reloads config
3. `GET /api/projects/:id/logs/stream` streams SSE; browser console shows `EventSource` events
4. Live Logs page shows colorized terminal output updating in real-time during an agent run
5. Settings page saves non-sensitive config fields
6. Manual trigger button calls `POST /api/projects/:id/trigger`
7. `docker compose build` still succeeds with web UI included
8. `pnpm typecheck` passes with zero errors
