import type { Hono } from 'hono'
import { eventQueue } from '../../queue/event-queue.js'

export function registerQueueRoutes(app: Hono): void {
  // GET /api/queue — queue status + dead-letter entries
  app.get('/api/queue', async (c) => {
    const [queueLength, deadLetterLength, deadLetterEntries] = await Promise.all([
      eventQueue.queueLength(),
      eventQueue.deadLetterLength(),
      eventQueue.deadLetterEntries(20),
    ])

    return c.json({
      queue_length: queueLength,
      dead_letter_length: deadLetterLength,
      dead_letter: deadLetterEntries,
    })
  })

  // DELETE /api/queue/dead-letter — clear dead-letter queue
  app.delete('/api/queue/dead-letter', async (c) => {
    await eventQueue.clearDeadLetter()
    return c.json({ ok: true })
  })
}
