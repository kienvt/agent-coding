import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig } from "../config/index.js";
import { AgentError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { logStore } from "../utils/log-store.js";

const log = createLogger("agent-runner");

// claude-config/ directory at project root (process.cwd() = /app in Docker, project root in dev)
// Use AGENT_CLAUDE_CONFIG_DIR to avoid conflicting with Claude Code's own CLAUDE_CONFIG_DIR
// (which Claude Code uses to locate auth credentials — overriding it breaks subscription auth)
const CLAUDE_CONFIG_DIR =
  process.env["AGENT_CLAUDE_CONFIG_DIR"] ??
  process.env["CLAUDE_CONFIG_DIR"] ??
  join(process.cwd(), "claude-config");

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  projectSlug?: string;
  allowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string;
  onProgress?: (message: string) => void;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  cost?: number;
  durationMs?: number;
  turns: number;
}

const DEFAULT_TOOLS = [
  "Skill",
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
];

/**
 * Deploy claude-config/ contents to the target repo's .claude/ directory.
 * Handles dev environments where the directory isn't mounted via Docker volume.
 * In production (Docker), the volume mount handles it — this is a no-op safeguard.
 */
function deployClaudeConfig(targetCwd: string): void {
  if (!existsSync(CLAUDE_CONFIG_DIR)) {
    log.warn(
      { claudeConfigDir: CLAUDE_CONFIG_DIR },
      "claude-config/ not found — agent will run without custom skills",
    );
    return;
  }

  // Deploy .claude/ directly into the repo being worked on so Claude Code
  // can find commands and skills without relying on parent-dir traversal.
  const destClaudeDir = join(targetCwd, ".claude");

  // Always sync so updates to claude-config/ are propagated on every run
  mkdirSync(destClaudeDir, { recursive: true });
  cpSync(CLAUDE_CONFIG_DIR, destClaudeDir, { recursive: true });
  log.debug(
    { destClaudeDir, source: CLAUDE_CONFIG_DIR },
    "Deployed claude-config to repo .claude/",
  );
}

export class AgentRunner {
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const config = getConfig();
    const {
      prompt,
      cwd,
      projectSlug,
      allowedTools = DEFAULT_TOOLS,
      maxTurns = config.agent.max_retries * 10,
      systemPrompt,
      onProgress,
    } = options;

    // Ensure .claude/ (skills + CLAUDE.md) is available in the workspace repo
    deployClaudeConfig(cwd);

    const botUsername = process.env["GITLAB_BOT_USERNAME"] ?? "ai-agent";
    const systemContext = [
      `Working directory: ${cwd}`,
      `Available tools: glab (GitLab CLI), git, standard Unix tools`,
      `GitLab instance: ${config.gitlab.url}`,
      `Bot username: ${botUsername}`,
      systemPrompt,
    ]
      .filter(Boolean)
      .join("\n");

    log.info({ cwd }, "Starting agent run (god mode)");
    const startMs = Date.now();

    let output = "";
    let cost: number | undefined;
    let durationMs: number | undefined;
    let turns = 0;

    try {
      const messages = query({
        prompt,
        options: {
          cwd,
          allowedTools,
          // God mode: bypass all permission checks — safe because we run in an isolated container
          // Note: allowDangerouslySkipPermissions is intentionally omitted — it's blocked when running as root (Docker default)
          permissionMode: "bypassPermissions",
          maxTurns,
          systemPrompt: systemContext,
          // Required for SDK to load .claude/commands/ and .claude/skills/ from the project dir
          settingSources: ['user', 'project'],
          // Capture stderr so exit-code-1 errors are visible in logs
          stderr: (text: string) => {
            const trimmed = text.trim();
            if (trimmed)
              log.error({ cwd, stderr: trimmed }, "Claude Code stderr");
          },
        },
      });

      for await (const message of messages) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text") {
              output += block.text;
              onProgress?.(block.text);
              // Stream agent output to log store if projectSlug is provided
              if (projectSlug && block.text.trim()) {
                await logStore
                  .append(projectSlug, {
                    level: "agent",
                    module: "agent-runner",
                    msg: block.text.slice(0, 500),
                  })
                  .catch(() => {
                    /* non-critical */
                  });
              }
            }
          }
          turns++;
        } else if (message.type === "result") {
          if (message.subtype === "success") {
            cost = message.total_cost_usd;
            durationMs = Date.now() - startMs;
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ cwd, error: errMsg }, "Agent run failed");
      throw new AgentError(`Agent run failed: ${errMsg}`, {
        cwd,
        prompt: prompt.slice(0, 100),
      });
    }

    durationMs ??= Date.now() - startMs;
    log.info({ cwd, turns, cost, durationMs }, "Agent run complete");

    if (projectSlug) {
      await logStore
        .append(projectSlug, {
          level: "info",
          module: "agent-runner",
          msg: `Run complete — ${turns} turns, $${(cost ?? 0).toFixed(4)} cost, ${durationMs}ms`,
        })
        .catch(() => {
          /* non-critical */
        });
    }

    return { success: true, output, cost, durationMs, turns };
  }
}

export const agentRunner = new AgentRunner();
