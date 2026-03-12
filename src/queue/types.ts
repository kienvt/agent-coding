export type EventType =
  | 'REQUIREMENT_PUSHED'
  | 'ISSUE_COMMENT'
  | 'MR_REVIEW'
  | 'MR_MERGED'
  | 'TRIGGER_PHASE'

export interface BaseEvent {
  id: string
  type: EventType
  projectId: number
  timestamp: string
}

export interface RequirementPushedEvent extends BaseEvent {
  type: 'REQUIREMENT_PUSHED'
  commitSha: string
  filePath: string
  repositoryName: string
}

export interface IssueCommentEvent extends BaseEvent {
  type: 'ISSUE_COMMENT'
  issueIid: number
  noteId: number
  authorUsername: string
  body: string
}

export interface MRReviewEvent extends BaseEvent {
  type: 'MR_REVIEW'
  mrIid: number
  action: 'approved' | 'changes_requested' | 'commented'
  authorUsername: string
  body?: string
}

export interface MRMergedEvent extends BaseEvent {
  type: 'MR_MERGED'
  mrIid: number
  mergedBy: string
}

export interface TriggerPhaseEvent extends BaseEvent {
  type: 'TRIGGER_PHASE'
  phase: 'init' | 'implement' | 'review' | 'done'
}

export type AgentEvent =
  | RequirementPushedEvent
  | IssueCommentEvent
  | MRReviewEvent
  | MRMergedEvent
  | TriggerPhaseEvent
