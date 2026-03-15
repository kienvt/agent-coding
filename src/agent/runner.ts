import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from '../config/index.js'
import { AgentError } from '../utils/errors.js'
import { createLogger } from '../utils/logger.js'
import { logStore } from '../utils/log-store.js'

const log = createLogger('agent-runner')

// claude-config/ directory at project root (process.cwd() = /app in Docker, project root in dev)
const CLAUDE_CONFIG_DIR = process.env['CLAUDE_CONFIG_DIR'] ?? join(process.cwd(), 'claude-config')

export interface AgentRunOptions {
  prompt: string
  cwd: string
  projectId?: number
  allowedTools?: string[]
  maxTurns?: number
  systemPrompt?: string
  onProgress?: (message: string) => void
}

export interface AgentRunResult {
  success: boolean
  output: string
  cost?: number
  durationMs?: number
  turns: number
}

const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']

/**
 * Deploy claude-config/ contents to the target repo's .claude/ directory.
 * Handles dev environments where the directory isn't mounted via Docker volume.
 * In production (Docker), the volume mount handles it — this is a no-op safeguard.
 */
function deployClaudeConfig(targetCwd: string): void {
  const destClaudeDir = join(targetCwd, '.claude')

  // Skip if .claude/ already exists (volume-mounted in Docker)
  if (existsSync(destClaudeDir)) {
    log.debug({ targetCwd }, 'Skipping deploy — .claude/ already exists (volume-mounted)')
    return
  }

  if (!existsSync(CLAUDE_CONFIG_DIR)) {
    log.warn({ claudeConfigDir: CLAUDE_CONFIG_DIR }, 'claude-config/ not found — agent will run without custom skills')
    return
  }

  mkdirSync(destClaudeDir, { recursive: true })
  cpSync(CLAUDE_CONFIG_DIR, destClaudeDir, { recursive: true })
  log.debug({ targetCwd, source: CLAUDE_CONFIG_DIR }, 'Deployed claude-config to .claude/')
}

export class AgentRunner {
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const config = getConfig()
    const {
      prompt,
      cwd,
      projectId,
      allowedTools = DEFAULT_TOOLS,
      maxTurns = config.agent.max_retries * 10,
      systemPrompt,
      onProgress,
    } = options

    // Ensure .claude/ (skills + CLAUDE.md) is available in the workspace repo
    deployClaudeConfig(cwd)

    const botUsername = process.env['GITLAB_BOT_USERNAME'] ?? 'ai-agent'
    const systemContext = [
      `Working directory: ${cwd}`,
      `Available tools: glab (GitLab CLI), git, standard Unix tools`,
      `GitLab instance: ${config.gitlab.url}`,
      `Bot username: ${botUsername}`,
      systemPrompt,
    ]
      .filter(Boolean)
      .join('\n')

    log.info({ cwd }, 'Starting agent run (god mode)')
    const startMs = Date.now()

    let output = ''
    let cost: number | undefined
    let durationMs: number | undefined
    let turns = 0

    try {
      const messages = query({
        prompt,
        options: {
          cwd,
          allowedTools,
          // God mode: bypass all permission checks — safe because we run in an isolated container
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns,
          systemPrompt: systemContext,
        },
      })

      for await (const message of messages) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              output += block.text
              onProgress?.(block.text)
              // Stream agent output to log store if projectId is provided
              if (projectId && block.text.trim()) {
                await logStore.append(projectId, {
                  level: 'agent',
                  module: 'agent-runner',
                  msg: block.text.slice(0, 500),
                }).catch(() => {/* non-critical */})
              }
            }
          }
          turns++
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            cost = message.total_cost_usd
            durationMs = Date.now() - startMs
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error({ cwd, error: errMsg }, 'Agent run failed')
      throw new AgentError(`Agent run failed: ${errMsg}`, {
        cwd,
        prompt: prompt.slice(0, 100),
      })
    }

    durationMs ??= Date.now() - startMs
    log.info({ cwd, turns, cost, durationMs }, 'Agent run complete')

    if (projectId) {
      await logStore.append(projectId, {
        level: 'info',
        module: 'agent-runner',
        msg: `Run complete — ${turns} turns, $${(cost ?? 0).toFixed(4)} cost, ${durationMs}ms`,
      }).catch(() => {/* non-critical */})
    }

    return { success: true, output, cost, durationMs, turns }
  }
}

export const agentRunner = new AgentRunner()
