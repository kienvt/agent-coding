import { useState } from 'react'
import { Modal } from './ui/Modal.js'
import { apiClient } from '../api/client.js'
import { useToast } from './ui/Toast.js'
import type { TriggerBody } from '../types/index.js'

interface Props {
  open: boolean
  onClose: () => void
  slug: string
  docsRepo?: string
}

const PHASES: Array<{ value: TriggerBody['phase']; label: string; description: string }> = [
  { value: 'init', label: 'Init', description: 'Analyze requirements and create issues' },
  { value: 'implement', label: 'Implement', description: 'Start implementing open issues' },
  { value: 'review', label: 'Review', description: 'Create merge requests' },
  { value: 'done', label: 'Done', description: 'Finalize and close completed work' },
]

export function TriggerModal({ open, onClose, slug, docsRepo }: Props) {
  const [phase, setPhase] = useState<TriggerBody['phase']>('init')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  const handleTrigger = async () => {
    setLoading(true)
    try {
      const body: TriggerBody = { phase }
      if (phase === 'init' && filePath.trim()) body.filePath = filePath.trim()
      await apiClient.projects.trigger(slug, body)
      showToast(`Triggered phase: ${phase}`, 'success')
      onClose()
    } catch {
      showToast('Trigger failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`Trigger — ${slug}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleTrigger} disabled={loading}>
            {loading ? 'Triggering…' : 'Trigger'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Phase</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PHASES.map((p) => (
            <label
              key={p.value}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                border: '1px solid',
                borderColor: phase === p.value ? 'var(--accent)' : 'var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                background: phase === p.value ? 'rgba(124,106,247,0.08)' : 'transparent',
              }}
              onClick={() => setPhase(p.value)}
            >
              <input
                type="radio"
                name="phase"
                value={p.value}
                checked={phase === p.value}
                onChange={() => setPhase(p.value)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {phase === 'init' && (
        <div className="form-group">
          <label>
            Requirement file path{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder={docsRepo ? `e.g. requirements/sprint-1.md (in ${docsRepo})` : 'e.g. requirements/sprint-1.md'}
          />
          {docsRepo && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              File path relative to the docs repo: <b>{docsRepo}</b>
            </span>
          )}
        </div>
      )}
    </Modal>
  )
}
