import { useState, useEffect } from 'react'
import { apiClient } from '../api/client.js'

export function useHealth() {
  const [status, setStatus] = useState<'ok' | 'error'>('ok')

  useEffect(() => {
    const check = () =>
      apiClient.health.check()
        .then((ok) => setStatus(ok ? 'ok' : 'error'))
        .catch(() => setStatus('error'))

    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [])

  return status
}
