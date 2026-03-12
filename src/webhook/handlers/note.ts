import { eventQueue } from '../../queue/event-queue.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('webhook:note')

interface NotePayload {
  object_kind: 'note'
  project: { id: number; name: string }
  user: { username: string }
  object_attributes: {
    noteable_type: 'Issue' | 'MergeRequest'
    noteable_iid: number
    id: number
    body: string
  }
}

export async function handleNoteEvent(payload: NotePayload): Promise<void> {
  const botUsername = process.env['GITLAB_BOT_USERNAME'] ?? 'ai-agent'

  if (payload.user.username === botUsername) {
    log.debug({ username: payload.user.username }, 'Ignoring bot comment')
    return
  }

  const projectId = payload.project.id
  const { noteable_type, noteable_iid, id: noteId, body } = payload.object_attributes

  if (noteable_type === 'Issue') {
    await eventQueue.enqueue({
      type: 'ISSUE_COMMENT',
      projectId,
      issueIid: noteable_iid,
      noteId,
      authorUsername: payload.user.username,
      body,
    })
    log.info({ projectId, issueIid: noteable_iid }, 'ISSUE_COMMENT enqueued')
  } else if (noteable_type === 'MergeRequest') {
    await eventQueue.enqueue({
      type: 'MR_REVIEW',
      projectId,
      mrIid: noteable_iid,
      action: 'commented',
      authorUsername: payload.user.username,
      body,
    })
    log.info({ projectId, mrIid: noteable_iid }, 'MR_REVIEW (commented) enqueued')
  }
}
