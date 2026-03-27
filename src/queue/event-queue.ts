import { randomUUID } from 'node:crypto'
import { getRedis } from './redis.js'
import type {
  AgentEvent,
  RequirementPushedEvent,
  IssueCommentEvent,
  MRReviewEvent,
  MRMergedEvent,
  TriggerPhaseEvent,
} from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('event-queue')

const QUEUE_KEY = 'agent:events'
const DEAD_LETTER_KEY = 'agent:dead-letter'
const PROCESSING_PREFIX = 'agent:processing:'
const PROCESSING_TTL_SECONDS = 3600 // 1 hour

// Explicitly typed union without id/timestamp for each event type
// (TypeScript cannot distribute Omit over unions, so we enumerate manually)
export type EnqueueInput =
  | (Omit<RequirementPushedEvent, 'id' | 'timestamp'> & { type: 'REQUIREMENT_PUSHED' })
  | (Omit<IssueCommentEvent, 'id' | 'timestamp'> & { type: 'ISSUE_COMMENT' })
  | (Omit<MRReviewEvent, 'id' | 'timestamp'> & { type: 'MR_REVIEW' })
  | (Omit<MRMergedEvent, 'id' | 'timestamp'> & { type: 'MR_MERGED' })
  | (Omit<TriggerPhaseEvent, 'id' | 'timestamp'> & { type: 'TRIGGER_PHASE' })

export class EventQueue {
  async enqueue(event: EnqueueInput): Promise<string> {
    const redis = getRedis()
    const fullEvent: AgentEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    } as AgentEvent

    await redis.rpush(QUEUE_KEY, JSON.stringify(fullEvent))
    log.debug({ eventId: fullEvent.id, type: fullEvent.type }, 'Event enqueued')
    return fullEvent.id
  }

  async dequeue(timeoutSeconds = 30): Promise<AgentEvent | null> {
    const redis = getRedis()
    const result = await redis.blpop(QUEUE_KEY, timeoutSeconds)
    if (!result) return null

    const [, data] = result
    const event = JSON.parse(data) as AgentEvent

    // Mark as processing with TTL
    await redis.set(
      `${PROCESSING_PREFIX}${event.id}`,
      data,
      'EX',
      PROCESSING_TTL_SECONDS,
    )

    log.debug({ eventId: event.id, type: event.type }, 'Event dequeued')
    return event
  }

  async ack(eventId: string): Promise<void> {
    const redis = getRedis()
    await redis.del(`${PROCESSING_PREFIX}${eventId}`)
    log.debug({ eventId }, 'Event acknowledged')
  }

  async nack(event: AgentEvent, reason: string): Promise<void> {
    const redis = getRedis()
    const deadLetterEntry = JSON.stringify({
      event,
      reason,
      failedAt: new Date().toISOString(),
    })
    await redis.rpush(DEAD_LETTER_KEY, deadLetterEntry)
    await redis.del(`${PROCESSING_PREFIX}${event.id}`)
    log.warn({ eventId: event.id, reason }, 'Event moved to dead-letter queue')
  }

  async queueLength(): Promise<number> {
    const redis = getRedis()
    return redis.llen(QUEUE_KEY)
  }

  async deadLetterLength(): Promise<number> {
    const redis = getRedis()
    return redis.llen(DEAD_LETTER_KEY)
  }

  async deadLetterEntries(limit = 20): Promise<Array<{ event: AgentEvent; reason: string; failedAt: string }>> {
    const redis = getRedis()
    const raw = await redis.lrange(DEAD_LETTER_KEY, -limit, -1)
    return raw.map((r) => JSON.parse(r))
  }

  async clearDeadLetter(): Promise<void> {
    const redis = getRedis()
    await redis.del(DEAD_LETTER_KEY)
    log.info('Dead-letter queue cleared')
  }
}

export const eventQueue = new EventQueue()
