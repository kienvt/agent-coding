export type ProjectPhase =
  | 'IDLE'
  | 'ANALYZING'
  | 'GENERATING_DOCS'
  | 'AWAITING_REVIEW'
  | 'PLANNING'
  | 'IMPLEMENTING'
  | 'ALL_ISSUES_DONE'
  | 'MR_CREATED'
  | 'AWAITING_MR_REVIEW'
  | 'MR_APPROVED'
  | 'MERGING'
  | 'COMPLETE'
  | 'ERROR'

export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CLOSED' | 'MR_OPEN' | 'INTERRUPTED' | 'REOPENED'

export interface CheckpointData {
  branch: string
  worktreePath?: string
  interruptedAt: string
}

export interface ProjectGroupState {
  projectSlug: string
  phase: ProjectPhase
  requirementFile?: string
  docsMrIid?: number
  startedAt: string
  updatedAt: string
  error?: string
}

export interface RepoState {
  projectSlug: string
  repoName: string
  gitlabProjectId: number
  phase: ProjectPhase
  issueIids: number[]
  issueStatuses: Record<number, IssueStatus>
  plannedOrder: number[]
  issueToMr: Record<string, number>
  checkpoints: Record<string, CheckpointData>
  currentIssueIid?: number
  mrIid?: number
  error?: string
}

/** @deprecated Use ProjectGroupState + RepoState instead */
export interface ProjectState {
  projectId: number
  repositoryName: string
  phase: ProjectPhase
  requirementFile?: string
  currentIssueIid?: number
  mrIid?: number
  issueIids: number[]
  issueStatuses: Record<number, IssueStatus>
  startedAt: string
  updatedAt: string
  error?: string
}
