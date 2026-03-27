import type { Config, RepositoryConfig, ProjectGroupConfig } from '../config/schema.js'

export interface ResolvedRepo {
  projectSlug: string
  repoConfig: RepositoryConfig
  projectGroup: ProjectGroupConfig
  isDocsRepo: boolean
}

/**
 * Resolve a GitLab project ID to its project group and repo config.
 * Returns null if the project ID is not configured in any group.
 */
export function resolveGitlabProject(
  gitlabProjectId: number,
  config: Config,
): ResolvedRepo | null {
  for (const group of config.projects) {
    const repo = group.repositories.find((r) => r.gitlab_project_id === gitlabProjectId)
    if (repo) {
      return {
        projectSlug: group.id,
        repoConfig: repo,
        projectGroup: group,
        isDocsRepo: repo.name === group.docs_repo,
      }
    }
  }
  return null
}
