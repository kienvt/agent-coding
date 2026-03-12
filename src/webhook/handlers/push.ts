import { eventQueue } from '../../queue/event-queue.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('webhook:push')

interface PushPayload {
  object_kind: 'push'
  project: { id: number; name: string }
  commits: Array<{
    id: string
    added: string[]
    modified: string[]
  }>
}

function isRequirementFile(filePath: string): boolean {
  return /requirement/i.test(filePath) && filePath.endsWith('.md')
}

export async function handlePushEvent(payload: PushPayload): Promise<void> {
  const projectId = payload.project.id
  const repositoryName = payload.project.name

  for (const commit of payload.commits) {
    const changedFiles = [...(commit.added ?? []), ...(commit.modified ?? [])]
    const reqFile = changedFiles.find(isRequirementFile)

    if (reqFile) {
      log.info({ projectId, filePath: reqFile, commitSha: commit.id }, 'Requirement file detected')
      await eventQueue.enqueue({
        type: 'REQUIREMENT_PUSHED',
        projectId,
        commitSha: commit.id,
        filePath: reqFile,
        repositoryName,
      })
      // Only process first matching file per push
      break
    }
  }
}
