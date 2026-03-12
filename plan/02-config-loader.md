# T02 — Config Loader

> **Phụ thuộc:** T01
> **Output:** `src/config/schema.ts`, `src/config/index.ts`

---

## Mục tiêu

Load `config.yaml`, thay thế `${ENV_VAR}` placeholders bằng giá trị từ environment, validate bằng Zod.

---

## Key Types / Interfaces

```typescript
// src/config/schema.ts
interface RepositoryConfig {
  name: string
  gitlab_project_id: number
  local_path: string
  type: 'frontend' | 'backend' | 'infra' | 'fullstack'
  tags: string[]
}

interface Config {
  gitlab: { url: string; token: string; webhook_secret: string }
  repositories: RepositoryConfig[]
  agent: {
    model: string            // default: 'claude-sonnet-4-6'
    max_retries: number
    timeout_seconds: number
    mockup: { enabled: boolean; output_dir: string; framework: string }
  }
  workflow: {
    auto_merge: boolean
    require_tests: boolean
    target_branch: string
    branch_prefix: string
    labels: { init: string[]; implement: string[]; review: string[]; done: string[] }
  }
}
```

---

## Các bước

### Bước 1: Zod schema (`src/config/schema.ts`)
- Định nghĩa schema đầy đủ cho `Config`
- Dùng `.default()` cho các field optional
- Export `Config` type từ schema

### Bước 2: Env interpolation
- Function `interpolateEnvVars(obj)`: duyệt đệ quy object
- Replace pattern `${VAR_NAME}` bằng `process.env[VAR_NAME]`
- Throw nếu env var không tồn tại: `Missing env var: VAR_NAME`

### Bước 3: loadConfig() (`src/config/index.ts`)
- Đọc `config.yaml` từ `process.cwd()`
- Parse YAML → interpolate env vars → validate với Zod schema
- Cache singleton (lần sau gọi không đọc file lại)
- Throw error rõ ràng nếu validation fail (liệt kê từng field lỗi)

### Bước 4: getConfig()
- Return cached config
- Throw nếu chưa gọi `loadConfig()`

---

## Acceptance Criteria

- [ ] `${GITLAB_TOKEN}` trong YAML được replace đúng từ `process.env.GITLAB_TOKEN`
- [ ] Missing env var → error message rõ tên biến
- [ ] Schema validation fail → error liệt kê từng field
- [ ] Singleton: chỉ đọc file 1 lần dù gọi `loadConfig()` nhiều lần
