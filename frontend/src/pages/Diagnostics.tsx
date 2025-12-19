import React, { useEffect, useMemo, useState } from 'react'
import { apiUrl, runtimeConfig } from '../config'
import type { BackendStatusPayload } from '../types/global'

interface AppInfo {
  name: string
  version: string
  platform: string
}

interface PathsInfo {
  dataDir: string
  logDir: string
  backendLog: string
}

export function DiagnosticsPage() {
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [paths, setPaths] = useState<PathsInfo>()
  const [backendStatus, setBackendStatus] = useState<BackendStatusPayload>()
  const [healthOk, setHealthOk] = useState<boolean | null>(null)

  useEffect(() => {
    window.appBridge?.getAppInfo?.().then((info) => info && setAppInfo(info))
    window.appBridge?.getAppPaths?.().then((value) => value && setPaths(value))

    const unsubscribe = window.appBridge?.onBackendStatus?.((payload) => setBackendStatus(payload))
    window.appBridge?.getBackendStatus?.().then((status) => status && setBackendStatus(status))

    const checkHealth = async () => {
      try {
        const response = await fetch(apiUrl('/api/health'))
        if (!response.ok) {
          setHealthOk(false)
          return
        }
        const payload = await response.json().catch(() => ({}))
        const ok = payload?.ok === true || payload?.status === 'ok'
        setHealthOk(ok)
      } catch (error) {
        setHealthOk(false)
      }
    }

    checkHealth()

    return () => {
      unsubscribe?.()
    }
  }, [])

  const diagnosticsText = useMemo(() => {
    const lines = [
      `App: ${appInfo?.name ?? 'Minecraft AMP'} ${appInfo?.version ?? ''}`.trim(),
      `Platform: ${runtimeConfig.platform ?? appInfo?.platform ?? 'unknown'}`,
      `Backend: ${
        healthOk === null ? 'checking' : healthOk ? 'running' : 'not running'
      } on port ${backendStatus?.port ?? 'n/a'}`,
      `API: ${apiUrl('/api/health')}`,
    ]

    if (paths?.dataDir) lines.push(`APP_DATA_DIR: ${paths.dataDir}`)
    if (paths?.logDir) lines.push(`APP_LOG_DIR: ${paths.logDir}`)
    if (paths?.backendLog) lines.push(`Backend log: ${paths.backendLog}`)

    return lines.join('\n')
  }, [
    appInfo,
    backendStatus?.port,
    backendStatus?.status,
    healthOk,
    paths?.backendLog,
    paths?.dataDir,
    paths?.logDir,
  ])

  const handleCopy = async () => {
    await window.appBridge?.copyDiagnostics?.(diagnosticsText)
  }

  const handleRestartBackend = async () => {
    await window.appBridge?.restartBackend?.()
  }

  const handleRestartApp = () => {
    window.appBridge?.restartApp?.()
  }

  return (
    <div className="page">
      <div className="page__header page__header--spread">
        <div>
          <h2>Diagnostics</h2>
          <p className="page__hint">
            Review environment details and backend health without touching any Minecraft instances.
          </p>
        </div>
        <div className="page__actions">
          <button className="btn btn--secondary" onClick={() => window.appBridge?.openLogsFolder?.()}>
            Open Logs Folder
          </button>
          <button className="btn btn--ghost" onClick={handleCopy}>
            Copy Diagnostics
          </button>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-card">
          <div className="label">App</div>
          <div className="value">{`${appInfo?.name ?? 'Minecraft AMP'} ${appInfo?.version ?? ''}`.trim()}</div>
        </div>
        <div className="info-card">
          <div className="label">Platform</div>
          <div className="value">{runtimeConfig.platform ?? appInfo?.platform ?? 'Unknown'}</div>
        </div>
        <div className="info-card">
          <div className="label">Backend Status</div>
          <div className="value">
            {healthOk === null ? 'checking...' : healthOk ? 'running' : 'unreachable'}
          </div>
          <div className="hint">Port: {backendStatus?.port ?? 'Unknown'}</div>
        </div>
        <div className="info-card">
          <div className="label">API Endpoint</div>
          <div className="value">{apiUrl('/api/health')}</div>
        </div>
        <div className="info-card">
          <div className="label">APP_DATA_DIR</div>
          <div className="value">{paths?.dataDir ?? 'Unknown'}</div>
        </div>
        <div className="info-card">
          <div className="label">APP_LOG_DIR</div>
          <div className="value">{paths?.logDir ?? 'Unknown'}</div>
        </div>
      </div>

      <div className="diagnostics-actions">
        <button className="btn" onClick={handleRestartBackend}>
          Restart Backend
        </button>
        <button className="btn btn--secondary" onClick={handleRestartApp}>
          Restart App
        </button>
      </div>
    </div>
  )
}

export default DiagnosticsPage
