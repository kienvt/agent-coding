import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RepositoryConfig } from '../config/index.js'
import { logger } from './logger.js'

/**
 * Clone a repository into the workspace if it doesn't already exist locally.
 * Uses GitLab API to resolve the HTTP clone URL from the project ID.
 */
export async function ensureRepoCloned(
  repo: RepositoryConfig,
  gitlabUrl: string,
  gitlabToken: string,
): Promise<{ cloned: boolean; error?: string }> {
  const workspacePath = process.env['WORKSPACE_PATH'] ?? '/workspace'
  const repoAbsPath = resolve(workspacePath, repo.local_path)

  if (existsSync(repoAbsPath)) {
    return { cloned: false }
  }

  // Fetch clone URL from GitLab API
  let cloneUrl: string
  try {
    const apiUrl = `${gitlabUrl.replace(/\/$/, '')}/api/v4/projects/${repo.gitlab_project_id}`
    const res = await fetch(apiUrl, {
      headers: { 'PRIVATE-TOKEN': gitlabToken },
    })
    if (!res.ok) {
      throw new Error(`GitLab API returned ${res.status}: ${await res.text()}`)
    }
    const data = (await res.json()) as { http_url_to_repo: string }
    cloneUrl = data.http_url_to_repo
  } catch (err) {
    const msg = `Failed to fetch clone URL for project ${repo.gitlab_project_id}: ${(err as Error).message}`
    logger.error(msg)
    return { cloned: false, error: msg }
  }

  // Embed token into HTTPS URL: https://oauth2:TOKEN@host/...
  const urlWithAuth = cloneUrl.replace('://', `://oauth2:${gitlabToken}@`)

  try {
    mkdirSync(workspacePath, { recursive: true })
    logger.info(`Cloning ${repo.name} into ${repoAbsPath}...`)
    execSync(`git clone "${urlWithAuth}" "${repoAbsPath}"`, { stdio: 'pipe' })
    logger.info(`Cloned ${repo.name} successfully`)
    return { cloned: true }
  } catch (err) {
    const msg = `git clone failed for ${repo.name}: ${(err as Error).message}`
    logger.error(msg)
    return { cloned: false, error: msg }
  }
}

/**
 * Ensure all repositories in config are cloned.
 * Runs in background — caller does not need to await.
 */
export async function ensureAllReposCloned(
  repos: RepositoryConfig[],
  gitlabUrl: string,
  gitlabToken: string,
): Promise<void> {
  for (const repo of repos) {
    await ensureRepoCloned(repo, gitlabUrl, gitlabToken)
  }
}
