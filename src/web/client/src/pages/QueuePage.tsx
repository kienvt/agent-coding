import { useState, useEffect } from 'react'
import { apiClient } from '../api/client.js'
import { Topbar } from '../components/layout/Topbar.js'
import { useToast } from '../components/ui/Toast.js'
import { Modal } from '../components/ui/Modal.js'
import type { QueueStatus } from '../types/index.js'

export function QueuePage() {
  const [status, setStatus] = useState<QueueStatus | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const { showToast } = useToast()

  const load = () => {
    apiClient.queue.get().then(setStatus).catch(() => showToast('Failed to load queue', 'error'))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  const handleClearDeadLetter = async () => {
    try {
      await apiClient.queue.clearDeadLetter()
      showToast('Dead letter queue cleared', 'success')
      setConfirmClear(false)
      load()
    } catch {
      showToast('Failed to clear dead letter', 'error')
    }
  }

  return (
    <>
      <Topbar
        title="Queue"
        actions={
          <button className="btn btn-sm" onClick={load}>
            Refresh
          </button>
        }
      />
      <div className="page">
        {/* Stats */}
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Queue Length</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{status?.queue_length ?? '—'}</div>
          </div>
          <div className="card">
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Dead Letter</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: (status?.dead_letter_length ?? 0) > 0 ? 'var(--error)' : 'var(--text)' }}>
              {status?.dead_letter_length ?? '—'}
            </div>
          </div>
        </div>

        {/* Dead letter list */}
        {(status?.dead_letter.length ?? 0) > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600 }}>Dead Letter Queue</span>
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)}>
                Clear All
              </button>
            </div>
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Project</th>
                    <th>Reason</th>
                    <th>Failed At</th>
                  </tr>
                </thead>
                <tbody>
                  {status!.dead_letter.map((item, i) => (
                    <tr key={i}>
                      <td>{item.event.type}</td>
                      <td>{item.event.projectSlug}</td>
                      <td style={{ color: 'var(--error)', fontSize: 12 }}>{item.reason}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(item.failedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {status && status.dead_letter.length === 0 && (
          <div className="empty-state">
            <p>Dead letter queue is empty.</p>
          </div>
        )}
      </div>

      <Modal
        open={confirmClear}
        title="Clear Dead Letter Queue"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <button className="btn btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={handleClearDeadLetter}>Clear</button>
          </>
        }
      >
        <p>Remove all {status?.dead_letter_length} items from the dead letter queue?</p>
      </Modal>
    </>
  )
}
