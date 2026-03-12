import pino from 'pino'

const isDev = process.env['NODE_ENV'] !== 'production'
const logLevel = process.env['LOG_LEVEL'] ?? 'info'

export const logger = pino({
  level: logLevel,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
})

export function createLogger(module: string): pino.Logger {
  return logger.child({ module })
}
