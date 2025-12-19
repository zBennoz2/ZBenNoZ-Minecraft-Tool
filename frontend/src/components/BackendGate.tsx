import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiUrl } from '../config'
import useBackendHealth from '../hooks/useBackendHealth'
import type { BackendStatusPayload } from '../types/global'

type Props = {
  children: React.ReactNode
}

const statusLabel = (status?: BackendStatusPayload['status']) => {
  switch (status) {
    case 'starting':
      return 'Backend is starting'
    case 'restarting':
      return 'Backend is restarting'
    case 'backoff':
      return 'Backend crashed, waiting to retry'
    case 'crashed':
      return 'Backend crashed'
    case 'failed':
      return 'Backend unavailable'
    case 'running':
      return 'Backend is running'
    case 'stopped':
      return 'Backend stopped'
    default:
      return 'Backend status unknown'
  }
}

function buildErrorDetails(
  healthMessage?: string,
  backend?: BackendStatusPayload,
  paths?: { logDir: string; backendLog: string },
) {
  const details: string[] = []
  if (backend?.reason === 'port-in-use') {
    details.push(`Port ${backend.port} is already in use.`)
  } else if (backend?.reason === 'missing-backend') {
    details.push('Backend files not found. Please reinstall or rebuild the app.')
  } else if (backend?.reason === 'max-retries') {
    details.push('Backend reached maximum restart attempts. Please review logs and restart.')
  }

  if (healthMessage) {
    details.push(healthMessage)
  }

  if (paths?.backendLog) {
    details.push(`Check backend log: ${paths.backendLog}`)
  }

  return details
}

export function BackendGate({ children }: Props) {
  const { status: health, backendStatus, retry } = useBackendHealth()
  const [paths, setPaths] = useState<{ dataDir: string; logDir: string; backendLog: string }>()

  useEffect(() => {
    window.appBridge?.getAppPaths?.().then((value) => {
      if (value) setPaths(value)
    })
  }, [])

  const criticalStatuses: BackendStatusPayload['status'][] = ['backoff', 'crashed', 'failed']

  const isBlocking =
    health.status !== 'ready' ||
    (backendStatus?.status ? criticalStatuses.includes(backendStatus.status) : false)

  const detailLines = useMemo(
    () => buildErrorDetails(health.message, backendStatus, paths),
    [backendStatus, health.message, paths],
  )

  const handleRestart = async () => {
    await window.appBridge?.restartBackend?.()
    retry()
  }

  const handleRetry = () => {
    retry()
  }

  if (!isBlocking) {
    return <>{children}</>
  }

  return (
    <div className="startup-gate">
      <div className="startup-gate__panel">
        <div className="startup-gate__header">
          <h2>Backend status</h2>
          <p className="startup-gate__status">{statusLabel(backendStatus?.status)}</p>
        </div>

        <div className="startup-gate__meta">
          <div>
            <div className="label">API base</div>
            <div className="value">{API_BASE || '(same origin)'}</div>
          </div>
          <div>
            <div className="label">API</div>
            <div className="value">{apiUrl('/api/health')}</div>
          </div>
          <div>
            <div className="label">Port</div>
            <div className="value">{backendStatus?.port ?? 'Unknown'}</div>
          </div>
          {paths?.logDir ? (
            <div>
              <div className="label">Logs</div>
              <div className="value">{paths.logDir}</div>
            </div>
          ) : null}
        </div>

        {detailLines.length > 0 ? (
          <div className="startup-gate__details">
            {detailLines.map((line) => (
              <div key={line} className="detail-line">
                {line}
              </div>
            ))}
          </div>
        ) : null}

        <div className="startup-gate__actions">
          <button className="btn" onClick={handleRetry}>Retry</button>
          <button className="btn btn--secondary" onClick={handleRestart}>
            Restart Backend
          </button>
          <button className="btn btn--ghost" onClick={() => window.appBridge?.openLogsFolder?.()}>
            Open Logs Folder
          </button>
        </div>
      </div>
    </div>
  )
}

export default BackendGate
