import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../api/client.js'
import type { LogEntry } from '../types/index.js'

export function useLogStream(slug: string | null, repoFilter?: string) {
  const [lines, setLines] = useState<LogEntry[]>([])
  const esRef = useRef<EventSource | null>(null)

  // Load initial history
  useEffect(() => {
    if (!slug) { setLines([]); return }
    apiClient.projects.getLogs(slug, 50).then((entries) => setLines(entries)).catch(() => {})
  }, [slug])

  // Subscribe to SSE stream
  useEffect(() => {
    if (!slug) return

    const es = apiClient.projects.streamLogs(slug, repoFilter)
    esRef.current = es

    es.onmessage = (e: MessageEvent) => {
      if (!e.data) return
      try {
        const entry = JSON.parse(e.data as string) as LogEntry
        setLines((prev) => [...prev, entry])
      } catch {
        // ignore
      }
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [slug, repoFilter])

  const clear = () => setLines([])

  return { lines, clear }
}
