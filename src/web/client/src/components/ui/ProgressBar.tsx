interface ProgressBarProps {
  done: number
  total: number
}

export function ProgressBar({ done, total }: ProgressBarProps) {
  if (total === 0) return null
  const pct = Math.round((done / total) * 100)

  return (
    <div className="progress-bar-wrap">
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-bar-label">{done}/{total}</span>
    </div>
  )
}
