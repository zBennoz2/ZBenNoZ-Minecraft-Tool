import { useEffect, useMemo, useState } from 'react'
import { SystemOverview, getSystemOverview } from '../api'
import BackButton from '../components/BackButton'

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[unitIndex]}`
}

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function SystemPage() {
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const payload = await getSystemOverview()
      setOverview(payload)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fehler beim Laden der Systemdaten'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => load(), 6000)
    return () => clearInterval(timer)
  }, [])

  const systemStatus = useMemo(() => {
    if (!overview) return 'Noch keine Daten'
    if (overview.cpu.usedPercent === null && overview.memory.usedPercent === null) {
      return 'Nur eingeschränkte Daten verfügbar'
    }
    return 'System erreichbar'
  }, [overview])

  return (
    <div className="page">
      <div className="page__toolbar">
        <BackButton />
      </div>
      <div className="page__header page__header--spread">
        <div>
          <h2>System</h2>
          <p className="page__hint">
            Überblick über CPU-, RAM- und Datenträger-Auslastung des Host-Systems.
          </p>
        </div>
        <div className="page__actions">
          <button className="btn btn--secondary" onClick={load} disabled={loading}>
            {loading ? 'Aktualisiere...' : 'Neu laden'}
          </button>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="info-grid">
        <div className="info-card">
          <div className="label">CPU Auslastung</div>
          <div className="value">{formatPercent(overview?.cpu.usedPercent)}</div>
          <div className="hint">Load Average: {overview?.loadAverage?.toFixed(2) ?? '—'}</div>
        </div>
        <div className="info-card">
          <div className="label">Arbeitsspeicher</div>
          <div className="value">{formatPercent(overview?.memory.usedPercent)}</div>
          <div className="hint">
            {formatBytes(overview?.memory.usedBytes)} / {formatBytes(overview?.memory.totalBytes)} genutzt
          </div>
        </div>
        <div className="info-card">
          <div className="label">Systemlaufzeit</div>
          <div className="value">{formatDuration(overview?.uptimeSeconds)}</div>
          <div className="hint">Stand: {overview ? new Date(overview.timestamp).toLocaleTimeString() : '—'}</div>
        </div>
        <div className="info-card">
          <div className="label">System-Check</div>
          <div className="value">{systemStatus}</div>
          <div className="hint">Alle Kernmetriken auf einen Blick</div>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__header">
          <div>
            <h3>Datenträger</h3>
            <p className="page__hint">Belegung der gemounteten Dateisysteme.</p>
          </div>
        </div>
        <div className="properties__table">
          <div className="properties__table-row properties__table-head">
            <span>Mountpoint</span>
            <span>Belegung</span>
          </div>
          {overview?.disks?.length ? (
            overview.disks.map((disk) => (
              <div
                className="properties__table-row"
                key={`${disk.filesystem}-${disk.mountpoint}`}
              >
                <div>
                  <div className="value">{disk.mountpoint}</div>
                  <div className="hint">{disk.filesystem}</div>
                </div>
                <div>
                  <div className="value">{formatPercent(disk.usedPercent)}</div>
                  <div className="hint">
                    {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="properties__table-row">
              <div className="hint">Keine Datenträgerinformationen verfügbar.</div>
              <div />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SystemPage
