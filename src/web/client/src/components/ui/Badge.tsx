import type { ProjectPhase } from '../../types/index.js'

const phaseColors: Record<ProjectPhase, string> = {
  IDLE: 'badge-idle',
  ANALYZING: 'badge-running',
  GENERATING_DOCS: 'badge-running',
  AWAITING_REVIEW: 'badge-waiting',
  IMPLEMENTING: 'badge-running',
  ALL_ISSUES_DONE: 'badge-waiting',
  MR_CREATED: 'badge-waiting',
  AWAITING_MR_REVIEW: 'badge-waiting',
  MR_APPROVED: 'badge-waiting',
  MERGING: 'badge-running',
  COMPLETE: 'badge-complete',
  ERROR: 'badge-error',
}

interface PhaseBadgeProps {
  phase: ProjectPhase
}

export function PhaseBadge({ phase }: PhaseBadgeProps) {
  return <span className={`badge ${phaseColors[phase]}`}>{phase}</span>
}

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warn' | 'error'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}
