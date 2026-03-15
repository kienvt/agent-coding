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

const REQUIREMENT_PATTERN = /requirement/i
const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.pdf']

function isRequirementFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return REQUIREMENT_PATTERN.test(filePath) && SUPPORTED_EXTENSIONS.includes(ext)
}

export async function handlePushEvent(payload: PushPayload): Promise<void> {
  const projectId = payload.project.id
  const repositoryName = payload.project.name

  // Collect all requirement files across all commits (deduplicated, preserve order)
  const seen = new Set<string>()
  const reqFiles: string[] = []
  let latestCommitSha = ''

  for (const commit of payload.commits) {
    const changedFiles = [...(commit.added ?? []), ...(commit.modified ?? [])]
    for (const f of changedFiles) {
      if (isRequirementFile(f) && !seen.has(f)) {
        seen.add(f)
        reqFiles.push(f)
        latestCommitSha = commit.id
      }
    }
  }

  if (reqFiles.length === 0) return

  // Comma-separated so agent can read all files
  const filePath = reqFiles.join(',')
  log.info({ projectId, files: reqFiles, commitSha: latestCommitSha }, 'Requirement file(s) detected')

  await eventQueue.enqueue({
    type: 'REQUIREMENT_PUSHED',
    projectId,
    commitSha: latestCommitSha,
    filePath,
    repositoryName,
  })
}
