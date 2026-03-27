import { useState, useEffect } from 'react'
import { apiClient } from '../api/client.js'
import { Topbar } from '../components/layout/Topbar.js'
import { Modal } from '../components/ui/Modal.js'
import { useToast } from '../components/ui/Toast.js'
import type {
  AppConfig,
  ProjectGroupConfig,
  RepositoryConfig,
  RepositoryType,
  RepositoryRole,
} from '../types/index.js'

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [activeTab, setActiveTab] = useState<'gitlab' | 'agent' | 'workflow' | 'projects'>('gitlab')
  const { showToast } = useToast()

  const load = () =>
    apiClient.config.get().then(setConfig).catch(() => showToast('Failed to load config', 'error'))

  useEffect(() => { load() }, [])

  if (!config) return (
    <>
      <Topbar title="Settings" />
      <div className="page"><div className="spinner" /></div>
    </>
  )

  const refresh = () => load()

  return (
    <>
      <Topbar title="Settings" />
      <div className="page">
        <div className="tabs">
          {(['gitlab', 'agent', 'workflow', 'projects'] as const).map((tab) => (
            <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
              {tab === 'gitlab' ? 'GitLab' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'gitlab' && (!config.secrets_configured?.token || !config.secrets_configured?.webhook_secret) && (
                <span style={{ marginLeft: 6, color: 'var(--warn)' }}>⚠</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'gitlab' && (
          <GitlabSettings config={config} onSave={(cfg) => { setConfig(cfg); showToast('Saved', 'success') }} />
        )}
        {activeTab === 'agent' && (
          <AgentSettings config={config} onSave={(cfg) => { setConfig(cfg); showToast('Saved', 'success') }} />
        )}
        {activeTab === 'workflow' && (
          <WorkflowSettings config={config} onSave={(cfg) => { setConfig(cfg); showToast('Saved', 'success') }} />
        )}
        {activeTab === 'projects' && (
          <ProjectsSettings config={config} onRefresh={refresh} />
        )}
      </div>
    </>
  )
}

// ── GitLab Settings ────────────────────────────────────────────────────────────

function GitlabSettings({ config, onSave }: { config: AppConfig; onSave: (c: AppConfig) => void }) {
  const [url, setUrl] = useState(config.gitlab.url)
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [savingSecrets, setSavingSecrets] = useState(false)
  const { showToast } = useToast()

  const saveUrl = async () => {
    setSavingUrl(true)
    try {
      const result = await apiClient.config.update({ gitlab: { url, token: config.gitlab.token, webhook_secret: config.gitlab.webhook_secret } })
      onSave(result.config)
    } catch {
      showToast('Failed to save', 'error')
    } finally {
      setSavingUrl(false)
    }
  }

  const saveSecrets = async () => {
    if (!token.trim() && !secret.trim()) return
    setSavingSecrets(true)
    try {
      await apiClient.config.updateSecrets({
        ...(token.trim() && { token: token.trim() }),
        ...(secret.trim() && { webhook_secret: secret.trim() }),
      })
      showToast('Credentials updated', 'success')
      setToken('')
      setSecret('')
      // Refresh config to get updated secrets_configured flags
      const updated = await apiClient.config.get()
      onSave(updated)
    } catch {
      showToast('Failed to update credentials', 'error')
    } finally {
      setSavingSecrets(false)
    }
  }

  const cfg = config.secrets_configured

  return (
    <div style={{ maxWidth: 560 }}>
      {/* URL section */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>GitLab Instance</h3>
        <div className="form-group">
          <label>GitLab URL</label>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gitlab.example.com" />
        </div>
        <button className="btn btn-primary" onClick={saveUrl} disabled={savingUrl}>
          {savingUrl ? 'Saving…' : 'Save URL'}
        </button>
      </div>

      {/* Credentials section */}
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Credentials</h3>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Secrets are stored in config.yaml and never returned by the API. Leave blank to keep existing value.
        </p>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Access Token
            <SecretStatus configured={cfg?.token} />
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter new token to update"
            autoComplete="new-password"
          />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Webhook Secret
            <SecretStatus configured={cfg?.webhook_secret} />
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter new webhook secret to update"
            autoComplete="new-password"
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={saveSecrets}
          disabled={savingSecrets || (!token.trim() && !secret.trim())}
        >
          {savingSecrets ? 'Saving…' : 'Update Credentials'}
        </button>
      </div>
    </div>
  )
}

function SecretStatus({ configured }: { configured?: boolean }) {
  if (configured === undefined) return null
  return configured
    ? <span style={{ fontSize: 11, color: 'var(--success)' }}>✓ configured</span>
    : <span style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ not set</span>
}

// ── Agent Settings ─────────────────────────────────────────────────────────────

function AgentSettings({ config, onSave }: { config: AppConfig; onSave: (c: AppConfig) => void }) {
  const [form, setForm] = useState(config.agent)
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiClient.config.update({ agent: form })
      onSave(result.config)
    } catch {
      showToast('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="form-group">
        <label>Model</label>
        <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Max Retries</label>
        <input type="number" value={form.max_retries} onChange={(e) => setForm({ ...form, max_retries: +e.target.value })} />
      </div>
      <div className="form-group">
        <label>Timeout (seconds)</label>
        <input type="number" value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: +e.target.value })} />
      </div>
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ── Workflow Settings ──────────────────────────────────────────────────────────

function WorkflowSettings({ config, onSave }: { config: AppConfig; onSave: (c: AppConfig) => void }) {
  const [form, setForm] = useState(config.workflow)
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiClient.config.update({ workflow: form })
      onSave(result.config)
    } catch {
      showToast('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="form-group">
        <label>Target Branch</label>
        <input type="text" value={form.target_branch} onChange={(e) => setForm({ ...form, target_branch: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Branch Prefix</label>
        <input type="text" value={form.branch_prefix} onChange={(e) => setForm({ ...form, branch_prefix: e.target.value })} />
      </div>
      <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" id="auto-merge" checked={form.auto_merge}
          onChange={(e) => setForm({ ...form, auto_merge: e.target.checked })} style={{ width: 'auto' }} />
        <label htmlFor="auto-merge" style={{ color: 'var(--text)' }}>Auto Merge</label>
      </div>
      <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" id="require-tests" checked={form.require_tests}
          onChange={(e) => setForm({ ...form, require_tests: e.target.checked })} style={{ width: 'auto' }} />
        <label htmlFor="require-tests" style={{ color: 'var(--text)' }}>Require Tests</label>
      </div>
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ── Projects Settings (full CRUD) ──────────────────────────────────────────────

function ProjectsSettings({ config, onRefresh }: { config: AppConfig; onRefresh: () => void }) {
  const [addingGroup, setAddingGroup] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProjectGroupConfig | null>(null)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null)
  const [addingRepoFor, setAddingRepoFor] = useState<string | null>(null)
  const [editingRepo, setEditingRepo] = useState<{ slug: string; repo: RepositoryConfig } | null>(null)
  const [confirmDeleteRepo, setConfirmDeleteRepo] = useState<{ slug: string; repoName: string } | null>(null)
  const { showToast } = useToast()

  const handleDeleteGroup = async (slug: string) => {
    try {
      await apiClient.projects.delete(slug)
      showToast('Project deleted', 'success')
      onRefresh()
    } catch {
      showToast('Delete failed', 'error')
    } finally {
      setConfirmDeleteGroup(null)
    }
  }

  const handleDeleteRepo = async (slug: string, repoName: string) => {
    try {
      await apiClient.projects.deleteRepo(slug, repoName)
      showToast('Repository removed', 'success')
      onRefresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setConfirmDeleteRepo(null)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Project Groups</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setAddingGroup(true)}>+ New Project</button>
      </div>

      {config.projects.length === 0 && (
        <div className="empty-state">
          <p>No projects yet.</p>
          <p className="text-muted mt-4">Click "New Project" to get started.</p>
        </div>
      )}

      {config.projects.map((pg) => (
        <div key={pg.id} className="card" style={{ marginBottom: 12 }}>
          {/* Group header */}
          <div className="card-header">
            <div>
              <div style={{ fontWeight: 600 }}>{pg.name}</div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{pg.id}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setEditingGroup(pg)}>Edit</button>
              {confirmDeleteGroup === pg.id ? (
                <>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteGroup(pg.id)}>Confirm</button>
                  <button className="btn btn-sm" onClick={() => setConfirmDeleteGroup(null)}>Cancel</button>
                </>
              ) : (
                <button className="btn btn-sm" onClick={() => setConfirmDeleteGroup(pg.id)}>Delete</button>
              )}
            </div>
          </div>

          {/* Docs config */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Docs: <b style={{ color: 'var(--text)' }}>{pg.docs_repo || '—'}</b>
            {' @ '}<b style={{ color: 'var(--text)' }}>{pg.docs_branch}</b>
            {' · '}<code style={{ fontSize: 11 }}>{pg.docs_path_pattern}</code>
          </div>

          {/* Repositories */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Repositories</div>
            {pg.repositories.length === 0 && (
              <div className="text-muted" style={{ fontSize: 12 }}>No repositories. Add one below.</div>
            )}
            {pg.repositories.map((r) => (
              <div key={r.name} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 4
              }}>
                <span style={{ fontWeight: 500, flex: 1 }}>{r.name}</span>
                <span className="badge badge-default">{r.role}</span>
                <span className="badge badge-default">{r.type}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>ID: {r.gitlab_project_id}</span>
                <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => setEditingRepo({ slug: pg.id, repo: r })}>Edit</button>
                {confirmDeleteRepo?.slug === pg.id && confirmDeleteRepo.repoName === r.name ? (
                  <>
                    <button className="btn btn-danger btn-sm" style={{ padding: '2px 8px' }} onClick={() => handleDeleteRepo(pg.id, r.name)}>Confirm</button>
                    <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => setConfirmDeleteRepo(null)}>✕</button>
                  </>
                ) : (
                  <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => setConfirmDeleteRepo({ slug: pg.id, repoName: r.name })}>Remove</button>
                )}
              </div>
            ))}
          </div>

          <button className="btn btn-sm" onClick={() => setAddingRepoFor(pg.id)}>+ Add Repository</button>
        </div>
      ))}

      {/* Project Group form modals */}
      <ProjectGroupModal
        open={addingGroup}
        onClose={() => setAddingGroup(false)}
        onSaved={() => { setAddingGroup(false); onRefresh() }}
      />
      <ProjectGroupModal
        open={!!editingGroup}
        existing={editingGroup ?? undefined}
        onClose={() => setEditingGroup(null)}
        onSaved={() => { setEditingGroup(null); onRefresh() }}
      />

      {/* Repository form modals */}
      <RepoModal
        open={!!addingRepoFor}
        slug={addingRepoFor ?? ''}
        onClose={() => setAddingRepoFor(null)}
        onSaved={() => { setAddingRepoFor(null); onRefresh() }}
      />
      <RepoModal
        open={!!editingRepo}
        slug={editingRepo?.slug ?? ''}
        existing={editingRepo?.repo}
        onClose={() => setEditingRepo(null)}
        onSaved={() => { setEditingRepo(null); onRefresh() }}
      />
    </>
  )
}

// ── ProjectGroupModal ──────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50)
}

function ProjectGroupModal({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  existing?: ProjectGroupConfig
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!existing
  const [id, setId] = useState(existing?.id ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [docsRepo, setDocsRepo] = useState(existing?.docs_repo ?? '')
  const [docsBranch, setDocsBranch] = useState(existing?.docs_branch ?? 'main')
  const [docsPattern, setDocsPattern] = useState(existing?.docs_path_pattern ?? 'requirement*')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  if (!open) return null  // unmount = reset (state reinitializes on next open)

  const handleNameChange = (v: string) => {
    setName(v)
    if (!isEdit) setId(slugify(v))
  }

  const handleSave = async () => {
    if (!id.trim() || !name.trim()) {
      showToast('ID and name are required', 'error')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await apiClient.projects.update(existing!.id, { name, docs_repo: docsRepo, docs_branch: docsBranch, docs_path_pattern: docsPattern })
      } else {
        await apiClient.projects.create({ id: id.trim(), name: name.trim(), docs_repo: docsRepo, docs_branch: docsBranch, docs_path_pattern: docsPattern })
      }
      showToast(isEdit ? 'Project updated' : 'Project created', 'success')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit — ${existing!.name}` : 'New Project Group'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Project Name</label>
        <input type="text" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="My Platform" />
      </div>
      <div className="form-group">
        <label>
          ID / Slug {!isEdit && <span className="text-muted" style={{ fontWeight: 400 }}>(auto-generated, immutable after creation)</span>}
        </label>
        <input type="text" value={id} onChange={(e) => setId(e.target.value)} disabled={isEdit} placeholder="my-platform" />
      </div>
      <div className="form-group">
        <label>Docs Repository Name</label>
        <input type="text" value={docsRepo} onChange={(e) => setDocsRepo(e.target.value)} placeholder="platform-docs" />
        <span className="text-muted" style={{ fontSize: 11 }}>Must match a repository name added below</span>
      </div>
      <div className="form-group">
        <label>Docs Branch</label>
        <input type="text" value={docsBranch} onChange={(e) => setDocsBranch(e.target.value)} placeholder="main" />
      </div>
      <div className="form-group">
        <label>Path Pattern</label>
        <input type="text" value={docsPattern} onChange={(e) => setDocsPattern(e.target.value)} placeholder="requirements/**" />
        <span className="text-muted" style={{ fontSize: 11 }}>Glob pattern for requirement files (e.g. <code>requirements/**</code>)</span>
      </div>
    </Modal>
  )
}

// ── RepoModal ──────────────────────────────────────────────────────────────────

const REPO_TYPES_CODE: RepositoryType[] = ['frontend', 'backend', 'infra', 'fullstack']
const REPO_ROLES: RepositoryRole[] = ['code', 'docs']

function RepoModal({
  open,
  slug,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  slug: string
  existing?: RepositoryConfig
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!existing
  const [repoName, setRepoName] = useState(existing?.name ?? '')
  const [projectId, setProjectId] = useState(existing?.gitlab_project_id?.toString() ?? '')
  const [localPath, setLocalPath] = useState(existing?.local_path ?? '')
  const [type, setType] = useState<RepositoryType>(existing?.type ?? 'backend')
  const [role, setRole] = useState<RepositoryRole>(existing?.role ?? 'code')
  const [tags, setTags] = useState(existing?.tags?.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  if (!open) return null

  const handleNameChange = (v: string) => {
    setRepoName(v)
    // Auto-fill local_path from name when not editing
    if (!isEdit && !localPath) setLocalPath(v.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))
  }

  const handleRoleChange = (r: RepositoryRole) => {
    setRole(r)
    // Docs repos have their own type; code repos default to backend
    if (r === 'docs') setType('docs')
    else if (type === 'docs') setType('backend')
  }

  const handleSave = async () => {
    if (!repoName.trim()) { showToast('Name is required', 'error'); return }
    if (!projectId.trim() || isNaN(+projectId)) { showToast('Valid GitLab Project ID is required', 'error'); return }
    if (!localPath.trim()) { showToast('Local path is required', 'error'); return }

    setSaving(true)
    try {
      const body = {
        gitlab_project_id: +projectId,
        local_path: localPath.trim(),
        type,
        role,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }
      if (isEdit) {
        await apiClient.projects.updateRepo(slug, existing!.name, body)
      } else {
        await apiClient.projects.addRepo(slug, { name: repoName.trim(), ...body })
      }
      showToast(isEdit ? 'Repository updated' : 'Repository added', 'success')
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const isDocsRole = role === 'docs'

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit repo — ${existing!.name}` : 'Add Repository'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Add'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Role</label>
        <select value={role} onChange={(e) => handleRoleChange(e.target.value as RepositoryRole)} disabled={isEdit}>
          {REPO_ROLES.map((r) => <option key={r} value={r}>{r === 'docs' ? 'docs — requirements/documentation repo' : 'code — source code repo'}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Repository Name {isEdit && <span className="text-muted" style={{ fontWeight: 400 }}>(immutable)</span>}</label>
        <input type="text" value={repoName} onChange={(e) => handleNameChange(e.target.value)} disabled={isEdit}
          placeholder={isDocsRole ? 'platform-docs' : 'platform-backend'} />
        {isDocsRole && (
          <span className="text-muted" style={{ fontSize: 11 }}>
            Must match the "Docs Repository Name" set on the project group
          </span>
        )}
      </div>
      <div className="form-group">
        <label>GitLab Project ID</label>
        <input type="number" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="101" />
        <span className="text-muted" style={{ fontSize: 11 }}>
          GitLab → Project → Settings → General → Project ID
          {isDocsRole && ' · Used for webhook routing and issue API calls'}
        </span>
      </div>
      <div className="form-group">
        <label>Local Path</label>
        <input type="text" value={localPath} onChange={(e) => setLocalPath(e.target.value)}
          placeholder={isDocsRole ? 'platform-docs' : 'platform-backend'} />
        <span className="text-muted" style={{ fontSize: 11 }}>
          Folder name relative to <code>WORKSPACE_PATH</code> (e.g. <code>{isDocsRole ? 'platform-docs' : 'platform-backend'}</code>)
        </span>
      </div>
      {!isDocsRole && (
        <div className="form-group">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as RepositoryType)}>
            {REPO_TYPES_CODE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}
      {!isDocsRole && (
        <div className="form-group">
          <label>Tags <span className="text-muted" style={{ fontWeight: 400 }}>(comma-separated)</span></label>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="nodejs, typescript, postgresql" />
        </div>
      )}
    </Modal>
  )
}
