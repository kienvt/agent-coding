// ── API client ─────────────────────────────────────────────────
const api = {
  get:    (url)       => fetch(url).then(r => r.json()),
  post:   (url, body) => fetch(url, { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  put:    (url, body) => fetch(url, { method: 'PUT',    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  delete: (url)       => fetch(url, { method: 'DELETE' }).then(r => r.json()),
}

// ── State ───────────────────────────────────────────────────────
let currentPage    = 'dashboard'
let currentProject = null   // { id, name }
let sseConn        = null   // active EventSource
let logLines       = []     // raw log entries for filter
let triggerTarget  = null   // projectId for trigger modal

// ── Router ──────────────────────────────────────────────────────
function navigate(page, ctx = {}) {
  // Tear down SSE if leaving project page
  if (page !== 'project' && sseConn) {
    sseConn.close()
    sseConn = null
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))

  const el = document.getElementById(`page-${page}`)
  if (!el) return
  el.classList.add('active')
  currentPage = page

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`)
  if (navEl) navEl.classList.add('active')

  const titles = { dashboard: 'Dashboard', project: ctx.name ?? 'Project', queue: 'Event Queue', settings: 'Settings' }
  document.getElementById('page-title').textContent = titles[page] ?? page
  document.getElementById('topbar-actions').innerHTML = ''

  if (page === 'dashboard') renderDashboard()
  if (page === 'project')   renderProject(ctx.id, ctx.name)
  if (page === 'queue')     renderQueue()
  if (page === 'settings')  renderSettings()
}

// ── Dashboard ───────────────────────────────────────────────────
async function renderDashboard() {
  const grid = document.getElementById('project-grid')
  const sub  = document.getElementById('dash-sub')
  try {
    const projects = await api.get('/api/projects')
    sub.textContent = `${projects.length} project(s) configured`
    if (!projects.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><div>No projects configured</div></div>`
      return
    }
    grid.innerHTML = projects.map(p => projectCard(p)).join('')
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div>Error loading projects: ${e.message}</div></div>`
  }
}

function projectCard(p) {
  const total   = p.issues.total
  const done    = p.issues.done
  const pct     = total ? Math.round(done / total * 100) : 0
  const barCls  = pct === 100 ? 'green' : ''
  const updated = p.lastActivity ? timeAgo(p.lastActivity) : 'never'
  const tags    = (p.tags || []).map(t => `<span class="tag">${t}</span>`).join('')
  const typTag  = `<span class="tag ${p.type}">${p.type}</span>`
  const issLine = total
    ? `<div class="progress-wrap">
         <div class="progress-label"><span>Issues</span><span>${done} / ${total} done</span></div>
         <div class="progress-bar"><div class="progress-fill ${barCls}" style="width:${pct}%"></div></div>
       </div>`
    : ''
  const errLine = p.hasError
    ? `<div class="text-xs" style="color:var(--red);margin-top:6px">⚠ ${escHtml(p.error ?? 'Error')}</div>`
    : ''

  return `
  <div class="project-card" onclick="navigate('project', {id:${p.id}, name:'${escHtml(p.name)}'})">
    <div class="project-card-header">
      <div>
        <div class="project-name">${escHtml(p.name)}</div>
        <div class="project-desc">${escHtml(p.local_path)}</div>
      </div>
      <span class="phase-badge phase-${p.phase}">${p.phase.replace(/_/g,' ')}</span>
    </div>
    <div class="project-card-body">
      <div class="tag-list">${typTag}${tags}</div>
      ${issLine}${errLine}
    </div>
    <div class="project-card-footer">
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();navigate('project',{id:${p.id},name:'${escHtml(p.name)}'})">📋 Logs</button>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openTriggerModal(${p.id},'${escHtml(p.name)}')">⚡ Trigger</button>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();resetState(${p.id})">↺ Reset</button>
      <span class="ml-auto text-xs">updated ${updated}</span>
    </div>
  </div>`
}

// ── Project detail ───────────────────────────────────────────────
const PHASE_ORDER = [
  'IDLE', 'ANALYZING', 'GENERATING_DOCS', 'AWAITING_REVIEW',
  'IMPLEMENTING', 'ALL_ISSUES_DONE', 'MR_CREATED', 'AWAITING_MR_REVIEW',
  'MR_APPROVED', 'MERGING', 'COMPLETE'
]

async function renderProject(id, name) {
  currentProject = { id, name }
  logLines = []
  document.getElementById('log-body').innerHTML = ''
  document.getElementById('log-count').textContent = '0 lines'

  // Topbar actions
  document.getElementById('topbar-actions').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="navigate('dashboard')">← Back</button>
    <button class="btn btn-default btn-sm" onclick="openTriggerModal(${id},'${escHtml(name)}')">⚡ Trigger</button>
    <button class="btn btn-danger btn-sm" onclick="resetState(${id})">↺ Reset</button>`

  try {
    const proj = await api.get(`/api/projects/${id}`)
    renderPhaseTimeline(proj.state?.phase ?? 'IDLE')
    renderIssueTable(proj.state)
  } catch { /* state may not exist yet */ }

  // Start SSE
  startSSE(id)
}

function renderPhaseTimeline(currentPhase) {
  const steps = [
    { key: 'IDLE',              label: 'Idle' },
    { key: 'ANALYZING',         label: 'Analyzing' },
    { key: 'AWAITING_REVIEW',   label: 'Plan Review' },
    { key: 'IMPLEMENTING',      label: 'Implementing' },
    { key: 'AWAITING_MR_REVIEW',label: 'MR Review' },
    { key: 'COMPLETE',          label: 'Complete' },
  ]
  const currentIdx = PHASE_ORDER.indexOf(currentPhase)
  const isError = currentPhase === 'ERROR'

  const html = steps.map((s, i) => {
    const si = PHASE_ORDER.indexOf(s.key)
    const isDone   = !isError && si < currentIdx
    const isActive = s.key === currentPhase || (!steps.find(x => x.key === currentPhase) && i === steps.length - 1)
    const dotCls   = isError && isActive ? 'error' : isDone ? 'done' : isActive ? 'active' : ''
    const lblCls   = isDone ? 'done' : isActive ? 'active' : ''
    const icon     = isError && isActive ? '✕' : isDone ? '✓' : i + 1
    const conn     = i < steps.length - 1
      ? `<div class="phase-connector ${isDone ? 'done' : ''}"></div>` : ''
    return `
      <div class="phase-step">
        <div class="phase-step-dot ${dotCls}">${icon}</div>
        <div class="phase-step-label ${lblCls}">${s.label}</div>
      </div>${conn}`
  }).join('')

  document.getElementById('proj-phases').innerHTML = `<div class="phase-steps">${html}</div>`
}

function renderIssueTable(state) {
  const el = document.getElementById('proj-issues')
  if (!state || !state.issueIids?.length) { el.style.display = 'none'; return }
  el.style.display = 'block'
  const rows = state.issueIids.map(iid => {
    const st = state.issueStatuses?.[iid] ?? 'OPEN'
    const cls = { OPEN: 'badge-blue', IN_PROGRESS: 'badge-yellow', DONE: 'badge-green', CLOSED: 'badge-green' }[st] ?? ''
    const current = state.currentIssueIid === iid ? ' ← current' : ''
    return `<tr><td class="td-mono">#${iid}</td><td><span class="badge ${cls}">${st}</span>${current}</td></tr>`
  }).join('')
  document.getElementById('proj-issue-list').innerHTML = `
    <table><thead><tr><th>Issue</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
}

// ── SSE Log Stream ───────────────────────────────────────────────
function startSSE(projectId) {
  if (sseConn) sseConn.close()
  sseConn = new EventSource(`/api/projects/${projectId}/logs/stream`)

  sseConn.onmessage = (e) => {
    if (!e.data) return
    try {
      const entry = JSON.parse(e.data)
      appendLog(entry)
    } catch { /* ignore */ }
  }

  sseConn.onerror = () => {
    appendRawLog('⚠ SSE connection lost. Logs paused.', 'warn')
  }
}

function appendLog(entry) {
  logLines.push(entry)
  const filter = document.getElementById('log-filter')?.value?.toLowerCase() ?? ''
  const line = buildLogLine(entry)
  const body = document.getElementById('log-body')
  body.appendChild(line)
  if (filter && !logLineMatchesFilter(entry, filter)) {
    line.classList.add('hidden')
  }
  const count = logLines.length
  document.getElementById('log-count').textContent = `${count} line${count !== 1 ? 's' : ''}`
  if (document.getElementById('log-autoscroll')?.checked) {
    body.scrollTop = body.scrollHeight
  }
}

function appendRawLog(msg, level = 'info') {
  appendLog({ ts: Date.now(), level, module: 'ui', msg, projectId: currentProject?.id })
}

function buildLogLine(entry) {
  const div = document.createElement('div')
  div.className = `log-line log-${entry.level}`
  const t = new Date(entry.ts)
  const time = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level">${entry.level.toUpperCase()}</span>
    <span class="log-module">${escHtml(entry.module ?? '')}</span>
    <span class="log-msg">${escHtml(entry.msg ?? '')}</span>`
  return div
}

function filterLogs() {
  const filter = document.getElementById('log-filter').value.toLowerCase()
  document.querySelectorAll('#log-body .log-line').forEach((line, i) => {
    const entry = logLines[i]
    if (!entry) return
    line.classList.toggle('hidden', filter ? !logLineMatchesFilter(entry, filter) : false)
  })
}

function logLineMatchesFilter(entry, filter) {
  return (entry.msg ?? '').toLowerCase().includes(filter) ||
         (entry.module ?? '').toLowerCase().includes(filter) ||
         (entry.level ?? '').toLowerCase().includes(filter)
}

function clearLogs() {
  if (!currentProject) return
  api.delete(`/api/projects/${currentProject.id}/logs`)
    .then(() => {
      logLines = []
      document.getElementById('log-body').innerHTML = ''
      document.getElementById('log-count').textContent = '0 lines'
      toast('Logs cleared')
    })
}

// ── Queue ────────────────────────────────────────────────────────
async function renderQueue() {
  try {
    const data = await api.get('/api/queue')
    document.getElementById('queue-sub').textContent = `${data.queue_length} pending, ${data.dead_letter_length} failed`
    document.getElementById('q-pending').textContent = data.queue_length
    document.getElementById('q-dead').textContent = data.dead_letter_length

    const badge = document.getElementById('queue-badge')
    if (data.dead_letter_length > 0) {
      badge.textContent = data.dead_letter_length
      badge.style.display = ''
    } else {
      badge.style.display = 'none'
    }

    const tbl = document.getElementById('dead-letter-table')
    if (!data.dead_letter?.length) {
      tbl.innerHTML = `<div class="empty-state" style="padding:30px"><div>No dead-letter entries</div></div>`
      return
    }
    const rows = data.dead_letter.map(dl => `
      <tr>
        <td class="td-mono">${escHtml(dl.event?.type ?? '?')}</td>
        <td class="td-mono">${dl.event?.projectId ?? '?'}</td>
        <td>${escHtml(dl.reason ?? '')}</td>
        <td class="text-xs">${timeAgo(dl.failedAt)}</td>
      </tr>`).join('')
    tbl.innerHTML = `<table>
      <thead><tr><th>Type</th><th>Project</th><th>Reason</th><th>Failed</th></tr></thead>
      <tbody>${rows}</tbody></table>`
  } catch (e) {
    document.getElementById('queue-sub').textContent = `Error: ${e.message}`
  }
}

async function refreshQueue() {
  await renderQueue()
  toast('Queue refreshed')
}

async function clearDeadLetter() {
  await api.delete('/api/queue/dead-letter')
  toast('Dead-letter cleared', 'success')
  renderQueue()
}

// ── Settings ─────────────────────────────────────────────────────
let _cfgRepos = []  // local copy of repositories array

async function renderSettings() {
  try {
    const cfg = await api.get('/api/config')
    document.getElementById('cfg-gitlab-url').value  = cfg.gitlab?.url ?? ''
    document.getElementById('cfg-model').value       = cfg.agent?.model ?? ''
    document.getElementById('cfg-retries').value     = cfg.agent?.max_retries ?? 3
    document.getElementById('cfg-timeout').value     = cfg.agent?.timeout_seconds ?? 300
    document.getElementById('cfg-branch').value      = cfg.workflow?.target_branch ?? 'main'
    document.getElementById('cfg-prefix').value      = cfg.workflow?.branch_prefix ?? 'feature/'
    document.getElementById('cfg-automerge').checked = cfg.workflow?.auto_merge ?? false
    document.getElementById('cfg-tests').checked     = cfg.workflow?.require_tests ?? true
    _cfgRepos = cfg.repositories ?? []
    renderRepoList()
  } catch (e) {
    toast(`Failed to load config: ${e.message}`, 'error')
  }
}

function renderRepoList() {
  const el = document.getElementById('repo-list')
  if (!_cfgRepos.length) {
    el.innerHTML = `<div class="text-xs" style="color:var(--text-muted)">No repositories configured.</div>`
    return
  }
  el.innerHTML = _cfgRepos.map((r, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <span style="font-weight:500">${escHtml(r.name)}</span>
        <span class="tag ${r.type}" style="margin-left:6px">${r.type}</span>
        <div class="text-xs" style="margin-top:2px;color:var(--text-muted)">${escHtml(r.local_path)} · ID: ${r.gitlab_project_id}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteRepository(${i})">Remove</button>
    </div>`).join('')
}

async function addRepository() {
  const name = document.getElementById('new-repo-name').value.trim()
  const id   = parseInt(document.getElementById('new-repo-id').value, 10)
  const path = document.getElementById('new-repo-path').value.trim()
  const type = document.getElementById('new-repo-type').value
  if (!name || !id || !path) { toast('Fill in all fields', 'error'); return }
  _cfgRepos = [..._cfgRepos, { name, gitlab_project_id: id, local_path: path, type, tags: [] }]
  try {
    await api.put('/api/config', { repositories: _cfgRepos })
    toast(`Repository "${name}" added — cloning in background…`, 'success')
    document.getElementById('new-repo-name').value = ''
    document.getElementById('new-repo-id').value   = ''
    document.getElementById('new-repo-path').value = ''
    renderRepoList()
  } catch (e) {
    _cfgRepos = _cfgRepos.slice(0, -1)
    toast(`Failed: ${e.message}`, 'error')
  }
}

async function deleteRepository(idx) {
  const repo = _cfgRepos[idx]
  if (!confirm(`Remove "${repo.name}" from config? Local files are not deleted.`)) return
  _cfgRepos = _cfgRepos.filter((_, i) => i !== idx)
  try {
    await api.put('/api/config', { repositories: _cfgRepos })
    toast('Repository removed', 'success')
    renderRepoList()
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error')
  }
}

async function saveSettings() {
  const gitlabUrl = document.getElementById('cfg-gitlab-url').value.trim()
  const partial = {
    ...(gitlabUrl ? { gitlab: { url: gitlabUrl } } : {}),
    agent: {
      model:           document.getElementById('cfg-model').value,
      max_retries:     parseInt(document.getElementById('cfg-retries').value, 10),
      timeout_seconds: parseInt(document.getElementById('cfg-timeout').value, 10),
    },
    workflow: {
      target_branch: document.getElementById('cfg-branch').value,
      branch_prefix: document.getElementById('cfg-prefix').value,
      auto_merge:    document.getElementById('cfg-automerge').checked,
      require_tests: document.getElementById('cfg-tests').checked,
    },
  }
  try {
    await api.put('/api/config', partial)
    toast('Settings saved', 'success')
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error')
  }
}

// ── Trigger modal ────────────────────────────────────────────────
function openTriggerModal(projectId, name) {
  triggerTarget = projectId
  document.getElementById('trigger-modal-desc').textContent = `Project: ${name}`
  document.getElementById('trigger-modal').classList.add('open')
}

function closeModal() {
  document.getElementById('trigger-modal').classList.remove('open')
  triggerTarget = null
}

async function confirmTrigger() {
  if (!triggerTarget) return
  const phase = document.getElementById('trigger-phase-select').value
  try {
    await api.post(`/api/projects/${triggerTarget}/trigger`, { phase })
    toast(`Triggered phase: ${phase}`, 'success')
    closeModal()
    if (currentPage === 'dashboard') renderDashboard()
  } catch (e) {
    toast(`Trigger failed: ${e.message}`, 'error')
  }
}

// ── Reset state ───────────────────────────────────────────────────
async function resetState(projectId) {
  if (!confirm('Reset project state to IDLE? This clears logs and phase progress.')) return
  try {
    await api.delete(`/api/projects/${projectId}/state`)
    toast('State reset to IDLE', 'success')
    if (currentPage === 'dashboard') renderDashboard()
    else if (currentPage === 'project' && currentProject?.id === projectId) renderProject(projectId, currentProject.name)
  } catch (e) {
    toast(`Reset failed: ${e.message}`, 'error')
  }
}

async function refreshDashboard() {
  await renderDashboard()
  toast('Refreshed')
}

// ── Health check ─────────────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await fetch('/health')
    const ok = r.ok
    document.getElementById('redis-dot').className = `status-dot ${ok ? 'green' : 'red'}`
    document.getElementById('redis-status').textContent = ok ? 'Connected' : 'Disconnected'
  } catch {
    document.getElementById('redis-dot').className = 'status-dot red'
    document.getElementById('redis-status').textContent = 'Offline'
  }
}

// ── Toast ────────────────────────────────────────────────────────
let toastTimer = null
function toast(msg, type = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast show${type ? ' ' + type : ''}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800)
}

// ── Utils ────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function pad(n) { return String(n).padStart(2, '0') }
function timeAgo(ts) {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

// ── Init ─────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page))
})

document.getElementById('trigger-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal()
})

checkHealth()
setInterval(checkHealth, 30_000)
navigate('dashboard')
