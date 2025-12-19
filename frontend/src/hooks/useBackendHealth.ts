import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../config'
import type { BackendStatusPayload } from '../types/global'

type HealthState = {
  status: 'checking' | 'ready' | 'error'
  message?: string
  lastChecked?: number
}

type BackendHealth = {
  status: HealthState
  backendStatus?: BackendStatusPayload
  retry: () => void
}

const HEALTH_ENDPOINT = '/api/health'

export function useBackendHealth(): BackendHealth {
  const [backendStatus, setBackendStatus] = useState<BackendStatusPayload>()
  const [healthStatus, setHealthStatus] = useState<HealthState>({ status: 'checking' })
  const [retryNonce, setRetryNonce] = useState(0)
  const statusRef = useRef<HealthState>({ status: 'checking' })

  useEffect(() => {
    const unsubscribe = window.appBridge?.onBackendStatus?.((payload) => {
      setBackendStatus(payload)
    })

    window.appBridge?.getBackendStatus?.().then((current) => {
      if (current) setBackendStatus(current)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const checkHealth = async () => {
      try {
        const url = apiUrl(HEALTH_ENDPOINT)
        // eslint-disable-next-line no-console
        console.log('[api] Requesting', url)

        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Backend unavailable (HTTP ${response.status})`)
        }
        const payload = await response.json().catch(() => undefined)
        if (disposed) return

        const next: HealthState = {
          status: 'ready',
          message: payload?.message || 'Backend ready',
          lastChecked: Date.now(),
        }
        statusRef.current = next
        setHealthStatus(next)
      } catch (error) {
        if (disposed) return
        const message = error instanceof Error ? error.message : 'Unable to reach backend'
        const next: HealthState = { status: 'error', message, lastChecked: Date.now() }
        statusRef.current = next
        setHealthStatus(next)
      }

      const delay = statusRef.current.status === 'ready' ? 5000 : 1500
      timer = setTimeout(checkHealth, delay)
    }

    checkHealth()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [retryNonce])

  useEffect(() => {
    if (healthStatus.status === 'ready') {
      setBackendStatus((current) => {
        if (!current) return current
        if (current.status === 'starting' || current.status === 'restarting') {
          return { ...current, status: 'running' }
        }
        return current
      })
    }
  }, [healthStatus.status])

  const retry = () => {
    statusRef.current = { status: 'checking' }
    setHealthStatus({ status: 'checking' })
    setRetryNonce((value) => value + 1)
  }

  return { status: healthStatus, backendStatus, retry }
}

export default useBackendHealth
