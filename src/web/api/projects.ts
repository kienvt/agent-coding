import type { Hono } from 'hono'
import { getConfig, updateConfig } from '../../config/index.js'
import { stateManager } from '../../state/manager.js'
import { eventQueue } from '../../queue/event-queue.js'
import { logStore } from '../../utils/log-store.js'
import { ensureAllReposCloned } from '../../utils/repo-setup.js'
import type { ProjectPhase } from '../../state/types.js'
import type { RepositoryConfig, ProjectGroupConfig } from '../../config/schema.js'

const VALID_TRIGGER_PHASES = ['init', 'implement', 'review', 'done'] as const
type TriggerPhase = (typeof VALID_TRIGGER_PHASES)[number]

// ── Helpers ──────────────────────────────────────────────────────────────────

function cloneReposAfterChange(): void {
  const cfg = getConfig()
  const allRepos = cfg.projects.flatMap((g) => g.repositories)
  void ensureAllReposCloned(allRepos, cfg.gitlab.url, cfg.gitlab.token)
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerProjectRoutes(app: Hono): void {

  // ── List / Get ──────────────────────────────────────────────────────────────

  app.get('/api/projects', async (c) => {
    const config = getConfig()

    const groups = await Promise.all(
      config.projects.map(async (group) => {
        const groupState = await stateManager.getGroupState(group.id)
        const repoStates = await stateManager.getAllRepoStates(group.id)

        const repositories = group.repositories.map((repo) => {
          const rs = repoStates.find((r) => r.repoName === repo.name)
          const issueStats = rs
            ? {
                total: rs.issueIids.length,
                done: Object.values(rs.issueStatuses).filter((s) => s === 'DONE' || s === 'CLOSED').length,
                inProgress: Object.values(rs.issueStatuses).filter((s) => s === 'IN_PROGRESS').length,
                pending: Object.values(rs.issueStatuses).filter((s) => s === 'OPEN').length,
              }
            : { total: 0, done: 0, inProgress: 0, pending: 0 }

          return {
            name: repo.name,
            role: repo.role,
            type: repo.type,
            gitlab_project_id: repo.gitlab_project_id,
            local_path: repo.local_path,
            phase: (rs?.phase ?? 'IDLE') as ProjectPhase,
            issues: issueStats,
            mrIid: rs?.mrIid ?? null,
            currentIssueIid: rs?.currentIssueIid ?? null,
            hasError: rs?.phase === 'ERROR',
            error: rs?.error ?? null,
          }
        })

        const codeRepoStats = repositories.filter((r) => r.role === 'code')
        const totalIssues = {
          total: codeRepoStats.reduce((a, r) => a + r.issues.total, 0),
          done: codeRepoStats.reduce((a, r) => a + r.issues.done, 0),
          inProgress: codeRepoStats.reduce((a, r) => a + r.issues.inProgress, 0),
          pending: codeRepoStats.reduce((a, r) => a + r.issues.pending, 0),
        }

        return {
          slug: group.id,
          name: group.name,
          docs_repo: group.docs_repo,
          phase: (groupState?.phase ?? 'IDLE') as ProjectPhase,
          repositories,
          issues: totalIssues,
          lastActivity: groupState?.updatedAt ?? null,
          startedAt: groupState?.startedAt ?? null,
          hasError: groupState?.phase === 'ERROR',
          error: groupState?.error ?? null,
        }
      }),
    )

    return c.json(groups)
  })

  app.get('/api/projects/:slug', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    const group = config.projects.find((g) => g.id === slug)
    if (!group) return c.json({ error: 'Project not found' }, 404)

    const groupState = await stateManager.getGroupState(slug)
    const repoStates = await stateManager.getAllRepoStates(slug)

    return c.json({
      slug: group.id,
      name: group.name,
      docs_repo: group.docs_repo,
      docs_branch: group.docs_branch,
      docs_path_pattern: group.docs_path_pattern,
      state: groupState,
      repositories: group.repositories.map((repo) => {
        const rs = repoStates.find((r) => r.repoName === repo.name)
        return {
          name: repo.name,
          role: repo.role,
          type: repo.type,
          gitlab_project_id: repo.gitlab_project_id,
          local_path: repo.local_path,
          state: rs ?? null,
        }
      }),
    })
  })

  // ── Trigger ─────────────────────────────────────────────────────────────────

  app.post('/api/projects/:slug/trigger', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    const group = config.projects.find((g) => g.id === slug)
    if (!group) return c.json({ error: 'Project not found' }, 404)

    let body: { phase: string; filePath?: string }
    try {
      body = (await c.req.json()) as { phase: string; filePath?: string }
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    if (!VALID_TRIGGER_PHASES.includes(body.phase as TriggerPhase)) {
      return c.json({ error: `phase must be one of: ${VALID_TRIGGER_PHASES.join(', ')}` }, 400)
    }

    if (body.phase === 'init') {
      if (!body.filePath?.trim()) {
        return c.json({ error: 'filePath is required for init phase' }, 400)
      }
      const docsRepo = group.repositories.find((r) => r.name === group.docs_repo)
      if (!docsRepo) return c.json({ error: 'docs_repo not found in project config' }, 400)

      const eventId = await eventQueue.enqueue({
        type: 'REQUIREMENT_PUSHED',
        projectSlug: slug,
        gitlabProjectId: docsRepo.gitlab_project_id,
        commitSha: 'manual',
        filePath: body.filePath.trim(),
        repositoryName: docsRepo.name,
      })
      return c.json({ ok: true, eventId })
    }

    const eventId = await eventQueue.enqueue({
      type: 'TRIGGER_PHASE',
      projectSlug: slug,
      phase: body.phase as TriggerPhase,
      filePath: body.filePath,
    })
    return c.json({ ok: true, eventId })
  })

  // ── State / Logs ─────────────────────────────────────────────────────────────

  app.delete('/api/projects/:slug/state', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    const group = config.projects.find((g) => g.id === slug)
    if (!group) return c.json({ error: 'Project not found' }, 404)

    await stateManager.resetGroupState(slug)
    await logStore.clear(slug)
    return c.json({ ok: true })
  })

  // ── Project Group CRUD ───────────────────────────────────────────────────────

  // POST /api/projects — create new project group
  app.post('/api/projects', async (c) => {
    let body: {
      id: string
      name: string
      docs_repo?: string
      docs_branch?: string
      docs_path_pattern?: string
      repositories?: RepositoryConfig[]
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    if (!body.id?.trim()) return c.json({ error: 'id is required' }, 400)
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

    const config = getConfig()
    if (config.projects.find((g) => g.id === body.id)) {
      return c.json({ error: `Project with id '${body.id}' already exists` }, 409)
    }

    const newGroup: ProjectGroupConfig = {
      id: body.id.trim(),
      name: body.name.trim(),
      docs_repo: body.docs_repo?.trim() ?? '',
      docs_branch: body.docs_branch?.trim() ?? 'main',
      docs_path_pattern: body.docs_path_pattern?.trim() ?? 'requirement*',
      repositories: body.repositories ?? [],
    }

    try {
      updateConfig({ projects: [...config.projects, newGroup] })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    cloneReposAfterChange()
    return c.json({ ok: true, project: newGroup }, 201)
  })

  // PUT /api/projects/:slug — update project group metadata (not repositories)
  app.put('/api/projects/:slug', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    const idx = config.projects.findIndex((g) => g.id === slug)
    if (idx === -1) return c.json({ error: 'Project not found' }, 404)

    let body: { name?: string; docs_repo?: string; docs_branch?: string; docs_path_pattern?: string }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const updated: ProjectGroupConfig = {
      ...config.projects[idx],
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.docs_repo !== undefined && { docs_repo: body.docs_repo.trim() }),
      ...(body.docs_branch !== undefined && { docs_branch: body.docs_branch.trim() }),
      ...(body.docs_path_pattern !== undefined && { docs_path_pattern: body.docs_path_pattern.trim() }),
    }

    const newProjects = [...config.projects]
    newProjects[idx] = updated

    try {
      updateConfig({ projects: newProjects })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    return c.json({ ok: true, project: updated })
  })

  // DELETE /api/projects/:slug — remove project group from config (does not wipe Redis state)
  app.delete('/api/projects/:slug', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    if (!config.projects.find((g) => g.id === slug)) {
      return c.json({ error: 'Project not found' }, 404)
    }

    try {
      updateConfig({ projects: config.projects.filter((g) => g.id !== slug) })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    return c.json({ ok: true })
  })

  // ── Repository CRUD ──────────────────────────────────────────────────────────

  // POST /api/projects/:slug/repositories — add a repo to a project group
  app.post('/api/projects/:slug/repositories', async (c) => {
    const slug = c.req.param('slug')
    const config = getConfig()
    const idx = config.projects.findIndex((g) => g.id === slug)
    if (idx === -1) return c.json({ error: 'Project not found' }, 404)

    let body: {
      name: string
      gitlab_project_id: number
      local_path: string
      type: RepositoryConfig['type']
      role?: RepositoryConfig['role']
      tags?: string[]
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
    if (!body.gitlab_project_id || isNaN(+body.gitlab_project_id)) return c.json({ error: 'gitlab_project_id is required' }, 400)
    if (!body.local_path?.trim()) return c.json({ error: 'local_path is required' }, 400)
    if (!body.type) return c.json({ error: 'type is required' }, 400)

    const group = config.projects[idx]
    if (group.repositories.find((r) => r.name === body.name)) {
      return c.json({ error: `Repository '${body.name}' already exists in this project` }, 409)
    }

    const newRepo: RepositoryConfig = {
      name: body.name.trim(),
      gitlab_project_id: +body.gitlab_project_id,
      local_path: body.local_path.trim(),
      type: body.type,
      role: body.role ?? 'code',
      tags: body.tags ?? [],
    }

    const updatedGroup: ProjectGroupConfig = {
      ...group,
      repositories: [...group.repositories, newRepo],
    }
    const newProjects = [...config.projects]
    newProjects[idx] = updatedGroup

    try {
      updateConfig({ projects: newProjects })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    cloneReposAfterChange()
    return c.json({ ok: true, repository: newRepo }, 201)
  })

  // PUT /api/projects/:slug/repositories/:repoName — update repo (name is immutable)
  app.put('/api/projects/:slug/repositories/:repoName', async (c) => {
    const slug = c.req.param('slug')
    const repoName = c.req.param('repoName')
    const config = getConfig()
    const groupIdx = config.projects.findIndex((g) => g.id === slug)
    if (groupIdx === -1) return c.json({ error: 'Project not found' }, 404)

    const group = config.projects[groupIdx]
    const repoIdx = group.repositories.findIndex((r) => r.name === repoName)
    if (repoIdx === -1) return c.json({ error: 'Repository not found' }, 404)

    let body: Partial<Omit<RepositoryConfig, 'name'>>
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const updatedRepo: RepositoryConfig = {
      ...group.repositories[repoIdx],
      ...(body.gitlab_project_id !== undefined && { gitlab_project_id: +body.gitlab_project_id }),
      ...(body.local_path !== undefined && { local_path: body.local_path.trim() }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.tags !== undefined && { tags: body.tags }),
    }

    const newRepos = [...group.repositories]
    newRepos[repoIdx] = updatedRepo
    const newProjects = [...config.projects]
    newProjects[groupIdx] = { ...group, repositories: newRepos }

    try {
      updateConfig({ projects: newProjects })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    cloneReposAfterChange()
    return c.json({ ok: true, repository: updatedRepo })
  })

  // DELETE /api/projects/:slug/repositories/:repoName
  app.delete('/api/projects/:slug/repositories/:repoName', async (c) => {
    const slug = c.req.param('slug')
    const repoName = c.req.param('repoName')
    const config = getConfig()
    const groupIdx = config.projects.findIndex((g) => g.id === slug)
    if (groupIdx === -1) return c.json({ error: 'Project not found' }, 404)

    const group = config.projects[groupIdx]
    if (!group.repositories.find((r) => r.name === repoName)) {
      return c.json({ error: 'Repository not found' }, 404)
    }

    // Guard: cannot remove the docs repo while it's still referenced
    if (group.docs_repo === repoName) {
      return c.json({ error: `Cannot remove docs repository '${repoName}' — update docs_repo first` }, 409)
    }

    const newProjects = [...config.projects]
    newProjects[groupIdx] = {
      ...group,
      repositories: group.repositories.filter((r) => r.name !== repoName),
    }

    try {
      updateConfig({ projects: newProjects })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }

    return c.json({ ok: true })
  })
}
