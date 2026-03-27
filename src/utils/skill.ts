import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CLAUDE_CONFIG_DIR = process.env['CLAUDE_CONFIG_DIR'] ?? join(process.cwd(), 'claude-config')

/**
 * Build a skill invocation prompt by reading the skill file content directly.
 *
 * Reads claude-config/commands/{skillName}.md, substitutes {key} placeholders,
 * then prepends the context variables. This works in both interactive and SDK/headless mode.
 */
export function invokeSkill(
  skillName: string,
  context: Record<string, string | number | null | undefined>,
): string {
  const skillPath = join(CLAUDE_CONFIG_DIR, 'commands', `${skillName}.md`)

  let skillContent: string
  if (existsSync(skillPath)) {
    skillContent = readFileSync(skillPath, 'utf8')
    // Substitute {key} placeholders with context values
    for (const [k, v] of Object.entries(context)) {
      if (v != null) {
        skillContent = skillContent.replaceAll(`{${k}}`, String(v))
      }
    }
  } else {
    // Fallback: just pass skill name + context (old behavior)
    skillContent = `Execute the ${skillName} task with the following context.`
  }

  const contextLines = Object.entries(context)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  return `## Task: ${skillName}\n\n## Context\n${contextLines}\n\n## Instructions\n\n${skillContent}`
}
