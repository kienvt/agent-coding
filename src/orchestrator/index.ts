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
import { getWorkspacePath } from '../utils/repo-setup.js'
import { handleRequirementPushed, handlePlanFeedback } from './phase1-init.js'
import { startImplementationLoop, handleIssueCommentDuringImplementation } from './phase2-implement.js'
import { runPhase3, handleMRReviewEvent } from './phase3-review.js'
import { runPhase4 } from './phase4-done.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('orchestrator')

async function dispatch(event: AgentEvent): Promise<void> {
  const config = getConfig()

  switch (event.type) {
    case 'REQUIREMENT_PUSHED': {
      await handleRequirementPushed(event as RequirementPushedEvent)
      break
    }

    case 'ISSUE_COMMENT': {
      const e = event as IssueCommentEvent
      const state = await stateManager.getGroupState(e.projectSlug)
      if (!state) {
        log.warn({ projectSlug: e.projectSlug }, 'No state — ignoring ISSUE_COMMENT')
        break
      }

      if (state.phase === 'AWAITING_REVIEW') {
        if (e.body?.trim().toLowerCase() === 'approve') {
          log.info({ projectSlug: e.projectSlug }, 'Plan approved — starting Phase 2')
          await stateManager.transitionGroupPhase(e.projectSlug, 'IMPLEMENTING')
          // Run in background (non-blocking)
          startImplementationLoop(e.projectSlug).catch((err) =>
            log.error({ err, projectSlug: e.projectSlug }, 'Phase 2 loop error'),
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
      const state = await stateManager.getGroupState(e.projectSlug)
      if (!state) break

      if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_CREATED') {
        await handleMRReviewEvent(e)
      }
      break
    }

    case 'MR_MERGED': {
      const e = event as MRMergedEvent
      const state = await stateManager.getGroupState(e.projectSlug)
      if (!state) break

      if (state.phase === 'AWAITING_MR_REVIEW' || state.phase === 'MR_APPROVED') {
        await runPhase4(e.projectSlug)
      }
      break
    }

    case 'TRIGGER_PHASE': {
      const e = event as TriggerPhaseEvent
      log.info({ projectSlug: e.projectSlug, phase: e.phase }, 'Manual trigger received')

      switch (e.phase) {
        case 'init': {
          const group = config.projects.find((g) => g.id === e.projectSlug)
          if (group) {
            await stateManager.initGroupState(e.projectSlug)
            log.info({ projectSlug: e.projectSlug }, 'Group state initialized via manual trigger')

            // If filePath provided, treat as REQUIREMENT_PUSHED
            if (e.filePath) {
              const docsRepo = group.repositories.find((r) => r.name === group.docs_repo)
              if (docsRepo) {
                await handleRequirementPushed({
                  type: 'REQUIREMENT_PUSHED',
                  id: e.id,
                  timestamp: e.timestamp,
                  projectSlug: e.projectSlug,
                  gitlabProjectId: docsRepo.gitlab_project_id,
                  commitSha: 'manual',
                  filePath: e.filePath,
                  repositoryName: docsRepo.name,
                })
              }
            }
          }
          break
        }
        case 'implement':
          await stateManager.transitionGroupPhase(e.projectSlug, 'IMPLEMENTING')
          startImplementationLoop(e.projectSlug).catch((err) =>
            log.error({ err, projectSlug: e.projectSlug }, 'Phase 2 loop error'),
          )
          break
        case 'review':
          await runPhase3(e.projectSlug)
          break
        case 'done':
          await runPhase4(e.projectSlug)
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
  const projectGroup = config.projects.find((g) => g.id === event.projectSlug)
  if (!projectGroup) return

  const docsRepo = projectGroup.repositories.find((r) => r.name === projectGroup.docs_repo)
  if (!docsRepo) return

  const workspacePath = getWorkspacePath()
  const repoAbsPath = path.resolve(workspacePath, docsRepo.local_path)
  const errorMsg = err instanceof Error ? err.message : String(err)

  const groupState = await stateManager.getGroupState(event.projectSlug)
  const repoStates = await stateManager.getAllRepoStates(event.projectSlug)

  // Find an active issue or MR to comment on
  const activeRepo = repoStates.find((rs) => rs.currentIssueIid ?? rs.mrIid)
  const targetIid = activeRepo?.currentIssueIid ?? activeRepo?.mrIid
  if (!targetIid) return

  const commentCmd = activeRepo?.mrIid && groupState?.phase?.includes('MR')
    ? `glab mr note ${targetIid} --message "⚠️ Agent error: ${errorMsg.slice(0, 200)}"`
    : `glab issue note ${targetIid} --message "⚠️ Agent error: ${errorMsg.slice(0, 200)}"`

  try {
    await agentRunner.run({
      prompt: `Post an error notification:\n${commentCmd}`,
      cwd: repoAbsPath,
    })
  } catch {
    log.error({ projectSlug: event.projectSlug }, 'Failed to post error notification')
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

    log.info({ eventId: event.id, type: event.type, projectSlug: event.projectSlug }, 'Processing event')

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
