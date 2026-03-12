export type ProjectPhase =
  | 'IDLE'
  | 'ANALYZING'
  | 'GENERATING_DOCS'
  | 'AWAITING_REVIEW'
  | 'IMPLEMENTING'
  | 'ALL_ISSUES_DONE'
  | 'MR_CREATED'
  | 'AWAITING_MR_REVIEW'
  | 'MR_APPROVED'
  | 'MERGING'
  | 'COMPLETE'
  | 'ERROR'

export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CLOSED'

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
