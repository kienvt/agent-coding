import type {
  ProjectGroupSummary,
  ProjectGroupDetail,
  ProjectGroupConfig,
  RepositoryConfig,
  AppConfig,
  QueueStatus,
  LogEntry,
  TriggerBody,
  CreateProjectBody,
  UpdateProjectBody,
  CreateRepositoryBody,
} from '../types/index.js'

async function handleError(res: Response, method: string, url: string): Promise<never> {
  let message = `${method} ${url} failed: ${res.status}`
  try {
    const data = await res.json() as { error?: string }
    if (data?.error) message = data.error
  } catch { /* ignore parse errors */ }
  throw new Error(message)
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) return handleError(res, 'GET', url)
  return res.json() as Promise<T>
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return handleError(res, 'POST', url)
  return res.json() as Promise<T>
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return handleError(res, 'PUT', url)
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) return handleError(res, 'DELETE', url)
  return res.json() as Promise<T>
}

export const apiClient = {
  projects: {
    list: () => get<ProjectGroupSummary[]>('/api/projects'),
    get: (slug: string) => get<ProjectGroupDetail>(`/api/projects/${slug}`),
    trigger: (slug: string, body: TriggerBody) =>
      post<{ ok: boolean; eventId: string }>(`/api/projects/${slug}/trigger`, body),
    resetState: (slug: string) =>
      del<{ ok: boolean }>(`/api/projects/${slug}/state`),
    clearLogs: (slug: string) =>
      del<{ ok: boolean }>(`/api/projects/${slug}/logs`),
    getLogs: (slug: string, limit = 200) =>
      get<LogEntry[]>(`/api/projects/${slug}/logs?limit=${limit}`),
    streamLogs: (slug: string, repo?: string) => {
      const url = repo
        ? `/api/projects/${slug}/logs/stream?repo=${encodeURIComponent(repo)}`
        : `/api/projects/${slug}/logs/stream`
      return new EventSource(url)
    },
    // CRUD
    create: (body: CreateProjectBody) =>
      post<{ ok: boolean; project: ProjectGroupConfig }>('/api/projects', body),
    update: (slug: string, body: UpdateProjectBody) =>
      put<{ ok: boolean; project: ProjectGroupConfig }>(`/api/projects/${slug}`, body),
    delete: (slug: string) =>
      del<{ ok: boolean }>(`/api/projects/${slug}`),
    addRepo: (slug: string, body: CreateRepositoryBody) =>
      post<{ ok: boolean; repository: RepositoryConfig }>(`/api/projects/${slug}/repositories`, body),
    updateRepo: (slug: string, repoName: string, body: Partial<Omit<CreateRepositoryBody, 'name'>>) =>
      put<{ ok: boolean; repository: RepositoryConfig }>(`/api/projects/${slug}/repositories/${encodeURIComponent(repoName)}`, body),
    deleteRepo: (slug: string, repoName: string) =>
      del<{ ok: boolean }>(`/api/projects/${slug}/repositories/${encodeURIComponent(repoName)}`),
  },
  config: {
    get: () => get<AppConfig>('/api/config'),
    update: (partial: Partial<AppConfig>) =>
      put<{ ok: boolean; config: AppConfig }>('/api/config', partial),
    updateSecrets: (body: { token?: string; webhook_secret?: string }) =>
      put<{ ok: boolean }>('/api/config/secrets', body),
  },
  queue: {
    get: () => get<QueueStatus>('/api/queue'),
    clearDeadLetter: () => del<{ ok: boolean }>('/api/queue/dead-letter'),
  },
  health: {
    check: () => fetch('/health').then((r) => r.ok),
  },
}
