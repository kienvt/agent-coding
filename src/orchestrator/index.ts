import path from 'node:path'
import { eventQueue } from '../queue/event-queue.js'
import { stateManager } from '../state/manager.js'
import { agentRunner } from '../agent/runner.js'
import { getConfig } from '../config/index.js'
import type {
  AgentEvent,
  RequirementPushedEvent,
  IssueCommentEvent,
  MRReviewEvent,
  MRMergedEvent,
  TriggerPhaseEvent,
} from '../queue/types.js'
import { handleRequirementPushed, handlePlanFeedback } from './phase1-init.js'
import { startImplementationLoop, handleIssueCommentDuringImplementation } from './phase2-implement.js'
import { runPhase3, handleMRReviewEvent } from './phase3-review.js'
import { runPhase4 } from './phase4-done.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('orchestrator')

async function dispatch(event: AgentEvent): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === event.projectId)

  switch (event.type) {
    case 'REQUIREMENT_PUSHED': {
      await handleRequirementPushed(event as RequirementPushedEvent)
      break
    }

    case 'ISSUE_COMMENT': {
      const e = event as IssueCommentEvent
      const state = await stateManager.getProjectState(e.projectId)
      if (!state) {
        log.warn({ projectId: e.projectId }, 'No state — ignoring ISSUE_COMMENT')
        break
      }

      if (state.phase === 'AWAITING_REVIEW') {
        if (e.body.toLowerCase().includes('approve')) {
          log.info({ projectId: e.projectId }, 'Plan approved — starting Phase 2')
          await stateManager.transitionPhase(e.projectId, 'IMPLEMENTING')
          // Run in background (non-blocking)
          startImplementationLoop(e.projectId).catch((err) =>
            log.error({ err, projectId: e.projectId }, 'Phase 2 loop error'),
          )
        } else {
          await handlePlanFeedback(e, config)
        }
      } else if (state.phase === 'IMPLEMENTING') {
        await handleIssueCommentDuringImplementation(e)
      }
      break
    }

    case 'MR_REVIEW': {
      const e = event as MRReviewEvent
      const state = await stateManager.getProjectState(e.projectId)
      if (!state) break

      if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_CREATED') {
        await handleMRReviewEvent(e)
      }
      break
    }

    case 'MR_MERGED': {
      const e = event as MRMergedEvent
      const state = await stateManager.getProjectState(e.projectId)
      if (!state) break

      // MR_MERGED can trigger Phase 4 if not already triggered by MR_REVIEW approved
      if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_APPROVED') {
        await runPhase4(e.projectId)
      }
      break
    }

    case 'TRIGGER_PHASE': {
      const e = event as TriggerPhaseEvent
      log.info({ projectId: e.projectId, phase: e.phase }, 'Manual trigger received')

      switch (e.phase) {
        case 'init': {
          // Initialize state and signal readiness
          const triggerRepo = config.repositories.find((r) => r.gitlab_project_id === e.projectId)
          if (triggerRepo) {
            await stateManager.initProjectState(e.projectId, triggerRepo.name)
            log.info({ projectId: e.projectId }, 'State initialized via manual trigger')
          }
          break
        }
        case 'implement':
          await stateManager.transitionPhase(e.projectId, 'IMPLEMENTING')
          startImplementationLoop(e.projectId).catch((err) =>
            log.error({ err, projectId: e.projectId }, 'Phase 2 loop error'),
          )
          break
        case 'review':
          await runPhase3(e.projectId)
          break
        case 'done':
          await runPhase4(e.projectId)
          break
      }
      break
    }

    default:
      log.warn({ type: (event as AgentEvent).type }, 'Unknown event type')
  }
}

async function notifyError(event: AgentEvent, err: unknown): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)
  const errorMsg = err instanceof Error ? err.message : String(err)

  const state = await stateManager.getProjectState(event.projectId)
  const targetIid = state?.currentIssueIid ?? state?.mrIid

  if (!targetIid) return

  const commentCmd = state?.mrIid && state.phase.includes('MR')
    ? `glab mr note ${targetIid} --message "⚠️ Agent error: ${errorMsg.slice(0, 200)}"`
    : `glab issue note ${targetIid} --message "⚠️ Agent error: ${errorMsg.slice(0, 200)}"`

  try {
    await agentRunner.run({
      prompt: `Post an error notification:\n${commentCmd}`,
      cwd: repoAbsPath,
    })
  } catch {
    log.error({ projectId: event.projectId }, 'Failed to post error notification')
  }
}

export async function startOrchestrator(): Promise<void> {
  log.info('Orchestrator started — waiting for events')

  while (true) {
    let event: AgentEvent | null = null

    try {
      event = await eventQueue.dequeue(30)
    } catch (err) {
      log.error({ err }, 'Error dequeuing event — retrying in 5s')
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }

    if (!event) continue

    log.info({ eventId: event.id, type: event.type, projectId: event.projectId }, 'Processing event')

    try {
      await dispatch(event)
      await eventQueue.ack(event.id)
    } catch (err) {
      log.error({ err, eventId: event.id, type: event.type }, 'Event processing failed')
      await eventQueue.nack(event, err instanceof Error ? err.message : String(err))
      await notifyError(event, err)
    }
  }
}
