import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../api/client.js'
import { Topbar } from '../components/layout/Topbar.js'
import { PhaseBadge } from '../components/ui/Badge.js'
import { Modal } from '../components/ui/Modal.js'
import { TriggerModal } from '../components/TriggerModal.js'
import { useToast } from '../components/ui/Toast.js'
import { useLogStream } from '../hooks/useLogStream.js'
import type { ProjectGroupDetail, LogEntry } from '../types/index.js'

interface Props {
  slug: string | null
  onBack: () => void
}

export function ProjectPage({ slug, onBack }: Props) {
  const [detail, setDetail] = useState<ProjectGroupDetail | null>(null)
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmClearLogs, setConfirmClearLogs] = useState(false)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const { showToast } = useToast()
  const { lines, clear } = useLogStream(slug, activeRepo ?? undefined)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!slug) return
    apiClient.projects
      .get(slug)
      .then(setDetail)
      .catch(() => showToast('Failed to load project', 'error'))
  }, [slug])

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines])

  if (!slug) return null

  const handleReset = async () => {
    try {
      await apiClient.projects.resetState(slug)
      showToast('State reset', 'success')
      setConfirmReset(false)
      setDetail(null)
      apiClient.projects.get(slug).then(setDetail).catch(() => {})
    } catch {
      showToast('Reset failed', 'error')
    }
  }

  const handleClearLogs = async () => {
    try {
      await apiClient.projects.clearLogs(slug)
      clear()
      showToast('Logs cleared', 'success')
      setConfirmClearLogs(false)
    } catch {
      showToast('Clear logs failed', 'error')
    }
  }

  const phase = detail?.state?.phase ?? 'IDLE'
  const codeRepos = detail?.repositories.filter((r) => r.role === 'code') ?? []

  return (
    <>
      <Topbar
        title={detail?.name ?? slug}
        actions={
          <>
            <button className="btn btn-sm" onClick={onBack}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={() => setTriggerOpen(true)}>⚡ Trigger</button>
            <button className="btn btn-sm" onClick={() => setConfirmReset(true)}>Reset</button>
          </>
        }
      />
      <div className="page">
        {/* Group state */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span style={{ fontWeight: 600 }}>Project Group</span>
            <PhaseBadge phase={phase} />
          </div>
          {detail?.state?.error && (
            <div className="text-error" style={{ fontSize: 12, marginBottom: 8 }}>{detail.state.error}</div>
          )}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Docs repo: <b style={{ color: 'var(--text)' }}>{detail?.docs_repo ?? '—'}</b></span>
            {detail?.state?.startedAt && (
              <span>Started: {new Date(detail.state.startedAt).toLocaleString()}</span>
            )}
          </div>
        </div>

        {/* Repo tabs */}
        {codeRepos.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              <button
                className={`tab ${activeRepo === null ? 'active' : ''}`}
                onClick={() => setActiveRepo(null)}
              >
                All Repos
              </button>
              {codeRepos.map((r) => (
                <button
                  key={r.name}
                  className={`tab ${activeRepo === r.name ? 'active' : ''}`}
                  onClick={() => setActiveRepo(r.name)}
                >
                  {r.name}
                </button>
              ))}
            </div>
            {activeRepo && (() => {
              const repo = codeRepos.find((r) => r.name === activeRepo)
              if (!repo) return null
              const rs = repo.state
              return (
                <div style={{ padding: '12px 0 0' }}>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <span>Phase: <PhaseBadge phase={rs?.phase ?? 'IDLE'} /></span>
                    {rs && (
                      <>
                        <span>Issues: {rs.issueIids.length}</span>
                        {rs.mrIid && <span>MR !{rs.mrIid}</span>}
                        {rs.error && <span className="text-error">{rs.error}</span>}
                      </>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Logs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Logs</span>
          <button className="btn btn-sm" onClick={() => setConfirmClearLogs(true)}>Clear Logs</button>
        </div>
        <div className="log-viewer" ref={logRef} style={{ height: 380 }}>
          {lines.length === 0 && <div className="text-muted">No logs yet.</div>}
          {lines.map((entry, i) => (
            <LogLine key={i} entry={entry} />
          ))}
        </div>
      </div>

      {/* Reset confirm modal */}
      <Modal
        open={confirmReset}
        title="Reset Project State"
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <button className="btn btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={handleReset}>Reset</button>
          </>
        }
      >
        <p>This will clear all state for <b>{slug}</b>. This cannot be undone.</p>
      </Modal>

      {/* Clear logs confirm modal */}
      <Modal
        open={confirmClearLogs}
        title="Clear Logs"
        onClose={() => setConfirmClearLogs(false)}
        footer={
          <>
            <button className="btn btn-sm" onClick={() => setConfirmClearLogs(false)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={handleClearLogs}>Clear</button>
          </>
        }
      >
        <p>Delete all log entries for <b>{slug}</b>?</p>
      </Modal>

      {/* Trigger modal */}
      <TriggerModal
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        slug={slug}
        docsRepo={detail?.docs_repo}
      />
    </>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const ts = new Date(entry.ts).toLocaleTimeString()
  return (
    <div className="log-line">
      <span className="log-ts">{ts}</span>
      <span className="log-module">{entry.module}</span>
      <span className={`log-level log-level-${entry.level}`}>{entry.level}</span>
      <span className="log-msg">{entry.msg}</span>
    </div>
  )
}
