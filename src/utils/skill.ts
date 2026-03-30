/**
 * Build a slash command invocation prompt.
 *
 * Emits `/{skillName}` followed by context key-value pairs as $ARGUMENTS.
 * Requires settingSources: ['user', 'project'] in query() options so the SDK
 * loads .claude/commands/ and can resolve the slash command.
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
