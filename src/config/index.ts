import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { ConfigSchema, type Config } from './schema.js'
import { ConfigError } from '../utils/errors.js'

export type { Config } from './schema.js'
export type { RepositoryConfig } from './schema.js'

let cachedConfig: Config | null = null

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

  const configPath = join(process.cwd(), 'config.yaml')

  let rawYaml: unknown
  try {
    const content = readFileSync(configPath, 'utf8')
    rawYaml = yaml.load(content)
  } catch (err) {
    throw new ConfigError(
      `Failed to read config.yaml from ${configPath}: ${(err as Error).message}`,
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
