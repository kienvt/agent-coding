import { eventQueue } from '../../queue/event-queue.js'
import { getConfig } from '../../config/index.js'
import { resolveGitlabProject } from '../resolve.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('webhook:mr')

interface MRPayload {
  object_kind: 'merge_request'
  project: { id: number; name: string }
  user: { username: string }
  object_attributes: {
    iid: number
    state: string
    action: 'merge' | 'approved' | 'unapproved' | 'changes_requested' | 'open' | 'update'
  }
}

export async function handleMREvent(payload: MRPayload): Promise<void> {
  const botUsername = process.env['GITLAB_BOT_USERNAME']
  if (!botUsername) {
    log.error('GITLAB_BOT_USERNAME is not set — refusing to process MR events')
    return
  }

  if (payload.user.username === botUsername) {
    log.debug({ username: payload.user.username }, 'Ignoring bot MR action')
    return
  }

  const config = getConfig()
  const resolved = resolveGitlabProject(payload.project.id, config)

  if (!resolved) {
    log.debug({ gitlabProjectId: payload.project.id }, 'MR: project not configured, ignoring')
    return
  }

  const { projectSlug } = resolved
  const gitlabProjectId = payload.project.id
  const { iid: mrIid, action } = payload.object_attributes

  if (action === 'merge') {
    await eventQueue.enqueue({
      type: 'MR_MERGED',
      projectSlug,
      gitlabProjectId,
      mrIid,
      mergedBy: payload.user.username,
    })
    log.info({ projectSlug, mrIid }, 'MR_MERGED enqueued')
  } else if (action === 'approved') {
    await eventQueue.enqueue({
      type: 'MR_REVIEW',
      projectSlug,
      gitlabProjectId,
      mrIid,
      action: 'approved',
      authorUsername: payload.user.username,
    })
    log.info({ projectSlug, mrIid }, 'MR_REVIEW (approved) enqueued')
  } else if (action === 'changes_requested') {
    await eventQueue.enqueue({
      type: 'MR_REVIEW',
      projectSlug,
      gitlabProjectId,
      mrIid,
      action: 'changes_requested',
      authorUsername: payload.user.username,
    })
    log.info({ projectSlug, mrIid }, 'MR_REVIEW (changes_requested) enqueued')
  }
}
