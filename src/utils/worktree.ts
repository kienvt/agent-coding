import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from './logger.js'

const log = createLogger('worktree')

/**
 * Create a git worktree for a task.
 * @param repoName - repo folder name under /workspace/repos/
 * @param issueIid - issue IID (used for directory naming)
 * @param branch - new branch name to create
 * @param workspaceBase - base workspace directory (default: /workspace)
 * @returns worktreePath
 */
export function createWorktree(
  repoName: string,
  issueIid: number,
  branch: string,
  workspaceBase = '/workspace',
): string {
  const repoPath = join(workspaceBase, 'repos', repoName)
  const worktreePath = join(workspaceBase, 'tasks', `${issueIid}-${repoName}`)

  if (existsSync(worktreePath)) {
    log.info({ worktreePath }, 'Worktree already exists, reusing')
    return worktreePath
  }

  log.info({ repoName, issueIid, branch, worktreePath }, 'Creating worktree')
  execSync(
    `git -C ${repoPath} worktree add ${worktreePath} -b ${branch} origin/main`,
    { stdio: 'pipe' },
  )
  log.info({ worktreePath }, 'Worktree created')
  return worktreePath
}

/**
 * Remove a git worktree after task completion.
 */
export function removeWorktree(repoName: string, worktreePath: string, workspaceBase = '/workspace'): void {
  if (!worktreePath || !existsSync(worktreePath)) {
    log.debug({ worktreePath }, 'Worktree path not found, skipping removal')
    return
  }

  const repoPath = join(workspaceBase, 'repos', repoName)
  log.info({ repoName, worktreePath }, 'Removing worktree')
  try {
    execSync(`git -C ${repoPath} worktree remove ${worktreePath} --force`, { stdio: 'pipe' })
    log.info({ worktreePath }, 'Worktree removed')
  } catch (err) {
    log.warn({ worktreePath, err }, 'Failed to remove worktree — may already be gone')
  }
}
