# T03 — Logger & Utilities

> **Phụ thuộc:** T01
> **Output:** `src/utils/logger.ts`, `src/utils/retry.ts`, `src/utils/errors.ts`

---

## Mục tiêu

Shared utilities dùng cho toàn bộ hệ thống: structured logging, retry với exponential backoff, custom error classes.

---

## Key Types / Interfaces

```typescript
// retry options
interface RetryOptions {
  maxAttempts?: number      // default: 3
  initialDelay?: number     // ms, default: 1000
  maxDelay?: number         // ms, default: 30000
  factor?: number           // backoff multiplier, default: 2
  onRetry?: (error: Error, attempt: number) => void
}

// custom errors
class AppError extends Error { code: string; details?: unknown }
class AgentError extends AppError {}   // AI agent failures
class GitError extends AppError {}     // Git operation failures
class ConfigError extends AppError {}  // Config/validation errors
```

---

## Các bước

### Bước 1: Logger (`src/utils/logger.ts`)
- Dùng `pino` với `pino-pretty` ở dev, JSON ở production
- Detect `NODE_ENV` để chọn transport
- Export `logger` (root) và `createLogger(module: string)` (child logger với `{ module }`)
- Log level từ `LOG_LEVEL` env var

### Bước 2: Retry (`src/utils/retry.ts`)
- `retry<T>(fn: () => Promise<T>, options): Promise<T>`
- Exponential backoff: delay × factor sau mỗi lần fail, cap tại maxDelay
- Log attempt number, delay, error message mỗi lần retry
- Throw error cuối cùng nếu tất cả attempts fail
- Export `sleep(ms)` helper

### Bước 3: Error classes (`src/utils/errors.ts`)
- `AppError`: base class với `code` string và optional `details`
- `AgentError`, `GitError`, `ConfigError` extend `AppError`
- Dễ dàng `catch (err) { if (err instanceof AgentError) ... }`

---

## Acceptance Criteria

- [ ] Dev mode: output có màu, human readable
- [ ] Production: JSON output
- [ ] `createLogger('agent')` tạo child logger có field `module: 'agent'`
- [ ] `retry(fn, { maxAttempts: 3 })` thử 3 lần với delay tăng dần
- [ ] Throw error lần cuối nếu fail hết
- [ ] Custom error classes có thể `instanceof` check
