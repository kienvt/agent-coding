import { z } from 'zod'

const RepositoryRoleSchema = z.enum(['docs', 'code'])

const RepositoryConfigSchema = z.object({
  name: z.string(),
  gitlab_project_id: z.number(),
  local_path: z.string(),
  type: z.enum(['frontend', 'backend', 'infra', 'fullstack', 'docs']),
  tags: z.array(z.string()).default([]),
  role: RepositoryRoleSchema.default('code'),
})

const ProjectGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  docs_repo: z.string().default(''),
  docs_branch: z.string().default('main'),
  docs_path_pattern: z.string().default('requirement*'),
  repositories: z.array(RepositoryConfigSchema).default([]),
})

const ConfigSchema = z.object({
  gitlab: z.object({
    // Allow empty strings so the server can boot without credentials configured.
    // The UI shows a warning when these are empty.
    url: z.string().default('https://gitlab.example.com'),
    token: z.string().default(''),
    webhook_secret: z.string().default(''),
  }),
  projects: z.array(ProjectGroupSchema).default([]),
  agent: z.object({
    model: z.string().default('claude-sonnet-4-6'),
    max_retries: z.number().int().min(1).default(3),
    timeout_seconds: z.number().int().min(30).default(300),
    mockup: z.object({
      enabled: z.boolean().default(true),
      output_dir: z.string().default('docs/mockup'),
      framework: z.enum(['vanilla', 'tailwind', 'bootstrap']).default('vanilla'),
    }).default({}),
  }).default({}),
  workflow: z.object({
    auto_merge: z.boolean().default(false),
    require_tests: z.boolean().default(true),
    target_branch: z.string().default('main'),
    branch_prefix: z.string().default('feature/'),
    labels: z.object({
      init: z.array(z.string()).default(['phase:init', 'ai-generated']),
      implement: z.array(z.string()).default(['phase:implement']),
      review: z.array(z.string()).default(['phase:review']),
      done: z.array(z.string()).default(['phase:done']),
    }).default({}),
  }).default({}),
  notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.array(z.string()).default(['gitlab-comment']),
  }).default({}),
})

export type RepositoryRole = z.infer<typeof RepositoryRoleSchema>
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>
export type ProjectGroupConfig = z.infer<typeof ProjectGroupSchema>
export type Config = z.infer<typeof ConfigSchema>
export { ConfigSchema, ProjectGroupSchema }
