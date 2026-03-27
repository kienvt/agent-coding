/**
 * Build a slash command invocation prompt.
 *
 * Emits `/{skillName}` followed by context key-value pairs as $ARGUMENTS.
 * The command file in .claude/commands/{skillName}.md is loaded by the claude binary.
 */
export function invokeSkill(
  skillName: string,
  context: Record<string, string | number | null | undefined>,
): string {
  const contextLines = Object.entries(context)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  return `/${skillName}\n\n${contextLines}`
}
