/**
 * Build a skill invocation prompt.
 *
 * The agent reads the skill file at .claude/skills/{skillName}.md for instructions,
 * then uses the context key-value pairs to fill in project-specific values.
 *
 * Example output:
 *   /init-plan
 *
 *   - requirementFile: /workspace/my-repo/requirements.md
 *   - repoName: my-repo
 *   - projectId: 42
 */
export function invokeSkill(
  skillName: string,
  context: Record<string, string | number | null | undefined>,
): string {
  const contextLines = Object.entries(context)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  return `/${skillName}\n\n${contextLines}`
}
