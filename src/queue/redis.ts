import { Redis } from 'ioredis'
import { createLogger } from '../utils/logger.js'

const log = createLogger('redis')

let redisInstance: Redis | null = null

export function getRedis(): Redis {
  if (!redisInstance) {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    })

    redisInstance.on('connect', () => log.info('Redis connected'))
    redisInstance.on('ready', () => log.info('Redis ready'))
    redisInstance.on('error', (err: Error) => log.error({ err }, 'Redis error'))
    redisInstance.on('close', () => log.warn('Redis connection closed'))
    redisInstance.on('reconnecting', () => log.info('Redis reconnecting'))
  }
  return redisInstance
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit()
    redisInstance = null
    log.info('Redis connection closed gracefully')
  }
}
