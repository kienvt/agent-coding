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

export type RepositoryRole = 'docs' | 'code'
export type RepositoryType = 'frontend' | 'backend' | 'infra' | 'fullstack' | 'docs'

export interface IssueStats {
  total: number
  done: number
  inProgress: number
  pending: number
}

export interface RepoSummary {
  name: string
  role: RepositoryRole
  type: RepositoryType
  gitlab_project_id: number
  local_path: string
  phase: ProjectPhase
  issues: IssueStats
  mrIid: number | null
  currentIssueIid: number | null
  hasError: boolean
  error: string | null
}

export interface ProjectGroupSummary {
  slug: string
  name: string
  docs_repo: string
  phase: ProjectPhase
  repositories: RepoSummary[]
  issues: IssueStats
  lastActivity: string | null
  startedAt: string | null
  hasError: boolean
  error: string | null
}

export interface RepoStateDetail {
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

export interface RepoDetail {
  name: string
  role: RepositoryRole
  type: RepositoryType
  gitlab_project_id: number
  local_path: string
  state: RepoStateDetail | null
}

export interface ProjectGroupDetail {
  slug: string
  name: string
  docs_repo: string
  docs_branch: string
  docs_path_pattern: string
  state: {
    projectSlug: string
    phase: ProjectPhase
    requirementFile?: string
    startedAt: string
    updatedAt: string
    error?: string
  } | null
  repositories: RepoDetail[]
}

export interface ProjectGroupConfig {
  id: string
  name: string
  docs_repo: string
  docs_branch: string
  docs_path_pattern: string
  repositories: RepositoryConfig[]
}

export interface RepositoryConfig {
  name: string
  gitlab_project_id: number
  local_path: string
  type: RepositoryType
  tags: string[]
  role: RepositoryRole
}

export interface AppConfig {
  gitlab: {
    url: string
    token: string
    webhook_secret: string
  }
  projects: ProjectGroupConfig[]
  agent: {
    model: string
    max_retries: number
    timeout_seconds: number
  }
  workflow: {
    auto_merge: boolean
    require_tests: boolean
    target_branch: string
    branch_prefix: string
  }
  /** Added by server — never contains actual secret values */
  secrets_configured?: {
    token: boolean
    webhook_secret: boolean
  }
}

// ── CRUD request shapes ───────────────────────────────────────────────────────

export interface CreateProjectBody {
  id: string
  name: string
  docs_repo?: string
  docs_branch?: string
  docs_path_pattern?: string
}

export interface UpdateProjectBody {
  name?: string
  docs_repo?: string
  docs_branch?: string
  docs_path_pattern?: string
}

export interface CreateRepositoryBody {
  name: string
  gitlab_project_id: number
  local_path: string
  type: RepositoryType
  role?: RepositoryRole
  tags?: string[]
}

export interface QueueStatus {
  queue_length: number
  dead_letter_length: number
  dead_letter: Array<{
    event: { type: string; projectSlug: string }
    reason: string
    failedAt: string
  }>
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'agent'

export interface LogEntry {
  ts: number
  level: LogLevel
  module: string
  msg: string
  projectSlug: string
}

export type Page = 'dashboard' | 'project' | 'queue' | 'settings'

export interface TriggerBody {
  phase: 'init' | 'implement' | 'review' | 'done'
  filePath?: string
}
