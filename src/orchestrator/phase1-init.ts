import path from 'node:path'
import { agentRunner } from '../agent/runner.js'
import { stateManager } from '../state/manager.js'
import { getConfig } from '../config/index.js'
import type { Config, RepositoryConfig } from '../config/index.js'
import type { RequirementPushedEvent, IssueCommentEvent } from '../queue/types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('phase1-init')

function buildPhase1Prompt(
  repo: RepositoryConfig,
  event: RequirementPushedEvent,
  workspacePath: string,
): string {
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)
  const reqFilePath = path.join(repoAbsPath, event.filePath)

  return `You are starting Phase 1 (Init) for project: ${repo.name}
Requirement file location: ${reqFilePath}
GitLab project ID: ${repo.gitlab_project_id}

Your tasks (execute in order):

1. READ the requirement file at: ${reqFilePath}

2. ANALYZE scope, features, modules, and tech decisions

3. CREATE branch 'docs/init-plan' from main:
   git fetch origin
   git checkout -b docs/init-plan origin/main

4. GENERATE and commit these documents to docs/ directory:
   - docs/architecture.md (system overview, component diagrams with Mermaid)
   - docs/database-schema.md (ERD + SQL schema)
   - docs/api-documentation.md (all endpoints + request/response schemas)
   - docs/test-cases.md (unit, integration, E2E test scenarios)
   - docs/implementation-plan.md (phased tasks, dependencies, ordered by priority)
   - docs/README.md (index linking to all documents)

5. GENERATE HTML UI Mockup to docs/mockup/:
   - docs/mockup/index.html (navigation hub with links to all screens)
   - docs/mockup/README.md (instructions to open in browser)
   - docs/mockup/assets/style.css (shared design system)
   - docs/mockup/assets/mock-data.js (realistic placeholder data)
   - docs/mockup/screens/{screen-name}.html (one file per UI screen, minimum 4 screens)
   Rules: self-contained (no CDN), responsive, realistic fake data, inline navigation

6. USE /create-issues skill:
   - Read docs/implementation-plan.md
   - Create GitLab issues for each task with acceptance criteria
   - Issues ordered by dependency (setup before features)
   - Output: ISSUE_IIDS: {comma-separated list}

7. PUSH all commits:
   git push -u origin docs/init-plan

8. POST summary comment on the first created issue:
   glab issue note {firstIssueIid} --message "## 🤖 Phase 1 Complete\\n\\nDocuments and issues created. Please review and comment 'approve' to start implementation."

Use glab for all GitLab operations.
Always use absolute file paths.`
}

function parseIssueIids(output: string): number[] {
  const match = output.match(/ISSUE_IIDS:\s*([\d,\s]+)/i)
  if (!match) return []
  return match[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n))
}

export async function handleRequirementPushed(
  event: RequirementPushedEvent,
): Promise<void> {
  const config = getConfig()
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) {
    log.warn({ projectId: event.projectId }, 'No repo config found for project')
    return
  }

  const state = await stateManager.getProjectState(event.projectId)
  if (state && state.phase !== 'IDLE') {
    log.info({ projectId: event.projectId, phase: state.phase }, 'Skipping — not in IDLE phase')
    return
  }

  await stateManager.initProjectState(event.projectId, repo.name, event.filePath)
  await stateManager.transitionPhase(event.projectId, 'ANALYZING')

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const prompt = buildPhase1Prompt(repo, event, workspacePath)
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  log.info({ projectId: event.projectId, repoPath: repoAbsPath }, 'Starting Phase 1 agent run')

  const result = await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
    onProgress: (msg) => log.debug({ msg: msg.slice(0, 120) }, 'Agent progress'),
  })

  const iids = parseIssueIids(result.output)
  if (iids.length > 0) {
    await stateManager.setIssueList(event.projectId, iids)
    log.info({ projectId: event.projectId, iids }, 'Issue list set')
  } else {
    log.warn({ projectId: event.projectId }, 'No issue IIDs found in agent output')
  }

  await stateManager.transitionPhase(event.projectId, 'AWAITING_REVIEW')
}

export async function handlePlanFeedback(
  event: IssueCommentEvent,
  config: Config,
): Promise<void> {
  const repo = config.repositories.find((r: RepositoryConfig) => r.gitlab_project_id === event.projectId)
  if (!repo) return

  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = path.resolve(workspacePath, repo.local_path)

  const prompt = `You received feedback on the plan for project ${repo.name}.

User @${event.authorUsername} commented on issue #${event.issueIid}:
"${event.body}"

Update the relevant documents in docs/ and/or issues to address this feedback.
After making changes, post a reply comment:
glab issue note ${event.issueIid} --message "✅ Feedback addressed: {brief summary of changes}"

Use absolute paths. Working directory: ${repoAbsPath}`

  await agentRunner.run({
    prompt,
    cwd: repoAbsPath,
  })
}
