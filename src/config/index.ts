import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { ConfigSchema, type Config, type RepositoryConfig } from './schema.js'
import { ConfigError } from '../utils/errors.js'

export type { Config } from './schema.js'
export type { RepositoryConfig, ProjectGroupConfig } from './schema.js'

let cachedConfig: Config | null = null

// Store config in /app/data/ (named volume) so it persists without a bind mount file
const DATA_DIR = process.env['DATA_DIR'] ?? join(process.cwd(), 'data')
const CONFIG_PATH = join(DATA_DIR, 'config.yaml')

/**
 * Bootstrap a minimal config.yaml using env vars for secrets.
 * Called automatically on first start if no config.yaml exists.
 * User then configures gitlab.url and repositories via the Web UI.
 */
function bootstrapConfigFile(): void {
  const minimal = {
    gitlab: {
      url: process.env['GITLAB_URL'] ?? 'https://gitlab.example.com',
      token: '${GITLAB_TOKEN}',
      webhook_secret: '${WEBHOOK_SECRET}',
    },
    projects: [],
  }
  writeFileSync(CONFIG_PATH, yaml.dump(minimal, { indent: 2 }), 'utf8')
}

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      const envValue = process.env[varName]
      // Return empty string for missing env vars so the server can boot without all secrets set.
      // The UI will show a "not configured" warning.
      return envValue ?? ''
    })
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnvVars)
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnvVars(v)
    }
    return result
  }
  return value
}

/**
 * Migrate old flat repositories[] config to new projects[] format.
 * If raw YAML has repositories[] but not projects[], wrap into a single project group.
 */
function migrateOldConfig(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw['projects'] && Array.isArray(raw['repositories'])) {
    const repos = raw['repositories'] as RepositoryConfig[]
    raw['projects'] = [
      {
        id: 'default',
        name: 'Default Project',
        docs_repo: repos[0]?.name ?? '',
        docs_branch: 'main',
        docs_path_pattern: 'requirement*',
        repositories: repos,
      },
    ]
    delete raw['repositories']
  }
  return raw
}

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig

  // Auto-create config.yaml on first start — user configures the rest via Web UI
  if (!existsSync(CONFIG_PATH)) {
    bootstrapConfigFile()
  }

  let rawYaml: unknown
  try {
    const content = readFileSync(CONFIG_PATH, 'utf8')
    rawYaml = yaml.load(content)
  } catch (err) {
    throw new ConfigError(
      `Failed to read config.yaml from ${CONFIG_PATH}: ${(err as Error).message}`,
      'CONFIG_READ_ERROR',
    )
  }

  // Migrate old repositories[] format to projects[]
  if (rawYaml !== null && typeof rawYaml === 'object') {
    rawYaml = migrateOldConfig(rawYaml as Record<string, unknown>)
  }

  let interpolated: unknown
  try {
    interpolated = interpolateEnvVars(rawYaml)
  } catch (err) {
    throw err
  }

  const result = ConfigSchema.safeParse(interpolated)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new ConfigError(
      `Config validation failed:\n${issues}`,
      'CONFIG_VALIDATION_ERROR',
    )
  }

  cachedConfig = result.data
  return cachedConfig
}

export function getConfig(): Config {
  if (!cachedConfig) {
    throw new ConfigError(
      'Config not loaded. Call loadConfig() first.',
      'CONFIG_NOT_LOADED',
    )
  }
  return cachedConfig
}

export function invalidateConfigCache(): void {
  cachedConfig = null
}

/**
 * Write actual token/webhook_secret values into config.yaml.
 * Skips fields that are empty or already an env-var placeholder.
 * After writing, invalidates the cache so the next getConfig() call reloads from disk.
 */
export function updateSecrets(token?: string, webhookSecret?: string): void {
  const isEmpty = (v?: string) => !v || v.trim() === '' || v === '***'
  const isPlaceholder = (v: string) => v.startsWith('${')

  if (isEmpty(token) && isEmpty(webhookSecret)) return

  let rawYaml: Record<string, unknown>
  try {
    const content = readFileSync(CONFIG_PATH, 'utf8')
    rawYaml = (yaml.load(content) as Record<string, unknown>) ?? {}
  } catch {
    rawYaml = {}
  }

  const gitlab = (rawYaml['gitlab'] as Record<string, unknown>) ?? {}
  rawYaml['gitlab'] = gitlab

  if (!isEmpty(token) && !isPlaceholder(token!)) {
    gitlab['token'] = token!.trim()
  }
  if (!isEmpty(webhookSecret) && !isPlaceholder(webhookSecret!)) {
    gitlab['webhook_secret'] = webhookSecret!.trim()
  }

  writeFileSync(CONFIG_PATH, yaml.dump(rawYaml, { indent: 2 }), 'utf8')
  invalidateConfigCache()
}

/**
 * Return all repositories flattened across all project groups.
 */
export function getAllRepositories(config: Config): RepositoryConfig[] {
  return config.projects.flatMap((g) => g.repositories)
}

// Sensitive keys that must never be written back via API
const PROTECTED_KEYS = new Set(['gitlab.token', 'gitlab.webhook_secret'])

export function updateConfig(partial: Partial<Config>): void {
  if (!cachedConfig) throw new ConfigError('Config not loaded', 'CONFIG_NOT_LOADED')

  // Strip sensitive fields from partial
  const safe = JSON.parse(JSON.stringify(partial)) as Record<string, unknown>
  if (safe['gitlab']) {
    const g = safe['gitlab'] as Record<string, unknown>
    delete g['token']
    delete g['webhook_secret']
  }

  // Deep merge into current config
  const merged = deepMerge(JSON.parse(JSON.stringify(cachedConfig)), safe) as Config

  const result = ConfigSchema.safeParse(merged)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new ConfigError(`Config validation failed:\n${issues}`, 'CONFIG_VALIDATION_ERROR')
  }

  // Write back to config.yaml.
  // Preserve whatever token/webhook_secret values are currently in the raw file
  // (they may be env-var placeholders like ${GITLAB_TOKEN} or literal values set via UI).
  let rawToken = '${GITLAB_TOKEN}'
  let rawSecret = '${WEBHOOK_SECRET}'
  try {
    const rawContent = readFileSync(CONFIG_PATH, 'utf8')
    const rawParsed = yaml.load(rawContent) as Record<string, unknown> | null
    if (rawParsed?.['gitlab']) {
      const g = rawParsed['gitlab'] as Record<string, unknown>
      if (typeof g['token'] === 'string' && g['token']) rawToken = g['token']
      if (typeof g['webhook_secret'] === 'string' && g['webhook_secret']) rawSecret = g['webhook_secret']
    }
  } catch { /* ignore — use placeholders as fallback */ }

  const toWrite = JSON.parse(JSON.stringify(result.data)) as Record<string, unknown>
  const gitlabSection = toWrite['gitlab'] as Record<string, unknown>
  gitlabSection['token'] = rawToken
  gitlabSection['webhook_secret'] = rawSecret

  writeFileSync(CONFIG_PATH, yaml.dump(toWrite, { indent: 2 }), 'utf8')

  cachedConfig = result.data
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      target[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
    } else {
      target[key] = sv
    }
  }
  return target
}

export { PROTECTED_KEYS }
