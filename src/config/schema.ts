import { z } from 'zod'

const RepositoryConfigSchema = z.object({
  name: z.string(),
  gitlab_project_id: z.number(),
  local_path: z.string(),
  type: z.enum(['frontend', 'backend', 'infra', 'fullstack']),
  tags: z.array(z.string()).default([]),
})

const ConfigSchema = z.object({
  gitlab: z.object({
    url: z.string().url(),
    token: z.string().min(1),
    webhook_secret: z.string().min(1),
  }),
  repositories: z.array(RepositoryConfigSchema).min(1),
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

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
export { ConfigSchema }
