import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { ConfigSchema, type Config } from './schema.js'
import { ConfigError } from '../utils/errors.js'

export type { Config } from './schema.js'
export type { RepositoryConfig } from './schema.js'

let cachedConfig: Config | null = null

const CONFIG_PATH = join(process.cwd(), 'config.yaml')

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
    repositories: [],
  }
  writeFileSync(CONFIG_PATH, yaml.dump(minimal, { indent: 2 }), 'utf8')
}

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const envValue = process.env[varName]
      if (envValue === undefined) {
        throw new ConfigError(`Missing env var: ${varName}`, 'MISSING_ENV_VAR')
      }
      return envValue
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

  // Write back to config.yaml (restore env var placeholders for secrets)
  const toWrite = JSON.parse(JSON.stringify(result.data)) as Record<string, unknown>
  const gitlabSection = toWrite['gitlab'] as Record<string, unknown>
  gitlabSection['token'] = '${GITLAB_TOKEN}'
  gitlabSection['webhook_secret'] = '${WEBHOOK_SECRET}'

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
