import { useState, useEffect } from 'react'
import { apiClient } from '../api/client.js'
import { Topbar } from '../components/layout/Topbar.js'
import { PhaseBadge } from '../components/ui/Badge.js'
import { ProgressBar } from '../components/ui/ProgressBar.js'
import { TriggerModal } from '../components/TriggerModal.js'
import { useToast } from '../components/ui/Toast.js'
import type { ProjectGroupSummary, RepoSummary, AppConfig, Page } from '../types/index.js'

interface Props {
  onSelectProject: (slug: string) => void
  onNavigate: (page: Page) => void
}

export function DashboardPage({ onSelectProject, onNavigate }: Props) {
  const [projects, setProjects] = useState<ProjectGroupSummary[]>([])
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()

  const load = () => {
    apiClient.projects
      .list()
      .then(setProjects)
      .catch(() => showToast('Failed to load projects', 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiClient.config.get().then(setAppConfig).catch(() => {})
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <Topbar
        title="Dashboard"
        actions={
          <button className="btn btn-sm" onClick={load}>
            Refresh
          </button>
        }
      />
      <div className="page">
        {/* Setup banners */}
        {appConfig && !appConfig.secrets_configured?.token && (
          <div className="setup-banner setup-banner-warn">
            <span>⚠ GitLab credentials not configured — webhooks will not work.</span>
            <button className="btn btn-sm" onClick={() => onNavigate('settings')}>Configure Now</button>
          </div>
        )}
        {!loading && projects.length === 0 && appConfig?.secrets_configured?.token && (
          <div className="setup-banner setup-banner-info">
            <span>GitLab is connected. Create your first project to get started.</span>
            <button className="btn btn-primary btn-sm" onClick={() => onNavigate('settings')}>Add Project</button>
          </div>
        )}

        {loading && <div className="spinner" />}
        {!loading && projects.length === 0 && !appConfig?.secrets_configured?.token && (
          <div className="empty-state">
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Welcome to AI Agent Orchestrator</p>
            <p className="text-muted">Complete setup in Settings to start automating your GitLab repositories.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => onNavigate('settings')}>
              Go to Settings
            </button>
          </div>
        )}
        <div className="project-grid">
          {projects.map((p) => (
            <ProjectCard
              key={p.slug}
              project={p}
              onViewLogs={() => onSelectProject(p.slug)}
              onRefresh={load}
            />
          ))}
        </div>
      </div>
      <style>{`
        .project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
        .repo-list { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; }
        .repo-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; }
        .repo-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
        .repo-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-actions { display: flex; gap: 6px; margin-top: 12px; }
        .progress-bar-wrap { display: flex; align-items: center; gap: 8px; }
        .progress-bar-track { flex: 1; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }
        .progress-bar-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
      `}</style>
    </>
  )
}

const REPO_ICONS: Record<string, string> = {
  frontend: '🖥',
  backend: '⚙',
  infra: '☁',
  fullstack: '⊞',
  docs: '📄',
}

function repoIcon(repo: RepoSummary): string {
  if (repo.role === 'docs') return REPO_ICONS.docs
  return REPO_ICONS[repo.type] ?? '📦'
}

function ProjectCard({
  project,
  onViewLogs,
  onRefresh,
}: {
  project: ProjectGroupSummary
  onViewLogs: () => void
  onRefresh: () => void
}) {
  const [triggerOpen, setTriggerOpen] = useState(false)
  const { showToast } = useToast()

  const handleReset = async () => {
    try {
      await apiClient.projects.resetState(project.slug)
      showToast('State reset', 'success')
      onRefresh()
    } catch {
      showToast('Reset failed', 'error')
    }
  }

  const { total, done } = project.issues

  return (
    <>
      <div className="card project-card">
        {/* Header */}
        <div className="card-header">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{project.name}</div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{project.slug}</div>
          </div>
          <PhaseBadge phase={project.phase} />
        </div>

        {/* Error */}
        {project.hasError && project.error && (
          <div className="text-error" style={{ fontSize: 12, marginBottom: 8 }}>{project.error}</div>
        )}

        {/* Repo list */}
        <div className="repo-list">
          {project.repositories.map((r) => (
            <div key={r.name} className="repo-row">
              <span className="repo-icon">{repoIcon(r)}</span>
              <span className="repo-name">{r.name}</span>
              <span className="badge badge-default" style={{ fontSize: 10 }}>{r.role}</span>
              {r.mrIid != null && (
                <span className="text-muted" style={{ fontSize: 11 }}>MR!{r.mrIid}</span>
              )}
              <span style={{ marginLeft: 'auto' }}>
                <PhaseBadge phase={r.phase} />
              </span>
            </div>
          ))}
        </div>

        {/* Issue progress */}
        {total > 0 && (
          <div style={{ marginTop: 4, marginBottom: 4 }}>
            <ProgressBar done={done} total={total} />
          </div>
        )}

        {/* Actions */}
        <div className="card-actions">
          <button className="btn btn-sm" onClick={onViewLogs}>
            Logs
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setTriggerOpen(true)}>
            ⚡ Trigger
          </button>
          <button className="btn btn-sm" onClick={handleReset}>
            Reset
          </button>
        </div>

        {project.lastActivity && (
          <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
            {new Date(project.lastActivity).toLocaleString()}
          </div>
        )}
      </div>

      <TriggerModal
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        slug={project.slug}
        docsRepo={project.docs_repo}
      />
    </>
  )
}
