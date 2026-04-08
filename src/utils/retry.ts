import { createLogger } from './logger.js'

const log = createLogger('retry')

export interface RetryOptions {
  maxAttempts?: number
  initialDelay?: number
  maxDelay?: number
  factor?: number
  shouldRetry?: (error: Error) => boolean
  onRetry?: (error: Error, attempt: number) => void
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    shouldRetry,
    onRetry,
  } = options

  let lastError: Error
  let delay = initialDelay

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt === maxAttempts) break
      if (shouldRetry && !shouldRetry(lastError)) throw lastError

      const waitMs = Math.min(delay, maxDelay)
      log.warn({ attempt, maxAttempts, delayMs: waitMs, error: lastError.message }, 'Retrying after error')

      onRetry?.(lastError, attempt)
      await sleep(waitMs)
      delay = Math.min(delay * factor, maxDelay)
    }
  }

  throw lastError!
}
