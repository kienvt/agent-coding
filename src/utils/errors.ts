export class AppError extends Error {
  code: string
  details?: unknown

  constructor(message: string, code: string, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.details = details
    Error.captureStackTrace(this, this.constructor)
  }
}

export class AgentError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'AGENT_ERROR', details)
  }
}

export class GitError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'GIT_ERROR', details)
  }
}

export class ConfigError extends AppError {
  constructor(message: string, code = 'CONFIG_ERROR', details?: unknown) {
    super(message, code, details)
  }
}
