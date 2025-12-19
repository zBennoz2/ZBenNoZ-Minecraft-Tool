import React, { useMemo, useState } from 'react'
import { SUPPORT_WEBSITE } from '../config'
import useLicenseStatus from '../hooks/useLicenseStatus'

const friendlyStatus = (status?: string) => {
  switch (status) {
    case 'active':
      return 'Lizenz aktiv'
    case 'expired':
      return 'Lizenz abgelaufen'
    case 'device_mismatch':
      return 'Lizenz an anderes Gerät gebunden'
    case 'invalid':
      return 'Lizenz ungültig'
    case 'missing':
    default:
      return 'Lizenz erforderlich'
  }
}

type Props = { children: React.ReactNode }

export function LicenseGate({ children }: Props) {
  const { licenseState, activate, refresh, remove } = useLicenseStatus()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const statusLabel = useMemo(() => friendlyStatus(licenseState.status?.status), [licenseState.status?.status])

  const handleActivate = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const status = await activate(input.trim())
      if (status.status === 'active') {
        setSuccess('Lizenz aktiviert. Vielen Dank!')
        setInput('')
      } else {
        setError(status.message || 'Lizenz konnte nicht aktiviert werden')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Aktivierung fehlgeschlagen'
      setError(message)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await remove()
      setSuccess('Lizenz entfernt. Bitte neuen Schlüssel eingeben.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lizenz konnte nicht entfernt werden'
      setError(message)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (licenseState.state === 'ready' && licenseState.status?.status === 'active') {
    return <>{children}</>
  }

  const isLoading = licenseState.state === 'checking'
  const statusHint = licenseState.status?.message ?? licenseState.message ?? 'Lizenz erforderlich'

  return (
    <div className="license-gate">
      <div className="license-gate__panel">
        <div className="license-gate__header">
          <div>
            <p className="badge">Lizenzmodus</p>
            <h2>{statusLabel}</h2>
            <p className="page__hint">Kostenlose Lizenz erforderlich, um das Panel zu nutzen.</p>
          </div>
          <div className="license-gate__link">
            <a href={SUPPORT_WEBSITE} target="_blank" rel="noreferrer">
              Lizenz erhalten
            </a>
          </div>
        </div>

        <div className="license-gate__body">
          <div className="license-gate__status">
            <span className="label">Status</span>
            <div className="status-line">{statusLabel}</div>
            <p className="page__hint">{statusHint}</p>
            {licenseState.status?.licenseId ? (
              <div className="license-meta">
                <div>
                  <span className="label">License ID</span>
                  <div className="value">{licenseState.status.licenseId}</div>
                </div>
                {licenseState.status.expiresAt ? (
                  <div>
                    <span className="label">Gültig bis</span>
                    <div className="value">{new Date(licenseState.status.expiresAt).toLocaleString()}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="license-gate__form">
            <label htmlFor="license-token">Lizenzschlüssel / Token</label>
            <textarea
              id="license-token"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Lizenz hier einfügen"
              rows={4}
            />
            <div className="license-gate__actions">
              <button className="btn" onClick={handleActivate} disabled={busy || isLoading || !input.trim()}>
                Lizenz aktivieren
              </button>
              <button className="btn btn--secondary" onClick={refresh} disabled={busy || isLoading}>
                Status neu laden
              </button>
              <button className="btn btn--ghost" onClick={handleRemove} disabled={busy || isLoading}>
                Lizenz entfernen
              </button>
            </div>
            {error ? <div className="alert alert--error">{error}</div> : null}
            {success ? <div className="alert alert--success">{success}</div> : null}
          </div>
        </div>

        <div className="license-gate__footer">
          <p className="page__hint">
            Deine Lizenz wird lokal im Anwendungsdatenordner gespeichert und ist offline gültig. Maximaler Geräteschutz wird
            über den Geräteschlüssel erzwungen.
          </p>
        </div>
      </div>
    </div>
  )
}

export default LicenseGate
