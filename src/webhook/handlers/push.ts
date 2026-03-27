import { eventQueue } from '../../queue/event-queue.js'
import { getConfig } from '../../config/index.js'
import { resolveGitlabProject } from '../resolve.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('webhook:push')

interface PushPayload {
  object_kind: 'push'
  ref: string
  project: { id: number; name: string }
  commits: Array<{
    id: string
    added: string[]
    modified: string[]
  }>
}

function matchesPattern(filePath: string, pattern: string): boolean {
  // Convert simple glob pattern to regex: * → [^/]*, ** → .*
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(filePath)
}

export async function handlePushEvent(payload: PushPayload): Promise<void> {
  const config = getConfig()
  const resolved = resolveGitlabProject(payload.project.id, config)

  if (!resolved) {
    log.info({ gitlabProjectId: payload.project.id }, 'Push: project not configured, ignoring')
    return
  }

  if (!resolved.isDocsRepo) {
    log.info({ slug: resolved.projectSlug, repo: resolved.repoConfig.name }, 'Push to code repo, ignoring')
    return
  }

  const { projectSlug, projectGroup } = resolved
  const pushedBranch = payload.ref.replace(/^refs\/heads\//, '')

  // Check branch filter
  if (pushedBranch !== projectGroup.docs_branch) {
    log.info({ pushedBranch, expected: projectGroup.docs_branch }, 'Push to non-docs branch, ignoring')
    return
  }

  const pattern = projectGroup.docs_path_pattern

  // Collect matching files across all commits (deduplicated)
  const seen = new Set<string>()
  const reqFiles: string[] = []
  let latestCommitSha = ''

  for (const commit of payload.commits) {
    const changedFiles = [...(commit.added ?? []), ...(commit.modified ?? [])]
    for (const f of changedFiles) {
      if (matchesPattern(f, pattern) && !seen.has(f)) {
        seen.add(f)
        reqFiles.push(f)
        latestCommitSha = commit.id
      }
    }
  }

  if (reqFiles.length === 0) {
    log.info({ projectSlug, pattern, branch: pushedBranch }, 'Push: no files match docs_path_pattern, ignoring')
    return
  }

  const filePath = reqFiles.join(',')
  log.info({ projectSlug, files: reqFiles, commitSha: latestCommitSha }, 'Requirement file(s) detected')

  await eventQueue.enqueue({
    type: 'REQUIREMENT_PUSHED',
    projectSlug,
    gitlabProjectId: payload.project.id,
    commitSha: latestCommitSha,
    filePath,
    repositoryName: payload.project.name,
  })
}
