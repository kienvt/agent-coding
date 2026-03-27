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

export interface ProjectGroupState {
  projectSlug: string
  phase: ProjectPhase
  requirementFile?: string
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
